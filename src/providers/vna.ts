/**
 * Nguồn giá Vietnam Airlines: endpoint công khai mà lịch chọn ngày trên vietnamairlines.com dùng
 * để hiển thị "giá thấp nhất mỗi ngày". 1 request = tối đa 62 ngày, giá 1 người lớn, 1 chiều, đã gồm thuế phí.
 *
 * Chỉ dùng cho mục đích cá nhân, phi thương mại (theo điều khoản website VNA), quét thưa.
 * Không có số hiệu chuyến / giờ bay, không đặt được vé: tool báo giá, anh vào web/app VNA đặt
 * (có thể chọn "Trả sau" để giữ chỗ miễn phí rồi thanh toán sau).
 */

const ENDPOINT = "https://integration-middleware-website.vietnamairlines.com/api/v1/public/booking/air-best-price";
export const VNA_MAX_RANGE = 62;
export const VNA_BOOKING_URL = "https://www.vietnamairlines.com/vn/vi/home";

export interface DayPrice {
  date: string; // YYYY-MM-DD
  total: number; // tổng / 1 người lớn, đã gồm thuế phí
  base: number;
  currency: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callOnce(origin: string, destination: string, start: string, range: number): Promise<DayPrice[]> {
  let res: Response;
  try {
    res = await doFetch(origin, destination, start, range);
  } catch (e: any) {
    const c = e?.cause;
    throw new Error(`VNA không kết nối được: ${c?.code ?? ""} ${c?.message ?? e.message}`.trim());
  }
  return handle(res);
}

function doFetch(origin: string, destination: string, start: string, range: number) {
  return fetch(ENDPOINT, {
    signal: AbortSignal.timeout(20_000),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.vietnamairlines.com",
      Referer: "https://www.vietnamairlines.com/",
      "Accept-Language": "vi-VN,vi;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    },
    body: JSON.stringify({
      route: { originLocationCode: origin, destinationLocationCode: destination, departureDateTime: start },
      tripDetails: { rangeOfDeparture: range },
      location: "VN",
    }),
  });
}

async function handle(res: Response): Promise<DayPrice[]> {
  const text = await res.text();
  if (!res.ok) {
    const err: any = new Error(`VNA HTTP ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`VNA trả về không phải JSON (có thể bị chặn): ${text.slice(0, 120)}`);
  }
  if (!j.success) throw new Error(`VNA lỗi: ${j.message ?? j.code}`);
  return parseBestPrices(j);
}

export function parseBestPrices(j: any): DayPrice[] {
  const out: DayPrice[] = [];
  for (const d of j?.data?.prices ?? []) {
    const p = (d.price ?? [])
      .map((x: any) => ({ total: Number(x.total), base: Number(x.base), currency: x.currencyCode }))
      .filter((x: any) => Number.isFinite(x.total) && x.total > 0)
      .sort((a: any, b: any) => a.total - b.total)[0];
    if (p && d.departureDate) out.push({ date: String(d.departureDate).slice(0, 10), ...p });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Giá thấp nhất mỗi ngày cho khoảng [from, to], tự chia thành nhiều request 62 ngày, có nghỉ giữa các request */
export async function vnaBestPrices(origin: string, destination: string, from: string, to: string): Promise<DayPrice[]> {
  const today = new Date().toISOString().slice(0, 10);
  let start = from < today ? today : from;
  const all = new Map<string, DayPrice>();
  let first = true;
  while (start <= to) {
    const days = Math.min(VNA_MAX_RANGE, Math.round((Date.parse(to) - Date.parse(start)) / 86400_000) + 1);
    if (!first) await sleep(1500 + Math.random() * 1500); // lịch sự, không dồn dập
    first = false;
    let list: DayPrice[] = [];
    for (let attempt = 1; ; attempt++) {
      try {
        list = await callOnce(origin, destination, start, days);
        break;
      } catch (e: any) {
        const transient = !e.status || e.status === 429 || e.status >= 500;
        if (!transient || attempt >= 3) throw e;
        await sleep(3000 * attempt);
      }
    }
    for (const d of list) if (d.date >= start && d.date <= to) all.set(d.date, d);
    const next = new Date(Date.parse(start) + days * 86400_000).toISOString().slice(0, 10);
    start = next;
  }
  return [...all.values()].sort((a, b) => a.date.localeCompare(b.date));
}
