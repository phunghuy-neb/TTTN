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

Yêu cầu: MongoDB chạy local (service `mongod`), Node 18+ (khuyến nghị 22).

## Biến môi trường (.env)

| Biến | Ý nghĩa |
|---|---|
| `PORT` | Cổng API, mặc định 5000 |
| `MONGO_URI` | Chuỗi kết nối MongoDB, VD `mongodb://localhost:27017/vietvoyage` |
| `JWT_SECRET` / `JWT_EXPIRE` | Bí mật ký JWT + hạn token (VD `7d`) |
| `NODE_ENV` | `development` / `production` (seed từ chối chạy ở production) |
| `AI_SERVICE_URL` | URL AI service (UC-07). **Để trống = chat dùng stub nội bộ.** Set URL là gọi AI thật — không cần sửa code (adapter: `src/services/aiAdapter.js`) |

`.env` KHÔNG được commit (đã ignore) — chỉ commit `.env.example`.

## Tài khoản demo (sau khi chạy seed)

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Admin | `admin@vietvoyage.vn` | `admin123456` |
| Khách | `tranthimai.vv@gmail.com` (và 3 tài khoản .vv@gmail.com khác) | `demo123456` |

## Script tiện ích (chạy từ thư mục gốc Backend)

| Lệnh | Việc |
|---|---|
| `node seed.mjs` | Seed lại toàn bộ dữ liệu trình diễn: 8 tour (đợt khởi hành luôn ở tương lai), 1 admin + 4 khách demo, ~20 đơn rải 6 tháng đủ 4 trạng thái. **File này không commit.** |
| `node seed.mjs --bookings-only` | Chỉ đắp lại đơn demo, không đụng tour/user |
| `node scripts/set-admin.mjs <email>` | Cấp quyền admin cho một tài khoản |
| `node scripts/migrate-departures.mjs [--dry-run]` | Migration Batch 2: cấp `_id`/`totalSlots` cho đợt khởi hành, backfill `booking.departureId` (idempotent; đơn không khớp ghi ra `C:\TTTN\orphan-bookings.json`) |
| `node scripts/rollback-departures.mjs` | Gỡ migration trên (dùng kèm quay code) |
| `node scripts/test-concurrent.mjs` | Bằng chứng chống oversell: đợt 5 chỗ + **20 khách khác nhau** đặt song song → đúng 5 thành công, 15 nhận 409 `SLOT_UNAVAILABLE` (phải là 20 tài khoản riêng, vì khóa chống đơn trùng gộp các lần gửi lặp của cùng một người) |
| `node scripts/verify-charts.mjs` | Kiểm **hình học** biểu đồ Dashboard ở 375/768/1440px: mỗi hình phải có `d` khác rỗng, bbox > 0 và cột lớn nhất chạm ≥80% vùng vẽ. Cần một Chrome mở cổng debug 9222 (hướng dẫn ở đầu file) |
| `node scripts/cleanup-demo.mjs [--dry-run]` | Dọn dữ liệu kiểm thử (ghi bản ghi bị xóa ra `C:\TTTN\deleted-batch6.json`, kiểm bất biến slot sau khi dọn) |
| `node scripts/backfillSearchText.mjs` | Tính lại trường tìm kiếm không dấu cho tour cũ |

Ghi chú: `seed.mjs` đọc dữ liệu tour mẫu từ `../TTTN_FE/src/data/tours.js` — file mock đó là NGUỒN DỮ LIỆU SEED, không phải dead code.

## Kiến trúc nhanh

- `server.js` — mount route, chuẩn hóa lỗi `{ success:false, message, code }`, error handler cuối chuỗi
- `src/models/` — Tour (departures có `_id` + `totalSlots`, bất biến `availableSlots + đang giữ = totalSlots`), Booking (máy trạng thái + `statusHistory`), User (role `customer|admin`), ChatMessage
- `src/middleware/` — `protect` (JWT), `requireAdmin`, `upload` (multer)
- `src/controllers/` + `src/routes/` — client (`/api/tours`, `/api/bookings`, `/api/auth`, `/api/chat`) và admin (`/api/admin/*`)
- Hợp đồng API đầy đủ: `../TTTN_FE/src/api/contract.md`
