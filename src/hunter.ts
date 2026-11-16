import { modeOf, type Config, type Hunt } from "./config.js";
import { addOrder, addSearch, FREE_RATIO, freeSearchesLeft, getUsage, markGuardNotified } from "./usage.js";
import type { Notifier } from "./notifier.js";
import { recordPrice, routeKey } from "./prices.js";
import { vnaBestPrices, VNA_BOOKING_URL, type DayPrice } from "./providers/vna.js";
import type { HuntState, Storage } from "./storage.js";
import type { FlightProvider, Offer, OrderInfo, SearchQuery } from "./types.js";

export const fmt = (n: number, cur: string) =>
  new Intl.NumberFormat("vi-VN").format(Math.round(n)) + " " + cur;

export const fmtTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: process.env.TZ_DISPLAY ?? "Asia/Ho_Chi_Minh" }) : "?";

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Số ngày ở lại có nằm trong khoảng người dùng chấp nhận không */
export function stayOk(hunt: Hunt, depart: string, ret: string) {
  if (!hunt.stay) return true;
  const n = Math.round((Date.parse(ret) - Date.parse(depart)) / 86400_000);
  return n >= hunt.stay.min && n <= hunt.stay.max;
}

/** Sinh mọi tổ hợp ngày đi/ngày về hợp lệ (bỏ ngày đã qua) */
export function buildQueries(hunt: Hunt): SearchQuery[] {
  const departs = eachDay(hunt.departDates.from, hunt.departDates.to).filter((d) => d >= today());
  if (!hunt.returnDates) return departs.map((departDate) => ({ hunt, departDate }));
  const returns = eachDay(hunt.returnDates.from, hunt.returnDates.to);
  const qs: SearchQuery[] = [];
  for (const d of departs) for (const r of returns) if (r >= d && stayOk(hunt, d, r)) qs.push({ hunt, departDate: d, returnDate: r });
  return qs;
}

export function describeOffer(o: Offer): string {
  return o.legs
    .map((leg, i) => {
      const f = leg.segments[0];
      const l = leg.segments[leg.segments.length - 1];
      const stops = leg.segments.length - 1;
      return `${i === 0 ? "✈️ Đi" : "↩️ Về"}: ${leg.segments.map((s) => s.flightNumber).join("+")} ${f.from}→${l.to} ${f.departAt.slice(0, 16).replace("T", " ")}${stops ? ` (${stops} điểm dừng)` : " (bay thẳng)"}`;
    })
    .join("\n");
}

type Pick = { offer: Offer; price: number };

/** Quy đổi về tiền tệ cấu hình; null nếu thiếu tỷ giá */
export function toBaseCurrency(cfg: Config, amount: number, cur: string): number | null {
  if (cur === cfg.currency) return amount;
  const rate = cfg.fxRates[cur];
  return rate ? amount * rate : null;
}

export class Hunter {
  private warnedFx = new Set<string>();

  constructor(
    private cfg: Config,
    private provider: FlightProvider,
    private store: Storage,
    private notifier: Notifier,
  ) {}

  /** Quy đổi về tiền tệ cấu hình; trả null nếu không có tỷ giá */
  private toBase(amount: number, cur: string): number | null {
    if (cur === this.cfg.currency) return amount;
    const rate = this.cfg.fxRates[cur];
    if (rate) return amount * rate;
    if (!this.warnedFx.has(cur)) {
      this.warnedFx.add(cur);
      console.warn(`[fx] Thiếu tỷ giá ${cur}→${this.cfg.currency} trong fxRates – bỏ qua các offer bằng ${cur}`);
    }
    return null;
  }

  private matches(hunt: Hunt, o: Offer): boolean {
    for (const leg of o.legs) {
      if (leg.segments.length - 1 > hunt.maxStops) return false;
      if (hunt.airlines?.length && !leg.segments.every((s) => hunt.airlines!.includes(s.carrier))) return false;
    }
    if (hunt.departTimeWindow) {
      const t = o.legs[0]?.segments[0]?.departAt?.slice(11, 16);
      if (!t || t < hunt.departTimeWindow.from || t > hunt.departTimeWindow.to) return false;
    }
    return true;
  }

  private payHint(hunt: Hunt) {
    return `💳 Thanh toán: chạy <code>npm run pay -- ${hunt.id}</code> trên máy chạy tool${this.provider.name === "duffel" ? " (hoặc vào app.duffel.com → Orders)" : ""}`;
  }

  /** Theo dõi đơn đang giữ chỗ. Trả về true nếu hunt nên dừng săn (đang giữ/đã trả). */
  private async trackOrder(hunt: Hunt, state: HuntState): Promise<boolean> {
    const b = state.booked!;
    if (b.status === "paid") {
      console.log(`[${hunt.id}] Đã thanh toán (PNR ${b.bookingReference}) – bỏ qua`);
      return true;
    }

    let info: OrderInfo;
    try {
      info = await this.provider.getOrder(b.orderId);
    } catch (e) {
      console.error(`[${hunt.id}] Không kiểm tra được order ${b.orderId}: ${(e as Error).message}`);
      return true; // lỗi tạm thời: giữ nguyên trạng thái, không săn tiếp để tránh giữ chỗ trùng
    }
    Object.assign(b, info);

    if (info.status === "paid") {
      await this.notifier.send(`✅ <b>${hunt.id}</b> đã thanh toán xong. PNR: <b>${info.bookingReference}</b> – ${fmt(info.totalAmount, info.currency)}`);
      return true;
    }

    if (info.status === "cancelled" || info.status === "expired") {
      state.pastOrders = [...(state.pastOrders ?? []), b];
      state.booked = undefined;
      state.lastNotifiedPrice = undefined;
      await this.notifier.send(
        `⌛ <b>${hunt.id}</b>: giữ chỗ PNR ${b.bookingReference} đã ${info.status === "expired" ? "hết hạn" : "bị huỷ"} mà chưa thanh toán. Tool tiếp tục săn vé.`,
      );
      return false;
    }

    // Đang giữ chỗ → nhắc thanh toán theo các mốc
    const hoursLeft = info.paymentRequiredBy ? (new Date(info.paymentRequiredBy).getTime() - Date.now()) / 3600_000 : Infinity;
    const due = this.cfg.notify.holdReminderHours
      .filter((h) => hoursLeft <= h && !(b.remindersSent ?? []).includes(h))
      .sort((a, z) => a - z)[0];
    if (due !== undefined) {
      b.remindersSent = [...(b.remindersSent ?? []), ...this.cfg.notify.holdReminderHours.filter((h) => h >= due)];
      const guaranteeNote =
        info.priceGuaranteeExpiresAt && new Date(info.priceGuaranteeExpiresAt) < new Date()
          ? "\n⚠️ Đã hết thời gian giữ giá – giá lúc thanh toán có thể khác."
          : "";
      await this.notifier.send(
        `⏰ <b>NHẮC THANH TOÁN</b> – ${hunt.id}\nPNR <b>${b.bookingReference}</b> | ${b.airline}\nCòn khoảng <b>${Math.max(0, hoursLeft).toFixed(1)} giờ</b> (hạn ${fmtTime(info.paymentRequiredBy)})\nSố tiền hiện tại: ${fmt(info.totalAmount, info.currency)}${guaranteeNote}\n${this.payHint(hunt)}`,
      );
    } else {
      console.log(`[${hunt.id}] Đang giữ chỗ PNR ${b.bookingReference}, hạn thanh toán ${fmtTime(info.paymentRequiredBy)}`);
    }
    return true;
  }

  /**
   * Nguồn Vietnam Airlines (lịch giá): 1 request = 62 ngày giá thấp nhất / 1 người lớn.
   * Ghép chiều đi + chiều về rẻ nhất, ước tính cả đoàn, báo khi ≤ ngưỡng.
   */
  private async runCalendarHunt(hunt: Hunt) {
    const state = this.store.get(hunt.id);
    const cur = this.cfg.currency;
    const today = new Date().toISOString().slice(0, 10);
    if (hunt.departDates.to < today) {
      console.log(`[${hunt.id}] Không còn ngày bay hợp lệ (đã qua hết)`);
      return;
    }
    if (hunt.cabinClass !== "economy") console.warn(`[${hunt.id}] Nguồn VNA chỉ có giá hạng Phổ thông – bỏ qua hạng ${hunt.cabinClass}`);

    const conv = (list: DayPrice[]) =>
      list.map((d) => ({ date: d.date, p: toBaseCurrency(this.cfg, d.total, d.currency) })).filter((d): d is { date: string; p: number } => d.p !== null);

    let out: { date: string; p: number }[];
    let back: { date: string; p: number }[] = [];
    try {
      out = conv(await vnaBestPrices(hunt.origin, hunt.destination, hunt.departDates.from, hunt.departDates.to));
      if (hunt.returnDates) {
        back = conv(await vnaBestPrices(hunt.destination, hunt.origin, hunt.returnDates.from, hunt.returnDates.to));
      }
    } catch (e) {
      console.error(`[${hunt.id}] Lỗi lấy giá Vietnam Airlines: ${(e as Error).message}`);
      return;
    }
    // Lịch sử giá (mỗi chiều là một chặng 1 chiều) cho biểu đồ
    for (const d of out) recordPrice({ k: routeKey(hunt.origin, hunt.destination, false, "economy"), d: d.date, p: d.p, a: "Vietnam Airlines", s: "hunt" });
    for (const d of back) recordPrice({ k: routeKey(hunt.destination, hunt.origin, false, "economy"), d: d.date, p: d.p, a: "Vietnam Airlines", s: "hunt" });

    // Tìm tổ hợp rẻ nhất (giá / 1 người lớn)
    type Combo = { d: string; r?: string; perAdult: number };
    const combos: Combo[] = [];
    if (!hunt.returnDates) for (const o of out) combos.push({ d: o.date, perAdult: o.p });
    else
      for (const o of out)
        for (const b of back)
          if (b.date >= o.date && stayOk(hunt, o.date, b.date)) combos.push({ d: o.date, r: b.date, perAdult: o.p + b.p });
    combos.sort((a, b) => a.perAdult - b.perAdult);

    const adults = hunt.passengers.filter((p) => p.type === "adult").length;
    const children = hunt.passengers.filter((p) => p.type === "child").length;
    const infants = hunt.passengers.filter((p) => p.type === "infant").length;
    const paxFactor = adults + children * this.cfg.vnaChildFactor + infants * this.cfg.vnaInfantFactor;
    const best = combos[0];
    const total = best ? Math.round(best.perAdult * paxFactor) : null;

    this.store.addCheck(hunt.id, {
      at: new Date().toISOString(),
      departDate: best?.d ?? hunt.departDates.from,
      returnDate: best?.r,
      bestPrice: total,
      airline: "Vietnam Airlines",
      offers: combos.length,
    });
    console.log(
      `[${hunt.id}] VNA: ${out.length} ngày đi${hunt.returnDates ? `, ${back.length} ngày về` : ""}; rẻ nhất ${best ? `${best.d}${best.r ? " ⇄ " + best.r : ""}: ${fmt(best.perAdult, cur)}/người lớn ≈ ${fmt(total!, cur)} cả đoàn` : "không có giá"}`,
    );
    if (!best || total === null) return;

    if (!state.bestEver || total < state.bestEver.price) {
      state.bestEver = { price: total, at: new Date().toISOString(), airline: "Vietnam Airlines", departDate: best.d, returnDate: best.r };
    }
    if (total > hunt.maxPrice) return;

    const last = state.lastNotifiedPrice;
    if (last !== undefined && total > last * (1 - this.cfg.notify.minDropPercent / 100)) return;
    state.lastNotifiedPrice = total;

    const under = combos.filter((c) => Math.round(c.perAdult * paxFactor) <= hunt.maxPrice).slice(0, 5);
    const fmtD = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
    const mode = modeOf(hunt);
    await this.notifier.send(
      `🎯 <b>${hunt.id}</b> – Vietnam Airlines ${hunt.origin}→${hunt.destination}${hunt.returnDates ? " (khứ hồi)" : ""}\n` +
        `💰 <b>${fmt(best.perAdult, cur)}</b>/người lớn ≈ <b>${fmt(total, cur)}</b> cho ${hunt.passengers.length} khách (ngưỡng ${fmt(hunt.maxPrice, cur)})\n` +
        `📅 Ngày rẻ nhất: ${under.map((c) => `${fmtD(c.d)}${c.r ? "⇄" + fmtD(c.r) : ""} ${fmt(Math.round(c.perAdult * paxFactor), "")}`).join(" · ")}\n` +
        `👉 Đặt trên web/app VNA: ${VNA_BOOKING_URL}\n` +
        `💡 Chọn hình thức <b>Trả sau</b> để giữ chỗ miễn phí rồi thanh toán sau (thường trong 8 giờ nếu bay sau 24 giờ).` +
        (mode !== "notify" ? `\nℹ️ Nguồn VNA không tự giữ chỗ được (trang đặt vé có xác minh chống bot) – vui lòng đặt thủ công.` : "") +
        (children || infants ? `\nℹ️ Tổng cả đoàn là ước tính (trẻ em ×${this.cfg.vnaChildFactor}, em bé ×${this.cfg.vnaInfantFactor} giá người lớn).` : ""),
    );
  }

  async runHunt(hunt: Hunt, budget: { left: number }) {
    if (this.cfg.provider === "vna") return this.runCalendarHunt(hunt);
    const state = this.store.get(hunt.id);
    if (state.booked && (await this.trackOrder(hunt, state))) return;

    const queries = buildQueries(hunt);
    if (!queries.length) {
      console.log(`[${hunt.id}] Không còn ngày bay hợp lệ (đã qua hết)`);
      return;
    }

    let best: Pick | null = null;
    let bestHoldable: Pick | null = null;

    // Xoay vòng: mỗi vòng quét tiếp các tổ hợp ngày chưa quét, để mọi ngày đều được kiểm tra dần
    const start = (state.cursor ?? 0) % queries.length;
    const ordered = [...queries.slice(start), ...queries.slice(0, start)];
    let searched = 0;

    for (const q of ordered) {
      if (budget.left <= 0) {
        console.log(`[${hunt.id}] Đã quét ${searched}/${queries.length} tổ hợp ngày, phần còn lại để vòng sau`);
        break;
      }
      budget.left--;
      searched++;
      addSearch();
      try {
        const offers = await this.provider.search(q);
        let bestHere: Pick | null = null;
        for (const o of offers) {
          if (!this.matches(hunt, o)) continue;
          const price = this.toBase(o.totalAmount, o.currency);
          if (price === null) continue;
          if (!bestHere || price < bestHere.price) bestHere = { offer: o, price };
          if (o.holdable && (!bestHoldable || price < bestHoldable.price)) bestHoldable = { offer: o, price };
        }
        this.store.addCheck(hunt.id, {
          at: new Date().toISOString(),
          departDate: q.departDate,
          returnDate: q.returnDate,
          bestPrice: bestHere?.price ?? null,
          airline: bestHere?.offer.airlineName,
          offers: offers.length,
        });
        console.log(
          `[${hunt.id}] ${q.departDate}${q.returnDate ? " ⇄ " + q.returnDate : ""}: ${offers.length} offer, rẻ nhất phù hợp: ${bestHere ? fmt(bestHere.price, this.cfg.currency) + " (" + bestHere.offer.airlineName + (bestHere.offer.holdable ? ", giữ chỗ được" : "") + ")" : "không có"}`,
        );
        if (bestHere) {
          // lưu lịch sử giá / khách có ghế để vẽ biểu đồ
          const seats = hunt.passengers.filter((p) => p.type !== "infant").length || 1;
          recordPrice({
            k: routeKey(hunt.origin, hunt.destination, !!hunt.returnDates, hunt.cabinClass),
            d: q.departDate,
            rd: q.returnDate,
            p: bestHere.price / seats,
            a: bestHere.offer.airlineName,
            s: "hunt",
          });
        }
        if (bestHere && (!best || bestHere.price < best.price)) best = bestHere;
      } catch (e) {
        console.error(`[${hunt.id}] Lỗi tìm ${q.departDate}: ${(e as Error).message}`);
      }
    }
    state.cursor = (start + searched) % queries.length;

    if (!best) return;

    if (!state.bestEver || best.price < state.bestEver.price) {
      state.bestEver = {
        price: best.price,
        at: new Date().toISOString(),
        airline: best.offer.airlineName,
        departDate: best.offer.legs[0].segments[0].departAt.slice(0, 10),
        returnDate: best.offer.legs[1]?.segments[0].departAt.slice(0, 10),
      };
    }

    const mode = modeOf(hunt);
    const header = (p: Pick) =>
      `🎯 <b>${hunt.id}</b> – ${hunt.origin}→${hunt.destination} | ${hunt.passengers.length} khách\n💰 <b>${fmt(p.price, this.cfg.currency)}</b> (ngưỡng ${fmt(hunt.maxPrice, this.cfg.currency)}) – ${p.offer.airlineName}\n${describeOffer(p.offer)}`;

    // ---- Chế độ GIỮ CHỖ ----
    if (mode === "hold" && bestHoldable && bestHoldable.price <= hunt.maxPrice) {
      const p = bestHoldable;
      try {
        const order = await this.provider.hold(p.offer, hunt.passengers);
        state.booked = {
          ...order,
          at: new Date().toISOString(),
          airline: p.offer.airlineName,
          summary: describeOffer(p.offer),
          remindersSent: [],
        };
        this.store.save();
        const cheaperNote =
          best.price < p.price
            ? `\nℹ️ Có vé rẻ hơn ${fmt(best.price, this.cfg.currency)} (${best.offer.airlineName}) nhưng hãng không cho giữ chỗ.`
            : "";
        await this.notifier.send(
          `${header(p)}\n🪑 <b>ĐÃ GIỮ CHỖ</b> – PNR: <b>${order.bookingReference}</b>\nSố tiền: ${fmt(order.totalAmount, order.currency)}\n⏳ Hạn thanh toán: <b>${fmtTime(order.paymentRequiredBy)}</b>${order.priceGuaranteeExpiresAt ? `\n🔒 Giữ giá đến: ${fmtTime(order.priceGuaranteeExpiresAt)}` : "\n⚠️ Hãng chỉ giữ chỗ, không cam kết giữ giá"}${cheaperNote}\n${this.payHint(hunt)}`,
        );
      } catch (e) {
        await this.notifier.send(`${header(p)}\n❌ Giữ chỗ thất bại: ${(e as Error).message}`);
      }
      return;
    }

    if (best.price > hunt.maxPrice) return;

    // ---- Chế độ ĐẶT + TRẢ TIỀN NGAY ----
    if (mode === "instant") {
      if (process.env.ALLOW_AUTOBOOK !== "true") {
        await this.notifier.send(`${header(best)}\n⚠️ bookingMode=instant nhưng ALLOW_AUTOBOOK chưa = true trong .env → chỉ thông báo.`);
        return;
      }
      try {
        const r = await this.provider.book(best.offer, hunt.passengers);
        state.booked = { ...r, at: new Date().toISOString(), airline: best.offer.airlineName, summary: describeOffer(best.offer) };
        addOrder();
        this.store.save();
        await this.notifier.send(
          `${header(best)}\n✅ <b>ĐÃ ĐẶT VÉ</b> – PNR: <b>${r.bookingReference}</b>\nĐã thanh toán: ${fmt(r.totalAmount, r.currency)}`,
        );
      } catch (e) {
        await this.notifier.send(`${header(best)}\n❌ Đặt vé thất bại: ${(e as Error).message}`);
      }
      return;
    }

    // ---- Chỉ thông báo (notify, hoặc hold nhưng không có vé giữ chỗ được) ----
    const last = state.lastNotifiedPrice;
    const drop = this.cfg.notify.minDropPercent / 100;
    if (last === undefined || best.price <= last * (1 - drop)) {
      state.lastNotifiedPrice = best.price;
      const note =
        mode === "hold"
          ? "\n⚠️ Vé này hãng yêu cầu thanh toán ngay, không giữ chỗ được → vào web hãng/đại lý để đặt."
          : "\n👉 Vào web hãng/đại lý để đặt ngay.";
      await this.notifier.send(header(best) + note);
    }
  }

  /** Số lượt tìm được phép trong vòng này (giới hạn theo hạn mức miễn phí của Duffel nếu bật) */
  private async roundBudget(): Promise<number> {
    let total = this.cfg.maxSearchesPerRun;
    if (this.provider.name === "duffel" && this.cfg.freeSearchGuard) {
      const u = getUsage();
      const left = freeSearchesLeft(u);
      if (left === 0) {
        console.warn(`[budget] Đã dùng hết ${u.searches} lượt tìm miễn phí tháng ${u.month} (tỷ lệ ${FREE_RATIO}:1). Tạm dừng quét.`);
        if (!u.guardNotified) {
          markGuardNotified();
          await this.notifier.send(
            `⛔ Flight Hunter đã dùng hết hạn mức tìm kiếm miễn phí của Duffel tháng ${u.month} (${u.searches} lượt, ${u.orders} đơn).\nTool tạm dừng quét để tránh phí $0.005/lượt. Có đơn mới hoặc sang tháng sẽ tự chạy lại. Muốn chạy tiếp thì tắt "Giới hạn lượt tìm miễn phí" trong Cài đặt.`,
          );
        }
      }
      total = Math.min(total, left);
    }
    return total;
  }

  async runOnce() {
    const hunts = this.cfg.hunts.filter((h) => h.enabled);
    const budget = { left: await this.roundBudget() };
    // Chia đều lượt tìm cho các chuyến, phần dư chuyển sang chuyến sau
    for (let i = 0; i < hunts.length; i++) {
      const share = { left: Math.ceil(budget.left / (hunts.length - i)) };
      const before = share.left;
      await this.runHunt(hunts[i], share);
      budget.left -= before - share.left;
      this.store.save();
    }
  }
}
