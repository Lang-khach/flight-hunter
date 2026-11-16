/** Danh sách sân bay: toàn bộ sân bay dân dụng Việt Nam + các sân bay quốc tế phổ biến từ Việt Nam */
export interface Airport {
  code: string;
  city: string;
  name: string;
  country: string;
  domestic: boolean;
  aliases?: string[];
}

const VN = "Việt Nam";
export const AIRPORTS: Airport[] = [
  // ---- Nội địa ----
  { code: "HAN", city: "Hà Nội", name: "Sân bay quốc tế Nội Bài", country: VN, domestic: true, aliases: ["ha noi", "noi bai", "hanoi"] },
  { code: "SGN", city: "TP. Hồ Chí Minh", name: "Sân bay quốc tế Tân Sơn Nhất", country: VN, domestic: true, aliases: ["sai gon", "saigon", "ho chi minh", "hcm", "tan son nhat"] },
  { code: "DAD", city: "Đà Nẵng", name: "Sân bay quốc tế Đà Nẵng", country: VN, domestic: true },
  { code: "CXR", city: "Nha Trang (Khánh Hòa)", name: "Sân bay quốc tế Cam Ranh", country: VN, domestic: true, aliases: ["cam ranh", "khanh hoa"] },
  { code: "PQC", city: "Phú Quốc", name: "Sân bay quốc tế Phú Quốc", country: VN, domestic: true, aliases: ["kien giang"] },
  { code: "HPH", city: "Hải Phòng", name: "Sân bay quốc tế Cát Bi", country: VN, domestic: true, aliases: ["cat bi"] },
  { code: "HUI", city: "Huế", name: "Sân bay quốc tế Phú Bài", country: VN, domestic: true, aliases: ["phu bai", "thua thien hue"] },
  { code: "VII", city: "Vinh (Nghệ An)", name: "Sân bay quốc tế Vinh", country: VN, domestic: true, aliases: ["nghe an"] },
  { code: "VCA", city: "Cần Thơ", name: "Sân bay quốc tế Cần Thơ", country: VN, domestic: true },
  { code: "DLI", city: "Đà Lạt (Lâm Đồng)", name: "Sân bay Liên Khương", country: VN, domestic: true, aliases: ["lien khuong", "lam dong"] },
  { code: "UIH", city: "Quy Nhơn (Bình Định)", name: "Sân bay Phù Cát", country: VN, domestic: true, aliases: ["phu cat", "binh dinh"] },
  { code: "BMV", city: "Buôn Ma Thuột (Đắk Lắk)", name: "Sân bay Buôn Ma Thuột", country: VN, domestic: true, aliases: ["dak lak", "ban me thuot"] },
  { code: "PXU", city: "Pleiku (Gia Lai)", name: "Sân bay Pleiku", country: VN, domestic: true, aliases: ["gia lai"] },
  { code: "VDH", city: "Đồng Hới (Quảng Bình)", name: "Sân bay Đồng Hới", country: VN, domestic: true, aliases: ["quang binh"] },
  { code: "THD", city: "Thanh Hóa", name: "Sân bay Thọ Xuân", country: VN, domestic: true, aliases: ["tho xuan"] },
  { code: "TBB", city: "Tuy Hòa (Phú Yên)", name: "Sân bay Tuy Hòa", country: VN, domestic: true, aliases: ["phu yen"] },
  { code: "VCL", city: "Tam Kỳ (Quảng Nam)", name: "Sân bay Chu Lai", country: VN, domestic: true, aliases: ["chu lai", "quang nam"] },
  { code: "VCS", city: "Côn Đảo", name: "Sân bay Côn Đảo", country: VN, domestic: true, aliases: ["con son", "vung tau"] },
  { code: "VKG", city: "Rạch Giá (Kiên Giang)", name: "Sân bay Rạch Giá", country: VN, domestic: true, aliases: ["kien giang"] },
  { code: "CAH", city: "Cà Mau", name: "Sân bay Cà Mau", country: VN, domestic: true },
  { code: "DIN", city: "Điện Biên", name: "Sân bay Điện Biên Phủ", country: VN, domestic: true, aliases: ["dien bien phu"] },
  { code: "VDO", city: "Quảng Ninh (Hạ Long)", name: "Sân bay quốc tế Vân Đồn", country: VN, domestic: true, aliases: ["van don", "ha long"] },
  // ---- Quốc tế phổ biến ----
  { code: "BKK", city: "Bangkok", name: "Suvarnabhumi", country: "Thái Lan", domestic: false },
  { code: "DMK", city: "Bangkok", name: "Don Mueang", country: "Thái Lan", domestic: false },
  { code: "HKT", city: "Phuket", name: "Phuket International", country: "Thái Lan", domestic: false },
  { code: "CNX", city: "Chiang Mai", name: "Chiang Mai International", country: "Thái Lan", domestic: false },
  { code: "SIN", city: "Singapore", name: "Changi", country: "Singapore", domestic: false },
  { code: "KUL", city: "Kuala Lumpur", name: "Kuala Lumpur International", country: "Malaysia", domestic: false },
  { code: "CGK", city: "Jakarta", name: "Soekarno–Hatta", country: "Indonesia", domestic: false },
  { code: "DPS", city: "Bali (Denpasar)", name: "Ngurah Rai", country: "Indonesia", domestic: false, aliases: ["bali"] },
  { code: "MNL", city: "Manila", name: "Ninoy Aquino International", country: "Philippines", domestic: false },
  { code: "PNH", city: "Phnom Penh", name: "Techo International", country: "Campuchia", domestic: false },
  { code: "SAI", city: "Siem Reap", name: "Siem Reap–Angkor International", country: "Campuchia", domestic: false },
  { code: "VTE", city: "Viêng Chăn", name: "Wattay International", country: "Lào", domestic: false, aliases: ["vientiane"] },
  { code: "LPQ", city: "Luang Prabang", name: "Luang Prabang International", country: "Lào", domestic: false },
  { code: "RGN", city: "Yangon", name: "Yangon International", country: "Myanmar", domestic: false },
  { code: "HKG", city: "Hồng Kông", name: "Hong Kong International", country: "Trung Quốc", domestic: false, aliases: ["hong kong"] },
  { code: "MFM", city: "Ma Cao", name: "Macau International", country: "Trung Quốc", domestic: false, aliases: ["macau"] },
  { code: "TPE", city: "Đài Bắc", name: "Taoyuan International", country: "Đài Loan", domestic: false, aliases: ["taipei"] },
  { code: "KHH", city: "Cao Hùng", name: "Kaohsiung International", country: "Đài Loan", domestic: false, aliases: ["kaohsiung"] },
  { code: "RMQ", city: "Đài Trung", name: "Taichung International", country: "Đài Loan", domestic: false, aliases: ["taichung"] },
  { code: "ICN", city: "Seoul", name: "Incheon International", country: "Hàn Quốc", domestic: false, aliases: ["han quoc", "korea"] },
  { code: "PUS", city: "Busan", name: "Gimhae International", country: "Hàn Quốc", domestic: false },
  { code: "NRT", city: "Tokyo", name: "Narita International", country: "Nhật Bản", domestic: false, aliases: ["nhat ban", "japan"] },
  { code: "HND", city: "Tokyo", name: "Haneda", country: "Nhật Bản", domestic: false, aliases: ["nhat ban", "japan"] },
  { code: "KIX", city: "Osaka", name: "Kansai International", country: "Nhật Bản", domestic: false },
  { code: "NGO", city: "Nagoya", name: "Chubu Centrair", country: "Nhật Bản", domestic: false },
  { code: "FUK", city: "Fukuoka", name: "Fukuoka", country: "Nhật Bản", domestic: false },
  { code: "PEK", city: "Bắc Kinh", name: "Beijing Capital", country: "Trung Quốc", domestic: false, aliases: ["beijing"] },
  { code: "PKX", city: "Bắc Kinh", name: "Beijing Daxing", country: "Trung Quốc", domestic: false, aliases: ["beijing"] },
  { code: "PVG", city: "Thượng Hải", name: "Pudong International", country: "Trung Quốc", domestic: false, aliases: ["shanghai"] },
  { code: "CAN", city: "Quảng Châu", name: "Baiyun International", country: "Trung Quốc", domestic: false, aliases: ["guangzhou"] },
  { code: "SZX", city: "Thâm Quyến", name: "Bao'an International", country: "Trung Quốc", domestic: false, aliases: ["shenzhen"] },
  { code: "CTU", city: "Thành Đô", name: "Tianfu / Shuangliu", country: "Trung Quốc", domestic: false, aliases: ["chengdu"] },
  { code: "DEL", city: "New Delhi", name: "Indira Gandhi International", country: "Ấn Độ", domestic: false },
  { code: "BOM", city: "Mumbai", name: "Chhatrapati Shivaji Maharaj", country: "Ấn Độ", domestic: false },
  { code: "SYD", city: "Sydney", name: "Kingsford Smith", country: "Úc", domestic: false, aliases: ["australia"] },
  { code: "MEL", city: "Melbourne", name: "Tullamarine", country: "Úc", domestic: false, aliases: ["australia"] },
  { code: "LHR", city: "London", name: "Heathrow", country: "Anh", domestic: false },
  { code: "CDG", city: "Paris", name: "Charles de Gaulle", country: "Pháp", domestic: false },
  { code: "FRA", city: "Frankfurt", name: "Frankfurt am Main", country: "Đức", domestic: false },
  { code: "MUC", city: "Munich", name: "Munich", country: "Đức", domestic: false },
  { code: "SFO", city: "San Francisco", name: "San Francisco International", country: "Mỹ", domestic: false },
  { code: "LAX", city: "Los Angeles", name: "Los Angeles International", country: "Mỹ", domestic: false },
  { code: "DXB", city: "Dubai", name: "Dubai International", country: "UAE", domestic: false },
  { code: "DOH", city: "Doha", name: "Hamad International", country: "Qatar", domestic: false },
];

/** Bỏ dấu tiếng Việt + chữ thường để so khớp ("Đà Nẵng" → "da nang") */
export const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const index = AIRPORTS.map((a) => {
  const text = fold([a.city, a.name, a.country, ...(a.aliases ?? [])].join(" "));
  const cityText = fold([a.city, ...(a.aliases ?? [])].join(" "));
  return { a, code: a.code.toLowerCase(), text, tokens: text.split(" "), compact: cityText.replace(/ /g, "") + " " + text.replace(/ /g, "") };
});

/** Tìm sân bay theo mã IATA, tên thành phố hoặc tên sân bay (gõ không dấu, gõ liền đều được). Ưu tiên khớp mã → đầu từ → nội địa. */
export function searchAirports(q: string, opts: { domesticOnly?: boolean; limit?: number } = {}): Airport[] {
  const f = fold(q ?? "");
  const limit = Math.min(opts.limit ?? 10, 50);
  const pool = index.filter((x) => !opts.domesticOnly || x.a.domestic);
  if (!f) return pool.filter((x) => x.a.domestic).slice(0, limit).map((x) => x.a);
  const words = f.split(" ");
  const fc = f.replace(/ /g, "");
  const scored = pool
    .map((x) => {
      let score = 0;
      if (x.code === fc) score = 100;
      else if (fc.length <= 3 && x.code.startsWith(fc)) score = 80;
      else if (words.every((w) => x.tokens.some((t) => t.startsWith(w)))) score = 60; // đầu từ: "da na", "sai g"
      else if (fc.length >= 3 && x.compact.includes(fc)) score = 55; // gõ liền: "dalat", "danang"
      else if (words.every((w) => x.text.includes(w))) score = 30;
      if (score && x.a.domestic) score += 5;
      return { a: x.a, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.a);
}

export const airportByCode = (code: string) => AIRPORTS.find((a) => a.code === code.toUpperCase());
