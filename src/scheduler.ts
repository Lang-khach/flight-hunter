import { loadConfig } from "./config.js";
import { Hunter } from "./hunter.js";
import { Notifier } from "./notifier.js";
import { makeProvider } from "./providers/index.js";
import type { Storage } from "./storage.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Vòng quét định kỳ. Đọc lại config.yaml mỗi vòng nên sửa trên web là có hiệu lực ngay vòng sau. */
export class Scheduler {
  running = false;
  lastRunAt?: string;
  lastError?: string;
  nextRunAt?: string;
  private stopping = false;
  private wake?: () => void;

  constructor(private store: Storage) {}

  /** Chạy 1 vòng ngay. Trả false nếu đang có vòng chạy. */
  async runNow(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    this.lastError = undefined;
    console.log(`⏱  Vòng quét lúc ${new Date().toLocaleString("vi-VN")}`);
    try {
      const cfg = loadConfig();
      const hunter = new Hunter(cfg, makeProvider(cfg), this.store, new Notifier(cfg.notify.telegram));
      await hunter.runOnce();
    } catch (e) {
      this.lastError = (e as Error).message;
      console.error("Lỗi vòng quét:", this.lastError);
    } finally {
      this.running = false;
      this.lastRunAt = new Date().toISOString();
    }
    return true;
  }

  /** Kích hoạt vòng quét ngay mà không chờ (dùng cho nút "Quét ngay" trên web) */
  trigger(): boolean {
    if (this.running) return false;
    if (this.wake) this.wake();
    else void this.runNow();
    return true;
  }

  async loop() {
    while (!this.stopping) {
      await this.runNow();
      let minutes = 30;
      try {
        minutes = loadConfig().checkIntervalMinutes;
      } catch {}
      const wait = minutes * 60_000 * (0.9 + Math.random() * 0.2); // jitter ±10%
      this.nextRunAt = new Date(Date.now() + wait).toISOString();
      console.log(`💤 Quét lại lúc ${new Date(this.nextRunAt).toLocaleTimeString("vi-VN")}`);
      await Promise.race([sleep(wait), new Promise<void>((r) => (this.wake = r))]);
      this.wake = undefined;
    }
  }

  stop() {
    this.stopping = true;
    this.wake?.();
  }
}
