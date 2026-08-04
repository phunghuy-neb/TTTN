// Tầng service booking — gọi API Booking THẬT của Backend (`/api/bookings`) qua services/api.js.
// Mọi endpoint booking đều yêu cầu đăng nhập → luôn gọi với auth: true.
// Nhiệm vụ của tầng này: đổi cấu trúc response Backend (khóa `booking`/`bookings` + total/page/totalPages
// phẳng) về cấu trúc §7 { success, data, pagination } / { success, data } / { success: false, message },
// để component (TourDetail/Checkout/Payment/Bookings) không phụ thuộc tên khóa của Backend.
import { request } from './api.js'

// Tạo đơn đặt tour (UC-08).
// payload: { tourId, departureId, guests, contact: { name, phone, email }, paymentMethod, note }
// departureId là `departures[]._id` nhận từ API tour — khóa ổn định, Backend trừ/hoàn chỗ
// theo id này nên admin đổi ngày đợt cũng không ảnh hưởng đơn đã đặt.
export async function createBooking(payload) {
  const res = await request('/bookings', { method: 'POST', body: payload, auth: true })
  if (res.success === false) return res

  return { success: true, data: res.booking, message: res.message }
}

// Lịch sử đặt tour của bản thân (UC-10) — lọc theo trạng thái + phân trang
export async function getMyBookings({ status = '', page = 1, limit = 5 } = {}) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('limit', String(limit))
  // Chỉ gửi status khi có giá trị — rỗng nghĩa là xem tất cả
  if (status) params.set('status', status)

  const res = await request(`/bookings/my?${params.toString()}`, { auth: true })
  if (res.success === false) return res

  // `limit` lấy từ tham số đầu vào vì response Backend không có trường này (giống tourService)
  return {
    success: true,
    data: res.bookings,
    pagination: { page: res.page, limit, total: res.total, totalPages: res.totalPages },
  }
}

// Chi tiết một đơn — Backend chỉ cho chủ đơn hoặc admin xem
export async function getBookingById(id) {
  const res = await request(`/bookings/${id}`, { auth: true })
  if (res.success === false) return res

  return { success: true, data: res.booking }
}

// Hủy đơn — Backend chỉ cho hủy khi đơn còn ở trạng thái pending_payment
export async function cancelBooking(id) {
  const res = await request(`/bookings/${id}/cancel`, { method: 'PATCH', auth: true })
  if (res.success === false) return res

  return { success: true, data: res.booking, message: res.message }
}
