// Tầng service chat với trợ lý AI (UC-07) — gọi `/api/chat` qua services/api.js.
// BE đang chạy stub nội bộ; nối AI thật chỉ cần BE set AI_SERVICE_URL (shape không đổi).
import { request } from './api.js'

// Gửi 1 câu hỏi. tourId (id hoặc slug) gửi kèm khi đang ở trang chi tiết tour.
// Trả về { success, reply, suggestedTours: [{ _id, title, price, image }] }
// Lỗi 503 AI_UNAVAILABLE → { success: false, code: 'AI_UNAVAILABLE', message lịch sự }.
export async function sendChatMessage({ message, tourId = '' }) {
  return request('/chat', { method: 'POST', body: { message, ...(tourId ? { tourId } : {}) }, auth: true })
}

// Lịch sử hội thoại — BE trả MỚI → CŨ, component tự đảo khi hiển thị
export async function getChatHistory({ page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  const res = await request(`/chat/history?${params.toString()}`, { auth: true })
  if (res.success === false) return res
  return {
    success: true,
    data: res.messages,
    pagination: { page: res.page, limit, total: res.total, totalPages: res.totalPages },
  }
}

// Xóa toàn bộ hội thoại của mình
export async function clearChatHistory() {
  return request('/chat/history', { method: 'DELETE', auth: true })
}
