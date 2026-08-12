import { request } from './api.js'

export function getAdminPayments(filters = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== undefined && value !== false) params.set(key, String(value))
  return request(`/admin/payments?${params}`, { auth: true })
}
export const getAdminPayment = (id) => request(`/admin/payments/${id}`, { auth: true })
export const resolveAdminPayment = (id, body) => request(`/admin/payments/${id}/reconciliation`, { method: 'PATCH', body, auth: true })
