import { request } from './api.js'

export async function sendChatMessage({
  message,
  tourId = '',
  conversationId = '',
  pageContext = null,
  clientMessageId = '',
  requestId = '',
}) {
  return request('/chat', {
    method: 'POST',
    body: {
      message,
      ...(clientMessageId ? { clientMessageId } : {}),
      ...(requestId ? { requestId } : {}),
      ...(tourId ? { tourId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(pageContext ? { pageContext } : {}),
    },
    auth: true,
  })
}

export async function createConversation({ title = '' } = {}) {
  return request('/chat/conversations', {
    method: 'POST',
    body: title ? { title } : {},
    auth: true,
  })
}

export async function getConversations({ page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  return request(`/chat/conversations?${params.toString()}`, { auth: true })
}

export async function getConversationMessages(conversationId, { page = 1, limit = 100 } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  return request(`/chat/conversations/${conversationId}/messages?${params.toString()}`, { auth: true })
}

// Giu hop dong cu cho cac man hinh/nhanh code chua chuyen sang conversation.
export async function getChatHistory({ page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  const res = await request(`/chat/history?${params.toString()}`, { auth: true })
  if (res.success === false) return res
  return {
    success: true,
    data: res.messages,
    pagination: {
      page: res.page,
      limit: res.limit || limit,
      total: res.total,
      totalPages: res.totalPages,
      hasMore: res.hasMore,
    },
  }
}

export async function clearChatHistory(conversationId = '') {
  return request('/chat/history', {
    method: 'DELETE',
    body: conversationId ? { conversationId } : {},
    auth: true,
  })
}
