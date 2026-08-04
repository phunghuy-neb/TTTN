// Tầng service quản lý đơn cho admin — gọi `/api/admin/bookings` (Batch 4).
import { request } from './api.js'

const THONG_BAO_LOI = {
  INVALID_STATUS_TRANSITION:
    'Không thể chuyển trạng thái này — đơn đã ở bước khác hoặc đã kết thúc. Tải lại trang để xem trạng thái mới nhất.',
}

function chuanHoaLoi(res) {
  if (res.success === false && THONG_BAO_LOI[res.code]) {
    return { ...res, message: res.message || THONG_BAO_LOI[res.code] }
  }
  return res
}

// Danh sách đơn — lọc status/tour/khoảng ngày đặt/tìm kiếm (mã đơn, tên, email, SĐT)
export async function getAdminBookings({
  page = 1,
  limit = 10,
  status = '',
  tourId = '',
  dateFrom = '',
  dateTo = '',
  q = '',
} = {}) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('limit', String(limit))
  if (status) params.set('status', status)
  if (tourId) params.set('tourId', tourId)
  if (dateFrom) params.set('dateFrom', dateFrom)
  if (dateTo) params.set('dateTo', dateTo)
  if (q) params.set('search', q)

  const res = await request(`/admin/bookings?${params.toString()}`, { auth: true })
  if (res.success === false) return res

  return {
    success: true,
    data: res.bookings,
    pagination: { page: res.page, limit, total: res.total, totalPages: res.totalPages },
  }
}

// Chi tiết đầy đủ 1 đơn (kèm statusHistory)
export async function getAdminBooking(id) {
  const res = await request(`/admin/bookings/${id}`, { auth: true })
  if (res.success === false) return res
  return { success: true, data: res.booking }
}

// Đổi trạng thái theo máy trạng thái BE — sai luồng nhận 409 INVALID_STATUS_TRANSITION
export async function updateBookingStatus(id, status) {
  const res = await request(`/admin/bookings/${id}/status`, {
    method: 'PATCH',
    body: { status },
    auth: true,
  })
  if (res.success === false) return chuanHoaLoi(res)
  return { success: true, data: res.booking, message: res.message }
}
