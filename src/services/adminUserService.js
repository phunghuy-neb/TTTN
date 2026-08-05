// Tầng service quản lý người dùng cho admin — gọi `/api/admin/users` (Batch 4).
import { request } from './api.js'

const THONG_BAO_LOI = {
  CANNOT_LOCK_SELF: 'Bạn không thể tự khóa tài khoản của chính mình.',
  CANNOT_DEMOTE_SELF: 'Bạn không thể tự hạ quyền admin của chính mình.',
}

function chuanHoaLoi(res) {
  if (res.success === false && THONG_BAO_LOI[res.code]) {
    return { ...res, message: res.message || THONG_BAO_LOI[res.code] }
  }
  return res
}

// Danh sách user — phân trang, search tên/email, lọc role, kèm số đơn mỗi user
export async function getAdminUsers({ page = 1, limit = 10, q = '', role = '' } = {}) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('limit', String(limit))
  if (q) params.set('search', q)
  if (role) params.set('role', role)

  const res = await request(`/admin/users?${params.toString()}`, { auth: true })
  if (res.success === false) return res

  return {
    success: true,
    data: res.users,
    pagination: { page: res.page, limit, total: res.total, totalPages: res.totalPages },
  }
}

// Khóa/mở khóa tài khoản — BE chặn tự khóa mình (409 CANNOT_LOCK_SELF)
export async function toggleLockUser(id) {
  const res = await request(`/admin/users/${id}/lock`, { method: 'PATCH', auth: true })
  if (res.success === false) return chuanHoaLoi(res)
  return { success: true, data: res.user, message: res.message }
}

// Đổi quyền customer ↔ admin — BE chặn tự hạ quyền (409 CANNOT_DEMOTE_SELF)
export async function changeUserRole(id, role) {
  const res = await request(`/admin/users/${id}/role`, { method: 'PATCH', body: { role }, auth: true })
  if (res.success === false) return chuanHoaLoi(res)
  return { success: true, data: res.user, message: res.message }
}
