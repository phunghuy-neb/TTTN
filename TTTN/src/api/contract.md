# Hợp đồng API — VietVoyage (FE ⇄ BE)

- **Base URL:** `VITE_API_BASE_URL` (bắt buộc; local dùng `http://localhost:5000/api`)
- **Xác thực:** trình duyệt nhận JWT trong cookie HttpOnly `vv_session` và gửi tự động với `credentials: include`; API vẫn nhận `Authorization: Bearer <token>` cho CLI/mobile. Middleware luôn đọc role hiện tại từ DB.
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
| `INVALID_STATUS_TRANSITION` | Đổi trạng thái đơn sai máy trạng thái, kèm `currentStatus` (409) |
| `CANNOT_LOCK_SELF` | Admin tự khóa tài khoản chính mình (409) |
| `CANNOT_DEMOTE_SELF` | Admin tự hạ quyền chính mình — chặn cả PATCH /role lẫn PUT (409) |
| `UPLOAD_ERROR` | File upload sai định dạng/quá 5MB (400) |
| `NOT_FOUND` | Không có route/tài nguyên (404) |
| `WRONG_PASSWORD` | Đổi mật khẩu nhưng mật khẩu cũ sai (400) |
| `AI_UNAVAILABLE` | AI service được cấu hình nhưng chết/timeout 30s (503) |
| `BAD_REQUEST` / `UNAUTHORIZED` / `CONFLICT` / `REQUEST_ERROR` | Code mặc định bơm theo status khi controller chưa đặt code riêng |
| `SERVER_ERROR` | Lỗi 5xx |
| `NETWORK_ERROR` | (chỉ FE) fetch thất bại — mất mạng/server tắt |

**Phía FE (`services/api.js`):** không lưu JWT trong `localStorage`; request gửi cookie HttpOnly. `localStorage['auth']` chỉ cache thông tin user không nhạy cảm. Request có `auth: true` bị 401 → xóa cache + phát `session-expired`.

---

## Auth

| Method | Path | Auth | Body | Response 2xx | Lỗi |
|---|---|---|---|---|---|
| POST | `/auth/register` | — | `{ name, email, password }` | `201 { success, message, token, user }` | 400 `VALIDATION_ERROR` / `EMAIL_TAKEN` |
| POST | `/auth/login` | — | `{ email, password }` | `200 { success, message, token, user }` | 400 `VALIDATION_ERROR`, 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_LOCKED` |
| GET | `/auth/me` | ✔ | — | `200 { success, user }` | 401 `AUTH_REQUIRED` / `TOKEN_INVALID` |
| POST | `/auth/logout` | — | — | `200 { success, message }`, xóa cookie phiên | — |
| PUT | `/auth/profile` | ✔ | `{ name?, phone? }` | `200 { success, message, user }` | 400 `VALIDATION_ERROR` |
| PATCH | `/auth/password` | ✔ | `{ oldPassword, newPassword }` | `200 { success, message }` | 400 `WRONG_PASSWORD` (sai mật khẩu cũ) / `VALIDATION_ERROR` |

`user` = `{ _id, name, email, phone, avatar, role, isActive, createdAt }`.

## Tours (public)

| Method | Path | Auth | Query | Response 2xx |
|---|---|---|---|---|
| GET | `/tours` | tùy chọn* | `page, limit, search, region, minPrice, maxPrice, days, minDays, maxDays, sort, deals` | `200 { success, total, page, totalPages, tours[] }` |
| GET | `/tours/:idOrSlug` | tùy chọn* | — | `200 { success, tour }` — 404 nếu không tồn tại hoặc chưa published |
| POST | `/tours/:tourId/reviews` | ✔ | multipart `{ bookingId, rating, comment, images[] }` | `201 { success, review }`; chỉ booking `completed`, mỗi booking một lần |

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
| POST | `/bookings` | `{ tourId, departureId, guests, contact{name,phone,email}, paymentMethod, note, idempotencyKey }` | `201 { success, message, booking }`; gửi lặp cùng key → `200 { …, duplicate: true }` kèm đơn cũ | 400 `VALIDATION_ERROR`/`DEPARTURE_NOT_FOUND`/`DEPARTURE_PAST`, 404 `TOUR_UNAVAILABLE`, 409 `SLOT_UNAVAILABLE` |
| GET | `/bookings/my` | `?status&page&limit` | `200 { success, total, page, totalPages, bookings[] }` | 400 status lạ |
| GET | `/bookings/code/:code` | — | `200 { success, booking }` cho chủ đơn/admin; dùng sau khi trở về từ cổng | 403, 404 |
| GET | `/bookings/:id` | — | `200 { success, booking }` | 403 (không phải chủ đơn/admin), 404 |
| PATCH | `/bookings/:id/cancel` | — | `200 { success, message, booking }` — hoàn chỗ về đợt | 400 (không phải pending_payment), 403, 404 |

`booking` gồm `departureId`, `departureDate`, `paymentExpiresAt`, `paidAt`, `txnRef`, `lastPaymentAttempt` và tour có `summary`, `itinerary`, `highlights` ở API chi tiết. `booking.status` ∈ `pending_payment | paid | cancelled | completed`; `paymentMethod` ∈ `vnpay | momo | later | null`.

## Yêu thích và thông báo — `protect`

| Method | Path | Body/Query | Response 2xx |
|---|---|---|---|
| GET | `/favorites/ids` | — | `{ success, ids[] }` |
| GET | `/favorites` | `?page&limit` | Danh sách tour đã lưu |
| GET | `/favorites/suggestions` | `?limit` | Gợi ý theo khu vực, địa điểm và tag của tour đã lưu |
| POST / DELETE | `/favorites/:tourId` | — | Thêm / bỏ yêu thích, idempotent |
| GET | `/notifications` | `?page&limit&unreadOnly` | Danh sách và `unreadCount` |
| PATCH | `/notifications/:id/read` | — | Đánh dấu một thông báo đã đọc |
| PATCH | `/notifications/read-all` | — | Đánh dấu tất cả đã đọc |

Worker tạo thông báo idempotent cho đơn sắp hết hạn thanh toán, hết hạn, thanh toán thành công/thất bại, admin xác nhận, tour sắp khởi hành, hoàn thành, hủy và thay đổi hiển thị đánh giá.

## Payments

| Method | Path | Auth | Body / callback | Kết quả |
|---|---|---|---|---|
| GET | `/payments/config` | — | — | Trạng thái cấu hình Sandbox của VNPay/MoMo, không trả key |
| POST | `/payments/:bookingId/initiate` | Chủ đơn | `{ provider: 'vnpay'|'momo' }` | `{ success, provider, paymentUrl, paymentQrDataUrl?, deeplink?, expiresAt, reused }` |
| GET | `/payments/vnpay/return` | Chữ ký VNPay | Query VNPay | Xử lý idempotent rồi redirect FE `/payment` |
| GET | `/payments/vnpay/ipn` | Chữ ký VNPay | Query VNPay | Response `RspCode` theo VNPay |
| GET | `/payments/momo/return` | Chữ ký MoMo | Query MoMo | Xử lý idempotent rồi redirect FE `/payment` |
| POST | `/payments/momo/ipn` | Chữ ký MoMo | JSON MoMo | Xử lý idempotent |
| GET | `/payments/review-required` | Admin | — | Danh sách giao dịch thành công về muộn/cần đối soát |

Admin có thể dùng `PATCH /admin/payments/:id/confirm-sandbox` với body
`{ transactionRef, note? }` để mô phỏng xác nhận giao dịch VNPay/MoMo khi không có
ứng dụng UAT. API chỉ nhận attempt `initiated`, booking còn hạn và provider đang ở
Sandbox; thao tác lưu admin vào `statusHistory`, dùng response code
`ADMIN_SANDBOX_CONFIRMED`, phát hành vé và không được bật cho môi trường thanh toán thật.

Backend so khớp chữ ký, merchant/partner, `orderId` và số tiền trước khi ghi nhận. Admin không được đánh dấu đơn VNPay/MoMo là `paid` bằng API trạng thái.
Khách có thể đổi VNPay/MoMo sau khi lần trước đã `failed/expired`; nếu còn attempt `creating/initiated`, backend chặn cổng khác để không mở đồng thời hai URL thanh toán.

## Admin — `protect + requireAdmin` (mới) / `authorize('admin')` (cũ)

| Method | Path | Body/Query | Response 2xx |
|---|---|---|---|
| GET | `/admin/stats` | — | `200 { success, stats }` — aggregate thật: `totalTours, totalBookings, totalUsers, revenue` (Σ đơn `paid`+`completed`) + **Batch 4**: `monthlyRevenue[{year,month,revenue,count}]` (6 tháng theo ngày đặt), `byStatus{status:n}`, `topTours[{tourId,tourName,soDon,doanhThu}]` (top 5, bỏ đơn hủy), `latestBookings[]` (5 đơn mới, populate user) + **Batch 7**: `currentMonthRevenue` (doanh thu THÁNG hiện tại — khác mảng monthlyRevenue), `pendingBookings`, `activeTours` (isActive≠false), `revenueByRegion[{region,revenue,bookings}]` (đủ 3 miền kể cả revenue 0) |
| GET | `/admin/ai-settings` | — | `200 { success, aiServiceUrl (đã che), status: 'not_configured'\|'online'\|'offline' (ping thật timeout 3s), chatEnabled, totalMessages, uniqueUsers }` |
| PATCH | `/admin/ai-settings` | `{ chatEnabled: boolean }` | `200 { success, message, chatEnabled }` — upsert collection `settings` (key-value) |
| GET | `/settings/public` | — (**không cần đăng nhập**) | `200 { success, chatEnabled }` — FE đọc lúc mount để quyết định render ChatWidget |
| GET | `/admin/users` | `?search&role&isActive&sort&page&limit` | `200 { success, total, page, totalPages, users[] }` — mỗi user kèm `soDon` (tổng đơn) |
| GET | `/admin/users/:id` | — | `200 { success, user }` |
| PUT | `/admin/users/:id` | `{ name?, phone?, avatar?, role? }` | `200 { success, message, user }` — tự hạ quyền → 409 `CANNOT_DEMOTE_SELF` |
| PATCH | `/admin/users/:id/lock` | — | `200 { success, message, user }` (toggle `isActive`) — tự khóa → 409 `CANNOT_LOCK_SELF`; user bị khóa login nhận 403 `ACCOUNT_LOCKED` |
| PATCH | `/admin/users/:id/role` | `{ role: 'customer'\|'admin' }` | `200 { success, message, user }` — tự hạ quyền → 409 `CANNOT_DEMOTE_SELF` |
| GET | `/admin/bookings` | `?status&tourId&userId&search&dateFrom&dateTo&sort&page&limit` — `search` khớp mã đơn/tên tour/tên/email/SĐT khách; `dateFrom/dateTo` là khoảng **ngày đặt** (createdAt, trọn ngày) | `200 { success, total, page, totalPages, bookings[] }` — booking kèm `departureId`, `departureDate`, `statusHistory` |
| GET | `/admin/bookings/:id` | — | `200 { success, booking }` — populate user + tour, kèm `statusHistory` |
| GET | `/admin/bookings/stats` | — | `200 { success, stats }` (doanh thu tính `paid` + `completed`) |
| PATCH | `/admin/bookings/:id/status` | `{ status, txnRef? }` | `200 { success, message, booking }`; online không được xác nhận paid thủ công |
| GET | `/admin/reviews` | `?q&rating&visibility&page&limit` | Danh sách đánh giá nhúng trong tour, kèm khách và tour |
| PATCH | `/admin/reviews/:tourId/:reviewId/visibility` | `{ isVisible: boolean }` | Ẩn/hiện đánh giá, tính lại `avgRating` và báo cho khách |

**Chống đơn trùng.** FE tạo một `idempotencyKey` ngẫu nhiên cho mỗi lần xác nhận checkout và giữ nguyên khi retry. Backend lưu `user:idempotencyKey` trong unique index; request song song thua index được rollback cả booking lẫn slot rồi nhận lại đúng đơn cũ.

**Máy trạng thái đơn** — `pending_payment → paid | cancelled`; `paid → completed`; `completed`/`cancelled` là cuối. Đơn đã thu tiền không thể bị hủy bằng thao tác trạng thái vì cần quy trình refund riêng. Tạo/hủy/hết hạn đơn và thay đổi slot được commit trong MongoDB transaction.

Lỗi chung khu admin: 401 `AUTH_REQUIRED`/`TOKEN_INVALID` (không token/token hỏng), 403 `ADMIN_ONLY` (đăng nhập nhưng không phải admin).

---

## 🤖 Trợ lý AI (UC-07)

**Trạng thái:** BE đang trả lời bằng **stub nội bộ** (từ khóa tiếng Việt + gợi ý tour THẬT từ MongoDB). Nối AI thật của Tuấn Anh **không cần sửa FE**: chỉ set `AI_SERVICE_URL` trong `.env` của BE — adapter duy nhất ở `TTTN_BE/src/services/aiAdapter.js` (đã đánh dấu `TODO(ai)`).

| Method | Path | Auth | Body/Query | Response 2xx | Lỗi |
|---|---|---|---|---|---|
| POST | `/chat` | ✔ | `{ message (≤1000 ký tự), tourId? }` — `tourId` nhận cả ObjectId lẫn slug, dùng bơm context tour đang xem | `200 { success, reply, suggestedTours }` | 400 `VALIDATION_ERROR`, **503 `AI_UNAVAILABLE`** (URL cấu hình nhưng AI chết/timeout 30s — KHÔNG rơi về stub để vận hành biết sự cố) |
| GET | `/chat/history` | ✔ | `?page&limit` | `200 { success, total, page, totalPages, messages[] }` — sắp MỚI → CŨ, mỗi tin `{ _id, role: 'user'\|'assistant', content, tourId, at }` | |
| DELETE | `/chat/history` | ✔ | — | `200 { success, message }` — xóa toàn bộ hội thoại của mình | |

**Shape CỐ ĐỊNH đã chốt với AI service** (Tuấn Anh code theo đúng cái này):
```
POST {AI_SERVICE_URL}/chat
body    : { message, userName, tourContext | null }
response: { reply: string, suggestedTours: [{ _id, title, price, image }] }
```
`tourContext` = `{ _id, name, basePrice, days, region, itinerarySo }`. Hội thoại lưu ở collection `chatMessages { userId, role, content, tourId, at }` — chỉ lưu khi trả lời thành công.

## ✅ RESOLVED: departureId (Batch 2 — 04/08/2026)

**Shape mới.** `departures[]` = `{ _id, date, totalSlots, availableSlots, price }` — Mongoose tự sinh `_id`, đây là khóa ổn định của đợt. `Booking` thêm `departureId` (ObjectId, có index); `departureDate` GIỮ LẠI làm bản sao denormalize chỉ để hiển thị (sẽ cân nhắc xóa sau khi FE ổn định).

**Luồng mới (không còn bất kỳ phép khớp ngày nào):**
1. FE (TourDetail) chọn đợt theo `departure._id`, gửi `departureId` trong `POST /bookings`.
2. BE tìm đợt bằng `tour.departures.id(departureId)`; trừ chỗ nguyên tử `findOneAndUpdate` với `$elemMatch { _id, availableSlots: { $gte: guests } }` — thua điều kiện trả **409 `SLOT_UNAVAILABLE`** (đã chứng minh bằng `scripts/test-concurrent.mjs`: 20 request song song vào đợt 5 chỗ → đúng 5×201 + 15×409, slots = 0).
3. Hủy đơn (user lẫn admin) hoàn chỗ theo `departures._id` — admin đổi `date` của đợt không còn làm trượt hoàn chỗ.

**Migration đã chạy (04/08/2026):** `scripts/migrate-departures.mjs` (idempotent, có `--dry-run`) cấp `_id` + `totalSlots` cho 24/24 đợt, backfill `departureId` cho 3/9 đơn khớp được. **6 đơn mồ côi từ trước** (trỏ tour đã bị seed xóa) ghi tại `C:\TTTN\orphan-bookings.json` — không xóa, không đoán; các đơn này `departureId = null`, khi hủy sẽ bỏ qua bước hoàn chỗ và ghi log. Rollback: `scripts/rollback-departures.mjs` (đã test trên bản restore từ backup) hoặc `mongorestore` từ `C:\TTTN\backup-batch2-20260804-231856`.

**Quy tắc cho màn admin sửa tour (batch sau):** `PUT /tours/:id` thay `departures` NGUYÊN MẢNG — đợt đã tồn tại **bắt buộc gửi kèm `_id` cũ** (thiếu `_id` → Mongoose sinh id mới → booking đang trỏ tới đợt đó thành mồ côi). Đợt mới thì không gửi `_id`. Khi sửa đợt phải gửi đủ `totalSlots` + `availableSlots`.
# API bổ sung: vé, voucher và vận hành (2026-08)

- `GET /tickets/verify/:token` — API công khai, chỉ trả mã vé/booking, tour, ngày đi, số khách và trạng thái.
- `GET /tickets/verify-page/:token` — trang HTML xác minh độc lập dùng trực tiếp trong QR; không cần đăng nhập và không phụ thuộc JavaScript của frontend.
- `GET /tickets/booking/:bookingId` và `/pdf` — chủ booking hoặc admin.
- `POST /vouchers/validate` — body `{ code, tourId, departureId, guests }`; backend đọc giá thật.
- `/admin/vouchers`, `/admin/tickets`, `/admin/payments` — quản lý voucher, check-in và đối soát.
- `GET /admin/operations/calendar` — lịch đợt khởi hành.
- `GET /admin/operations/reports/bookings|revenue?format=csv|xlsx` — tải báo cáo.

`POST /bookings` nhận thêm `voucherCode`. Client không gửi giá: backend tự tính `originalPrice`, `discountAmount`, snapshot `voucher` và `totalPrice` trong cùng transaction với trừ chỗ/lượt voucher.
