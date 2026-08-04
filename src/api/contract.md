# Hợp đồng API — VietVoyage (FE ⇄ BE)

- **Base URL:** `VITE_API_BASE_URL` (mặc định `http://localhost:5000/api`)
- **Xác thực:** JWT qua header `Authorization: Bearer <token>`. Payload token: `{ id, role }` (role nhúng từ batch Admin; middleware BE vẫn đọc role từ DB nên đổi quyền là token cũ mất tác dụng phân quyền).
- **Quy ước response:** thành công `{ success: true, ... }`; lỗi 4xx/5xx `{ success: false, message, code }` — `message` tiếng Việt hiển thị được cho người dùng, `code` để FE rẽ nhánh logic.
- **Role:** enum thực tế trong DB là `['customer', 'admin']` (KHÔNG phải `user`) — FE chỉ được kiểm `role === 'admin'`, không so sánh với `'customer'`/`'user'`.

## Mã lỗi (`code`)

| Code | Ý nghĩa |
|---|---|
| `AUTH_REQUIRED` | Chưa gửi token ở route cần đăng nhập (401) |
| `TOKEN_INVALID` | Token sai/hết hạn/tài khoản không tồn tại (401) |
| `INVALID_CREDENTIALS` | Sai email hoặc mật khẩu khi login (401) |
| `ACCOUNT_LOCKED` | Tài khoản bị khóa `isActive=false` (403) |
| `ADMIN_ONLY` | Route admin nhưng role không phải admin (403) |
| `FORBIDDEN` | Không đủ quyền (403, từ `authorize()` cũ) |
| `EMAIL_TAKEN` | Email đã tồn tại khi đăng ký (400) |
| `VALIDATION_ERROR` | Dữ liệu đầu vào không hợp lệ (400) |
| `UPLOAD_ERROR` | File upload sai định dạng/quá 5MB (400) |
| `NOT_FOUND` | Không có route/tài nguyên (404) |
| `BAD_REQUEST` / `UNAUTHORIZED` / `CONFLICT` / `REQUEST_ERROR` | Code mặc định bơm theo status khi controller chưa đặt code riêng |
| `SERVER_ERROR` | Lỗi 5xx |
| `NETWORK_ERROR` | (chỉ FE) fetch thất bại — mất mạng/server tắt |

**Phía FE (`services/api.js`):** request có `auth: true` bị 401 → xóa `localStorage['auth']` + phát sự kiện `session-expired` → AuthContext reset user ngay (không cần F5). 401 của `/auth/login` (auth: false) không kích hoạt cơ chế này.

---

## Auth

| Method | Path | Auth | Body | Response 2xx | Lỗi |
|---|---|---|---|---|---|
| POST | `/auth/register` | — | `{ name, email, password }` | `201 { success, message, token, user }` | 400 `VALIDATION_ERROR` / `EMAIL_TAKEN` |
| POST | `/auth/login` | — | `{ email, password }` | `200 { success, message, token, user }` | 400 `VALIDATION_ERROR`, 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_LOCKED` |
| GET | `/auth/me` | ✔ | — | `200 { success, user }` | 401 `AUTH_REQUIRED` / `TOKEN_INVALID` |

`user` = `{ _id, name, email, phone, avatar, role, isActive, createdAt }`.

## Tours (public)

| Method | Path | Auth | Query | Response 2xx |
|---|---|---|---|---|
| GET | `/tours` | tùy chọn* | `page, limit, search, region, minPrice, maxPrice, days, minDays, maxDays, sort, deals` | `200 { success, total, page, totalPages, tours[] }` |
| GET | `/tours/:idOrSlug` | tùy chọn* | — | `200 { success, tour }` — 404 nếu không tồn tại hoặc chưa published |

\* Có token admin thì thấy cả tour `draft`/`archived`; khách vãng lai chỉ thấy `published`.

`tour` = `{ _id, name, slug, region, location, days, description, basePrice, oldPrice, images[], avgRating, itinerary[], departures[], reviews[], cancellationPolicy, status, createdBy, searchText }`.
`departures[]` = `{ date (ISO), availableSlots, price }` — **chưa có `_id` dùng làm định danh, xem PENDING bên dưới**.

## Tours (admin) — `protect + authorize('admin')`

| Method | Path | Body | Response 2xx | Lỗi |
|---|---|---|---|---|
| POST | `/tours` | multipart (`images` tối đa 10 file) hoặc JSON | `201 { success, message, tour }` | 400 validation/trùng slug, 400 `UPLOAD_ERROR` |
| PUT | `/tours/:id` | như trên (ảnh mới nối vào mảng cũ) | `200 { success, message, tour }` | 404, 400 |
| DELETE | `/tours/:id` | — | `200` (xóa mềm → `status: 'archived'`) | 404 |
| POST | `/tours/upload` | multipart `image` (1 file) | `200 { success, url }` | 400 `UPLOAD_ERROR` |

## Bookings (user) — `protect`

| Method | Path | Body/Query | Response 2xx | Lỗi |
|---|---|---|---|---|
| POST | `/bookings` | `{ tourId, departureDate, guests, contact{name,phone,email}, paymentMethod, note }` | `201 { success, message, booking }` | 400 (thiếu field/hết chỗ/đợt đã qua), 404 tour |
| GET | `/bookings/my` | `?status&page&limit` | `200 { success, total, page, totalPages, bookings[] }` | 400 status lạ |
| GET | `/bookings/:id` | — | `200 { success, booking }` | 403 (không phải chủ đơn/admin), 404 |
| PATCH | `/bookings/:id/cancel` | — | `200 { success, message, booking }` — hoàn chỗ về đợt | 400 (không phải pending_payment), 403, 404 |

`booking.status` ∈ `pending_payment | paid | cancelled | completed`. `paymentMethod` ∈ `vnpay | momo | later | null`.

## Admin — `protect + requireAdmin` (mới) / `authorize('admin')` (cũ)

| Method | Path | Body/Query | Response 2xx |
|---|---|---|---|
| GET | `/admin/stats` | — | `200 { success, stats: { totalTours, totalBookings, totalUsers, revenue } }` — đếm/aggregate thật; `revenue` = Σ`totalPrice` của đơn `paid` + `completed` |
| GET | `/admin/users` | `?search&role&isActive&sort&page&limit` | `200 { success, total, page, totalPages, users[] }` |
| GET | `/admin/users/:id` | — | `200 { success, user }` |
| PUT | `/admin/users/:id` | `{ name?, phone?, avatar?, role? }` | `200 { success, message, user }` |
| PATCH | `/admin/users/:id/lock` | — | `200 { success, message, user }` (toggle `isActive`; không tự khóa chính mình) |
| GET | `/admin/bookings` | `?status&tourId&userId&search&sort&page&limit` | `200 { success, total, page, totalPages, bookings[] }` |
| GET | `/admin/bookings/stats` | — | `200 { success, stats: { totalBookings, pendingCount, totalRevenue, byStatus, monthlyRevenue } }` (chỉ tính đơn `paid`) |
| PATCH | `/admin/bookings/:id/status` | `{ status, txnRef?, paymentMethod? }` | `200 { success, message, booking }` — hủy đơn pending thì hoàn chỗ |

Lỗi chung khu admin: 401 `AUTH_REQUIRED`/`TOKEN_INVALID` (không token/token hỏng), 403 `ADMIN_ONLY` (đăng nhập nhưng không phải admin).

---

## ⚠ PENDING: departureId — rủi ro đơn mồ côi khi sửa ngày khởi hành

**Hiện trạng.** Đợt khởi hành trong `tour.departures[]` KHÔNG có định danh ổn định. Toàn bộ vòng đời booking khớp đợt bằng **giá trị ngày**:

1. FE chọn đợt bằng so sánh chuỗi ISO (`d.date === ngayChon`, TourDetail) và gửi nguyên chuỗi `departure.date` lên `POST /bookings`.
2. BE tạo đơn: tìm đợt bằng `toDateString()` so khớp theo ngày, trừ chỗ nguyên tử theo `departures.$.date`.
3. BE hủy đơn / admin hủy đơn: hoàn chỗ bằng `$elemMatch { date: { $gte: đầu-ngày, $lte: cuối-ngày } }` — khớp theo NGÀY của `booking.departureDate`.

**Rủi ro.** Khi admin có màn sửa tour (batch sau) và **đổi `date` của một đợt đã có đơn**:
- Đơn cũ giữ `departureDate` cũ → khi hủy, phép khớp theo ngày **trượt** → `availableSlots` không được hoàn (mất chỗ âm thầm, `modifiedCount === 0` chỉ ghi console).
- Đơn trở thành "mồ côi": không còn trỏ được về đợt nào của tour.
- Hai đợt cùng ngày (khác giờ) sẽ khớp nhầm nhau vì mọi phép so đều theo ngày.

**Hướng xử lý đã chốt (Batch 2 — KHÔNG làm ở batch này):**
- BE: để Mongoose sinh `_id` cho từng phần tử `departures[]` (bỏ `_id: false` nếu có), booking lưu thêm `departureId`; tạo/hủy/hoàn chỗ khớp bằng `departures._id`. Giữ `departureDate` làm dữ liệu hiển thị + fallback cho đơn cũ.
- FE: TourDetail gửi `departureId` thay cho chuỗi ngày; `bookingService` cập nhật payload; màn admin sửa đợt chỉ được phép khi đã có `departureId`.
- Migration: script backfill gán `departureId` cho đơn cũ bằng phép khớp ngày (lần cuối cùng dùng cách này).

**Quy tắc tạm thời cho đến Batch 2:** admin KHÔNG sửa `departures[].date` của đợt đã có đơn; FE KHÔNG tự format lại chuỗi ngày trước khi gửi (`bookingService.js` đã ghi chú).
