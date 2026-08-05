// Hàm tiện ích định dạng dùng chung cho toàn bộ giao diện.
// Tách khỏi src/data/*: đây là tiện ích thuần, không phải dữ liệu (§6.2, §7).

// Định dạng giá VNĐ dạng 5.000.000đ
export const formatPrice = (v) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`

// Ngày dạng dd/mm/yyyy theo chuẩn vi-VN (§14) — ép 2 chữ số, mặc định của Intl là 14/8/2026.
// timeZone UTC vì dữ liệu là ngày lịch thuần ('2026-08-21'), new Date() hiểu là nửa đêm UTC:
// để Intl đọc theo giờ máy thì máy ở phía tây UTC sẽ hiển thị lùi một ngày.
const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC'
})
export const formatDate = (iso) => dateFormatter.format(new Date(iso))
