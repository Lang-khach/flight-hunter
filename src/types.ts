import type { Hunt, Passenger } from "./config.js";

export interface Segment {
  carrier: string; // mã IATA hãng
  flightNumber: string;
  from: string;
  to: string;
  departAt: string; // giờ địa phương ISO, ví dụ 2027-02-01T06:15:00
  arriveAt: string;
}

export interface Leg {
  segments: Segment[];
}

export interface Offer {
  id: string;
  provider: string;
  airlineName: string;
  totalAmount: number;
  currency: string;
  legs: Leg[]; // [chiều đi] hoặc [chiều đi, chiều về]
  expiresAt?: string;
  /** true = có thể giữ chỗ, trả tiền sau */
  holdable: boolean;
  /** hạn chót phải thanh toán nếu giữ chỗ */
  paymentRequiredBy?: string;
  /** đến thời điểm này giá được giữ nguyên (không phải hãng nào cũng có) */
  priceGuaranteeExpiresAt?: string;
}

export interface SearchQuery {
  hunt: Hunt;
  departDate: string;
  returnDate?: string;
}

export type OrderStatus = "held" | "paid" | "cancelled" | "expired";

export interface OrderInfo {
  orderId: string;
  bookingReference: string;
  status: OrderStatus;
  totalAmount: number;
  currency: string;
  paymentRequiredBy?: string;
  priceGuaranteeExpiresAt?: string;
}

export interface FlightProvider {
  readonly name: string;
  search(q: SearchQuery): Promise<Offer[]>;
  /** Đặt và thanh toán ngay */
  book(offer: Offer, passengers: Passenger[]): Promise<OrderInfo>;
  /** Giữ chỗ, chưa thanh toán */
  hold(offer: Offer, passengers: Passenger[]): Promise<OrderInfo>;
  getOrder(orderId: string): Promise<OrderInfo>;
  /** Thanh toán đơn đang giữ chỗ */
  pay(orderId: string, amount: number, currency: string): Promise<OrderInfo>;
}
