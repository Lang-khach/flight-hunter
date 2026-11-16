import fs from "node:fs";
import path from "node:path";
import type { OrderInfo } from "./types.js";

export interface CheckRecord {
  at: string;
  departDate: string;
  returnDate?: string;
  bestPrice: number | null; // đã quy đổi ra currency cấu hình
  airline?: string;
  offers: number;
}

export interface BookedOrder extends OrderInfo {
  at: string;
  airline: string;
  summary: string;
  /** các mốc nhắc thanh toán đã gửi (giờ) */
  remindersSent?: number[];
}

export interface HuntState {
  bestEver?: { price: number; at: string; airline: string; departDate: string; returnDate?: string };
  lastNotifiedPrice?: number;
  /** đơn hiện tại (đang giữ chỗ hoặc đã thanh toán) */
  booked?: BookedOrder;
  /** đơn giữ chỗ đã hết hạn / bị huỷ */
  pastOrders?: BookedOrder[];
  /** vị trí xoay vòng tổ hợp ngày */
  cursor?: number;
  checks: CheckRecord[];
}

type DB = Record<string, HuntState>;

const FILE = process.env.DATA_FILE ?? path.join(process.env.DATA_DIR ?? "data", "state.json");
const MAX_CHECKS = 500;

export class Storage {
  private db: DB;

  constructor() {
    this.db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};
  }

  get(id: string): HuntState {
    return (this.db[id] ??= { checks: [] });
  }

  addCheck(id: string, rec: CheckRecord) {
    const s = this.get(id);
    s.checks.push(rec);
    if (s.checks.length > MAX_CHECKS) s.checks.splice(0, s.checks.length - MAX_CHECKS);
  }

  save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, FILE);
  }
}
