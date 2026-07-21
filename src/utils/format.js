// Hàm tiện ích định dạng dùng chung cho toàn bộ giao diện.
// Tách khỏi src/data/*: đây là tiện ích thuần, không phải dữ liệu (§6.2, §7).

// Định dạng giá VNĐ dạng 5.000.000đ
export const formatPrice = (v) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`
