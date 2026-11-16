import type { Config } from "./config.js";
import { fmt } from "./hunter.js";
import { Notifier } from "./notifier.js";
import { makeProvider } from "./providers/index.js";
import type { Storage } from "./storage.js";
import type { OrderInfo } from "./types.js";
import { addOrder } from "./usage.js";

export class ActionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Lấy thông tin thanh toán mới nhất của đơn đang giữ chỗ */
export async function getPaymentInfo(cfg: Config, store: Storage, huntId: string) {
  const hunt = cfg.hunts.find((h) => h.id === huntId);
  if (!hunt) throw new ActionError(`Không có chuyến "${huntId}"`, 404);
  const b = store.get(huntId).booked;
  if (!b) throw new ActionError("Chuyến này chưa có đơn giữ chỗ", 404);
  if (b.status === "paid") throw new ActionError(`Đơn đã thanh toán rồi (PNR ${b.bookingReference})`, 409);
  const info = await makeProvider(cfg).getOrder(b.orderId);
  Object.assign(b, info);
  store.save();
  if (info.status !== "held") throw new ActionError(`Đơn đang ở trạng thái "${info.status}", không thể thanh toán`, 409);
  return { hunt, booked: b, info };
}

/**
 * Thanh toán đơn giữ chỗ. expected = số tiền người dùng đã xem và xác nhận;
 * nếu giá đã đổi so với lúc xem thì từ chối để người dùng xác nhận lại.
 */
export async function payHeldOrder(
  cfg: Config,
  store: Storage,
  huntId: string,
  expected: { amount: number; currency: string },
): Promise<OrderInfo> {
  const { booked, info } = await getPaymentInfo(cfg, store, huntId);
  if (info.totalAmount !== expected.amount || info.currency !== expected.currency) {
    throw new ActionError(
      `Giá đã thay đổi: hiện tại ${fmt(info.totalAmount, info.currency)}. Vui lòng xem lại và xác nhận lần nữa.`,
      409,
    );
  }
  const paid = await makeProvider(cfg).pay(info.orderId, info.totalAmount, info.currency);
  Object.assign(booked, paid);
  addOrder();
  store.save();
  await new Notifier(cfg.notify.telegram).send(
    `✅ <b>${huntId}</b> đã thanh toán. PNR: <b>${paid.bookingReference}</b> – ${fmt(paid.totalAmount, paid.currency)}`,
  );
  return paid;
}
