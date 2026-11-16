"use strict";
// ================= Tiện ích =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n, cur = "VND") => (n == null ? "–" : new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " " + cur);
const when = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN") : "–");
const MODE = { notify: ["Chỉ báo", "mute"], hold: ["Tự giữ chỗ", "warn"], instant: ["Tự đặt + trả", "bad"] };

const S = { user: null, tab: "dashboard", cfg: null, timer: null };

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Requested-With": "flight-hunter" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") {
    const wasIn = !!S.user;
    S.user = null;
    renderLogin(wasIn ? "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại." : "");
    throw new Error("401");
  }
  if (!res.ok) throw new Error(data.error || `Lỗi HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (bad ? " bad" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

function modal(html) {
  closeModal();
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.id = "modal";
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener("click", (e) => e.target === bg && closeModal());
  document.body.appendChild(bg);
  return bg;
}
const closeModal = () => $("#modal")?.remove();

async function busy(btn, fn) {
  const old = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Đang xử lý…"; }
  try { return await fn(); }
  catch (e) { if (e.message !== "401") toast(e.message, true); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = old; } }
}

// ================= Đăng nhập =================
function renderLogin(msg = "") {
  clearInterval(S.timer);
  closeModal();
  $("#app").innerHTML = `
  <div class="login">
    <div class="card stack">
      <div><h1>✈️ Flight Hunter</h1><div class="muted small">Đăng nhập để quản lý săn vé</div></div>
      <form data-form="login" class="stack" autocomplete="on">
        <label>Tên đăng nhập<input name="username" autocomplete="username" required autofocus /></label>
        <label>Mật khẩu<input name="password" type="password" autocomplete="current-password" required /></label>
        <div class="err" id="login-err">${esc(msg)}</div>
        <button class="btn primary" type="submit">Đăng nhập</button>
      </form>
    </div>
  </div>`;
}

// ================= Khung chính =================
const TABS = [
  ["dashboard", "Tổng quan"],
  ["charts", "Biểu đồ giá"],
  ["hunts", "Chuyến bay"],
  ["telegram", "Telegram"],
  ["settings", "Cài đặt"],
  ["logs", "Nhật ký"],
];

function renderShell() {
  $("#app").innerHTML = `
  <header class="top">
    <div class="top-inner">
      <span class="logo">✈️ Flight Hunter</span><span class="spacer"></span>
      <span class="muted small">👤 ${esc(S.user)}</span>
      <button class="btn sm" data-action="logout">Đăng xuất</button>
    </div>
    <nav class="tabs">${TABS.map(([k, v]) => `<button data-action="tab" data-tab="${k}" class="${S.tab === k ? "active" : ""}">${v}</button>`).join("")}</nav>
  </header>
  <main id="view"></main>`;
  renderTab();
}

function renderTab() {
  clearInterval(S.timer);
  $$("nav.tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === S.tab));
  ({ dashboard: viewDashboard, charts: viewCharts, hunts: viewHunts, telegram: viewTelegram, settings: viewSettings, logs: viewLogs })[S.tab]();
}

// ================= Tổng quan =================
async function viewDashboard() {
  const v = $("#view");
  const load = async () => {
    let st;
    try { st = await api("GET", "/api/status"); } catch (e) { if (e.message !== "401") v.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    if (S.tab !== "dashboard") return;
    const sc = st.scheduler || {};
    const tg = st.telegram || {};
    v.innerHTML = `
      ${st.configError ? `<div class="card err">${esc(st.configError)}</div>` : ""}
      ${tg.enabled && tg.configured ? "" : `<div class="card held"><b>Telegram chưa hoạt động.</b> <span class="muted">Bạn sẽ không nhận được báo giá / nhắc thanh toán.</span> <button class="btn sm" data-action="tab" data-tab="telegram">Cấu hình ngay</button></div>`}
      <div class="card row">
        <div class="u-tight stack">
          <div><b>Trạng thái quét</b> ${sc.running ? '<span class="badge warn">Đang quét…</span>' : '<span class="badge ok">Chờ</span>'}
            <span class="badge mute">${esc(st.provider || "")}</span></div>
          <div class="muted small">Lần trước: ${when(sc.lastRunAt)} · Lần tới: ${when(sc.nextRunAt)}</div>
          ${sc.lastError ? `<div class="err">${esc(sc.lastError)}</div>` : ""}
          ${st.usage ? `<div class="muted small">Tháng ${esc(st.usage.month)}: ${st.usage.searches} lượt tìm · ${st.usage.orders} đơn${st.provider === "duffel" ? ` · còn ${st.usage.freeLeft}/${st.usage.freeTotal} lượt miễn phí${st.usage.guard ? "" : " (đã tắt giới hạn)"}` : ""}</div>` : ""}
        </div>
        <button class="btn primary" data-action="scan" ${sc.running ? "disabled" : ""}>🔎 Quét ngay</button>
      </div>
      ${(st.hunts || []).length ? "" : `<div class="card muted">Chưa có chuyến nào. <button class="btn sm" data-action="tab" data-tab="hunts">Thêm chuyến</button></div>`}
      ${(st.hunts || []).map((h) => huntCard(h, st.currency)).join("")}`;
  };
  v.innerHTML = `<div class="card muted">Đang tải…</div>`;
  await load();
  S.timer = setInterval(load, 15000);
}

function huntCard(h, cur) {
  const b = h.booked;
  const cls = b?.status === "held" ? "held" : b?.status === "paid" ? "paid" : "";
  const [mLabel, mCls] = MODE[h.mode] || [h.mode, "mute"];
  let order = "";
  if (b?.status === "held") {
    const left = b.paymentRequiredBy ? (new Date(b.paymentRequiredBy) - Date.now()) / 3600000 : null;
    order = `<div class="u-inset card">
      <div><b>🪑 Đang giữ chỗ</b> · PNR <b class="mono">${esc(b.bookingReference)}</b> · ${esc(b.airline)}</div>
      <pre class="pre small">${esc(b.summary)}</pre>
      <div class="price">${money(b.totalAmount, b.currency)}</div>
      <div class="small">⏳ Hạn thanh toán: <b>${when(b.paymentRequiredBy)}</b>${left != null ? ` (còn ${Math.max(0, left).toFixed(1)} giờ)` : ""}</div>
      ${b.priceGuaranteeExpiresAt ? `<div class="small muted">🔒 Giữ giá đến ${when(b.priceGuaranteeExpiresAt)}</div>` : `<div class="small muted">⚠️ Hãng không cam kết giữ giá</div>`}
      <div class="u-mt1 row"><button class="btn primary" data-action="pay" data-id="${esc(h.id)}">💳 Thanh toán</button></div>
    </div>`;
  } else if (b?.status === "paid") {
    order = `<div class="u-inset card"><b>✅ Đã thanh toán</b> · PNR <b class="mono">${esc(b.bookingReference)}</b> · ${money(b.totalAmount, b.currency)}
      <pre class="pre small">${esc(b.summary || "")}</pre>
      <button class="btn sm" data-action="reset" data-id="${esc(h.id)}">Săn tiếp chuyến này</button></div>`;
  }
  return `<div class="card stack ${cls}">
    <div class="row"><h3 class="u-m0">${esc(h.route)}</h3><span class="badge ${mCls}">${mLabel}</span>
      ${h.enabled ? "" : '<span class="badge mute">Tạm dừng</span>'}<span class="spacer"></span><span class="muted small mono">${esc(h.id)}</span></div>
    <dl class="kv">
      <dt>Ngày</dt><dd>${esc(h.dates)}</dd>
      <dt>Khách</dt><dd>${h.pax}</dd>
      <dt>Ngưỡng</dt><dd>${money(h.maxPrice, cur)}</dd>
      <dt>Rẻ nhất từng thấy</dt><dd>${h.bestEver ? `<b>${money(h.bestEver.price, cur)}</b> – ${esc(h.bestEver.airline)} (${esc(h.bestEver.departDate)}${h.bestEver.returnDate ? " ⇄ " + esc(h.bestEver.returnDate) : ""})` : "–"}</dd>
      <dt>Lần quét cuối</dt><dd>${h.lastCheck ? `${when(h.lastCheck.at)} · ${money(h.lastCheck.bestPrice, cur)}` : "–"}</dd>
    </dl>
    ${order}
  </div>`;
}

async function openPay(id) {
  const m = modal(`<div class="muted">Đang lấy giá mới nhất…</div>`);
  let p;
  try { p = await api("GET", `/api/hunts/${encodeURIComponent(id)}/payment`); }
  catch (e) { if (e.message !== "401") $(".modal", m).innerHTML = `<div class="err">${esc(e.message)}</div><div class="u-mt3 row"><button class="btn" data-action="close">Đóng</button></div>`; return; }
  $(".modal", m).innerHTML = `
    <h2>Xác nhận thanh toán</h2>
    <dl class="kv">
      <dt>PNR</dt><dd class="mono"><b>${esc(p.bookingReference)}</b></dd>
      <dt>Hãng</dt><dd>${esc(p.airline)}</dd>
      <dt>Hành trình</dt><dd><pre class="pre">${esc(p.summary)}</pre></dd>
      <dt>Hành khách</dt><dd>${p.passengers.map(esc).join("<br>")}</dd>
      <dt>Hạn</dt><dd>${when(p.paymentRequiredBy)}</dd>
    </dl>
    <div class="u-my2 price">${money(p.totalAmount, p.currency)}</div>
    ${p.totalAmount !== p.heldAmount ? `<div class="err">⚠️ Giá đã thay đổi so với lúc giữ chỗ (${money(p.heldAmount, p.currency)})</div>` : ""}
    ${p.live ? `<div class="err"><b>Tài khoản LIVE – sẽ trừ tiền thật từ Duffel balance.</b></div>` : `<div class="muted small">Môi trường test – không trừ tiền thật.</div>`}
    <label class="u-mt2 check"><input type="checkbox" id="pay-ok" /> Tôi đã kiểm tra thông tin hành khách và hành trình</label>
    <div class="u-mt3 row">
      <button class="btn primary" data-action="pay-confirm" data-id="${esc(id)}" data-amount="${p.totalAmount}" data-currency="${esc(p.currency)}">Thanh toán ${money(p.totalAmount, p.currency)}</button>
      <button class="btn" data-action="close">Huỷ</button>
    </div>`;
}


// ================= Biểu đồ giá =================
const shortMoney = (v) => (v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(".0", "") + "tr" : Math.round(v / 1000) + "k");
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const CH = { key: null, month: null, data: null, meta: null, pax: null, charts: {} };

function niceMax(v) {
  if (!v) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((m) => m >= v * 1.08);
}

/** Biểu đồ cột 1 chuỗi, bắt đầu từ 0, có đường ngưỡng và tooltip. items: {label, value|null, hi, tip, valueLabel?} */
function drawBars(el, id, { items, ref, refLabel, height = 220, everyLabel = 1 }) {
  const W = Math.max(300, el.clientWidth || 600);
  const m = { t: 18, r: 8, b: 26, l: 40 };
  const iw = W - m.l - m.r, ih = height - m.t - m.b;
  const max = niceMax(Math.max(ref || 0, ...items.map((d) => d.value || 0)));
  const y = (v) => m.t + ih - (v / max) * ih;
  const band = iw / items.length;
  const bw = Math.min(28, Math.max(3, band - 2)); // khe 2px giữa các cột
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    g += `<line class="${i ? "grid-line" : "axis-line"}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
    g += `<text x="${m.l - 6}" y="${yy + 4}" text-anchor="end">${i ? shortMoney(v) : "0"}</text>`;
  }
  items.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    if (d.value != null) {
      const top = y(d.value), h = m.t + ih - top, r = Math.min(4, bw / 2, h);
      const x0 = cx - bw / 2, x1 = cx + bw / 2, yb = m.t + ih;
      g += `<path class="bar ${d.hi ? "bar-hi" : "bar-lo"}" data-bar="${i}" d="M${x0},${yb} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${yb} Z"/>`;
      if (d.valueLabel) g += `<text class="val" x="${cx}" y="${top - 5}" text-anchor="middle">${esc(d.valueLabel)}</text>`;
    }
    if (i % everyLabel === 0 || i === items.length - 1) g += `<text x="${cx}" y="${height - 8}" text-anchor="middle">${esc(d.label)}</text>`;
    g += `<rect class="hit" data-chart="${id}" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/>`;
  });
  if (ref) {
    const yy = y(ref);
    g += `<line class="ref-line" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
    g += `<text class="ref-label" x="${W - m.r}" y="${yy - 5}" text-anchor="end">${esc(refLabel)}</text>`;
  }
  CH.charts[id] = items;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-label="${esc(id)}">${g}</svg><div class="chart-tip" hidden></div>`;
}

function chartHover(e) {
  const hit = e.target.closest?.("[data-chart]");
  $$(".bar.is-hover").forEach((b) => b.classList.remove("is-hover"));
  $$(".chart-tip").forEach((t) => (t.hidden = true));
  if (!hit) return;
  const wrap = hit.closest(".chart-wrap");
  const d = CH.charts[hit.dataset.chart]?.[hit.dataset.i];
  if (!d) return;
  $(`[data-bar="${hit.dataset.i}"]`, wrap)?.classList.add("is-hover");
  const tip = $(".chart-tip", wrap);
  tip.innerHTML = d.tip;
  tip.hidden = false;
  const r = wrap.getBoundingClientRect(), hr = hit.getBoundingClientRect();
  const x = hr.left - r.left + hr.width / 2;
  tip.style.top = "0px";
  tip.style.left = Math.min(Math.max(0, x - tip.offsetWidth / 2), r.width - tip.offsetWidth) + "px";
}
document.addEventListener("pointermove", chartHover);
document.addEventListener("pointerdown", chartHover);

async function viewCharts() {
  const v = $("#view");
  v.innerHTML = `<div class="card muted">Đang tải…</div>`;
  let meta;
  try { meta = await api("GET", "/api/prices/routes"); } catch (e) { if (e.message !== "401") v.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
  CH.meta = meta;
  if (!CH.key || !meta.routes.some((r) => r.key === CH.key)) CH.key = meta.routes[0]?.key || null;
  const label = (r) => `${r.origin} → ${r.destination} · ${r.roundTrip ? "khứ hồi" : "1 chiều"} · ${r.cabin === "economy" ? "phổ thông" : r.cabin}`;
  v.innerHTML = `
    <div class="card stack">
      <div class="row"><h2 class="u-m0">Biểu đồ giá vé</h2></div>
      ${meta.routes.length
        ? `<label>Chặng bay<select id="ch-route">${meta.routes.map((r) => `<option value="${esc(r.key)}" ${r.key === CH.key ? "selected" : ""}>${esc(label(r))} (${r.days} ngày có dữ liệu)</option>`).join("")}</select></label>`
        : `<div class="muted">Chưa có dữ liệu giá. Dữ liệu tự tích luỹ mỗi lần quét chuyến săn, hoặc chạy <b>Khảo sát giá</b> bên dưới để có ngay biểu đồ theo tháng.</div>`}
    </div>
    <div id="ch-body" class="stack"></div>
    ${surveyForm()}`;
  $("#ch-route")?.addEventListener("change", (e) => { CH.key = e.target.value; CH.month = null; CH.pax = null; loadChart(); });
  if (CH.key) await loadChart();
  pollSurvey();
}

async function loadChart() {
  const body = $("#ch-body");
  if (!body) return;
  body.innerHTML = `<div class="card muted">Đang tải…</div>`;
  const data = await api("GET", "/api/prices?key=" + encodeURIComponent(CH.key));
  CH.data = data;
  const hunt = CH.meta.hunts.find((h) => h.key === CH.key);
  if (CH.pax == null) CH.pax = hunt?.seats || 1;
  const months = data.byMonth.map((m) => m.month);
  if (!CH.month || !months.includes(CH.month)) CH.month = months[0];
  renderChart();
}

function renderChart() {
  const data = CH.data, st = data.stats, cur = CH.meta.currency;
  const body = $("#ch-body");
  if (!st.days) { body.innerHTML = `<div class="card muted">Chưa có dữ liệu cho các ngày bay sắp tới trên chặng này.</div>`; return; }
  const hunts = CH.meta.hunts.filter((h) => h.key === CH.key);
  const n = CH.pax;
  const tile = (t, val, sub, cls = "") => `<div class="tile ${cls}"><div class="t">${t}</div><div class="v">${money(val, "")}</div><div class="s">${sub}</div></div>`;
  const [yy, mm] = CH.month.split("-").map(Number);
  const dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const byDate = Object.fromEntries(data.byDay.map((d) => [d.date, d]));
  const dayItems = Array.from({ length: dim }, (_, i) => {
    const date = `${CH.month}-${String(i + 1).padStart(2, "0")}`;
    const d = byDate[date];
    const wd = WD[new Date(date + "T00:00:00Z").getUTCDay()];
    return {
      label: String(i + 1),
      value: d ? d.latest : null,
      hi: d && st.suggested != null && d.latest <= st.suggested,
      tip: d
        ? `<div>${wd}, ${i + 1}/${mm}/${yy}</div><b>${money(d.latest, cur)}</b> /khách<div class="muted">${esc(d.airline || "")}</div><div class="muted">Thấp nhất từng thấy: ${money(d.min, cur)}</div><div class="muted">Cập nhật: ${when(d.latestAt)}</div>`
        : `<div>${wd}, ${i + 1}/${mm}/${yy}</div><div class="muted">Chưa có dữ liệu</div>`,
    };
  });
  const lowestMonth = data.byMonth.reduce((a, b) => (b.min < a.min ? b : a), data.byMonth[0]);
  const monthItems = data.byMonth.map((m) => {
    const [y2, m2] = m.month.split("-");
    return {
      label: `${Number(m2)}/${y2.slice(2)}`,
      value: m.min,
      hi: m.month === lowestMonth.month,
      valueLabel: shortMoney(m.min),
      tip: `<div>Tháng ${Number(m2)}/${y2} · ${m.days} ngày có dữ liệu</div><b>Thấp nhất ${money(m.min, cur)}</b><div class="muted">25% ngày rẻ nhất ≤ ${money(m.p25, cur)}</div><div class="muted">Trung vị ${money(m.median, cur)} · Cao nhất ${money(m.max, cur)}</div>`,
    };
  });
  const dayRows = data.byDay.filter((d) => d.date.startsWith(CH.month));

  body.innerHTML = `
    <div class="card stack">
      <div class="row"><h3 class="u-m0">Nên đặt ở mức nào?</h3><span class="spacer"></span>
        <label class="row small">Số khách có ghế <input id="ch-pax" type="number" min="1" max="9" value="${n}" class="u-w4" /></label></div>
      <div class="tiles">
        ${tile("Rẻ nhất hiện tại", st.min * n, `${money(st.min, cur)}/khách`)}
        ${tile("Ngưỡng gợi ý", st.suggested * n, `${money(st.suggested, cur)}/khách`, "accent")}
        ${tile("Giá phổ biến (trung vị)", st.median * n, `${money(st.median, cur)}/khách`)}
      </div>
      <div class="muted small">Ngưỡng gợi ý = mức mà khoảng 1/4 số ngày bay đang rẻ hơn (tính trên ${st.days} ngày có dữ liệu). Đặt ngưỡng ở đây: đủ thấp để là giá tốt, đủ thực tế để có thể chạm. Thấp nhất từng ghi nhận: ${money(st.lowestEver, cur)}/khách. Giá cho ${n} khách = giá/khách × ${n} (em bé tính riêng, thường rất rẻ).</div>
      ${hunts.map((h) => CH.meta.provider === "vna" && h.roundTrip
        ? `<div class="row small">Chuyến <b class="mono">${esc(h.id)}</b> là khứ hồi: ngưỡng nên ≈ (ngưỡng gợi ý chiều đi + chiều về) × số khách. Chọn chặng chiều về ở ô trên để xem.</div>`
        : `<div class="row small">Chuyến <b class="mono">${esc(h.id)}</b>: ngưỡng hiện tại ${money(h.maxPrice, cur)}
        <button class="btn sm" data-action="ch-apply" data-id="${esc(h.id)}" data-value="${st.suggested * h.seats}">Đặt ngưỡng ${money(st.suggested * h.seats, cur)} (${h.seats} khách)</button></div>`).join("")}
    </div>
    <div class="card stack">
      <h3 class="u-m0">Giá theo ngày bay – tháng ${mm}/${yy}</h3>
      <div class="seg">${data.byMonth.map((m) => { const [a, b] = m.month.split("-"); return `<button class="btn sm ${m.month === CH.month ? "on" : ""}" data-action="ch-month" data-month="${m.month}">${Number(b)}/${a}</button>`; }).join("")}</div>
      <div class="legend"><span><i class="hi"></i>≤ ngưỡng gợi ý (nên đặt)</span><span><i class="lo"></i>Cao hơn ngưỡng</span><span><i class="ref"></i>Ngưỡng gợi ý</span></div>
      <div class="chart-wrap" id="ch-days"></div>
      <div class="muted small">Giá rẻ nhất/khách ở lần quét gần nhất của từng ngày. Chạm vào cột để xem chi tiết.</div>
      <details><summary class="small">Xem bảng số liệu</summary>
        <table class="data"><thead><tr><th>Ngày</th><th class="num">Giá/khách</th><th class="num">Thấp nhất từng thấy</th><th>Hãng</th></tr></thead>
        <tbody>${dayRows.map((d) => `<tr><td>${WD[new Date(d.date + "T00:00:00Z").getUTCDay()]} ${d.date.slice(8)}/${d.date.slice(5, 7)}</td><td class="num">${money(d.latest, "")}</td><td class="num">${money(d.min, "")}</td><td>${esc(d.airline || "")}</td></tr>`).join("")}</tbody></table>
      </details>
    </div>
    <div class="card stack">
      <h3 class="u-m0">Giá thấp nhất theo tháng</h3>
      <div class="legend"><span><i class="hi"></i>Tháng rẻ nhất</span><span><i class="lo"></i>Tháng khác</span><span><i class="ref"></i>Ngưỡng gợi ý</span></div>
      <div class="chart-wrap" id="ch-months"></div>
      <details><summary class="small">Xem bảng số liệu</summary>
        <table class="data"><thead><tr><th>Tháng</th><th class="num">Thấp nhất</th><th class="num">25% rẻ nhất ≤</th><th class="num">Trung vị</th><th class="num">Số ngày</th></tr></thead>
        <tbody>${data.byMonth.map((m) => `<tr><td>${m.month.slice(5)}/${m.month.slice(0, 4)}</td><td class="num">${money(m.min, "")}</td><td class="num">${money(m.p25, "")}</td><td class="num">${money(m.median, "")}</td><td class="num">${m.days}</td></tr>`).join("")}</tbody></table>
      </details>
    </div>`;
  drawBars($("#ch-days"), "days", { items: dayItems, ref: st.suggested, refLabel: "Ngưỡng " + shortMoney(st.suggested), everyLabel: $("#ch-days").clientWidth < 500 ? 5 : 2 });
  drawBars($("#ch-months"), "months", { items: monthItems, ref: st.suggested, refLabel: "Ngưỡng " + shortMoney(st.suggested), height: 200 });
  $("#ch-pax").addEventListener("change", (e) => { CH.pax = Math.max(1, Number(e.target.value) || 1); renderChart(); });
}

function surveyForm() {
  const t = new Date(), d0 = t.toISOString().slice(0, 10);
  const d1 = new Date(t.getTime() + (CH.meta?.provider === "vna" ? 180 : 90) * 86400000).toISOString().slice(0, 10);
  const r = CH.key ? CH.meta.routes.find((x) => x.key === CH.key) : null;
  return `<form class="card stack" data-form="survey">
    <h3 class="u-m0">Khảo sát giá</h3>
    <div class="muted small">${CH.meta?.provider === "vna" ? "Lấy giá thấp nhất từng ngày của Vietnam Airlines (1 người lớn, 1 chiều, đã gồm thuế phí) – mỗi request 62 ngày, nên khảo sát cả năm chỉ vài request. Khứ hồi = khảo sát cả 2 chiều." : "Tìm giá 1 người lớn cho cả dải ngày để vẽ biểu đồ theo ngày và theo tháng. Mỗi ngày = 1 lượt tìm (Duffel miễn phí 1500 lượt/tháng nếu chưa có đơn)."}</div>
    <div class="grid2">
      <label>Điểm đi${airportInput("origin", r?.origin || "", "HAN hoặc Hà Nội")}</label>
      <label>Điểm đến${airportInput("destination", r?.destination || "", "SGN hoặc Sài Gòn")}</label>
      <label>Từ ngày<input name="from" type="date" value="${d0}" required /></label>
      <label>Đến ngày<input name="to" type="date" value="${d1}" required /></label>
      <label>Lấy mẫu<select name="stepDays"><option value="1">Mỗi ngày</option><option value="2">Cách 2 ngày</option><option value="3" selected>Cách 3 ngày</option><option value="7">Mỗi tuần</option></select></label>
      <label>Loại vé<select name="stayDays"><option value="0">1 chiều</option><option value="3">Khứ hồi, ở 3 ngày</option><option value="5">Khứ hồi, ở 5 ngày</option><option value="7">Khứ hồi, ở 7 ngày</option></select></label>
      <label>Hạng ghế<select name="cabinClass"><option value="economy">Phổ thông</option><option value="business">Thương gia</option></select></label>
      <label>Điểm dừng<select name="maxStops"><option value="0">Bay thẳng</option><option value="1">≤ 1</option></select></label>
    </div>
    <div class="small" id="sv-est"></div>
    <div id="sv-status" class="small"></div>
    <div class="row"><button class="btn primary" type="submit">Bắt đầu khảo sát</button><button type="button" class="btn" data-action="sv-cancel">Dừng</button></div>
    <div class="err" id="sv-err"></div>
  </form>`;
}

function surveyBody(f) {
  return { origin: f.origin.value, destination: f.destination.value, from: f.from.value, to: f.to.value, stepDays: Number(f.stepDays.value), stayDays: Number(f.stayDays.value), cabinClass: f.cabinClass.value, maxStops: Number(f.maxStops.value) };
}

let surveyTimer;
async function pollSurvey() {
  clearTimeout(surveyTimer);
  const el = $("#sv-status");
  if (!el) return;
  let s;
  try { s = await api("GET", "/api/survey"); } catch { return; }
  if (s.running) {
    el.innerHTML = `⏳ Đang khảo sát ${esc(s.route)}: ${s.done}/${s.total} ngày…`;
    surveyTimer = setTimeout(pollSurvey, 2000);
  } else if (s.finishedAt) {
    el.innerHTML = `✅ Khảo sát ${esc(s.route)} xong (${s.done}/${s.total}) lúc ${when(s.finishedAt)}${s.error ? ` – <span class="err">${esc(s.error)}</span>` : ""}`;
    if (S.tab === "charts" && CH.lastFinished !== s.finishedAt) {
      const first = CH.lastFinished === undefined;
      CH.lastFinished = s.finishedAt;
      if (!first) viewCharts();
    }
  }
}


// ================= Ô chọn sân bay (gợi ý tự động) =================
const AP = { cache: new Map(), timer: null };
function airportInput(name, value, placeholder) {
  return `<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" list="dl-${name}" autocomplete="off" data-airport required /><datalist id="dl-${name}"></datalist><span class="small muted" data-ap-label="${name}"></span>`;
}
async function airportSearch(q) {
  const k = q.trim().toLowerCase();
  if (AP.cache.has(k)) return AP.cache.get(k);
  const r = await api("GET", "/api/airports?limit=8&q=" + encodeURIComponent(q));
  AP.cache.set(k, r);
  return r;
}
async function onAirportInput(el) {
  clearTimeout(AP.timer);
  AP.timer = setTimeout(async () => {
    const list = await airportSearch(el.value).catch(() => []);
    const dl = document.getElementById("dl-" + el.name);
    if (dl) dl.innerHTML = list.map((a) => `<option value="${a.code}">${esc(a.city)} – ${esc(a.name)}</option>`).join("");
    showAirportLabel(el, list);
  }, 200);
}
function showAirportLabel(el, list) {
  const lab = document.querySelector(`[data-ap-label="${el.name}"]`);
  if (!lab) return;
  const code = el.value.trim().toUpperCase();
  const a = list.find((x) => x.code === code);
  lab.textContent = a ? `${a.city} – ${a.name}` : "";
}
/** Khi rời ô: nếu gõ tên (vd "da nang") thì tự đổi thành mã IATA khớp nhất */
async function resolveAirport(el) {
  const v = el.value.trim();
  if (!v) return;
  const list = await airportSearch(v).catch(() => []);
  if (!/^[A-Za-z]{3}$/.test(v) || !list.some((a) => a.code === v.toUpperCase())) {
    if (list[0]) el.value = list[0].code;
  } else el.value = v.toUpperCase();
  showAirportLabel(el, list);
}
document.addEventListener("input", (e) => { if (e.target.matches?.("[data-airport]")) onAirportInput(e.target); });
document.addEventListener("focusout", (e) => { if (e.target.matches?.("[data-airport]")) resolveAirport(e.target); });
document.addEventListener("focusin", (e) => { if (e.target.matches?.("[data-airport]")) onAirportInput(e.target); });

// ================= Chuyến bay =================
async function loadCfg() {
  S.cfg = await api("GET", "/api/config");
  return S.cfg;
}

async function viewHunts() {
  const v = $("#view");
  v.innerHTML = `<div class="card muted">Đang tải…</div>`;
  try { await loadCfg(); } catch (e) { if (e.message !== "401") v.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
  const hs = S.cfg.hunts;
  v.innerHTML = `
    <div class="row"><h2 class="u-m0">Chuyến bay cần săn (${hs.length})</h2><span class="spacer"></span>
      <button class="btn primary" data-action="hunt-new">＋ Thêm chuyến</button></div>
    ${hs.map((h, i) => {
      const [mLabel, mCls] = MODE[h.bookingMode || (h.autoBook ? "instant" : "notify")];
      return `<div class="card stack">
        <div class="row"><b>${esc(h.origin)} → ${esc(h.destination)}</b>
          <span class="badge ${mCls}">${mLabel}</span>${h.enabled ? "" : '<span class="badge mute">Tạm dừng</span>'}
          <span class="spacer"></span><span class="mono muted small">${esc(h.id)}</span></div>
        <div class="small muted">${esc(h.departDates.from)} → ${esc(h.departDates.to)}${h.returnDates ? ` · về ${esc(h.returnDates.from)} → ${esc(h.returnDates.to)}` : " · 1 chiều"}
          · ${h.passengers.length} khách · ngưỡng ${money(h.maxPrice, S.cfg.currency)}</div>
        <div class="row">
          <button class="btn sm" data-action="hunt-edit" data-i="${i}">✏️ Sửa</button>
          <button class="btn sm" data-action="hunt-toggle" data-i="${i}">${h.enabled ? "⏸ Tạm dừng" : "▶️ Bật"}</button>
          <button class="btn sm danger" data-action="hunt-del" data-i="${i}">🗑 Xoá</button>
        </div></div>`;
    }).join("")}`;
}

const blankPax = () => ({ type: "adult", title: "mr", gender: "m", givenName: "", familyName: "", bornOn: "", email: "", phone: "+84" });

function paxBlock(p, i) {
  const opt = (arr, val) => arr.map(([k, l]) => `<option value="${k}" ${k === val ? "selected" : ""}>${l}</option>`).join("");
  return `<div class="pax" data-pax>
    <div class="pax-head"><span>Hành khách ${i + 1}</span><button type="button" class="btn sm danger" data-action="pax-del">Xoá</button></div>
    <div class="grid2">
      <label>Loại<select name="type">${opt([["adult", "Người lớn (≥12)"], ["child", "Trẻ em (2–11)"], ["infant", "Em bé (<2)"]], p.type)}</select></label>
      <label>Danh xưng<select name="title">${opt([["mr", "Mr"], ["mrs", "Mrs"], ["ms", "Ms"], ["miss", "Miss"], ["dr", "Dr"]], p.title)}</select></label>
      <label>Giới tính<select name="gender">${opt([["m", "Nam"], ["f", "Nữ"]], p.gender)}</select></label>
      <label>Họ (không dấu)<input name="familyName" value="${esc(p.familyName)}" placeholder="NGUYEN" required /></label>
      <label>Tên đệm + tên (không dấu)<input name="givenName" value="${esc(p.givenName)}" placeholder="VAN AN" required /></label>
      <label>Ngày sinh<input name="bornOn" type="date" value="${esc(p.bornOn)}" required /></label>
      <label>Email<input name="email" type="email" value="${esc(p.email)}" required /></label>
      <label>Điện thoại<input name="phone" value="${esc(p.phone)}" placeholder="+84901234567" required /></label>
    </div></div>`;
}

function openHuntEditor(idx) {
  const isNew = idx == null;
  const h = isNew
    ? { id: "", enabled: true, origin: "", destination: "", departDates: { from: "", to: "" }, cabinClass: "economy", maxStops: 0, maxPrice: 0, bookingMode: "hold", passengers: [blankPax()] }
    : structuredClone(S.cfg.hunts[idx]);
  const mode = h.bookingMode || (h.autoBook ? "instant" : "notify");
  const sel = (name, arr, val) => `<select name="${name}">${arr.map(([k, l]) => `<option value="${k}" ${String(k) === String(val) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  modal(`
  <form data-form="hunt" data-idx="${isNew ? "" : idx}" class="stack">
    <h2>${isNew ? "Thêm chuyến cần săn" : "Sửa chuyến " + esc(h.id)}</h2>
    <div class="grid2">
      <label>Mã chuyến (id)<input name="id" value="${esc(h.id)}" placeholder="han-sgn-tet" pattern="[A-Za-z0-9_\\-]+" required /></label>
      <label class="u-end check"><input type="checkbox" name="enabled" ${h.enabled ? "checked" : ""} /> Đang bật</label>
      <label>Điểm đi (mã hoặc tên thành phố)${airportInput("origin", h.origin, "HAN hoặc Hà Nội")}</label>
      <label>Điểm đến (mã hoặc tên thành phố)${airportInput("destination", h.destination, "SGN hoặc Sài Gòn")}</label>
      <label>Ngày đi từ<input name="departFrom" type="date" value="${esc(h.departDates.from)}" required /></label>
      <label>Ngày đi đến<input name="departTo" type="date" value="${esc(h.departDates.to)}" required /></label>
    </div>
    <label class="check"><input type="checkbox" name="roundTrip" data-action="toggle-return" ${h.returnDates ? "checked" : ""} /> Khứ hồi</label>
    <div class="grid2" id="return-box" ${h.returnDates ? "" : "hidden"}>
      <label>Ngày về từ<input name="returnFrom" type="date" value="${esc(h.returnDates?.from)}" /></label>
      <label>Ngày về đến<input name="returnTo" type="date" value="${esc(h.returnDates?.to)}" /></label>
    </div>
    <div class="grid2">
      <label>Hạng ghế${sel("cabinClass", [["economy", "Phổ thông"], ["premium_economy", "Phổ thông đặc biệt"], ["business", "Thương gia"], ["first", "Hạng nhất"]], h.cabinClass)}</label>
      <label>Điểm dừng tối đa${sel("maxStops", [[0, "Bay thẳng"], [1, "≤ 1"], [2, "≤ 2"]], h.maxStops)}</label>
      <label>Hãng (mã IATA, cách nhau dấu phẩy)<input name="airlines" value="${esc((h.airlines || []).join(", "))}" placeholder="VN, VJ, QH (bỏ trống = tất cả)" /></label>
      <label>Cất cánh từ giờ<input name="timeFrom" type="time" value="${esc(h.departTimeWindow?.from)}" /></label>
      <label>Đến giờ<input name="timeTo" type="time" value="${esc(h.departTimeWindow?.to)}" /></label>
      <label>Ngưỡng giá – tổng cả đoàn (${esc(S.cfg.currency)})<input name="maxPrice" type="number" min="1" step="any" value="${h.maxPrice || ""}" required /></label>
    </div>
    ${S.cfg.provider === "vna" ? `<div class="card u-inset small">Nguồn <b>Vietnam Airlines</b>: tool canh giá thấp nhất mỗi ngày và báo Telegram. Không lọc được giờ bay/điểm dừng, không tự giữ chỗ (trang đặt vé VNA có xác minh chống bot) – anh đặt trên web/app VNA, chọn <b>Trả sau</b> để giữ chỗ miễn phí.</div>` : ""}
    <label>Khi giá ≤ ngưỡng${sel("bookingMode", [["notify", "Chỉ báo Telegram"], ["hold", "Tự giữ chỗ, báo tôi vào thanh toán"], ["instant", "Tự đặt + thanh toán luôn (cần ALLOW_AUTOBOOK)"]], mode)}</label>
    <div class="row"><h3 class="u-m0">Hành khách</h3><span class="muted small">Số vé = số hành khách. Tên viết như CCCD/hộ chiếu.</span></div>
    <div id="pax-list" class="stack">${h.passengers.map(paxBlock).join("")}</div>
    <button type="button" class="btn" data-action="pax-add">＋ Thêm hành khách</button>
    <div class="err" id="hunt-err"></div>
    <div class="row"><button class="btn primary" type="submit">Lưu</button><button type="button" class="btn" data-action="close">Huỷ</button></div>
  </form>`);
}

function readHuntForm(f) {
  const g = (n) => f.elements[n]?.value?.trim() ?? "";
  const h = {
    id: g("id"),
    enabled: f.elements.enabled.checked,
    origin: g("origin").toUpperCase(),
    destination: g("destination").toUpperCase(),
    departDates: { from: g("departFrom"), to: g("departTo") },
    cabinClass: g("cabinClass"),
    maxStops: Number(g("maxStops")),
    maxPrice: Number(g("maxPrice")),
    bookingMode: g("bookingMode"),
    autoBook: false,
    passengers: $$("[data-pax]", f).map((el) => {
      const v = (n) => $(`[name="${n}"]`, el).value.trim();
      return { type: v("type"), title: v("title"), gender: v("gender"), givenName: v("givenName").toUpperCase(), familyName: v("familyName").toUpperCase(), bornOn: v("bornOn"), email: v("email"), phone: v("phone").replace(/[\s.-]/g, "") };
    }),
  };
  if (f.elements.roundTrip.checked) h.returnDates = { from: g("returnFrom"), to: g("returnTo") };
  const al = g("airlines").split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase());
  if (al.length) h.airlines = al;
  if (g("timeFrom") && g("timeTo")) h.departTimeWindow = { from: g("timeFrom"), to: g("timeTo") };
  return h;
}

async function saveCfg(cfg) {
  S.cfg = await api("PUT", "/api/config", cfg);
}

// ================= Telegram =================
async function viewTelegram() {
  const v = $("#view");
  v.innerHTML = `<div class="card muted">Đang tải…</div>`;
  let t;
  try { t = await api("GET", "/api/telegram"); } catch (e) { if (e.message !== "401") v.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
  v.innerHTML = `
  <div class="card">
    <h2>Hướng dẫn nhanh</h2>
    <ol class="steps small">
      <li>Mở Telegram, chat với <b>@BotFather</b> → gửi <span class="mono">/newbot</span> → đặt tên → nhận <b>Bot token</b>.</li>
      <li>Dán token vào ô bên dưới, bấm <b>Kiểm tra</b>.</li>
      <li>Mở bot vừa tạo, bấm <b>Start</b> (hoặc thêm bot vào nhóm và nhắn 1 tin).</li>
      <li>Bấm <b>Tìm Chat ID</b> → chọn đúng cuộc trò chuyện → <b>Lưu</b> → <b>Gửi tin thử</b>.</li>
    </ol>
  </div>
  <form class="card stack" data-form="telegram">
    <h2>Cấu hình Telegram</h2>
    <label class="check"><input type="checkbox" name="enabled" ${t.enabled ? "checked" : ""} /> Bật thông báo Telegram</label>
    <label>Bot token ${t.hasToken ? `<span class="muted">(đang dùng: <span class="mono">${esc(t.botTokenMasked)}</span>${t.tokenFromEnv ? " – từ .env" : ""}; để trống nếu không đổi)</span>` : ""}
      <input name="botToken" type="password" autocomplete="off" placeholder="${t.hasToken ? "Giữ nguyên token hiện tại" : "123456789:AA..."}" /></label>
    <div class="row"><button type="button" class="btn sm" data-action="tg-check">Kiểm tra token</button><span id="tg-bot" class="small muted"></span></div>
    <label>Chat ID<input name="chatId" value="${esc(t.chatId)}" placeholder="123456789 hoặc -100… (nhóm)" /></label>
    <div class="row"><button type="button" class="btn sm" data-action="tg-detect">Tìm Chat ID</button></div>
    <div id="tg-chats" class="stack"></div>
    <div class="grid2">
      <label>Báo lại khi giá giảm thêm (%)<input name="minDropPercent" type="number" min="0" step="0.5" value="${t.minDropPercent}" /></label>
      <label>Nhắc thanh toán trước hạn (giờ, cách nhau dấu phẩy)<input name="holdReminderHours" value="${esc(t.holdReminderHours.join(", "))}" /></label>
    </div>
    <div class="err" id="tg-err"></div>
    <div class="row">
      <button class="btn primary" type="submit">Lưu</button>
      <button type="button" class="btn" data-action="tg-test">📨 Gửi tin thử</button>
    </div>
  </form>`;
}

// ================= Cài đặt =================
async function viewSettings() {
  const v = $("#view");
  v.innerHTML = `<div class="card muted">Đang tải…</div>`;
  try { await loadCfg(); } catch (e) { if (e.message !== "401") v.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
  const c = S.cfg;
  v.innerHTML = `
  <form class="card stack" data-form="general">
    <h2>Cài đặt chung</h2>
    <div class="grid2">
      <label>Nguồn dữ liệu<select name="provider"><option value="mock" ${c.provider === "mock" ? "selected" : ""}>Mock (chạy thử)</option><option value="duffel" ${c.provider === "duffel" ? "selected" : ""}>Duffel (quốc tế)</option><option value="vna" ${c.provider === "vna" ? "selected" : ""}>Vietnam Airlines (nội địa, canh giá)</option></select></label>
      <label>Tiền tệ so sánh<input name="currency" value="${esc(c.currency)}" maxlength="3" /></label>
      <label>Chu kỳ quét (phút)<input name="checkIntervalMinutes" type="number" min="1" value="${c.checkIntervalMinutes}" /></label>
      <label>Số lượt tìm tối đa mỗi vòng<input name="maxSearchesPerRun" type="number" min="1" value="${c.maxSearchesPerRun}" /></label>
    </div>
    <label class="check"><input type="checkbox" name="freeSearchGuard" ${c.freeSearchGuard ? "checked" : ""} /> Giới hạn lượt tìm trong mức miễn phí của Duffel (1500 lượt / 1 đơn / tháng)</label>
    <div class="muted small">Vượt mức Duffel tính $0.005/lượt. Ví dụ 6 lượt × 12 vòng/ngày ≈ 2.160 lượt/tháng. Nên đặt chu kỳ 2–3 giờ và khoảng ngày hẹp.</div>
    <label>Tỷ giá (mỗi dòng: MÃ=giá trị)<textarea name="fxRates" rows="4" class="mono">${esc(Object.entries(c.fxRates).map(([k, v]) => `${k}=${v}`).join("\n"))}</textarea></label>
    <div class="muted small">Duffel token đặt trong file .env (DUFFEL_TOKEN) vì lý do bảo mật.</div>
    <div class="err" id="gen-err"></div>
    <div><button class="btn primary" type="submit">Lưu</button></div>
  </form>
  <form class="card stack" data-form="password" autocomplete="off">
    <h2>Đổi mật khẩu</h2>
    <label>Mật khẩu hiện tại<input name="current" type="password" autocomplete="current-password" required /></label>
    <label>Mật khẩu mới (≥ 8 ký tự, có chữ và số)<input name="next" type="password" autocomplete="new-password" minlength="8" required /></label>
    <label>Nhập lại mật khẩu mới<input name="next2" type="password" autocomplete="new-password" required /></label>
    <div class="err" id="pw-err"></div>
    <div><button class="btn primary" type="submit">Đổi mật khẩu</button></div>
  </form>`;
}

// ================= Nhật ký =================
async function viewLogs() {
  const v = $("#view");
  v.innerHTML = `<div class="card"><div class="row"><h2 class="u-m0">Nhật ký</h2><span class="spacer"></span><button class="btn sm" data-action="logs-refresh">Làm mới</button></div><div class="u-mt1 logs" id="logs"></div></div>`;
  const load = async () => {
    let lines;
    try { lines = await api("GET", "/api/logs"); } catch { return; }
    const el = $("#logs");
    if (!el) return;
    el.innerHTML = lines.slice().reverse().map((l) => `<div class="${l.level}">${esc(new Date(l.at).toLocaleTimeString("vi-VN"))} ${esc(l.msg)}</div>`).join("") || '<div class="muted">Chưa có log</div>';
  };
  await load();
  S.timer = setInterval(load, 10000);
}

// ================= Xử lý sự kiện =================
const actions = {
  tab: (el) => { S.tab = el.dataset.tab; renderTab(); },
  close: () => closeModal(),
  logout: async () => { await api("POST", "/api/logout").catch(() => {}); S.user = null; renderLogin(); },
  scan: (el) => busy(el, async () => { await api("POST", "/api/scan"); toast("Đã bắt đầu quét"); setTimeout(() => S.tab === "dashboard" && renderTab(), 1500); }),
  pay: (el) => openPay(el.dataset.id),
  "pay-confirm": (el) => {
    if (!$("#pay-ok").checked) return toast("Hãy tích xác nhận đã kiểm tra thông tin", true);
    return busy(el, async () => {
      const r = await api("POST", `/api/hunts/${encodeURIComponent(el.dataset.id)}/pay`, { confirm: true, amount: Number(el.dataset.amount), currency: el.dataset.currency });
      closeModal();
      toast(`Đã thanh toán – PNR ${r.bookingReference}`);
      renderTab();
    });
  },
  reset: (el) => {
    if (!confirm("Săn tiếp chuyến này? Đơn đã thanh toán vẫn giữ nguyên, tool sẽ tìm và có thể giữ/đặt thêm vé mới.")) return;
    return busy(el, async () => { await api("POST", `/api/hunts/${encodeURIComponent(el.dataset.id)}/reset`); renderTab(); });
  },
  "hunt-new": () => openHuntEditor(null),
  "hunt-edit": (el) => openHuntEditor(Number(el.dataset.i)),
  "hunt-toggle": (el) => busy(el, async () => {
    const cfg = structuredClone(S.cfg);
    cfg.hunts[el.dataset.i].enabled = !cfg.hunts[el.dataset.i].enabled;
    await saveCfg(cfg); viewHunts();
  }),
  "hunt-del": (el) => {
    const h = S.cfg.hunts[el.dataset.i];
    if (!confirm(`Xoá chuyến "${h.id}"?`)) return;
    return busy(el, async () => { const cfg = structuredClone(S.cfg); cfg.hunts.splice(el.dataset.i, 1); await saveCfg(cfg); toast("Đã xoá"); viewHunts(); });
  },
  "pax-add": () => {
    const list = $("#pax-list");
    list.insertAdjacentHTML("beforeend", paxBlock(blankPax(), $$("[data-pax]", list).length));
  },
  "pax-del": (el) => {
    const list = $("#pax-list");
    if ($$("[data-pax]", list).length <= 1) return toast("Cần ít nhất 1 hành khách", true);
    el.closest("[data-pax]").remove();
    $$("[data-pax] .pax-head span", list).forEach((s, i) => (s.textContent = `Hành khách ${i + 1}`));
  },
  "toggle-return": (el) => { $("#return-box").hidden = !el.checked; },
  "tg-check": (el) => busy(el, async () => {
    const r = await api("POST", "/api/telegram/check", { botToken: $('[name="botToken"]').value });
    $("#tg-bot").innerHTML = `✅ Bot: <b>@${esc(r.username)}</b> (${esc(r.name)})`;
  }),
  "tg-detect": (el) => busy(el, async () => {
    const r = await api("POST", "/api/telegram/detect-chat", { botToken: $('[name="botToken"]').value });
    const box = $("#tg-chats");
    box.innerHTML = r.chats.length
      ? `<div class="small muted">Chọn cuộc trò chuyện nhận thông báo:</div>` + r.chats.map((c) => `<button type="button" class="btn sm" data-action="tg-pick" data-id="${esc(c.id)}">${esc(c.title)} <span class="muted">(${esc(c.type)} · ${esc(c.id)})</span></button>`).join("")
      : `<div class="err">Chưa thấy tin nhắn nào. Mở bot trên Telegram, bấm Start hoặc nhắn 1 tin, rồi bấm Tìm lại.</div>`;
  }),
  "tg-pick": (el) => { $('[name="chatId"]').value = el.dataset.id; $("#tg-chats").innerHTML = ""; toast("Đã chọn – bấm Lưu"); },
  "tg-test": (el) => busy(el, async () => { await api("POST", "/api/telegram/test"); toast("Đã gửi tin thử, kiểm tra Telegram"); }),
  "logs-refresh": () => viewLogs(),
  "ch-month": (el) => { CH.month = el.dataset.month; renderChart(); },
  "ch-apply": (el) => busy(el, async () => {
    const cfg = await loadCfg();
    const h = cfg.hunts.find((x) => x.id === el.dataset.id);
    if (!h) throw new Error("Không tìm thấy chuyến");
    h.maxPrice = Number(el.dataset.value);
    await saveCfg(cfg);
    CH.meta = await api("GET", "/api/prices/routes");
    toast(`Đã đặt ngưỡng ${money(h.maxPrice, cfg.currency)} cho ${h.id}`);
    renderChart();
  }),
  "sv-cancel": () => api("POST", "/api/survey/cancel").then(() => toast("Đã yêu cầu dừng")).catch(() => {}),
};

const forms = {
  survey: async (f) => {
    $("#sv-err").textContent = "";
    try {
      const est = await api("POST", "/api/survey", { ...surveyBody(f), dryRun: true });
      if (!confirm(`Khảo sát dùng ${est.searches} request${CH.meta?.provider === "vna" ? " tới Vietnam Airlines (mỗi request 62 ngày)" : " (lượt tìm)"}. Tiếp tục?`)) return;
      await api("POST", "/api/survey", surveyBody(f));
      CH.key = CH.meta?.provider === "vna" ? `${f.origin.value.toUpperCase()}-${f.destination.value.toUpperCase()}|ow|economy` : `${f.origin.value.toUpperCase()}-${f.destination.value.toUpperCase()}|${Number(f.stayDays.value) > 0 ? "rt" : "ow"}|${f.cabinClass.value}`;
      CH.lastFinished = null;
      pollSurvey();
    } catch (e) { if (e.message !== "401") $("#sv-err").textContent = e.message; }
  },
  login: async (f) => {
    const btn = $("button[type=submit]", f);
    btn.disabled = true;
    try {
      const r = await api("POST", "/api/login", { username: f.username.value.trim(), password: f.password.value });
      S.user = r.user;
      renderShell();
    } catch (e) { $("#login-err").textContent = e.message; f.password.value = ""; }
    finally { btn.disabled = false; }
  },
  hunt: async (f) => {
    const h = readHuntForm(f);
    const cfg = structuredClone(S.cfg);
    const idx = f.dataset.idx === "" ? null : Number(f.dataset.idx);
    if (idx == null) cfg.hunts.push(h); else cfg.hunts[idx] = h;
    const btn = $("button[type=submit]", f);
    btn.disabled = true;
    try { await saveCfg(cfg); closeModal(); toast("Đã lưu – áp dụng từ vòng quét tiếp theo"); viewHunts(); }
    catch (e) { if (e.message !== "401") $("#hunt-err").textContent = e.message; }
    finally { btn.disabled = false; }
  },
  telegram: async (f) => {
    const body = {
      enabled: f.enabled.checked,
      botToken: f.botToken.value.trim(),
      chatId: f.chatId.value.trim(),
      minDropPercent: Number(f.minDropPercent.value),
      holdReminderHours: f.holdReminderHours.value.split(/[,\s]+/).filter(Boolean).map(Number),
    };
    try { await api("PUT", "/api/telegram", body); $("#tg-err").textContent = ""; toast("Đã lưu cấu hình Telegram"); viewTelegram(); }
    catch (e) { if (e.message !== "401") $("#tg-err").textContent = e.message; }
  },
  general: async (f) => {
    const cfg = structuredClone(S.cfg);
    cfg.provider = f.provider.value;
    cfg.currency = f.currency.value.trim().toUpperCase();
    cfg.checkIntervalMinutes = Number(f.checkIntervalMinutes.value);
    cfg.maxSearchesPerRun = Number(f.maxSearchesPerRun.value);
    cfg.freeSearchGuard = f.freeSearchGuard.checked;
    cfg.fxRates = Object.fromEntries(
      f.fxRates.value.split("\n").map((l) => l.split("=").map((s) => s.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k.toUpperCase(), Number(v)]),
    );
    try { await saveCfg(cfg); $("#gen-err").textContent = ""; toast("Đã lưu cài đặt"); }
    catch (e) { if (e.message !== "401") $("#gen-err").textContent = e.message; }
  },
  password: async (f) => {
    if (f.next.value !== f.next2.value) return ($("#pw-err").textContent = "Hai mật khẩu mới không khớp");
    try {
      const r = await api("POST", "/api/password", { current: f.current.value, next: f.next.value });
      S.user = null;
      renderLogin(r.message);
    } catch (e) { if (e.message !== "401") $("#pw-err").textContent = e.message; }
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "INPUT") return;
  e.preventDefault();
  actions[el.dataset.action]?.(el, e);
});
document.addEventListener("change", (e) => {
  const el = e.target.closest("input[data-action]");
  if (el) actions[el.dataset.action]?.(el, e);
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  await Promise.all($$("[data-airport]", e.target).map(resolveAirport));
  forms[e.target.dataset.form]?.(e.target);
});

// ================= Khởi động =================
(async () => {
  try {
    const me = await api("GET", "/api/me");
    S.user = me.user;
    renderShell();
  } catch (e) {
    if (e.message !== "401") renderLogin(e.message);
  }
})();
