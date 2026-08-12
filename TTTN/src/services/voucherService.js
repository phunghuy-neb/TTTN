import { request } from './api.js'

export const validateVoucher = (payload) => request('/vouchers/validate', {
  method: 'POST', body: payload, auth: true,
})

export const getAdminVouchers = ({ page = 1, q = '' } = {}) => {
  const params = new URLSearchParams({ page: String(page) })
  if (q) params.set('q', q)
  return request(`/admin/vouchers?${params}`, { auth: true })
}
export const createAdminVoucher = (body) => request('/admin/vouchers', { method: 'POST', body, auth: true })
export const updateAdminVoucher = (id, body) => request(`/admin/vouchers/${id}`, { method: 'PUT', body, auth: true })
export const toggleAdminVoucher = (id, isActive) => request(`/admin/vouchers/${id}/active`, { method: 'PATCH', body: { isActive }, auth: true })
