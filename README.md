# ✈️ Flight Hunter – Săn vé máy bay giá rẻ tự động

Tự động quét giá vé theo lịch, lọc theo điều kiện, báo qua Telegram khi giá chạm ngưỡng và (tuỳ chọn) **tự đặt vé** với thông tin hành khách đã cấu hình.

## Tính năng
- Cấu hình nhiều "hunt" (chuyến cần săn) trong `config.yaml`: điểm đi/đến, **khoảng ngày** đi/về (quét mọi tổ hợp), hạng ghế, số điểm dừng, lọc hãng, khung giờ cất cánh, ngưỡng giá
- **Số lượng vé = danh sách hành khách** (người lớn / trẻ em / em bé) kèm đầy đủ thông tin: danh xưng, giới tính, họ tên, ngày sinh, email, SĐT
- Quy đổi tiền tệ (USD/EUR… → VND) để so với ngưỡng
- Báo Telegram, chống spam (chỉ báo lại khi giá giảm thêm X%)
- Tự đặt vé qua Duffel API, có **2 lớp khoá an toàn**: `autoBook: true` trong hunt + `ALLOW_AUTOBOOK=true` trong `.env`. Đặt xong hunt tự dừng, không đặt trùng
- Lưu lịch sử giá và giá thấp nhất từng thấy (`data/state.json`)
- Provider `mock` để chạy thử không cần key

## Chế độ khi giá chạm ngưỡng (`bookingMode`)
| Giá trị | Hành động |
|---|---|
| `notify` | Chỉ báo Telegram |
| `hold` | **Tự giữ chỗ**, chưa trả tiền. Báo PNR + hạn thanh toán, nhắc lại trước hạn (`holdReminderHours`). Anh chạy `npm run pay -- <id>` để thanh toán |
| `instant` | Tự đặt + trả tiền ngay (cần `ALLOW_AUTOBOOK=true`) |

Luồng giữ chỗ:
1. Tool chỉ chọn vé **hãng cho phép giữ chỗ** (`payment_requirements.requires_instant_payment = false`). Nếu vé rẻ nhất là hãng bắt trả ngay, tool vẫn báo kèm để anh tự đặt
2. Đang giữ chỗ thì hunt dừng săn (không giữ trùng), chỉ theo dõi đơn
3. `npm run pay -- <id>` lấy giá mới nhất, hiện chi tiết, bắt gõ `yes` rồi trả bằng Duffel balance (hoặc vào app.duffel.com → Orders)
4. Quá hạn chưa trả: chỗ tự nhả, tool báo và **săn tiếp**
5. Có hãng chỉ giữ chỗ, không giữ giá: sau mốc `price_guarantee_expires_at` giá có thể đổi, lệnh `pay` sẽ cảnh báo nếu giá khác lúc giữ

## Nguồn Vietnam Airlines (nội địa) – khuyên dùng
Đặt **Cài đặt → Nguồn dữ liệu = Vietnam Airlines**. Tool lấy *giá thấp nhất mỗi ngày* (1 người lớn, 1 chiều, đã gồm thuế phí), chính là dữ liệu lịch giá trên vietnamairlines.com. Mỗi request lấy được 62 ngày, nên quét rất nhẹ.
- Khứ hồi: ghép chiều đi + chiều về rẻ nhất; tổng cả đoàn là **ước tính** (trẻ em × `vnaChildFactor`, em bé × `vnaInfantFactor` giá người lớn)
- Báo Telegram kèm 5 tổ hợp ngày rẻ nhất dưới ngưỡng
- **Không tự giữ chỗ / đặt vé**: trang đặt vé của VNA có xác minh Cloudflare chống bot, tool không vượt kiểm tra này. Anh vào web/app VNA, chọn **Trả sau** để giữ chỗ miễn phí rồi thanh toán sau
- Không lọc được giờ bay / điểm dừng (lịch giá không có chi tiết chuyến)
- Chỉ dùng cá nhân, phi thương mại, quét thưa (điều khoản website VNA cấm bot lấy dữ liệu cho mục đích thương mại)

## Biểu đồ giá & ngưỡng gợi ý
Tab **Biểu đồ giá** trên web:
- **Giá theo ngày bay trong tháng**: cột xanh là ngày có giá ≤ ngưỡng gợi ý, chạm vào cột để xem giá, hãng, giá thấp nhất từng thấy
- **Giá thấp nhất theo tháng**: so sánh các tháng, tô đậm tháng rẻ nhất
- **Ngưỡng gợi ý** = mức mà ~25% số ngày bay đang rẻ hơn (tính theo giá/khách × số khách). Nút *Đặt ngưỡng* áp mức này vào chuyến săn
- **Khảo sát giá**: quét giá 1 người lớn cho dải ngày tối đa 120 lượt (ví dụ 3 tháng, cách 1–3 ngày) để có biểu đồ ngay, không phải chờ tích luỹ
- Mọi lần quét của chuyến săn cũng được lưu vào lịch sử giá (`data/prices.json`)

## Chi phí Duffel & giới hạn lượt tìm
Duffel tính $3/đơn + 1% giá trị đơn, và **$0.005 cho mỗi lượt tìm vượt tỷ lệ 1500 lượt tìm : 1 đơn** mỗi tháng (0 đơn được tính là 1).
- `freeSearchGuard: true` (mặc định): tool tự dừng quét khi chạm hạn mức miễn phí và báo Telegram
- Mặc định 6 lượt/vòng, 2 giờ/vòng, khoảng 2.160 lượt/tháng. Muốn chạy suốt tháng trong mức miễn phí thì để 3 lượt/vòng hoặc chu kỳ 3 giờ
- Tổ hợp ngày được **xoay vòng** giữa các vòng quét, lượt tìm chia đều cho các chuyến

## Deploy lên Railway
1. Tài khoản Railway phải có gói trả phí (gói dùng thử hết hạn thì không tạo được project)
2. Đẩy code lên một repo GitHub private
3. Railway → New Project → Deploy from GitHub repo (Railway tự nhận `Dockerfile`)
4. Gắn **Volume** vào service, mount path `/data` (lưu config, mật khẩu, lịch sử giá)
5. Variables:
   ```
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<mật khẩu mạnh, đổi lại trên web sau lần đăng nhập đầu>
   COOKIE_SECURE=true
   TRUST_PROXY=true
   DUFFEL_TOKEN=duffel_test_...   # hoặc duffel_live_...
   ALLOW_AUTOBOOK=false
   ```
   (`HOST`, `DATA_DIR=/data`, `CONFIG_PATH=/data/config.yaml` đã đặt sẵn trong Dockerfile; Railway tự cấp `PORT`)
6. Settings → Healthcheck path `/healthz`; Networking → Generate Domain (có HTTPS)
7. Chỉ chạy **1 replica** (phiên đăng nhập và bộ quét nằm trong bộ nhớ)

## Cài đặt
```bash
npm install
cp config.example.yaml config.yaml
cp .env.example .env        # điền DUFFEL_TOKEN, ADMIN_USERNAME, ADMIN_PASSWORD
npm start                   # mở http://localhost:8080 và đăng nhập
```
Hoặc tạo tài khoản quản trị bằng lệnh `npm run set-password` (không cần để mật khẩu trong .env).

## Giao diện web (bắt buộc đăng nhập)
`npm start` chạy cùng lúc web quản trị và bộ quét định kỳ. Mọi chức năng đều cần đăng nhập:
- **Tổng quan**: trạng thái quét, nút *Quét ngay*, giá rẻ nhất, đơn đang giữ chỗ, nút **Thanh toán** (hiện lại giá mới nhất, bắt tích xác nhận; nếu giá đổi thì từ chối và yêu cầu xác nhận lại)
- **Chuyến bay**: thêm, sửa, tạm dừng, xoá chuyến; nhập hành khách bằng form
- **Telegram**: dán Bot token → *Kiểm tra*, *Tìm Chat ID* tự động, bật/tắt, mốc nhắc thanh toán, *Gửi tin thử*
- **Cài đặt**: nguồn dữ liệu, chu kỳ quét, tỷ giá, đổi mật khẩu
- **Nhật ký**: log hoạt động gần nhất

Bảo mật:
- Mật khẩu băm bằng scrypt (`data/auth.json`)
- Cookie phiên dạng HttpOnly + SameSite=Strict, tự hết hạn sau `SESSION_TTL_HOURS` giờ không hoạt động
- Sai mật khẩu 5 lần thì khoá IP 15 phút
- Chống CSRF, đặt CSP chặt
- Bot token lưu trong `data/settings.json` (quyền 600) và luôn hiện dạng che khi xem lại
- Mặc định chỉ nghe ở `127.0.0.1`. Muốn mở từ điện thoại thì đặt `HOST=0.0.0.0`, chạy sau Nginx/Caddy có HTTPS, và đặt `COOKIE_SECURE=true` + `TRUST_PROXY=true`
- Lưu cấu hình trên web sẽ ghi lại `config.yaml` (mất comment, bản cũ lưu ở `config.yaml.bak`)

## Chạy
```bash
npm run once      # quét 1 vòng rồi thoát
npm start         # web quản trị + quét định kỳ
npm run hunt      # chỉ quét định kỳ, không web
npm run history   # xem lịch sử giá + đơn đang giữ chỗ
npm run pay                  # liệt kê đơn đang giữ chỗ
npm run pay -- han-sgn-tet   # thanh toán đơn của hunt han-sgn-tet
```
Chạy nền 24/7: `pm2 start "npm start" --name flight-hunter` (hoặc Docker / systemd).

## Nguồn dữ liệu: Duffel
1. Đăng ký tại https://app.duffel.com, tạo **test token** (`duffel_test_...`) → đặt `provider: duffel` trong config
2. Ở chế độ test, Duffel trả về hãng giả "Duffel Airways" để thử luồng đặt vé mà không mất tiền
3. Khi muốn mua thật: xác minh tài khoản, nạp **balance**, dùng token `duffel_live_...`. Tool thanh toán bằng balance (`payments.type = balance`)

> **Lưu ý về độ phủ hãng:** Duffel kết nối hàng trăm hãng qua NDC/GDS, nhưng không phải hãng nào cũng có, nhất là hãng giá rẻ nội địa. Hãy dùng test/live token để kiểm tra tuyến của anh có ra offer của VN/VJ/QH hay không. Tool **không** scrape website hãng (vi phạm điều khoản, dính captcha, dễ bị khoá). Nếu cần hãng không có trên Duffel, thêm provider mới bằng cách implement interface `FlightProvider` (`search` + `book`) trong `src/providers/`, ví dụ API B2B của đại lý cấp 1 / Sabre / Travelport mà công ty có hợp đồng.

## Cấu trúc
```
src/
  index.ts            CLI + vòng lặp lịch quét
  config.ts           Schema cấu hình (zod) + validate
  hunter.ts           Sinh tổ hợp ngày, lọc, so ngưỡng, báo, tự đặt
  storage.ts          Lưu trạng thái/lịch sử JSON
  notifier.ts         Console + Telegram
  providers/duffel.ts Tìm vé + đặt vé qua Duffel API v2
  providers/mock.ts   Dữ liệu giả lập
```

## Lưu ý quan trọng
- Họ tên hành khách phải **không dấu, đúng như CCCD/hộ chiếu**; sai tên rất khó sửa sau khi xuất vé
- `maxPrice` là **tổng tiền cho tất cả hành khách**, gồm thuế phí
- Khoảng ngày rộng × khứ hồi tạo ra nhiều lượt tìm (4 ngày đi × 3 ngày về = 12 lượt); dùng `maxSearchesPerRun` để giới hạn
- `config.yaml`, `.env`, `data/` chứa thông tin cá nhân, đừng commit lên git
