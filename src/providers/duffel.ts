import type { Passenger } from "../config.js";
import type { FlightProvider, Offer, OrderInfo, SearchQuery } from "../types.js";

const BASE = "https://api.duffel.com";

/** Tính tuổi tại một ngày cho trước */
function ageOn(bornOn: string, date: string): number {
  const b = new Date(bornOn);
  const d = new Date(date);
  let age = d.getFullYear() - b.getFullYear();
  const m = d.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) age--;
  return age;
}

function toOrderInfo(o: any): OrderInfo {
  const ps = o.payment_status ?? {};
  let status: OrderInfo["status"];
  if (o.cancelled_at || o.cancellation) status = "cancelled";
  else if (ps.paid_at || ps.awaiting_payment === false) status = "paid";
  else if (ps.payment_required_by && new Date(ps.payment_required_by) < new Date()) status = "expired";
  else status = "held";
  return {
    orderId: o.id,
    bookingReference: o.booking_reference,
    status,
    totalAmount: Number(o.total_amount),
    currency: o.total_currency,
    paymentRequiredBy: ps.payment_required_by ?? undefined,
    priceGuaranteeExpiresAt: ps.price_guarantee_expires_at ?? undefined,
  };
}

export class DuffelProvider implements FlightProvider {
  readonly name = "duffel";

  constructor(private token: string) {
    if (!token) throw new Error("Thiếu DUFFEL_TOKEN trong .env");
  }

  /**
   * Gọi API. Chỉ tự thử lại (429 / 5xx / lỗi mạng) với request an toàn để lặp: GET và tìm vé.
   * KHÔNG thử lại khi tạo đơn / thanh toán để tránh đặt trùng.
   */
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const retryable = method === "GET" || path.startsWith("/air/offer_requests");
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.callOnce<T>(method, path, body);
      } catch (e: any) {
        const status: number | undefined = e.status;
        const transient = status === undefined || status === 429 || status >= 500;
        if (!retryable || !transient || attempt >= 3) throw e;
        const wait = (e.retryAfter ?? 2 ** attempt) * 1000;
        console.warn(`[duffel] ${path} lỗi tạm thời (${status ?? "mạng"}), thử lại sau ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  private async callOnce<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Duffel-Version": "v2",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errs = (json.errors ?? []).map((e: any) => `${e.code ?? ""} ${e.message ?? ""}`).join("; ");
      const err: any = new Error(`Duffel ${method} ${path} -> HTTP ${res.status}: ${errs || res.statusText}`);
      err.status = res.status;
      err.retryAfter = Number(res.headers.get("retry-after")) || undefined;
      throw err;
    }
    return json.data as T;
  }

  async search(q: SearchQuery): Promise<Offer[]> {
    const { hunt } = q;
    const slices: any[] = [
      { origin: hunt.origin, destination: hunt.destination, departure_date: q.departDate },
    ];
    if (q.returnDate) {
      slices.push({ origin: hunt.destination, destination: hunt.origin, departure_date: q.returnDate });
    }
    // Thứ tự passengers trong request = thứ tự passengers Duffel trả về -> dùng để map khi đặt vé
    const passengers = hunt.passengers.map((p) => {
      if (p.type === "adult") return { type: "adult" };
      if (p.type === "infant") return { type: "infant_without_seat" };
      return { age: p.bornOn ? ageOn(p.bornOn, q.departDate) : 8 };
    });

    const data: any = await this.call(
      "POST",
      "/air/offer_requests?return_offers=true&supplier_timeout=20000",
      { data: { slices, passengers, cabin_class: hunt.cabinClass, max_connections: hunt.maxStops } },
    );

    return (data.offers ?? []).map((o: any): Offer => {
      const pr = o.payment_requirements ?? {};
      return {
        id: o.id,
        provider: this.name,
        airlineName: o.owner?.name ?? o.owner?.iata_code ?? "?",
        totalAmount: Number(o.total_amount),
        currency: o.total_currency,
        expiresAt: o.expires_at,
        holdable: pr.requires_instant_payment === false,
        paymentRequiredBy: pr.payment_required_by ?? undefined,
        priceGuaranteeExpiresAt: pr.price_guarantee_expires_at ?? undefined,
        legs: (o.slices ?? []).map((s: any) => ({
          segments: (s.segments ?? []).map((seg: any) => ({
            carrier: seg.marketing_carrier?.iata_code ?? seg.operating_carrier?.iata_code ?? "",
            flightNumber: `${seg.marketing_carrier?.iata_code ?? ""}${seg.marketing_carrier_flight_number ?? ""}`,
            from: seg.origin?.iata_code,
            to: seg.destination?.iata_code,
            departAt: seg.departing_at,
            arriveAt: seg.arriving_at,
          })),
        })),
      };
    });
  }

  /** Dựng body tạo order (dùng chung cho instant và hold) */
  private async createOrder(offer: Offer, passengers: Passenger[], type: "instant" | "hold") {
    // Lấy lại offer mới nhất để có giá + passenger id chính xác
    const fresh: any = await this.call("GET", `/air/offers/${offer.id}`);
    const passengerIds: string[] = (fresh.passengers ?? []).map((p: any) => p.id);
    if (passengerIds.length !== passengers.length) {
      throw new Error("Số hành khách trong offer không khớp cấu hình");
    }
    // Giá có thể đã tăng giữa lúc tìm và lúc đặt → không đặt, để vòng sau đánh giá lại
    if (fresh.total_currency !== offer.currency || Number(fresh.total_amount) > offer.totalAmount) {
      throw new Error(
        `Giá đã thay đổi: ${offer.totalAmount} ${offer.currency} → ${fresh.total_amount} ${fresh.total_currency}. Bỏ qua, sẽ xét lại ở vòng sau.`,
      );
    }
    if (type === "hold" && fresh.payment_requirements?.requires_instant_payment !== false) {
      throw new Error("Offer này không còn cho phép giữ chỗ (hãng yêu cầu thanh toán ngay)");
    }

    // Ghép em bé với người lớn
    const adultIdx = passengers.map((p, i) => (p.type === "adult" ? i : -1)).filter((i) => i >= 0);
    const infantIdx = passengers.map((p, i) => (p.type === "infant" ? i : -1)).filter((i) => i >= 0);
    const infantOf = new Map<number, string>();
    infantIdx.forEach((inf, k) => infantOf.set(adultIdx[k], passengerIds[inf]));

    const body: any = {
      data: {
        type,
        selected_offers: [offer.id],
        passengers: passengers.map((p, i) => ({
          id: passengerIds[i],
          title: p.title,
          gender: p.gender,
          given_name: p.givenName,
          family_name: p.familyName,
          born_on: p.bornOn,
          email: p.email,
          phone_number: p.phone,
          ...(infantOf.has(i) ? { infant_passenger_id: infantOf.get(i) } : {}),
        })),
      },
    };
    // hold: KHÔNG gửi payments
    if (type === "instant") {
      body.data.payments = [{ type: "balance", currency: fresh.total_currency, amount: fresh.total_amount }];
    }
    const order: any = await this.call("POST", "/air/orders", body);
    return toOrderInfo(order);
  }

  book(offer: Offer, passengers: Passenger[]) {
    return this.createOrder(offer, passengers, "instant");
  }

  hold(offer: Offer, passengers: Passenger[]) {
    return this.createOrder(offer, passengers, "hold");
  }

  async getOrder(orderId: string): Promise<OrderInfo> {
    return toOrderInfo(await this.call("GET", `/air/orders/${orderId}`));
  }

  async pay(orderId: string, amount: number, currency: string): Promise<OrderInfo> {
    await this.call("POST", "/air/payments", {
      data: { order_id: orderId, payment: { type: "balance", amount: amount.toFixed(2), currency } },
    });
    return this.getOrder(orderId);
  }
}
