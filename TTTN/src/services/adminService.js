// Tầng service admin — gọi API `/api/admin/*` (chỉ role admin) qua services/api.js.
// Chuẩn hóa response Backend về khuôn { success, data } / { success: false, message } như các service khác.
import { request } from './api.js'

// Số liệu tổng quan cho Dashboard — xem shape đầy đủ trong src/api/contract.md
export async function getStats() {
  const res = await request('/admin/stats', { auth: true })
  if (res.success === false) return res

  return { success: true, data: res.stats }
}

// Cài đặt AI: trạng thái service (đã ping), chatEnabled, thống kê chat
export async function getAiSettings() {
  const res = await request('/admin/ai-settings', { auth: true })
  if (res.success === false) return res
  return { success: true, data: res }
}

// Bật/tắt chat widget toàn site
export async function patchAiSettings({ chatEnabled }) {
  const res = await request('/admin/ai-settings', { method: 'PATCH', body: { chatEnabled }, auth: true })
  if (res.success === false) return res
  return { success: true, message: res.message, chatEnabled: res.chatEnabled }
}
