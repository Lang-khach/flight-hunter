import fs from "node:fs";
import path from "node:path";

/**
 * Lịch sử giá theo NGÀY BAY, tính theo 1 khách (tổng tiền / số khách có ghế).
 * Nguồn: các lần quét của chuyến săn + các lần "khảo sát giá".
 */
export interface PriceObs {
  k: string; // route key
  d: string; // ngày đi YYYY-MM-DD
  rd?: string; // ngày về
  at: string; // thời điểm quan sát
  p: number; // giá / khách, tiền tệ cấu hình
  a?: string; // hãng
  s: "hunt" | "survey";
}

const FILE = path.join(process.env.DATA_DIR ?? "data", "prices.json");
const MAX = 30_000;
let cache: PriceObs[] | null = null;

export const routeKey = (origin: string, destination: string, roundTrip: boolean, cabin: string) =>
  `${origin}-${destination}|${roundTrip ? "rt" : "ow"}|${cabin}`;

export function parseKey(k: string) {
  const [od, trip, cabin] = k.split("|");
  const [origin, destination] = od.split("-");
  return { origin, destination, roundTrip: trip === "rt", cabin };
}

function load(): PriceObs[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    cache = [];
  }
  return cache!;
}

let saveTimer: NodeJS.Timeout | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(load()));
    fs.renameSync(FILE + ".tmp", FILE);
  }, 500);
}

export function recordPrice(o: Omit<PriceObs, "at"> & { at?: string }) {
  const all = load();
  all.push({ ...o, p: Math.round(o.p), at: o.at ?? new Date().toISOString() });
  if (all.length > MAX) all.splice(0, all.length - MAX);
  scheduleSave();
}

export function flushPrices() {
  clearTimeout(saveTimer);
  if (!cache) return;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache));
}

export function listRoutes() {
  const m = new Map<string, { key: string; count: number; lastAt: string; days: Set<string> }>();
  for (const o of load()) {
    const r = m.get(o.k) ?? { key: o.k, count: 0, lastAt: o.at, days: new Set<string>() };
    r.count++;
    r.days.add(o.d);
    if (o.at > r.lastAt) r.lastAt = o.at;
    m.set(o.k, r);
  }
  return [...m.values()]
    .map((r) => ({ key: r.key, ...parseKey(r.key), observations: r.count, days: r.days.size, lastAt: r.lastAt }))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
};

/**
 * Tổng hợp cho biểu đồ.
 * - byDay: mỗi ngày bay (từ hôm nay trở đi) lấy giá của lần quét GẦN NHẤT (rẻ nhất trong lần đó, mọi ngày về),
 *   kèm giá thấp nhất từng thấy.
 * - byMonth: theo tháng bay: thấp nhất, P25, trung vị của giá hiện tại các ngày.
 * - stats + gợi ý ngưỡng = P25 giá hiện tại (≈ 1/4 số ngày rẻ hơn mức này).
 */
export function aggregate(key: string) {
  const today = new Date().toISOString().slice(0, 10);
  const obs = load().filter((o) => o.k === key);
  const days = new Map<string, { date: string; latest: number; latestAt: string; airline?: string; min: number; minAt: string; samples: number }>();
  // gom theo ngày bay; "lần quét gần nhất" = các quan sát trong vòng 6 giờ tính từ quan sát mới nhất của ngày đó
  const byDate = new Map<string, PriceObs[]>();
  for (const o of obs) (byDate.get(o.d) ?? byDate.set(o.d, []).get(o.d)!).push(o);
  for (const [date, list] of byDate) {
    list.sort((a, b) => b.at.localeCompare(a.at));
    const newest = new Date(list[0].at).getTime();
    const recent = list.filter((o) => newest - new Date(o.at).getTime() <= 6 * 3600_000);
    const cur = recent.reduce((m, o) => (o.p < m.p ? o : m));
    const low = list.reduce((m, o) => (o.p < m.p ? o : m));
    days.set(date, { date, latest: cur.p, latestAt: cur.at, airline: cur.a, min: low.p, minAt: low.at, samples: list.length });
  }
  const upcoming = [...days.values()].filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));

  const months = new Map<string, number[]>();
  for (const d of upcoming) (months.get(d.date.slice(0, 7)) ?? months.set(d.date.slice(0, 7), []).get(d.date.slice(0, 7))!).push(d.latest);
  const byMonth = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, ps]) => {
      const s = [...ps].sort((a, b) => a - b);
      return { month, min: s[0], p25: quantile(s, 0.25), median: quantile(s, 0.5), max: s[s.length - 1], days: s.length };
    });

  const all = upcoming.map((d) => d.latest).sort((a, b) => a - b);
  const p25 = quantile(all, 0.25);
  return {
    key,
    ...parseKey(key),
    byDay: upcoming,
    byMonth,
    stats: {
      days: all.length,
      min: all[0] ?? null,
      p25,
      median: quantile(all, 0.5),
      max: all[all.length - 1] ?? null,
      lowestEver: obs.length ? Math.min(...obs.map((o) => o.p)) : null,
      suggested: p25 === null ? null : Math.round(p25 / 1000) * 1000,
    },
  };
}
