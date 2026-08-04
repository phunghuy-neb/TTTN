// Tầng service admin — gọi API `/api/admin/*` (chỉ role admin) qua services/api.js.
// Chuẩn hóa response Backend về khuôn { success, data } / { success: false, message } như các service khác.
import { request } from './api.js'

// Số liệu tổng quan cho Dashboard: { totalTours, totalBookings, totalUsers, revenue }
export async function getStats() {
  const res = await request('/admin/stats', { auth: true })
  if (res.success === false) return res

  return { success: true, data: res.stats }
}
