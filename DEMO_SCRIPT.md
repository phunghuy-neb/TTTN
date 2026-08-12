# Kịch bản trình diễn VietVoyage

## Chuẩn bị

1. Chạy `docker compose up --build -d`.
2. Chạy `docker compose exec backend npm run seed:demo`.
3. Mở `http://localhost:5173` hoặc domain ngrok trong `.env` gốc.
4. Dùng mã voucher `DEMO10`. VNPay dùng Sandbox; MoMo dùng `MOMO_MODE=demo` nếu chưa có key Test.

## Vai khách hàng (6–8 phút)

1. Đăng nhập `codex-customer-ui-20260812@example.com` / `CodexCustomer123!`.
2. Yêu thích một tour, chọn đợt khởi hành và số khách.
3. Tại Checkout nhập `DEMO10`; chỉ ra giá gốc, tiền giảm và tổng do backend trả về.
4. Chọn MoMo Demo hoặc VNPay Sandbox, hoàn tất/giả lập thanh toán.
5. Mở menu tài khoản → Đơn đặt tour → chi tiết đơn; giới thiệu timeline, lịch sử giao dịch và thông báo.
6. Với đơn đã thanh toán, mở vé điện tử, quét QR bằng điện thoại, thử tải PDF/in vé.
7. Mở một đơn completed để gửi đánh giá có ảnh.

## Vai quản trị viên (6–8 phút)

1. Đăng nhập `codex-admin-ui-20260812@example.com` / `CodexAdmin123!` và vào `/admin`.
2. Giới thiệu dashboard: doanh thu, tour bán chạy, tỷ lệ thanh toán và tỷ lệ hủy.
3. Mở Voucher để tạo/tắt/sửa mã ưu đãi.
4. Mở Giao dịch, lọc “Cần đối soát”, ghi kết quả xử lý; khách nhận thông báo trong web.
5. Mở Vé & check-in, tìm mã vé và xác nhận đã sử dụng.
6. Mở Lịch khởi hành để xem chỗ trống, số đơn và doanh thu theo ngày.
7. Mở Báo cáo, tải danh sách booking và doanh thu dạng Excel/CSV.
8. Mở Đánh giá để ẩn/hiện nội dung và chỉ ra thông báo gửi lại khách.

## Điểm kỹ thuật nên nói ngắn gọn

- Giá, voucher và số chỗ do backend tính; frontend không thể tự gửi tổng tiền.
- Booking, giữ chỗ và giữ lượt voucher dùng MongoDB transaction; callback thanh toán là idempotent.
- Route admin có kiểm tra đăng nhập và role ở backend, không chỉ ẩn nút trên giao diện.
- QR vé chứa token ngẫu nhiên, không lộ MongoDB ID hay thông tin liên hệ trên trang xác minh công khai.
- Sandbox/Demo không thu tiền thật; giao dịch về muộn được đưa vào danh sách đối soát thay vì tự giữ lại chỗ.
