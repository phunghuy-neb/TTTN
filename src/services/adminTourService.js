// Tầng service quản lý tour cho admin — gọi `/api/admin/tours` (Batch 3).
// Chuẩn hóa response về khuôn { success, data, ... } như các service khác.
import { request } from './api.js'

// Map mã lỗi 409 nghiệp vụ → thông báo tiếng Việt rõ ràng cho người dùng admin.
// Ưu tiên message BE (đã tiếng Việt, kèm số liệu); map này là fallback + chuẩn hóa.
const THONG_BAO_LOI = {
  DEPARTURE_HAS_BOOKINGS:
    'Không thể xóa đợt khởi hành đang có đơn active. Hủy hoặc hoàn tất các đơn trước, hoặc giữ nguyên đợt.',
  SLOTS_BELOW_BOOKED:
    'Tổng số chỗ không được nhỏ hơn số chỗ khách đã đặt của đợt đó.',
  TOUR_HAS_BOOKINGS:
    'Tour vẫn còn đơn active nên chưa thể ẩn. Xử lý hết đơn trước khi ẩn tour.',
}

// Gắn message thân thiện theo code (giữ nguyên message BE nếu có)
function chuanHoaLoi(res) {
  if (res.success === false && THONG_BAO_LOI[res.code]) {
    return { ...res, message: res.message || THONG_BAO_LOI[res.code] }
  }
  return res
}

// Danh sách tour admin — phân trang + tìm kiếm + lọc isActive, kèm activeBookings mỗi tour
export async function getAdminTours({ page = 1, limit = 10, q = '', isActive = '' } = {}) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('limit', String(limit))
  if (q) params.set('search', q)
  if (isActive) params.set('isActive', isActive)

  const res = await request(`/admin/tours?${params.toString()}`, { auth: true })
  if (res.success === false) return res

  return {
    success: true,
    data: res.tours,
    pagination: { page: res.page, limit, total: res.total, totalPages: res.totalPages },
  }
}

// Chi tiết tour cho form sửa — kèm số đơn active theo từng đợt
export async function getAdminTour(id) {
  const res = await request(`/admin/tours/${id}`, { auth: true })
  if (res.success === false) return res

  return {
    success: true,
    data: res.tour,
    bookingsByDeparture: res.bookingsByDeparture || {},
    activeBookings: res.activeBookings || 0,
  }
}

// Tạo tour mới. departures: [{ date, price, totalSlots }]
export async function createAdminTour(payload) {
  const res = await request('/admin/tours', { method: 'POST', body: payload, auth: true })
  if (res.success === false) return chuanHoaLoi(res)
  return { success: true, data: res.tour, message: res.message }
}

// Cập nhật tour. QUAN TRỌNG: đợt đã tồn tại PHẢI mang theo _id trong departures —
// vắng mặt _id nghĩa là yêu cầu XÓA đợt đó (BE sẽ 409 nếu đợt còn đơn active).
export async function updateAdminTour(id, payload) {
  const res = await request(`/admin/tours/${id}`, { method: 'PUT', body: payload, auth: true })
  if (res.success === false) return chuanHoaLoi(res)
  return { success: true, data: res.tour, message: res.message }
}

// Ẩn tour (soft delete) — BE 409 TOUR_HAS_BOOKINGS nếu còn đơn active
export async function deleteAdminTour(id) {
  const res = await request(`/admin/tours/${id}`, { method: 'DELETE', auth: true })
  if (res.success === false) return chuanHoaLoi(res)
  return { success: true, message: res.message }
}

// Hiện lại tour đã ẩn
export async function restoreAdminTour(id) {
  const res = await request(`/admin/tours/${id}`, { method: 'PUT', body: { isActive: true }, auth: true })
  if (res.success === false) return chuanHoaLoi(res)
  return { success: true, data: res.tour, message: 'Đã hiện lại tour trên trang khách.' }
}

// Upload 1 ảnh — trả URL tuyệt đối để gắn vào images[].
// FormData: KHÔNG set Content-Type (request() đã xử lý, browser tự gắn boundary).
export async function uploadTourImage(file) {
  const form = new FormData()
  form.append('image', file)
  const res = await request('/tours/upload', { method: 'POST', body: form, auth: true })
  if (res.success === false) return res
  return { success: true, url: res.url }
}
