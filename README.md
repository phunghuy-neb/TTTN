# VietVoyage - chạy bằng Docker

VietVoyage gồm đầy đủ luồng tìm tour → đặt chỗ → voucher → VNPay/MoMo → vé QR → đánh giá,
tour yêu thích và thông báo. Khu admin có quản lý booking/tour/user/review/voucher/vé, giao dịch
đối soát, lịch khởi hành, dashboard và xuất CSV/Excel.

Docker Compose đóng gói Frontend, Backend và ngrok. Người chạy không cần cài riêng
Node.js, Python hay ngrok; chỉ cần Docker Desktop, MongoDB Atlas URI và các key họ
muốn sử dụng.

## 1. Chuẩn bị cấu hình

Trong PowerShell tại thư mục gốc dự án:

```powershell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
Copy-Item TTTN/.env.example TTTN/.env
```

Điền tối thiểu trong `backend/.env`:

```env
MONGO_URI=mongodb+srv://...
JWT_SECRET=mot_chuoi_ngau_nhien_toi_thieu_32_ky_tu
CLIENT_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
MOMO_MODE=demo
```

Trong `.env` ở thư mục gốc, điền authtoken và development domain lấy từ ngrok:

```env
NGROK_AUTHTOKEN=...
NGROK_DOMAIN=your-name.ngrok-free.dev
PUBLIC_BASE_URL=https://your-name.ngrok-free.dev
CLIENT_URL=https://your-name.ngrok-free.dev
CORS_ORIGINS=http://localhost:5173,https://your-name.ngrok-free.dev
VITE_API_BASE_URL=/api
```

Không thêm `https://` vào `NGROK_DOMAIN`. Không commit bất kỳ file `.env` thật nào.

## 2. Chạy hệ thống

```powershell
docker compose --profile ai up --build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:5000
- Ngrok inspector: http://localhost:4040
- Website public: `https://<NGROK_DOMAIN>`

Domain ngrok mở Frontend; Nginx tự chuyển `/api` và `/uploads` sang Backend. Vì vậy
cùng một domain phục vụ giao diện, API, ảnh tải lên và callback thanh toán.

## Dữ liệu demo và kiểm thử

Sau khi hệ thống chạy, nạp dữ liệu dùng khi trình diễn (idempotent, chỉ chạy ở development):

```powershell
docker compose exec backend npm run seed:demo
```

- Khách: `codex-customer-ui-20260812@example.com` / `CodexCustomer123!`
- Admin: `codex-admin-ui-20260812@example.com` / `CodexAdmin123!`
- Voucher: `DEMO10`

Đổi các mật khẩu này nếu môi trường có người khác truy cập. Chạy kiểm thử:

```powershell
docker compose exec backend npm test
docker compose exec backend npm run test:voucher-concurrency
```

Kịch bản trình bày theo từng vai trò nằm trong `DEMO_SCRIPT.md`.

## 3. Thanh toán

### MoMo demo cho bài nộp

`MOMO_MODE=demo` mở trang mô phỏng có nhãn rõ ràng, không kết nối ví và không thu
tiền thật. Luồng vẫn tạo PaymentAttempt, cập nhật Booking và kiểm tra token chống
sửa mã giao dịch. Chế độ này tự bị chặn khi `NODE_ENV=production`.

### MoMo Test chính thức

Khi có key MoMo for Business hợp lệ, sửa `backend/.env`:

```env
MOMO_MODE=sandbox
MOMO_PARTNER_CODE=...
MOMO_ACCESS_KEY=...
MOMO_SECRET_KEY=...
MOMO_REQUEST_TYPE=captureWallet
MOMO_ENDPOINT=https://test-payment.momo.vn/v2/gateway/api/create
```

`captureWallet` cho phép backend nhận `qrCodeUrl`/deep link và dựng QR ngay trong trang
VietVoyage. Khi lên production, merchant phải được MoMo cấp quyền sử dụng các trường
QR/deep link; không dùng bộ key Sandbox cho giao dịch thật.

Với bài nộp, có thể dùng bộ merchant demo công khai của MoMo như video hướng dẫn. Bộ key
này chỉ dành cho Sandbox, dùng chung và có thể bị MoMo thay đổi hoặc thu hồi; không đưa key
vào Git và tuyệt đối không dùng cho môi trường thật.

Backend tự tạo hai URL từ `NGROK_DOMAIN`:

```text
https://<NGROK_DOMAIN>/api/payments/momo/return
https://<NGROK_DOMAIN>/api/payments/momo/ipn
```

### VNPay Sandbox

Điền `VNP_TMN_CODE` và `VNP_HASH_SECRET` trong `backend/.env`, sau đó cấu hình IPN
trên VNPay merchant:

```text
https://<NGROK_DOMAIN>/api/payments/vnpay/ipn
```

Return URL được Backend tự tạo là:

```text
https://<NGROK_DOMAIN>/api/payments/vnpay/return
```

## AI service (tùy chọn)

Sao chép `ai/tour-ai-service/.env.example` thành `.env`, điền Gemini/MongoDB key,
đặt `AI_SERVICE_URL=http://tour-ai-service:4000/api/ai` trong `.env` gốc rồi chạy:

```powershell
docker compose --profile ai up --build
```

Sau khi container AI healthy, đồng bộ dữ liệu tour vào Chroma:

```powershell
docker compose --profile ai exec tour-ai-service npm run sync:vectors
```

AI cần `GEMINI_API_KEY` hợp lệ trong `ai/tour-ai-service/.env`; không commit các file `.env` lên Git.
