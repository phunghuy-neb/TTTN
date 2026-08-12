# VietVoyage Backend

API đặt tour du lịch trong nước — đồ án Thực tập tốt nghiệp (Nhóm 1, PTIT). Backend phục vụ khu khách hàng (danh sách/chi tiết tour, đặt & hủy tour, hồ sơ, chat trợ lý AI) và khu quản trị (dashboard thống kê, quản lý tour/đơn/người dùng).

## Tech stack

- **Node.js** (ES modules) + **Express 4** — REST API
- **MongoDB** + **Mongoose 8** — dữ liệu (Tour nhúng departures/reviews, Booking tham chiếu đợt bằng `departureId`)
- **jsonwebtoken** — JWT (payload `{ id, role }`), **bcryptjs** — hash mật khẩu
- **multer** — upload ảnh tour (jpg/png/webp ≤ 5MB, lưu thư mục `uploads/`)

## Cài đặt & chạy

```bash
npm install
copy .env.example .env        # rồi điền giá trị thật
npm run dev                   # chạy dev (node --watch), mặc định http://localhost:5000
```

Yêu cầu: Node 18+ (khuyến nghị 22) và MongoDB chạy dưới dạng **replica set** (MongoDB Atlas hoặc local `rs0`) vì luồng booking/slot/payment dùng transaction.

## Biến môi trường (.env)

| Biến | Ý nghĩa |
|---|---|
| `PORT` | Cổng API, mặc định 5000 |
| `MONGO_URI` | URI replica set, VD `mongodb://localhost:27017/vietvoyage?replicaSet=rs0`, hoặc URI Atlas |
| `JWT_SECRET` / `JWT_EXPIRE` | Bí mật ký JWT + hạn token; JWT trình duyệt được lưu trong cookie HttpOnly |
| `JWT_COOKIE_DAYS`, `COOKIE_SECURE`, `COOKIE_SAME_SITE` | Tuổi và chính sách cookie phiên |
| `CLIENT_URL`, `CORS_ORIGINS` | URL FE và danh sách origin được phép gọi API |
| `PUBLIC_BASE_URL`, `NGROK_DOMAIN` | URL HTTPS công khai của Backend; dùng để tự sinh Return URL/IPN URL |
| `BOOKING_HOLD_MINUTES`, `LATER_HOLD_MINUTES` | Thời gian giữ chỗ cho thanh toán online / thanh toán sau |
| `NOTIFICATION_RETENTION_DAYS`, `UNREAD_NOTIFICATION_RETENTION_DAYS` | Số ngày giữ thông báo đã đọc / chưa đọc |
| `VNP_*` | `TmnCode`, `HashSecret`, payment URL, return URL và IPN URL của VNPay |
| `MOMO_MODE` | `demo` cho bài nộp không thu tiền; `sandbox` để gọi MoMo Test bằng key hợp lệ |
| `MOMO_*` | Partner/Access/Secret key, endpoint, redirect URL và IPN URL của MoMo |
| `NODE_ENV` | `development` / `production` (seed từ chối chạy ở production) |
| `AI_SERVICE_URL`, `AI_SERVICE_API_KEY` | URL AI service và shared secret phải trùng `AI_INTERNAL_API_KEY` bên AI |

`.env` KHÔNG được commit (đã ignore) — chỉ commit `.env.example`.

## Tài khoản quản trị

Không có mật khẩu admin mặc định trong mã nguồn. Hãy đăng ký tài khoản rồi cấp quyền:

```bash
node scripts/set-admin.mjs email-cua-ban@example.com
```

Đăng xuất và đăng nhập lại để nhận phiên có quyền admin.

## Script tiện ích (chạy từ thư mục gốc Backend)

| Lệnh | Việc |
|---|---|
| `node scripts/seed-tours.mjs` | Nạp dữ liệu tour mẫu vào MongoDB; không tạo tài khoản hoặc mật khẩu admin. |
| `node scripts/set-admin.mjs <email>` | Cấp quyền admin cho một tài khoản |
| `node scripts/migrate-departures.mjs [--dry-run]` | Migration Batch 2: cấp `_id`/`totalSlots` cho đợt khởi hành, backfill `booking.departureId` (idempotent; đơn không khớp ghi ra `C:\TTTN\orphan-bookings.json`) |
| `node scripts/rollback-departures.mjs` | Gỡ migration trên (dùng kèm quay code) |
| `node scripts/test-concurrent.mjs` | Bằng chứng chống oversell: đợt 5 chỗ + **20 khách khác nhau** đặt song song → đúng 5 thành công, 15 nhận 409 `SLOT_UNAVAILABLE` (phải là 20 tài khoản riêng, vì khóa chống đơn trùng gộp các lần gửi lặp của cùng một người) |
| `node scripts/verify-charts.mjs` | Kiểm **hình học** biểu đồ Dashboard ở 375/768/1440px: mỗi hình phải có `d` khác rỗng, bbox > 0 và cột lớn nhất chạm ≥80% vùng vẽ. Cần một Chrome mở cổng debug 9222 (hướng dẫn ở đầu file) |
| `node scripts/cleanup-demo.mjs [--dry-run]` | Dọn dữ liệu kiểm thử (ghi bản ghi bị xóa ra `C:\TTTN\deleted-batch6.json`, kiểm bất biến slot sau khi dọn) |
| `node scripts/backfillSearchText.mjs` | Tính lại trường tìm kiếm không dấu cho tour cũ |

Ghi chú: `scripts/seed-tours.mjs` đọc dữ liệu tour mẫu từ `../TTTN/src/data/tours.js` — file mock đó là NGUỒN DỮ LIỆU SEED, không phải dead code.

## Kiến trúc nhanh

- `server.js` — mount route, chuẩn hóa lỗi `{ success:false, message, code }`, error handler cuối chuỗi
- `src/models/` — Tour, Booking, PaymentAttempt (audit giao dịch VNPay/MoMo), User, ChatMessage
- `src/middleware/` — `protect` (JWT), `requireAdmin`, `upload` (multer)
- `src/controllers/` + `src/routes/` — client (`/api/tours`, `/api/bookings`, `/api/auth`, `/api/chat`) và admin (`/api/admin/*`)
- Hợp đồng API đầy đủ: `../TTTN/src/api/contract.md`

## Thanh toán

FE tạo booking với `idempotencyKey`, sau đó gọi `POST /api/payments/:bookingId/initiate`. Backend chỉ tạo URL VNPay Sandbox hoặc MoMo Sandbox; MoMo có thể trả QR/deep link để FE giữ khách tại trung tâm thanh toán nội bộ. Hai cổng dùng `paymentExpiresAt` của booking làm thời hạn giữ chỗ duy nhất. Chỉ callback/IPN có chữ ký hợp lệ mới được chuyển đơn online sang `paid`. Worker nền tự hủy đơn hết hạn và hoàn slot trong cùng transaction. Giao dịch thành công về sau khi hết hạn được gắn `review_required` để admin đối soát thủ công.

Khi không có ứng dụng UAT để quét QR, admin có thể mở giao dịch `initiated` tại
`/admin/payments` và dùng nút **Xác nhận thanh toán Sandbox**. Đây là luồng mô phỏng
được ghi audit riêng (`ADMIN_SANDBOX_CONFIRMED`), chỉ hoạt động khi cổng ở Sandbox,
booking còn hạn và chưa được callback xử lý; không đại diện cho tiền thật.

Nếu đặt `MOMO_MODE=demo` trong development, Backend tạo một trang mô phỏng MoMo có
nhãn “MÔ PHỎNG SANDBOX”. Luồng này không gọi MoMo và không thu tiền, chỉ phục vụ
trình diễn đồ án; token HMAC vẫn ngăn người dùng sửa `orderId`. Chế độ demo bị chặn
trong production. Để test cổng chính thức, đặt `MOMO_MODE=sandbox` và điền bộ key
MoMo for Business hợp lệ.

## Vé, voucher và vận hành admin

- Đơn `paid/completed` có đúng một vé `VVT-*`; QR trỏ tới trang HTML `/api/tickets/verify-page/:token` chạy không cần JavaScript, bản đầy đủ và PDF chỉ chủ đơn/admin xem được.
- Voucher được tính và giữ lượt trong backend transaction; booking lưu giá gốc, tiền giảm, snapshot voucher và tổng cuối. Đơn pending bị hủy/hết hạn tự hoàn lượt.
- `/api/admin/payments` giữ PaymentAttempt và quy trình đối soát; xử lý xong gửi notification cho khách.
- `/api/admin/operations/calendar` trả lịch khởi hành; báo cáo booking/doanh thu hỗ trợ CSV và XLSX.

Các lệnh mới: `npm run seed:demo`, `npm test`, `npm run test:voucher-concurrency`.

Khi có `PUBLIC_BASE_URL` hoặc `NGROK_DOMAIN`, Backend ưu tiên URL công khai này và
tự sinh callback `/api/payments/{provider}/return` cùng IPN tương ứng. Vì vậy không
cần sửa bốn URL callback mỗi lần chuyển từ localhost sang ngrok.
