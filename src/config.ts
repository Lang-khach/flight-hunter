import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Định dạng ngày phải là YYYY-MM-DD");
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Định dạng giờ phải là HH:mm");
const dateRange = z
  .object({ from: z.coerce.string().pipe(isoDate), to: z.coerce.string().pipe(isoDate) })
  .refine((r) => r.from <= r.to, "from phải <= to");

/** Thông tin chi tiết chỉ bắt buộc khi tool tự đặt/giữ chỗ (Duffel). Canh giá chỉ cần loại khách. */
export const PassengerSchema = z.object({
  type: z.enum(["adult", "child", "infant"]),
  title: z.enum(["mr", "ms", "mrs", "miss", "dr"]).optional(),
  gender: z.enum(["m", "f"]).optional(),
  givenName: z.string().min(1).optional(),
  familyName: z.string().min(1).optional(),
  bornOn: z.coerce.string().pipe(isoDate).optional(),
  email: z.string().email().optional(),
  phone: z.string().regex(/^\+\d{8,15}$/, "SĐT dạng quốc tế, ví dụ +84901234567").optional(),
});

export const HuntSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-_]+$/i),
    enabled: z.boolean().default(true),
    origin: z.string().length(3).toUpperCase(),
    destination: z.string().length(3).toUpperCase(),
    departDates: dateRange,
    returnDates: dateRange.optional(),
    cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).default("economy"),
    maxStops: z.number().int().min(0).default(1),
    airlines: z.array(z.string().length(2).toUpperCase()).optional(),
    departTimeWindow: z.object({ from: hhmm, to: hhmm }).optional(),
    maxPrice: z.number().positive(),
    /**
     * notify  = chỉ báo giá
     * hold    = tự giữ chỗ (chưa trả tiền), báo anh vào thanh toán trước hạn
     * instant = tự đặt + thanh toán luôn (cần ALLOW_AUTOBOOK=true)
     */
    bookingMode: z.enum(["notify", "hold", "instant"]).optional(),
    /** @deprecated dùng bookingMode. autoBook: true tương đương bookingMode: instant */
    autoBook: z.boolean().default(false),
    passengers: z.array(PassengerSchema).min(1).max(9),
  })
  .superRefine((h, ctx) => {
    const adults = h.passengers.filter((p) => p.type === "adult").length;
    const infants = h.passengers.filter((p) => p.type === "infant").length;
    if (adults === 0) ctx.addIssue({ code: "custom", message: `[${h.id}] Cần ít nhất 1 người lớn` });
    if (infants > adults)
      ctx.addIssue({ code: "custom", message: `[${h.id}] Số em bé không được nhiều hơn số người lớn` });
  });

export const ConfigSchema = z.object({
  provider: z.enum(["mock", "duffel", "vna"]).default("vna"),
  /** Ước tính giá cả đoàn từ giá 1 người lớn của VNA (nguồn vna chỉ có giá người lớn) */
  vnaChildFactor: z.number().min(0).max(1.5).default(1),
  vnaInfantFactor: z.number().min(0).max(1).default(0.15),
  currency: z.string().length(3).default("VND"),
  checkIntervalMinutes: z.number().min(1).default(60),
  maxSearchesPerRun: z.number().int().min(1).default(3),
  /** Duffel: dừng quét khi chạm hạn mức miễn phí 1500 lượt tìm / 1 đơn trong tháng */
  freeSearchGuard: z.boolean().default(true),
  fxRates: z.record(z.number().positive()).default({}),
  notify: z
    .object({
      telegram: z.boolean().default(false),
      minDropPercent: z.number().min(0).default(2),
      /** nhắc thanh toán khi còn bấy nhiêu giờ trước hạn giữ chỗ */
      holdReminderHours: z.array(z.number().positive()).default([12, 3, 1]),
    })
    .default({}),
  hunts: z.array(HuntSchema).default([]),
}).superRefine((c, ctx) => {
  // Tự đặt / giữ chỗ (không phải nguồn VNA) cần đủ thông tin từng hành khách
  if (c.provider === "vna") return;
  c.hunts.forEach((h, hi) => {
    const mode = h.bookingMode ?? (h.autoBook ? "instant" : "notify");
    if (mode === "notify") return;
    h.passengers.forEach((p, pi) => {
      const missing = (["title", "gender", "givenName", "familyName", "bornOn", "email", "phone"] as const).filter((k) => !p[k]);
      if (missing.length)
        ctx.addIssue({ code: "custom", path: ["hunts", hi, "passengers", pi], message: `[${h.id}] Hành khách ${pi + 1} thiếu ${missing.join(", ")} (bắt buộc khi tự giữ chỗ/đặt vé)` });
    });
  });
});

export type Config = z.infer<typeof ConfigSchema>;
export type Hunt = z.infer<typeof HuntSchema>;
export type BookingMode = "notify" | "hold" | "instant";
export const modeOf = (h: Hunt): BookingMode => h.bookingMode ?? (h.autoBook ? "instant" : "notify");
export type Passenger = z.infer<typeof PassengerSchema>;

const CONFIG_PATH = process.env.CONFIG_PATH ?? "config.yaml";

/** Lần chạy đầu trên server (volume trống): tạo config mặc định chưa có chuyến nào */
/** Cấu hình khuyên dùng theo nguồn */
export const RECOMMENDED = {
  vna: { checkIntervalMinutes: 60, maxSearchesPerRun: 3 }, // 1–2 yêu cầu/chuyến mỗi giờ
  duffel: { checkIntervalMinutes: 120, maxSearchesPerRun: 3, freeSearchGuard: true }, // ≈1.080 lượt/tháng < 1.500 miễn phí
  mock: { checkIntervalMinutes: 60, maxSearchesPerRun: 3 },
} as const;

export function ensureConfigFile() {
  if (fs.existsSync(CONFIG_PATH)) {
    // Bản cài cũ còn để "giả lập" mặc định và chưa có chuyến nào → chuyển sang cấu hình khuyên dùng (Vietnam Airlines)
    try {
      const cur = loadConfig();
      if (cur.provider === "mock" && cur.hunts.length === 0) {
        saveConfig({ ...cur, provider: "vna", ...RECOMMENDED.vna });
        console.log("📝 Đã chuyển cấu hình mặc định sang nguồn Vietnam Airlines, kiểm tra mỗi 1 giờ");
      }
    } catch {}
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(CONFIG_PATH)), { recursive: true });
  saveConfig({ provider: "vna", currency: "VND", ...RECOMMENDED.vna, fxRates: { USD: 26300, EUR: 30500 }, hunts: [] });
  console.log(`📝 Đã tạo ${CONFIG_PATH} mặc định (Vietnam Airlines, kiểm tra mỗi 1 giờ) – thêm chuyến bay trên giao diện web`);
}

/** Validate + ghi config.yaml (giữ bản sao config.yaml.bak) */
export function saveConfig(raw: unknown): Config {
  const cfg = validateConfig(raw);
  if (fs.existsSync(CONFIG_PATH)) fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + ".bak");
  const header = "# File này được ghi bởi giao diện web Flight Hunter. Bản trước: config.yaml.bak\n";
  fs.writeFileSync(CONFIG_PATH, header + YAML.stringify(cfg), { mode: 0o600 });
  return cfg;
}

export function loadConfig(path = CONFIG_PATH): Config {
  if (!fs.existsSync(path)) {
    throw new Error(`Không tìm thấy ${path}. Hãy copy config.example.yaml thành config.yaml`);
  }
  return validateConfig(YAML.parse(fs.readFileSync(path, "utf8")));
}

export function validateConfig(raw: unknown): Config {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => ` - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Cấu hình không hợp lệ:\n${msg}`);
  }
  const ids = new Set<string>();
  for (const h of parsed.data.hunts) {
    if (ids.has(h.id)) throw new Error(`Trùng id hunt: ${h.id}`);
    ids.add(h.id);
  }
  return parsed.data;
}
