import fs from "node:fs";
import path from "node:path";

/**
 * Đếm số lượt tìm (offer request) và số đơn trong tháng.
 * Duffel tính phí $0.005/lượt tìm vượt tỷ lệ 1500 lượt tìm : 1 đơn (0 đơn được tính là 1).
 */
export interface Usage {
  month: string; // YYYY-MM (UTC)
  searches: number;
  orders: number;
  guardNotified?: boolean;
}

const FILE = path.join(process.env.DATA_DIR ?? "data", "usage.json");
export const FREE_RATIO = 1500;

const thisMonth = () => new Date().toISOString().slice(0, 7);

export function getUsage(): Usage {
  try {
    const u: Usage = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (u.month === thisMonth()) return u;
  } catch {}
  return { month: thisMonth(), searches: 0, orders: 0 };
}

function save(u: Usage) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(u));
}

export function addSearch() {
  const u = getUsage();
  u.searches++;
  save(u);
}

export function addOrder() {
  const u = getUsage();
  u.orders++;
  u.guardNotified = false;
  save(u);
}

export function markGuardNotified() {
  const u = getUsage();
  u.guardNotified = true;
  save(u);
}

/** Số lượt tìm còn lại trong hạn mức miễn phí của tháng */
export function freeSearchesLeft(u = getUsage()) {
  return Math.max(0, FREE_RATIO * Math.max(1, u.orders) - u.searches);
}
