import fs from "node:fs";
import path from "node:path";
import type { Passenger } from "../config.js";
import type { FlightProvider, Offer, OrderInfo, SearchQuery } from "../types.js";

const AIRLINES = [
  { code: "VN", name: "Vietnam Airlines", factor: 1.35, holdable: true },
  { code: "VJ", name: "Vietjet Air", factor: 0.85, holdable: false },
  { code: "QH", name: "Bamboo Airways", factor: 1.1, holdable: true },
  { code: "VU", name: "Vietravel Airlines", factor: 0.95, holdable: true },
];

const ORDERS_FILE = path.join(process.env.DATA_DIR ?? "data", "mock-orders.json");
const loadOrders = (): Record<string, OrderInfo> =>
  fs.existsSync(ORDERS_FILE) ? JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8")) : {};
const saveOrders = (o: Record<string, OrderInfo>) => {
  fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(o, null, 2));
};

/** Provider giả lập để chạy thử luồng mà không cần API key. Giá dao động ngẫu nhiên mỗi lần quét. */
export class MockProvider implements FlightProvider {
  readonly name = "mock";

  async search(q: SearchQuery): Promise<Offer[]> {
    const { hunt } = q;
    const paxFactor = hunt.passengers.reduce(
      (s, p) => s + (p.type === "adult" ? 1 : p.type === "child" ? 0.9 : 0.1),
      0,
    );
    const offers: Offer[] = [];
    for (const al of AIRLINES) {
      for (let i = 0; i < 3; i++) {
        const hour = 6 + Math.floor(Math.random() * 16);
        const stops = Math.random() < 0.75 ? 0 : 1;
        const mkLeg = (date: string, from: string, to: string) => ({
          segments: Array.from({ length: stops + 1 }, (_, s) => ({
            carrier: al.code,
            flightNumber: `${al.code}${100 + Math.floor(Math.random() * 800)}`,
            from: s === 0 ? from : "HUI",
            to: s === stops ? to : "HUI",
            departAt: `${date}T${String(hour + s * 2).padStart(2, "0")}:${i === 0 ? "05" : "40"}:00`,
            arriveAt: `${date}T${String(hour + s * 2 + 2).padStart(2, "0")}:10:00`,
          })),
        });
        const legs = [mkLeg(q.departDate, hunt.origin, hunt.destination)];
        if (q.returnDate) legs.push(mkLeg(q.returnDate, hunt.destination, hunt.origin));
        const base = 900_000 * al.factor * (0.6 + Math.random() * 0.9) * legs.length;
        offers.push({
          id: `mock_${al.code}_${q.departDate}_${q.returnDate ?? "ow"}_${i}_${Date.now()}`,
          provider: this.name,
          airlineName: al.name,
          totalAmount: Math.round((base * paxFactor) / 1000) * 1000,
          currency: "VND",
          legs,
          holdable: al.holdable,
          paymentRequiredBy: al.holdable ? new Date(Date.now() + 24 * 3600_000).toISOString() : undefined,
          priceGuaranteeExpiresAt: al.holdable ? new Date(Date.now() + 12 * 3600_000).toISOString() : undefined,
        });
      }
    }
    return offers;
  }

  private create(offer: Offer, status: "held" | "paid"): OrderInfo {
    const o: OrderInfo = {
      orderId: `ord_mock_${Date.now()}`,
      bookingReference: Math.random().toString(36).slice(2, 8).toUpperCase(),
      status,
      totalAmount: offer.totalAmount,
      currency: offer.currency,
      paymentRequiredBy: status === "held" ? offer.paymentRequiredBy : undefined,
      priceGuaranteeExpiresAt: status === "held" ? offer.priceGuaranteeExpiresAt : undefined,
    };
    const all = loadOrders();
    all[o.orderId] = o;
    saveOrders(all);
    return o;
  }

  async book(offer: Offer, _p: Passenger[]) {
    return this.create(offer, "paid");
  }

  async hold(offer: Offer, _p: Passenger[]) {
    if (!offer.holdable) throw new Error("Offer không cho giữ chỗ");
    return this.create(offer, "held");
  }

  async getOrder(orderId: string): Promise<OrderInfo> {
    const o = loadOrders()[orderId];
    if (!o) throw new Error(`Không tìm thấy order ${orderId}`);
    if (o.status === "held" && o.paymentRequiredBy && new Date(o.paymentRequiredBy) < new Date()) o.status = "expired";
    return o;
  }

  async pay(orderId: string, amount: number, currency: string): Promise<OrderInfo> {
    const all = loadOrders();
    const o = all[orderId];
    if (!o) throw new Error(`Không tìm thấy order ${orderId}`);
    if (o.status !== "held") throw new Error(`Order đang ở trạng thái ${o.status}, không thanh toán được`);
    if (amount !== o.totalAmount || currency !== o.currency) throw new Error("Số tiền không khớp giá hiện tại");
    o.status = "paid";
    saveOrders(all);
    return o;
  }
}
