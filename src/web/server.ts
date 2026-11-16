import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ActionError, getPaymentInfo, payHeldOrder } from "../actions.js";
import { changePassword, destroySession, getSession, login } from "../auth.js";
import { loadConfig, modeOf, saveConfig } from "../config.js";
import { recentLogs } from "../logs.js";
import { sendTelegram, tgCall } from "../notifier.js";
import type { Scheduler } from "../scheduler.js";
import { getSettings, maskSecret, saveSettings, telegramCreds } from "../settings.js";
import type { Storage } from "../storage.js";
import { FREE_RATIO, freeSearchesLeft, getUsage } from "../usage.js";
import { aggregate, listRoutes } from "../prices.js";
import { airportByCode, searchAirports } from "../airports.js";
import { suggestThreshold } from "../suggest.js";
import { MAX_SURVEY_SEARCHES, survey, surveyCost, type SurveyRequest } from "../survey.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const COOKIE = "fh_session";
const SECURE_COOKIE = process.env.COOKIE_SECURE === "true";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

type Req = http.IncomingMessage & { user?: string; body?: any; params: Record<string, string> };
type Res = http.ServerResponse;
type Handler = (req: Req, res: Res) => Promise<void> | void;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res: Res, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function cookies(req: http.IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent) as [string, string]).filter((p) => p[0]),
  );
}

function clientIp(req: http.IncomingMessage) {
  if (TRUST_PROXY) {
    const xf = req.headers["x-forwarded-for"];
    if (typeof xf === "string" && xf) return xf.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "?";
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 200_000) throw new ActionError("Dữ liệu quá lớn", 413);
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ActionError("JSON không hợp lệ");
  }
}

export function startServer(opts: { port: number; host: string; store: Storage; scheduler: Scheduler }) {
  const { store, scheduler } = opts;
  const routes: { method: string; pattern: RegExp; keys: string[]; auth: boolean; h: Handler }[] = [];
  const route = (method: string, p: string, h: Handler, auth = true) => {
    const keys: string[] = [];
    const pattern = new RegExp("^" + p.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
    routes.push({ method, pattern, keys, auth, h });
  };

  // ---------------- Đăng nhập ----------------
  route("POST", "/api/login", (req, res) => {
    const r = login(clientIp(req), req.body.username, req.body.password);
    if (!r.ok) return send(res, r.status, { error: r.error });
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${r.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${r.maxAgeSec}${SECURE_COOKIE ? "; Secure" : ""}`,
    );
    send(res, 200, { ok: true, user: req.body.username });
  }, false);

  route("POST", "/api/logout", (req, res) => {
    destroySession(cookies(req)[COOKIE]);
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    send(res, 200, { ok: true });
  }, false);

  route("GET", "/api/healthz", (_req, res) => send(res, 200, { ok: true }), false);

  route("GET", "/api/me", (req, res) => send(res, 200, { user: req.user }));

  route("POST", "/api/password", (req, res) => {
    try {
      changePassword(req.user!, String(req.body.current ?? ""), String(req.body.next ?? ""));
    } catch (e) {
      throw new ActionError((e as Error).message);
    }
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    send(res, 200, { ok: true, message: "Đã đổi mật khẩu. Vui lòng đăng nhập lại." });
  });

  // ---------------- Tổng quan ----------------
  route("GET", "/api/status", (_req, res) => {
    let cfg;
    try {
      cfg = loadConfig();
    } catch (e) {
      return send(res, 200, { configError: (e as Error).message, hunts: [], scheduler: {} });
    }
    const { token, chatId } = telegramCreds();
    const u = getUsage();
    send(res, 200, {
      usage: { ...u, freeLeft: freeSearchesLeft(u), freeTotal: FREE_RATIO * Math.max(1, u.orders), guard: cfg.freeSearchGuard },
      provider: cfg.provider,
      currency: cfg.currency,
      telegram: { enabled: cfg.notify.telegram, configured: !!(token && chatId) },
      scheduler: {
        running: scheduler.running,
        lastRunAt: scheduler.lastRunAt,
        nextRunAt: scheduler.nextRunAt,
        lastError: scheduler.lastError,
      },
      hunts: cfg.hunts.map((h) => {
        const s = store.get(h.id);
        const lastCheck = s.checks.at(-1);
        return {
          id: h.id,
          enabled: h.enabled,
          route: `${h.origin} → ${h.destination}`,
          dates: `${h.departDates.from} → ${h.departDates.to}${h.returnDates ? ` | về ${h.returnDates.from} → ${h.returnDates.to}` : ""}`,
          pax: h.passengers.length,
          maxPrice: h.maxPrice,
          mode: modeOf(h),
          bestEver: s.bestEver,
          lastCheck,
          booked: s.booked,
        };
      }),
    });
  });

  route("POST", "/api/scan", (_req, res) => {
    if (!scheduler.trigger()) return send(res, 409, { error: "Đang có vòng quét chạy, vui lòng đợi" });
    send(res, 202, { ok: true });
  });

  route("GET", "/api/logs", (_req, res) => send(res, 200, recentLogs(250)));

  // ---------------- Cấu hình chuyến bay + cài đặt chung ----------------
  route("GET", "/api/config", (_req, res) => send(res, 200, loadConfig()));

  route("PUT", "/api/config", (req, res) => {
    try {
      const cfg = saveConfig(req.body);
      console.log(`[web] ${req.user} đã lưu cấu hình (${cfg.hunts.length} chuyến)`);
      send(res, 200, cfg);
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
    }
  });

  route("POST", "/api/hunts/:id/reset", (req, res) => {
    const s = store.get(req.params.id);
    if (s.booked?.status === "held") throw new ActionError("Đơn đang giữ chỗ – hãy thanh toán hoặc chờ hết hạn", 409);
    if (s.booked) s.pastOrders = [...(s.pastOrders ?? []), s.booked];
    s.booked = undefined;
    s.lastNotifiedPrice = undefined;
    store.save();
    send(res, 200, { ok: true });
  });

  // ---------------- Thanh toán ----------------
  route("GET", "/api/hunts/:id/payment", async (req, res) => {
    const { hunt, booked, info } = await getPaymentInfo(loadConfig(), store, req.params.id);
    send(res, 200, {
      ...info,
      airline: booked.airline,
      summary: booked.summary,
      heldAmount: booked.totalAmount,
      passengers: hunt.passengers.map((p) => `${p.familyName} ${p.givenName}`),
      live: process.env.DUFFEL_TOKEN?.startsWith("duffel_live_") ?? false,
    });
  });

  route("POST", "/api/hunts/:id/pay", async (req, res) => {
    if (req.body.confirm !== true) throw new ActionError("Thiếu xác nhận");
    const paid = await payHeldOrder(loadConfig(), store, req.params.id, {
      amount: Number(req.body.amount),
      currency: String(req.body.currency),
    });
    console.log(`[web] ${req.user} đã thanh toán ${req.params.id} (PNR ${paid.bookingReference})`);
    send(res, 200, paid);
  });

  // ---------------- Sân bay ----------------
  /** GET /api/airports?q=da nang&domestic=1&limit=10  – tìm theo mã, thành phố, tên (không dấu được) */
  route("GET", "/api/airports", (req, res) => {
    const sp = new URL(req.url ?? "", "http://x").searchParams;
    const q = (sp.get("q") ?? "").slice(0, 60);
    send(res, 200, searchAirports(q, { domesticOnly: sp.get("domestic") === "1", limit: Number(sp.get("limit")) || 10 }));
  });

  route("GET", "/api/airports/:code", (req, res) => {
    const a = airportByCode(req.params.code);
    if (!a) throw new ActionError("Không tìm thấy sân bay", 404);
    send(res, 200, a);
  });

  // ---------------- Gợi ý ngưỡng (giá VNA thật của đúng khoảng ngày) ----------------
  route("POST", "/api/suggest-threshold", async (req, res) => {
    const b = req.body;
    const date = (x: unknown) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined);
    const q = {
      origin: String(b.origin ?? "").toUpperCase(),
      destination: String(b.destination ?? "").toUpperCase(),
      departFrom: date(b.departFrom),
      departTo: date(b.departTo),
      returnFrom: date(b.returnFrom),
      returnTo: date(b.returnTo),
      adults: Math.max(0, Number(b.adults) || 0),
      children: Math.max(0, Number(b.children) || 0),
      infants: Math.max(0, Number(b.infants) || 0),
    };
    if (!/^[A-Z]{3}$/.test(q.origin) || !/^[A-Z]{3}$/.test(q.destination)) throw new ActionError("Chọn điểm đi / điểm đến trước");
    if (!q.departFrom || !q.departTo) throw new ActionError("Chọn ngày đi trước");
    if (q.adults < 1) throw new ActionError("Cần ít nhất 1 người lớn");
    let r;
    try {
      r = await suggestThreshold(loadConfig(), q as any);
    } catch (e) {
      throw new ActionError("Không lấy được giá Vietnam Airlines: " + (e as Error).message, 502);
    }
    if (!r) throw new ActionError("Vietnam Airlines chưa có giá cho khoảng ngày này (có thể chưa mở bán)", 404);
    send(res, 200, r);
  });

  // ---------------- Biểu đồ giá ----------------
  route("GET", "/api/prices/routes", (_req, res) => {
    const cfg = loadConfig();
    send(res, 200, {
      routes: listRoutes(),
      hunts: cfg.hunts.map((h) => ({
        id: h.id,
        key: cfg.provider === "vna" ? `${h.origin}-${h.destination}|ow|economy` : `${h.origin}-${h.destination}|${h.returnDates ? "rt" : "ow"}|${h.cabinClass}`,
        seats: h.passengers.filter((p) => p.type !== "infant").length,
        roundTrip: !!h.returnDates,
        maxPrice: h.maxPrice,
      })),
      currency: cfg.currency,
      provider: cfg.provider,
    });
  });

  route("GET", "/api/prices", (req, res) => {
    const key = new URL(req.url ?? "", "http://x").searchParams.get("key");
    if (!key) throw new ActionError("Thiếu key");
    send(res, 200, aggregate(key));
  });

  route("GET", "/api/survey", (_req, res) => send(res, 200, { ...survey.state, maxSearches: MAX_SURVEY_SEARCHES }));

  route("POST", "/api/survey", (req, res) => {
    const b = req.body;
    const r: SurveyRequest = {
      origin: String(b.origin ?? "").trim().toUpperCase(),
      destination: String(b.destination ?? "").trim().toUpperCase(),
      from: String(b.from ?? ""),
      to: String(b.to ?? ""),
      stepDays: Math.max(1, Math.min(14, Number(b.stepDays) || 1)),
      stayDays: Math.max(0, Math.min(60, Number(b.stayDays) || 0)),
      cabinClass: ["economy", "premium_economy", "business", "first"].includes(b.cabinClass) ? b.cabinClass : "economy",
      maxStops: Math.max(0, Math.min(2, Number(b.maxStops) || 0)),
    };
    if (!/^[A-Z]{3}$/.test(r.origin) || !/^[A-Z]{3}$/.test(r.destination)) throw new ActionError("Mã sân bay phải gồm 3 chữ cái (IATA)");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.from) || !/^\d{4}-\d{2}-\d{2}$/.test(r.to) || r.from > r.to) throw new ActionError("Khoảng ngày không hợp lệ");
    if (b.dryRun) return send(res, 200, { searches: surveyCost(loadConfig().provider, r), freeLeft: freeSearchesLeft() });
    try {
      survey.start(r);
    } catch (e) {
      throw new ActionError((e as Error).message, 409);
    }
    console.log(`[web] ${req.user} bắt đầu khảo sát giá ${r.origin}→${r.destination}`);
    send(res, 202, survey.state);
  });

  route("POST", "/api/survey/cancel", (_req, res) => {
    survey.cancel();
    send(res, 200, { ok: true });
  });

  // ---------------- Telegram ----------------
  route("GET", "/api/telegram", (_req, res) => {
    const cfg = loadConfig();
    const st = getSettings().telegram;
    const { token, chatId } = telegramCreds();
    send(res, 200, {
      enabled: cfg.notify.telegram,
      hasToken: !!token,
      botTokenMasked: maskSecret(token),
      tokenFromEnv: !st.botToken && !!process.env.TELEGRAM_BOT_TOKEN,
      chatId,
      minDropPercent: cfg.notify.minDropPercent,
      holdReminderHours: cfg.notify.holdReminderHours,
    });
  });

  route("PUT", "/api/telegram", async (req, res) => {
    const b = req.body;
    const settings = getSettings();
    if (typeof b.botToken === "string" && b.botToken.trim()) {
      const t = b.botToken.trim();
      if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(t)) throw new ActionError("Bot token không đúng định dạng (dạng 123456:ABC...)");
      settings.telegram.botToken = t;
    }
    if (b.clearToken === true) delete settings.telegram.botToken;
    if (typeof b.chatId === "string") {
      const c = b.chatId.trim();
      if (c && !/^(-?\d+|@[A-Za-z0-9_]{5,})$/.test(c)) throw new ActionError("Chat ID phải là số (vd 123456789, nhóm: -100...) hoặc @tenkenh");
      settings.telegram.chatId = c || undefined;
    }
    const raw: any = loadConfig();
    raw.notify = {
      ...raw.notify,
      telegram: !!b.enabled,
      minDropPercent: b.minDropPercent ?? raw.notify.minDropPercent,
      holdReminderHours: Array.isArray(b.holdReminderHours) ? b.holdReminderHours.map(Number) : raw.notify.holdReminderHours,
    };
    const cfg = saveConfig(raw); // validate trước khi lưu secret
    saveSettings(settings);
    console.log(`[web] ${req.user} đã cập nhật cấu hình Telegram (bật: ${cfg.notify.telegram})`);
    send(res, 200, { ok: true });
  });

  /** Kiểm tra token: trả về tên bot */
  route("POST", "/api/telegram/check", async (req, res) => {
    const token = (req.body.botToken as string)?.trim() || telegramCreds().token;
    if (!token) throw new ActionError("Chưa có Bot token");
    try {
      const me: any = await tgCall(token, "getMe");
      send(res, 200, { ok: true, username: me.username, name: me.first_name });
    } catch (e) {
      throw new ActionError("Token không hợp lệ: " + (e as Error).message);
    }
  });

  /** Tìm Chat ID từ các tin nhắn gần đây gửi tới bot */
  route("POST", "/api/telegram/detect-chat", async (req, res) => {
    const token = (req.body.botToken as string)?.trim() || telegramCreds().token;
    if (!token) throw new ActionError("Chưa có Bot token");
    let updates: any[];
    try {
      updates = await tgCall(token, "getUpdates", { limit: 50, allowed_updates: ["message", "channel_post", "my_chat_member"] });
    } catch (e) {
      throw new ActionError("Không đọc được tin nhắn của bot: " + (e as Error).message);
    }
    const chats = new Map<string, { id: string; title: string; type: string }>();
    for (const u of updates) {
      const chat = u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat;
      if (!chat) continue;
      const title = chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? chat.username;
      chats.set(String(chat.id), { id: String(chat.id), title: title || String(chat.id), type: chat.type });
    }
    send(res, 200, { chats: [...chats.values()] });
  });

  route("POST", "/api/telegram/test", async (req, res) => {
    const { token, chatId } = telegramCreds();
    if (!token || !chatId) throw new ActionError("Cần lưu Bot token và Chat ID trước");
    try {
      await sendTelegram(`✅ <b>Flight Hunter</b>: kết nối Telegram thành công!\nGửi bởi ${req.user} lúc ${new Date().toLocaleString("vi-VN")}`, token, chatId);
    } catch (e) {
      throw new ActionError("Gửi thất bại: " + (e as Error).message);
    }
    send(res, 200, { ok: true });
  });

  // ---------------- HTTP server ----------------
  const server = http.createServer(async (rawReq, res) => {
    const req = rawReq as Req;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'",
    );

    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/healthz") return send(res, 200, { ok: true });
    try {
      if (url.pathname.startsWith("/api/")) {
        const r = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
        if (!r) return send(res, 404, { error: "Không tìm thấy" });
        // Chống CSRF: mọi request ghi phải có header riêng (form ngoài trang không gửi được) + cookie SameSite=Strict
        if (req.method !== "GET" && req.headers["x-requested-with"] !== "flight-hunter")
          return send(res, 403, { error: "Thiếu header bảo mật" });
        if (r.auth) {
          const s = getSession(cookies(req)[COOKIE]);
          if (!s) return send(res, 401, { error: "Chưa đăng nhập hoặc phiên đã hết hạn" });
          req.user = s.user;
        }
        const m = url.pathname.match(r.pattern)!;
        req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        req.body = req.method === "GET" ? {} : await readBody(req);
        return await r.h(req, res);
      }

      // File tĩnh (trang đăng nhập + ứng dụng). Dữ liệu chỉ lấy qua API có kiểm tra phiên.
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      const status = e instanceof ActionError ? e.status : 500;
      if (status === 500) console.error("[web]", (e as Error).message);
      send(res, status, { error: (e as Error).message });
    }
  });

  server.listen(opts.port, opts.host, () => {
    console.log(`🌐 Giao diện quản trị: http://${opts.host === "0.0.0.0" ? "localhost" : opts.host}:${opts.port}`);
  });
  return server;
}
