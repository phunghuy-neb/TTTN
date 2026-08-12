import { request } from './api.js'

export async function getFavoriteIds() {
  const res = await request('/favorites/ids', { auth: true })
  if (res.success === false) return res
  return { success: true, data: res.ids || [] }
}

export async function getFavoriteTours({ page = 1, limit = 12 } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  const res = await request(`/favorites?${params.toString()}`, { auth: true })
  if (res.success === false) return res
  return {
    success: true,
    data: res.tours || [],
    pagination: { page: res.page, limit, total: res.total, totalPages: res.totalPages },
  }
}

export async function getFavoriteSuggestions(limit = 4) {
  const res = await request(`/favorites/suggestions?limit=${encodeURIComponent(limit)}`, { auth: true })
  if (res.success === false) return res
  return { success: true, data: res.tours || [] }
}

export async function addFavorite(tourId) {
  return request(`/favorites/${encodeURIComponent(tourId)}`, { method: 'POST', auth: true })
}

export async function removeFavorite(tourId) {
  return request(`/favorites/${encodeURIComponent(tourId)}`, { method: 'DELETE', auth: true })
}
