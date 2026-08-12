import mongoose from 'mongoose'
import Booking from '../models/Booking.js'
import Tour from '../models/Tour.js'
import PaymentAttempt from '../models/PaymentAttempt.js'
import { cleanupOldNotifications, createNotification } from './notificationService.js'
import { releaseVoucherForBooking } from './voucherService.js'

// Hết hạn một đơn theo transaction: đổi trạng thái, hoàn chỗ và đóng attempt
// cùng commit hoặc cùng rollback. Hàm idempotent; chỉ pending_payment mới khớp.
export async function expireBooking(bookingId, now = new Date()) {
  let expired = false
  await mongoose.connection.transaction(async (session) => {
    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, status: 'pending_payment', paymentExpiresAt: { $lte: now } },
      {
        $set: { status: 'cancelled' },
        $push: {
          statusHistory: {
            from: 'pending_payment',
            to: 'cancelled',
            byUserId: null,
            source: 'system',
            reason: 'Hết thời hạn giữ chỗ',
            at: now,
          },
        },
      },
      { new: true, session }
    )
    if (!booking) return

    if (booking.departureId) {
      const slotResult = await Tour.updateOne(
        { _id: booking.tour, 'departures._id': booking.departureId },
        { $inc: { 'departures.$.availableSlots': booking.guests } },
        { session }
      )
      if (slotResult.modifiedCount !== 1) {
        throw new Error(`Không thể hoàn chỗ cho booking hết hạn ${booking.bookingCode}`)
      }
    }

    await releaseVoucherForBooking(booking._id, session)

    await PaymentAttempt.updateMany(
      { booking: booking._id, active: true },
      { $set: { active: false, status: 'expired', responseCode: 'HOLD_EXPIRED', processedAt: now } },
      { session }
    )
    await createNotification({
      user: booking.user,
      type: 'booking',
      title: 'Đơn đã hết thời gian giữ chỗ',
      message: `Đơn ${booking.bookingCode} đã tự động hủy vì chưa hoàn tất thanh toán đúng hạn.`,
      link: `/bookings/${booking._id}`,
      uniqueKey: `booking-expired:${booking._id}`,
    }, session)
    expired = true
  })
  return expired
}

export async function expirePendingBookings({ limit = 100 } = {}) {
  const now = new Date()
  const rows = await Booking.find({ status: 'pending_payment', paymentExpiresAt: { $lte: now } })
    .sort({ paymentExpiresAt: 1 })
    .limit(limit)
    .select('_id')
    .lean()
  const ids = rows.map((row) => row._id)

  let count = 0
  for (const id of ids) {
    if (await expireBooking(id, now)) count += 1
  }
  return count
}

export async function sendPaymentExpiryWarnings({ limit = 100 } = {}) {
  const now = new Date()
  const warningMinutes = Math.max(1, Number(process.env.PAYMENT_EXPIRY_WARNING_MINUTES) || 10)
  const warningUntil = new Date(now.getTime() + warningMinutes * 60_000)
  const bookings = await Booking.find({
    status: 'pending_payment',
    paymentExpiresAt: { $gt: now, $lte: warningUntil },
  })
    .sort({ paymentExpiresAt: 1 })
    .limit(limit)
    .select('_id user bookingCode paymentExpiresAt')
    .lean()

  for (const booking of bookings) {
    await createNotification({
      user: booking.user,
      type: 'payment',
      title: 'Đơn sắp hết thời gian giữ chỗ',
      message: `Đơn ${booking.bookingCode} sắp hết hạn thanh toán. Hoàn tất giao dịch để không mất chỗ.`,
      link: `/payment?bookingId=${booking._id}`,
      uniqueKey: `booking-expiry-warning:${booking._id}`,
    })
  }
  return bookings.length
}

export async function sendTripReminders({ limit = 100 } = {}) {
  const now = new Date()
  const reminderDays = Math.max(1, Number(process.env.TRIP_REMINDER_DAYS) || 3)
  const reminderUntil = new Date(now.getTime() + reminderDays * 24 * 60 * 60_000)
  const bookings = await Booking.find({
    status: 'paid',
    departureDate: { $gt: now, $lte: reminderUntil },
  })
    .sort({ departureDate: 1 })
    .limit(limit)
    .select('_id user bookingCode tourName departureDate')
    .lean()

  for (const booking of bookings) {
    const departure = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(booking.departureDate)
    await createNotification({
      user: booking.user,
      type: 'trip',
      title: 'Tour sắp khởi hành',
      message: `${booking.tourName} của đơn ${booking.bookingCode} sẽ khởi hành ngày ${departure}.`,
      link: `/bookings/${booking._id}`,
      uniqueKey: `trip-reminder:${booking._id}`,
    })
  }
  return bookings.length
}

// Booking từ phiên bản cũ chưa có paymentExpiresAt: gán hạn một lần
// để không giữ chỗ vô thời hạn sau khi nâng cấp.
async function backfillLegacyExpiry(now = new Date()) {
  const onlineMinutes = Math.max(5, Number(process.env.BOOKING_HOLD_MINUTES) || 30)
  const laterMinutes = Math.max(30, Number(process.env.LATER_HOLD_MINUTES) || 1440)
  const [online, later] = await Promise.all([
    Booking.updateMany(
      {
        status: 'pending_payment',
        paymentExpiresAt: null,
        paymentMethod: { $in: ['vnpay', 'momo'] },
      },
      { $set: { paymentExpiresAt: new Date(now.getTime() + onlineMinutes * 60_000) } }
    ),
    Booking.updateMany(
      {
        status: 'pending_payment',
        paymentExpiresAt: null,
        paymentMethod: { $nin: ['vnpay', 'momo'] },
      },
      { $set: { paymentExpiresAt: new Date(now.getTime() + laterMinutes * 60_000) } }
    ),
  ])
  return online.modifiedCount + later.modifiedCount
}

export function startBookingExpiryWorker() {
  const intervalMs = Math.max(15_000, Number(process.env.BOOKING_EXPIRY_INTERVAL_MS) || 60_000)
  let running = false

  const run = async () => {
    if (running || mongoose.connection.readyState !== 1) return
    running = true
    try {
      const backfilled = await backfillLegacyExpiry()
      const warnings = await sendPaymentExpiryWarnings()
      const reminders = await sendTripReminders()
      const count = await expirePendingBookings()
      const cleanedNotifications = await cleanupOldNotifications()
      if (backfilled > 0) console.log(`[booking-expiry] Đã gán hạn cho ${backfilled} đơn cũ.`)
      if (warnings > 0) console.log(`[booking-expiry] Đã kiểm tra ${warnings} cảnh báo sắp hết hạn.`)
      if (reminders > 0) console.log(`[booking-expiry] Đã kiểm tra ${reminders} nhắc lịch khởi hành.`)
      if (count > 0) console.log(`[booking-expiry] Đã hết hạn ${count} đơn và hoàn chỗ.`)
      if (cleanedNotifications > 0) console.log(`[notifications] Đã dọn ${cleanedNotifications} thông báo cũ.`)
    } catch (error) {
      console.error('[booking-expiry] Lỗi:', error.message)
    } finally {
      running = false
    }
  }

  const timer = setInterval(run, intervalMs)
  timer.unref()
  setTimeout(run, 1000).unref()
  return timer
}
