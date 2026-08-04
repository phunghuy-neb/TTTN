// Nhãn + màu badge cho trạng thái đơn — dùng chung cho các màn admin.
// (Trang client Bookings.jsx có bản riêng từ trước — giữ nguyên để không đổi hành vi.)

export const TRANG_THAI_DON = {
  pending_payment: { label: 'Chờ thanh toán', className: 'bg-gold/15 text-gold' },
  paid: { label: 'Đã thanh toán', className: 'bg-jade/10 text-jade' },
  cancelled: { label: 'Đã hủy', className: 'bg-coral/10 text-coralD' },
  completed: { label: 'Hoàn thành', className: 'bg-teal/10 text-teal' },
}

export const nhanTrangThai = (status) =>
  TRANG_THAI_DON[status] || { label: status, className: 'bg-sand text-muted' }

// Máy trạng thái — PHẢN CHIẾU đúng luật BE để UI chỉ hiện nút hợp lệ.
// Nguồn sự thật vẫn là BE (sai luồng BE trả 409 INVALID_STATUS_TRANSITION).
export const CHUYEN_TRANG_THAI = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}
