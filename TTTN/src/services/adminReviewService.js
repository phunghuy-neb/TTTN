import { request } from './api.js'

export async function getAdminReviews({ page = 1, limit = 12, q = '', rating = '', visibility = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (q) params.set('q', q)
  if (rating) params.set('rating', rating)
  if (visibility) params.set('visibility', visibility)
  const res = await request(`/admin/reviews?${params.toString()}`, { auth: true })
  if (res.success === false) return res
  return {
    success: true,
    data: res.reviews || [],
    pagination: { page: res.page, limit, total: res.total, totalPages: res.totalPages },
  }
}

export async function updateReviewVisibility(tourId, reviewId, isVisible) {
  return request(`/admin/reviews/${encodeURIComponent(tourId)}/${encodeURIComponent(reviewId)}/visibility`, {
    method: 'PATCH',
    body: { isVisible },
    auth: true,
  })
}
