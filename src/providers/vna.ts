/**
 * Nguồn giá Vietnam Airlines: endpoint công khai mà lịch chọn ngày trên vietnamairlines.com dùng
 * để hiển thị "giá thấp nhất mỗi ngày". 1 request = tối đa 62 ngày, giá 1 người lớn, 1 chiều, đã gồm thuế phí.
 *
 * Chỉ dùng cho mục đích cá nhân, phi thương mại (theo điều khoản website VNA), quét thưa.
 * Không có số hiệu chuyến / giờ bay, không đặt được vé: tool báo giá, anh vào web/app VNA đặt
 * (có thể chọn "Trả sau" để giữ chỗ miễn phí rồi thanh toán sau).
 */

import { X509Certificate } from "node:crypto";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";

const HOST = "integration-middleware-website.vietnamairlines.com";
const PATH = "/api/v1/public/booking/air-best-price";
export const VNA_MAX_RANGE = 62;
export const VNA_BOOKING_URL = "https://www.vietnamairlines.com/vn/vi/home";

export interface DayPrice {
  date: string; // YYYY-MM-DD
  total: number; // tổng / 1 người lớn, đã gồm thuế phí
  base: number;
  currency: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Server của VNA không gửi kèm chứng chỉ trung gian (trình duyệt tự tải bù, Node thì không).
 * Cách xử lý giống trình duyệt: đọc địa chỉ "CA Issuers" trong chứng chỉ, tải chứng chỉ trung gian,
 * rồi kết nối lại với XÁC THỰC ĐẦY ĐỦ dựa trên kho root tin cậy (không tắt kiểm tra TLS).
 */
let extraCa: string[] = [];
let agent = new https.Agent({ keepAlive: true });

function download(url: string, redirects = 3): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { timeout: 10_000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`tải chứng chỉ trung gian lỗi HTTP ${res.statusCode}`));
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("timeout", () => req.destroy(new Error("timeout tải chứng chỉ trung gian")));
    req.on("error", reject);
  });
}

async function loadIntermediate(): Promise<void> {
  // Chỉ để ĐỌC chứng chỉ lá (lấy URL CA Issuers) – không gửi dữ liệu nào qua kết nối này
  const leaf = await new Promise<tls.DetailedPeerCertificate>((resolve, reject) => {
    const sock = tls.connect({ host: HOST, port: 443, servername: HOST, rejectUnauthorized: false }, () => {
      const c = sock.getPeerCertificate(true);
      sock.end();
      resolve(c);
    });
    sock.setTimeout(10_000, () => sock.destroy(new Error("timeout")));
    sock.on("error", reject);
  });
  const urls = (leaf.infoAccess?.["CA Issuers - URI"] ?? []) as string[];
  if (!urls.length) throw new Error("chứng chỉ VNA không có địa chỉ CA Issuers");
  const raw = await download(urls[0]);
  const text = raw.toString("latin1");
  const pem = text.includes("BEGIN CERTIFICATE") ? text : new X509Certificate(raw).toString();
  extraCa = [pem];
  agent = new https.Agent({ keepAlive: true, ca: [...tls.rootCertificates, ...extraCa] });
  console.log(`[vna] Đã nạp chứng chỉ trung gian từ ${urls[0]}`);
}

function post(body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        path: PATH,
        method: "POST",
        agent,
        timeout: 20_000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Accept: "application/json, text/plain, */*",
          Origin: "https://www.vietnamairlines.com",
          Referer: "https://www.vietnamairlines.com/",
          "Accept-Language": "vi-VN,vi;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

async function callOnce(origin: string, destination: string, start: string, range: number): Promise<DayPrice[]> {
  const body = JSON.stringify({
    route: { originLocationCode: origin, destinationLocationCode: destination, departureDateTime: start },
    tripDetails: { rangeOfDeparture: range },
    location: "VN",
  });
  let r: { status: number; text: string };
  try {
    r = await post(body);
  } catch (e: any) {
    if (e?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" && !extraCa.length) {
      await loadIntermediate();
      r = await post(body);
    } else {
      throw new Error(`VNA không kết nối được: ${e?.code ?? ""} ${e?.message ?? e}`.trim());
    }
  }
  return handle(r.status, r.text);
}

async function handle(status: number, text: string): Promise<DayPrice[]> {
  if (status < 200 || status >= 300) {
    const err: any = new Error(`VNA HTTP ${status}: ${text.slice(0, 200)}`);
    err.status = status;
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
