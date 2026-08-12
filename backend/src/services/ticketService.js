import mongoose from 'mongoose'
import Booking from '../models/Booking.js'
import Ticket from '../models/Ticket.js'
import { createNotification } from './notificationService.js'

export function ticketVerifyUrl(ticket) {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '')
  // Trang HTML do backend render trực tiếp: hoạt động cả trong trình duyệt tích
  // hợp của ứng dụng quét QR (nơi JavaScript/SPA đôi khi bị chặn).
  return `${base}/api/tickets/verify-page/${ticket.verificationToken}`
}

export async function ensureTicketForBooking(bookingOrId, session = null) {
  const booking = typeof bookingOrId === 'object' && bookingOrId?._id
    ? bookingOrId
    : await Booking.findById(bookingOrId).session(session)
  if (!booking || !['paid', 'completed'].includes(booking.status)) return null

  const existing = await Ticket.findOne({ booking: booking._id }).session(session)
  if (existing) return existing

  const [ticket] = await Ticket.create([{
    booking: booking._id,
    user: booking.user?._id || booking.user,
    tour: booking.tour?._id || booking.tour,
  }], { session })

  await createNotification({
    user: booking.user?._id || booking.user,
    type: 'trip',
    title: 'Vé điện tử đã sẵn sàng',
    message: `Vé ${ticket.ticketCode} cho đơn ${booking.bookingCode} đã được phát hành.`,
    link: `/tickets/${booking._id}`,
    uniqueKey: `ticket-issued:${booking._id}`,
  }, session)
  return ticket
}

export async function backfillTickets({ limit = 500 } = {}) {
  if (mongoose.connection.readyState !== 1) return 0
  const existingBookingIds = await Ticket.distinct('booking')
  const bookings = await Booking.find({
    status: { $in: ['paid', 'completed'] },
    _id: { $nin: existingBookingIds },
  }).limit(limit)
  let count = 0
  for (const booking of bookings) {
    try {
      await mongoose.connection.transaction((session) => ensureTicketForBooking(booking, session))
      count += 1
    } catch (error) {
      if (error.code !== 11000) throw error
    }
  }
  return count
}
