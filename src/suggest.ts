import { loadConfig, saveConfig, type Config } from "./config.js";
import { toBaseCurrency } from "./hunter.js";
import { recordPrice, routeKey } from "./prices.js";
import { vnaBestPrices } from "./providers/vna.js";

export interface SuggestQuery {
  origin: string;
  destination: string;
  departFrom: string;
  departTo: string;
  returnFrom?: string;
  returnTo?: string;
  adults: number;
  children: number;
  infants: number;
}

const q25 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * 0.25;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
};

/**
 * Gợi ý ngưỡng từ lịch giá Vietnam Airlines của đúng khoảng ngày:
 * ngưỡng = mức mà ~1/4 số ngày đang rẻ hơn (mỗi chiều), × số khách. Đồng thời lưu giá vào lịch sử biểu đồ.
 */
export async function suggestThreshold(cfg: Config, q: SuggestQuery) {
  const conv = async (o: string, d: string, from: string, to: string) => {
    const list = (await vnaBestPrices(o, d, from, to))
      .map((x) => ({ date: x.date, p: toBaseCurrency(cfg, x.total, x.currency) }))
      .filter((x): x is { date: string; p: number } => x.p !== null);
    for (const x of list) recordPrice({ k: routeKey(o, d, false, "economy"), d: x.date, p: x.p, a: "Vietnam Airlines", s: "survey" });
    return list.map((x) => x.p);
  };
  const out = await conv(q.origin, q.destination, q.departFrom, q.departTo);
  const back = q.returnFrom && q.returnTo ? await conv(q.destination, q.origin, q.returnFrom, q.returnTo) : null;
  if (!out.length || (back && !back.length)) return null;

  const minAdult = Math.min(...out) + (back ? Math.min(...back) : 0);
  const p25Adult = q25(out)! + (back ? q25(back)! : 0);
  const pax = q.adults + q.children * cfg.vnaChildFactor + q.infants * cfg.vnaInfantFactor;
  return {
    days: { out: out.length, back: back?.length ?? 0 },
    perAdult: { min: Math.round(minAdult), p25: Math.round(p25Adult) },
    total: { min: Math.round(minAdult * pax), suggested: Math.floor((p25Adult * pax) / 10_000) * 10_000 },
  };
}

/** Tháng 5 của năm sau (theo yêu cầu: chuyến mặc định Hà Nội → Nha Trang tháng 5 năm sau) */
function mayNextYear() {
  const y = new Date().getFullYear() + 1;
  return { from: `${y}-05-01`, to: `${y}-05-31`, y };
}

/** Chạy 1 lần: tạo chuyến mặc định Hà Nội → Nha Trang tháng 5 năm sau, ngưỡng lấy từ giá VNA thật */
export async function seedDefaultHunt() {
  const cfg = loadConfig();
  if (cfg.seededDefaultHunt) return;
  const { from, to, y } = mayNextYear();
  const id = `han-cxr-thang5-${y}`;
  if (cfg.hunts.some((h) => h.id === id)) {
    saveConfig({ ...cfg, seededDefaultHunt: true });
    return;
  }
  let maxPrice = 1_500_000;
  let note = "ngưỡng tạm 1.500.000đ (chưa lấy được giá VNA)";
  try {
    const s = await suggestThreshold(cfg, { origin: "HAN", destination: "CXR", departFrom: from, departTo: to, adults: 1, children: 0, infants: 0 });
    if (s) {
      maxPrice = s.total.suggested;
      note = `ngưỡng gợi ý ${maxPrice.toLocaleString("vi-VN")}đ (rẻ nhất hiện tại ${s.perAdult.min.toLocaleString("vi-VN")}đ, ${s.days.out} ngày có giá)`;
    }
  } catch (e) {
    console.warn("[seed] Không lấy được giá VNA để gợi ý ngưỡng:", (e as Error).message);
  }
  const fresh = loadConfig(); // đọc lại phòng khi người dùng vừa lưu cấu hình
  saveConfig({
    ...fresh,
    seededDefaultHunt: true,
    hunts: [
      ...fresh.hunts,
      {
        id,
        enabled: true,
        origin: "HAN",
        destination: "CXR",
        departDates: { from, to },
        cabinClass: "economy",
        maxStops: 0,
        maxPrice,
        bookingMode: "notify",
        autoBook: false,
        passengers: [{ type: "adult" }],
      },
    ],
  });
  console.log(`📝 Đã tạo chuyến mặc định ${id}: Hà Nội → Nha Trang ${from}..${to}, 1 người lớn, ${note}`);
}
