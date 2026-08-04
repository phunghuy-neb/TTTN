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
| `DEPARTURE_NOT_FOUND` | departureId không có trong tour (400) |
| `DEPARTURE_PAST` | Đợt khởi hành đã qua (400) |
| `SLOT_UNAVAILABLE` | Đợt không còn đủ chỗ — trừ chỗ nguyên tử thất bại (409) |
| `DEPARTURE_HAS_BOOKINGS` | Xóa đợt còn đơn active — TỪ CHỐI CẢ request PUT, DB không đổi (409) |
| `SLOTS_BELOW_BOOKED` | Hạ totalSlots xuống dưới số chỗ đang được giữ (409) |
| `TOUR_HAS_BOOKINGS` | Ẩn tour còn đơn active (409) |
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
`departures[]` = `{ _id, date (ISO), totalSlots, availableSlots, price }` — **`_id` là khóa ổn định của đợt; FE chọn đợt và đặt tour bằng `_id` này** (xem RESOLVED bên dưới).

## Tours (admin) — `/api/admin/tours`, `protect + requireAdmin` (Batch 3)

CRUD tour của admin chuyển hẳn về đây; các route mutation cũ trên `/api/tours` **đã bị gỡ** (gán đè cả mảng `departures` là đường sinh đơn mồ côi). Chỉ còn upload ảnh ở chỗ cũ.

| Method | Path | Body/Query | Response 2xx | Lỗi |
|---|---|---|---|---|
| GET | `/admin/tours` | `?search&isActive(true/false)&status&sort&page&limit` | `200 { success, total, page, totalPages, tours[] }` — mỗi tour kèm `activeBookings` | |
| GET | `/admin/tours/:id` | — | `200 { success, tour, bookingsByDeparture{depId:n}, activeBookings }` | 404 |
| POST | `/admin/tours` | JSON hoặc multipart; bắt buộc `departures` ≥ 1 đợt, mỗi đợt `date` không quá khứ, `totalSlots > 0`, `price > 0`; `availableSlots` server tự đặt = `totalSlots` | `201 { success, message, tour }` | 400 `VALIDATION_ERROR`/`UPLOAD_ERROR` |
| PUT | `/admin/tours/:id` | như POST + **quy tắc merge departures bên dưới** | `200 { success, message, tour }` | 400, **409 `DEPARTURE_HAS_BOOKINGS` / `SLOTS_BELOW_BOOKED`** |
| DELETE | `/admin/tours/:id` | — | `200` — soft delete `isActive=false`, KHÔNG hard delete | 404, **409 `TOUR_HAS_BOOKINGS`** |
| POST | `/tours/upload` | multipart `image` (1 file, ≤5MB, jpg/png/webp) | `200 { success, url }` | 400 `UPLOAD_ERROR` |

**Quy tắc merge `departures` của PUT (chống mồ côi — BE không tin payload):**
- Phần tử **có `_id`** → update tại chỗ, `_id` giữ nguyên. `availableSlots` KHÔNG nhận từ client — server `$inc` theo phần chênh `totalSlots` (tăng tổng → chỗ trống tăng đúng chênh; giảm dưới số đang giữ → 409 `SLOTS_BELOW_BOOKED`).
- Phần tử **không `_id`** → tạo đợt mới (`availableSlots = totalSlots`).
- Đợt cũ **vắng mặt** trong payload = yêu cầu xóa: còn đơn active → **409 `DEPARTURE_HAS_BOOKINGS` từ chối CẢ request, DB không đổi** (response kèm `departures: [{departureId, soDon}]`); không còn đơn → xóa.
- Mọi validate chạy xong hết mới ghi → nhận 4xx/409 nghĩa là DB chưa bị đụng.

**`isActive` (soft delete):** `false` → tour biến mất khỏi `GET /tours` + `GET /tours/:idOrSlug` phía client (404), vẫn hiện đầy đủ ở `/admin/tours`. Hiện lại bằng `PUT { isActive: true }`.

## Bookings (user) — `protect`

| Method | Path | Body/Query | Response 2xx | Lỗi |
|---|---|---|---|---|
| POST | `/bookings` | `{ tourId, departureId, guests, contact{name,phone,email}, paymentMethod, note }` | `201 { success, message, booking }` | 400 `VALIDATION_ERROR`/`DEPARTURE_NOT_FOUND`/`DEPARTURE_PAST`, 404 tour, **409 `SLOT_UNAVAILABLE`** |
| GET | `/bookings/my` | `?status&page&limit` | `200 { success, total, page, totalPages, bookings[] }` | 400 status lạ |
| GET | `/bookings/:id` | — | `200 { success, booking }` | 403 (không phải chủ đơn/admin), 404 |
| PATCH | `/bookings/:id/cancel` | — | `200 { success, message, booking }` — hoàn chỗ về đợt | 400 (không phải pending_payment), 403, 404 |

`booking` gồm `departureId` (ObjectId của đợt — nguồn sự thật) và `departureDate` (bản sao denormalize chỉ để hiển thị). `booking.status` ∈ `pending_payment | paid | cancelled | completed`. `paymentMethod` ∈ `vnpay | momo | later | null`.

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

## ✅ RESOLVED: departureId (Batch 2 — 04/08/2026)

**Shape mới.** `departures[]` = `{ _id, date, totalSlots, availableSlots, price }` — Mongoose tự sinh `_id`, đây là khóa ổn định của đợt. `Booking` thêm `departureId` (ObjectId, có index); `departureDate` GIỮ LẠI làm bản sao denormalize chỉ để hiển thị (sẽ cân nhắc xóa sau khi FE ổn định).

**Luồng mới (không còn bất kỳ phép khớp ngày nào):**
1. FE (TourDetail) chọn đợt theo `departure._id`, gửi `departureId` trong `POST /bookings`.
2. BE tìm đợt bằng `tour.departures.id(departureId)`; trừ chỗ nguyên tử `findOneAndUpdate` với `$elemMatch { _id, availableSlots: { $gte: guests } }` — thua điều kiện trả **409 `SLOT_UNAVAILABLE`** (đã chứng minh bằng `scripts/test-concurrent.mjs`: 20 request song song vào đợt 5 chỗ → đúng 5×201 + 15×409, slots = 0).
3. Hủy đơn (user lẫn admin) hoàn chỗ theo `departures._id` — admin đổi `date` của đợt không còn làm trượt hoàn chỗ.

**Migration đã chạy (04/08/2026):** `scripts/migrate-departures.mjs` (idempotent, có `--dry-run`) cấp `_id` + `totalSlots` cho 24/24 đợt, backfill `departureId` cho 3/9 đơn khớp được. **6 đơn mồ côi từ trước** (trỏ tour đã bị seed xóa) ghi tại `C:\TTTN\orphan-bookings.json` — không xóa, không đoán; các đơn này `departureId = null`, khi hủy sẽ bỏ qua bước hoàn chỗ và ghi log. Rollback: `scripts/rollback-departures.mjs` (đã test trên bản restore từ backup) hoặc `mongorestore` từ `C:\TTTN\backup-batch2-20260804-231856`.

**Quy tắc cho màn admin sửa tour (batch sau):** `PUT /tours/:id` thay `departures` NGUYÊN MẢNG — đợt đã tồn tại **bắt buộc gửi kèm `_id` cũ** (thiếu `_id` → Mongoose sinh id mới → booking đang trỏ tới đợt đó thành mồ côi). Đợt mới thì không gửi `_id`. Khi sửa đợt phải gửi đủ `totalSlots` + `availableSlots`.
