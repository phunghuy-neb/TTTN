# VietVoyage Frontend

Giao diện web đặt tour du lịch trong nước — đồ án Thực tập tốt nghiệp (Nhóm 1, PTIT). Gồm khu **khách hàng** (tìm tour, yêu thích, voucher, đặt/thanh toán, lịch sử, vé QR/PDF, đánh giá, thông báo, hồ sơ, chat AI) và khu **quản trị** `/admin` (dashboard, tour/booking/user/review/voucher/vé/giao dịch, lịch khởi hành và báo cáo).

## Tech stack

- **React 18** + **Vite 5** — SPA, JavaScript thuần (JSX)
- **React Router 6** — router hai khu (client layout / admin layout), guard `PrivateRoute` + `AdminRoute`
- **Tailwind CSS 3** — design system riêng (token màu teal/coral, font Be Vietnam Pro + Lora)
- **Recharts** — biểu đồ dashboard admin
- Không dùng axios/Redux — tầng HTTP tự viết (`src/services/api.js`), state bằng Context + hook

## Cài đặt & chạy

```bash
npm install
copy .env.example .env        # chỉnh nếu Backend chạy cổng khác
npm run dev                   # http://localhost:5173
```

Chạy kèm Backend (`../backend`, cổng 5000) + MongoDB replica set. Build production: `npm run build` (ra `dist/`).

## Biến môi trường (.env)

| Biến | Ý nghĩa |
|---|---|
| `VITE_API_BASE_URL` | Base URL của Backend API, VD `http://localhost:5000/api` — bắt buộc |

`.env` KHÔNG được commit — chỉ commit `.env.example`.

## Tài khoản quản trị

Dự án không lưu mật khẩu mẫu trong Git. Đăng ký một tài khoản qua giao diện, sau đó
cấp quyền bằng lệnh sau tại thư mục `backend`:

```bash
node scripts/set-admin.mjs email-cua-ban@example.com
```

Đăng xuất và đăng nhập lại sau khi cấp quyền.

## Cấu trúc chính

```
src/
├── App.jsx                 # Router 2 khu + ErrorBoundary + ToastProvider
├── components/
│   ├── ui/                 # Primitives: Button, Field, Modal, Toast, Pagination, Table, EmptyState, Skeleton
│   └── chat/               # ChatWidget (UC-07) + event bus mở panel
├── context/AuthContext.jsx # Phiên đăng nhập, đồng bộ 401 từ tầng HTTP (event bus)
├── hooks/useRequestGuard.js# Chống race condition cho mọi màn có filter/phân trang
├── layouts/AdminLayout.jsx # Sidebar + topbar + breadcrumb khu admin
├── pages/                  # Trang client + pages/admin/* (Dashboard, Tours, Bookings, Users)
├── routes/                 # PrivateRoute, GuestRoute, AdminRoute
├── services/               # api.js (fetch + cookie HttpOnly + lỗi tập trung) + service từng miền
├── api/contract.md         # HỢP ĐỒNG API đầy đủ (endpoint, shape, mã lỗi) — đọc file này trước khi sửa service
└── data/tours.js           # Dữ liệu tour mẫu — NGUỒN SEED của Backend (seed.mjs đọc file này), không phải dead code
```

## Ghi chú cho người chấm

- Mọi lỗi 4xx/5xx từ API đều có `{ message, code }` — FE map `code` sang thông báo tiếng Việt.
- Đặt/hủy tour tham chiếu đợt khởi hành bằng `departureId` (khóa ổn định) — admin đổi ngày đợt không làm hỏng đơn cũ; chống oversell bằng cập nhật nguyên tử (xem `scripts/test-concurrent.mjs` bên Backend).
- Thanh toán VNPay chuyển sang sandbox; MoMo hỗ trợ cả sandbox thật và chế độ mô phỏng có nhãn rõ ràng cho bài nộp. Trang `/payment` đối chiếu lại trạng thái booking sau callback.
- Chat dùng AI service khi Backend có `AI_SERVICE_URL` + `AI_SERVICE_API_KEY`; nếu không cấu hình thì Backend mới dùng stub.
