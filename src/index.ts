import "dotenv/config";
import readline from "node:readline/promises";
import { getPaymentInfo, payHeldOrder } from "./actions.js";
import { hasAdmin, setAdmin } from "./auth.js";
import { ensureConfigFile, loadConfig, modeOf, type Config } from "./config.js";
import { fmt, fmtTime } from "./hunter.js";
import { installLogCapture } from "./logs.js";
import { Scheduler } from "./scheduler.js";
import { Storage } from "./storage.js";
import { flushPrices } from "./prices.js";
import { startServer } from "./web/server.js";
import { vnaBestPrices } from "./providers/vna.js";
import { seedDefaultHunt } from "./suggest.js";

function showHistory(cfg: Config, store: Storage) {
  for (const h of cfg.hunts) {
    const s = store.get(h.id);
    console.log(`\n=== ${h.id} (${h.origin}→${h.destination}, ${h.passengers.length} khách, ngưỡng ${fmt(h.maxPrice, cfg.currency)}, chế độ ${modeOf(h)})`);
    const b = s.booked;
    if (b?.status === "paid") console.log(`  ✅ Đã thanh toán: PNR ${b.bookingReference} – ${fmt(b.totalAmount, b.currency)}`);
    if (b?.status === "held")
      console.log(`  🪑 Đang giữ chỗ: PNR ${b.bookingReference} – ${fmt(b.totalAmount, b.currency)} – hạn ${fmtTime(b.paymentRequiredBy)}`);
    for (const p of s.pastOrders ?? []) console.log(`  ⌛ Đơn cũ (${p.status}): PNR ${p.bookingReference}`);
    if (s.bestEver)
      console.log(`  Rẻ nhất từng thấy: ${fmt(s.bestEver.price, cfg.currency)} – ${s.bestEver.airline} – ${s.bestEver.departDate}${s.bestEver.returnDate ? " ⇄ " + s.bestEver.returnDate : ""}`);
    for (const c of s.checks.slice(-10))
      console.log(`  ${c.at.slice(0, 16)} | ${c.departDate}${c.returnDate ? "⇄" + c.returnDate : ""} | ${c.bestPrice?.toLocaleString("vi-VN") ?? "-"} | ${c.airline ?? ""}`);
  }
}

async function ask(q: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  if (hidden && process.stdin.isTTY) {
    let prompted = false;
    (rl as any)._writeToOutput = (s: string) => {
      if (!prompted) {
        process.stdout.write(s);
        prompted = true;
      } else if (s.includes("\n") || s.includes("\r")) process.stdout.write("\n");
      else process.stdout.write("*");
    };
  }
  const a = await rl.question(q);
  rl.close();
  return a.trim();
}

/** npm run pay -- <id> [--yes] */
async function payCommand(cfg: Config, store: Storage, huntId: string | undefined, yes: boolean) {
  if (!huntId) {
    const held = cfg.hunts.filter((h) => store.get(h.id).booked?.status === "held");
    if (!held.length) return console.log("Không có đơn nào đang giữ chỗ.");
    for (const h of held) {
      const b = store.get(h.id).booked!;
      console.log(`  ${h.id}: PNR ${b.bookingReference} – ${fmt(b.totalAmount, b.currency)} – hạn ${fmtTime(b.paymentRequiredBy)}`);
    }
    return console.log("\nChạy: npm run pay -- <id>");
  }
  const { hunt, booked, info } = await getPaymentInfo(cfg, store, huntId);
  console.log(`\nĐơn ${huntId} – PNR ${info.bookingReference} – ${booked.airline}\n${booked.summary}`);
  console.log(`Hành khách: ${hunt.passengers.map((p) => `${p.familyName} ${p.givenName}`).join(", ")}`);
  console.log(`Số tiền cần trả: ${fmt(info.totalAmount, info.currency)}${info.totalAmount !== booked.totalAmount ? "  (⚠️ khác lúc giữ chỗ)" : ""}`);
  console.log(`Hạn thanh toán: ${fmtTime(info.paymentRequiredBy)}`);
  if (!yes && (await ask("\nXác nhận thanh toán? Gõ 'yes': ")).toLowerCase() !== "yes") return console.log("Đã huỷ.");
  const paid = await payHeldOrder(cfg, store, huntId, { amount: info.totalAmount, currency: info.currency });
  console.log(`✅ Đã thanh toán PNR ${paid.bookingReference}`);
}

async function setPasswordCommand() {
  const user = (await ask("Tên đăng nhập [admin]: ")) || "admin";
  const p1 = await ask("Mật khẩu mới (≥8 ký tự, có chữ và số): ", true);
  const p2 = await ask("Nhập lại mật khẩu: ", true);
  if (p1 !== p2) throw new Error("Hai lần nhập không khớp");
  setAdmin(user, p1);
  console.log(`✅ Đã lưu tài khoản quản trị "${user}"`);
}

/** Tạo tài khoản lần đầu từ ADMIN_USERNAME/ADMIN_PASSWORD trong .env */
function ensureAdmin() {
  if (hasAdmin()) return;
  const u = process.env.ADMIN_USERNAME;
  const p = process.env.ADMIN_PASSWORD;
  if (!u || !p) {
    throw new Error(
      "Chưa có tài khoản quản trị. Chạy `npm run set-password` hoặc đặt ADMIN_USERNAME + ADMIN_PASSWORD trong .env rồi khởi động lại.",
    );
  }
  setAdmin(u, p);
  console.log(`🔐 Đã tạo tài khoản quản trị "${u}" từ .env. Nên xoá ADMIN_PASSWORD khỏi .env sau lần chạy đầu.`);
}

async function main() {
  const [cmd = "start", ...rest] = process.argv.slice(2);

  if (cmd === "set-password") return setPasswordCommand();

  const store = new Storage();

  if (cmd === "history") return showHistory(loadConfig(), store);
  if (cmd === "pay") return payCommand(loadConfig(), store, rest.find((a) => !a.startsWith("-")), rest.includes("--yes"));

  const scheduler = new Scheduler(store);
  if (cmd === "once") {
    await scheduler.runNow();
    flushPrices();
    return;
  }

  if (cmd === "start") {
    installLogCapture();
    ensureConfigFile();
    ensureAdmin();
    startServer({
      port: Number(process.env.PORT ?? 8080),
      host: process.env.HOST ?? (process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1"),
      store,
      scheduler,
    });
  }
  // start = web + quét định kỳ; run = chỉ quét định kỳ (không web)
  process.on("SIGTERM", () => {
    scheduler.stop();
    flushPrices();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    console.log("\nĐang dừng...");
    scheduler.stop();
    flushPrices();
    setTimeout(() => process.exit(0), 300);
  });
  try {
    loadConfig();
  } catch (e) {
    console.error("⚠️ ", (e as Error).message);
  }
  if (cmd === "start") {
    // Kiểm tra 1 lần: server có lấy được lịch giá Vietnam Airlines không (1 request nhỏ)
    const d = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    vnaBestPrices("HAN", "SGN", d, d)
      .then((l) => console.log(`✅ Kết nối Vietnam Airlines OK (HAN→SGN ${d}: ${l[0] ? l[0].total + " " + l[0].currency : "không có giá"})`))
      .catch((e) => console.warn(`⚠️ Không lấy được giá Vietnam Airlines từ server: ${(e as Error).message}`))
      .finally(() => seedDefaultHunt().catch((e) => console.warn("[seed]", (e as Error).message)));
  }
  await scheduler.loop();
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
