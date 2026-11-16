import { loadConfig, type Hunt } from "./config.js";
import { toBaseCurrency } from "./hunter.js";
import { recordPrice, routeKey } from "./prices.js";
import { makeProvider } from "./providers/index.js";
import { addSearch, freeSearchesLeft } from "./usage.js";

export interface SurveyRequest {
  origin: string;
  destination: string;
  from: string; // ngày đầu
  to: string; // ngày cuối
  stepDays: number; // cách bao nhiêu ngày lấy 1 mẫu
  stayDays: number; // 0 = một chiều; >0 = khứ hồi, về sau N ngày
  cabinClass: Hunt["cabinClass"];
  maxStops: number;
}

export const MAX_SURVEY_SEARCHES = 120;

export function surveyDates(r: SurveyRequest): string[] {
  const out: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(r.from + "T00:00:00Z");
  const end = new Date(r.to + "T00:00:00Z");
  while (d <= end) {
    const s = d.toISOString().slice(0, 10);
    if (s >= today) out.push(s);
    d.setUTCDate(d.getUTCDate() + Math.max(1, r.stepDays));
  }
  return out;
}

/** Khảo sát giá: tìm vé 1 người lớn cho dải ngày để vẽ biểu đồ (chạy nền, mỗi lần 1 khảo sát) */
class SurveyRunner {
  state: { running: boolean; route?: string; done: number; total: number; error?: string; finishedAt?: string } = {
    running: false,
    done: 0,
    total: 0,
  };
  private cancelled = false;

  start(r: SurveyRequest) {
    if (this.state.running) throw new Error("Đang có khảo sát chạy");
    const dates = surveyDates(r);
    if (!dates.length) throw new Error("Không có ngày nào hợp lệ (đã qua)");
    if (dates.length > MAX_SURVEY_SEARCHES) throw new Error(`Tối đa ${MAX_SURVEY_SEARCHES} lượt tìm mỗi lần khảo sát (đang là ${dates.length}). Tăng "cách ngày" hoặc thu hẹp khoảng.`);
    const cfg = loadConfig();
    if (cfg.provider === "duffel" && cfg.freeSearchGuard && freeSearchesLeft() < dates.length) {
      throw new Error(`Không đủ lượt tìm miễn phí tháng này (còn ${freeSearchesLeft()}, cần ${dates.length}).`);
    }
    this.cancelled = false;
    this.state = { running: true, route: `${r.origin} → ${r.destination}`, done: 0, total: dates.length };
    void this.run(r, dates);
  }

  cancel() {
    this.cancelled = true;
  }

  private async run(r: SurveyRequest, dates: string[]) {
    const cfg = loadConfig();
    const provider = makeProvider(cfg);
    const key = routeKey(r.origin, r.destination, r.stayDays > 0, r.cabinClass);
    const hunt: Hunt = {
      id: "survey",
      enabled: true,
      origin: r.origin,
      destination: r.destination,
      departDates: { from: r.from, to: r.to },
      cabinClass: r.cabinClass,
      maxStops: r.maxStops,
      maxPrice: 1,
      autoBook: false,
      passengers: [{ type: "adult", title: "mr", gender: "m", givenName: "SURVEY", familyName: "SURVEY", bornOn: "1990-01-01", email: "survey@example.com", phone: "+84900000000" }],
    };
    console.log(`[survey] Bắt đầu khảo sát ${r.origin}→${r.destination}: ${dates.length} ngày`);
    try {
      for (const d of dates) {
        if (this.cancelled) break;
        const ret = r.stayDays > 0 ? new Date(Date.parse(d + "T00:00:00Z") + r.stayDays * 86400_000).toISOString().slice(0, 10) : undefined;
        addSearch();
        try {
          const offers = await provider.search({ hunt, departDate: d, returnDate: ret });
          let best: { p: number; a: string } | null = null;
          for (const o of offers) {
            if (o.legs.some((l) => l.segments.length - 1 > r.maxStops)) continue;
            const p = toBaseCurrency(cfg, o.totalAmount, o.currency);
            if (p !== null && (!best || p < best.p)) best = { p, a: o.airlineName };
          }
          if (best) recordPrice({ k: key, d, rd: ret, p: best.p, a: best.a, s: "survey" });
        } catch (e) {
          console.warn(`[survey] ${d}: ${(e as Error).message}`);
        }
        this.state.done++;
        await new Promise((res) => setTimeout(res, provider.name === "mock" ? 50 : 1200));
      }
      console.log(`[survey] Xong ${this.state.done}/${this.state.total} ngày ${r.origin}→${r.destination}`);
    } catch (e) {
      this.state.error = (e as Error).message;
    } finally {
      this.state.running = false;
      this.state.finishedAt = new Date().toISOString();
    }
  }
}

export const survey = new SurveyRunner();
