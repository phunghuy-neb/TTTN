import { downloadFile, request } from './api.js'

export const getTicketByBooking = (bookingId) => request(`/tickets/booking/${bookingId}`, { auth: true })
export const verifyTicket = (token) => request(`/tickets/verify/${token}`)
export const downloadTicketPdf = (bookingId) => downloadFile(`/tickets/booking/${bookingId}/pdf`, 've-vietvoyage.pdf')
export const getAdminTickets = ({ page = 1, status = '', q = '' } = {}) => {
  const params = new URLSearchParams({ page: String(page) })
  if (status) params.set('status', status)
  if (q) params.set('q', q)
  return request(`/admin/tickets?${params}`, { auth: true })
}
export const updateTicketStatus = (id, status) => request(`/admin/tickets/${id}/status`, {
  method: 'PATCH', auth: true, body: { status },
})
