import type { Config } from "../config.js";
import type { FlightProvider } from "../types.js";
import { DuffelProvider } from "./duffel.js";
import { MockProvider } from "./mock.js";

/** Nguồn "vna" không theo mô hình offer (dùng lịch giá) – các thao tác offer sẽ báo lỗi rõ ràng */
class VnaOfferStub implements FlightProvider {
  readonly name = "vna";
  private no(): never {
    throw new Error("Nguồn Vietnam Airlines chỉ canh giá theo lịch – không đặt/giữ chỗ qua tool được");
  }
  search(): Promise<any> { return this.no(); }
  book(): Promise<any> { return this.no(); }
  hold(): Promise<any> { return this.no(); }
  getOrder(): Promise<any> { return this.no(); }
  pay(): Promise<any> { return this.no(); }
}

export const makeProvider = (cfg: Config): FlightProvider =>
  cfg.provider === "duffel"
    ? new DuffelProvider(process.env.DUFFEL_TOKEN ?? "")
    : cfg.provider === "vna"
      ? new VnaOfferStub()
      : new MockProvider();
