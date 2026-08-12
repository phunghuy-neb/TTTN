import { request } from './api.js'

export async function getNotifications({ page = 1, limit = 10, unreadOnly = false } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (unreadOnly) params.set('unreadOnly', 'true')
  const res = await request(`/notifications?${params.toString()}`, { auth: true })
  if (res.success === false) return res
  return {
    success: true,
    data: res.notifications || [],
    unreadCount: res.unreadCount || 0,
    pagination: { page: res.page, limit, total: res.total, totalPages: res.totalPages },
  }
}

export async function markNotificationRead(id) {
  return request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', auth: true })
}

export async function markAllNotificationsRead() {
  return request('/notifications/read-all', { method: 'PATCH', auth: true })
}
