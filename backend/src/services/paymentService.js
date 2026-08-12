import crypto from 'crypto'
import mongoose from 'mongoose'
import Booking from '../models/Booking.js'
import Tour from '../models/Tour.js'
import PaymentAttempt from '../models/PaymentAttempt.js'
import { createVnpayUrl, createMomoPayment, createMomoDemoUrl, isMomoDemoMode } from './paymentProviders.js'
import { expireBooking } from './bookingExpiryService.js'
import { createNotification } from './notificationService.js'
import { ensureTicketForBooking } from './ticketService.js'
import { releaseVoucherForBooking, useVoucherForBooking } from './voucherService.js'

function paymentError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function createOrderId(provider) {
  return `${provider === 'vnpay' ? 'VNP' : 'MOMO'}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`
}

export async function initiatePayment({ bookingId, userId, provider, ipAddress }) {
  if (!mongoose.isValidObjectId(bookingId)) throw paymentError('Mã đơn không hợp lệ.', 400, 'VALIDATION_ERROR')
  if (!['vnpay', 'momo'].includes(provider)) throw paymentError('Cổng thanh toán không hợp lệ.', 400, 'VALIDATION_ERROR')

  let booking = await Booking.findOne({ _id: bookingId, user: userId })
  if (!booking) throw paymentError('Không tìm thấy đơn đặt.', 404, 'NOT_FOUND')
  if (booking.status !== 'pending_payment') throw paymentError('Đơn không còn ở trạng thái chờ thanh toán.', 409, 'BOOKING_NOT_PAYABLE')
  if (!booking.paymentExpiresAt) {
    booking.paymentExpiresAt = new Date(Date.now() + (Number(process.env.BOOKING_HOLD_MINUTES) || 30) * 60_000)
    await booking.save()
  }
  if (booking.paymentExpiresAt <= new Date()) {
    await expireBooking(booking._id)
    throw paymentError('Đơn đã hết thời hạn giữ chỗ. Vui lòng đặt lại tour.', 410, 'BOOKING_EXPIRED')
  }

  let active = await PaymentAttempt.findOne({ booking: booking._id, active: true }).select('+qrCodeData')
  if (active) {
    if (active.provider !== provider) throw paymentError('Đơn đang có một giao dịch khác chưa kết thúc.', 409, 'PAYMENT_ATTEMPT_ACTIVE')
    if (booking.paymentMethod !== provider) {
      await Booking.updateOne({ _id: booking._id, status: 'pending_payment' }, { $set: { paymentMethod: provider } })
    }
    if (active.payUrl) return { attempt: active, reused: true }
    if (active.updatedAt > new Date(Date.now() - 60_000)) throw paymentError('Giao dịch đang được khởi tạo. Vui lòng thử lại sau ít giây.', 409, 'PAYMENT_INITIALIZING')
    await PaymentAttempt.updateOne(
      { _id: active._id, active: true },
      { $set: { active: false, status: 'failed', responseCode: 'CREATE_TIMEOUT', processedAt: new Date() } }
    )
  }

  const orderId = createOrderId(provider)
  const requestId = provider === 'momo' ? `${orderId}-REQ` : ''
  try {
    active = await PaymentAttempt.create({
      booking: booking._id,
      user: userId,
      provider,
      orderId,
      requestId,
      amount: booking.totalPrice,
      expiresAt: booking.paymentExpiresAt,
      status: 'creating',
      active: true,
    })
    if (booking.paymentMethod !== provider) {
      const changed = await Booking.updateOne(
        { _id: booking._id, user: userId, status: 'pending_payment' },
        { $set: { paymentMethod: provider } }
      )
      if (changed.matchedCount !== 1) {
        await PaymentAttempt.updateOne(
          { _id: active._id },
          { $set: { active: false, status: 'expired', responseCode: 'BOOKING_NOT_PAYABLE', processedAt: new Date() } }
        )
        throw paymentError('Đơn không còn ở trạng thái chờ thanh toán.', 409, 'BOOKING_NOT_PAYABLE')
      }
      booking.paymentMethod = provider
    }
  } catch (error) {
    if (error.code === 11000) {
      const existing = await PaymentAttempt.findOne({ booking: booking._id, active: true }).select('+qrCodeData')
      if (existing?.payUrl) return { attempt: existing, reused: true }
      throw paymentError('Một giao dịch khác đang được khởi tạo.', 409, 'PAYMENT_INITIALIZING')
    }
    throw error
  }

  try {
    const orderInfo = `Thanh toan don tour ${booking.bookingCode}`
    const result = provider === 'vnpay'
      ? { payUrl: createVnpayUrl({ orderId, amount: booking.totalPrice, orderInfo, ipAddress, expiresAt: booking.paymentExpiresAt }) }
      : isMomoDemoMode()
          ? { payUrl: createMomoDemoUrl({ orderId }) }
          : await createMomoPayment({ orderId, requestId, amount: booking.totalPrice, orderInfo })

    active = await PaymentAttempt.findByIdAndUpdate(
      active._id,
      {
        $set: {
          payUrl: result.payUrl,
          qrCodeData: result.qrCodeData || '',
          deeplink: result.deeplink || '',
          deeplinkMiniApp: result.deeplinkMiniApp || '',
          status: 'initiated',
        },
      },
      { new: true }
    ).select('+qrCodeData')
    return { attempt: active, reused: false }
  } catch (error) {
    await PaymentAttempt.updateOne(
      { _id: active._id },
      { $set: { active: false, status: 'failed', responseCode: error.code || 'CREATE_FAILED', processedAt: new Date() } }
    )
    throw error
  }
}

export async function processPaymentResult({ provider, result }) {
  if (!result.valid) return { accepted: false, code: 'INVALID_SIGNATURE' }

  let outcome = { accepted: false, code: 'ORDER_NOT_FOUND' }
  await mongoose.connection.transaction(async (session) => {
    const attempt = await PaymentAttempt.findOne({ provider, orderId: result.orderId }).session(session)
    if (!attempt) return
    if (attempt.amount !== result.amount) {
      outcome = { accepted: false, code: 'INVALID_AMOUNT', bookingId: attempt.booking }
      return
    }
    if (attempt.status === 'paid') {
      const paidBooking = await Booking.findById(attempt.booking).select('_id bookingCode').session(session)
      outcome = {
        accepted: true,
        code: 'ALREADY_PAID',
        bookingId: attempt.booking,
        bookingCode: paidBooking?.bookingCode,
      }
      return
    }

    const booking = await Booking.findById(attempt.booking).session(session)
    if (!booking) return

    if (!result.success) {
      await PaymentAttempt.updateOne(
        { _id: attempt._id },
        { $set: { active: false, status: 'failed', responseCode: result.responseCode, processedAt: new Date() } },
        { session }
      )
      await createNotification({
        user: booking.user,
        type: 'payment',
        title: 'Thanh toán chưa thành công',
        message: `Giao dịch cho đơn ${booking.bookingCode} chưa hoàn tất. Bạn có thể thử lại khi còn thời gian giữ chỗ.`,
        link: `/payment?bookingId=${booking._id}`,
        uniqueKey: `payment-failed:${attempt.orderId}`,
      }, session)
      outcome = { accepted: true, code: 'PAYMENT_FAILED', bookingId: booking._id, bookingCode: booking.bookingCode }
      return
    }

    const now = new Date()
    if (booking.status === 'pending_payment' && booking.paymentExpiresAt > now) {
      booking.status = 'paid'
      booking.paidAt = now
      booking.txnRef = result.txnId || result.orderId
      booking.statusHistory.push({
        from: 'pending_payment', to: 'paid', byUserId: null,
        source: 'payment', reason: `${provider} xác nhận giao dịch`, at: now,
      })
      await booking.save({ session })
      await PaymentAttempt.updateOne(
        { _id: attempt._id },
        { $set: { active: false, status: 'paid', providerTxnId: result.txnId, responseCode: result.responseCode, processedAt: now } },
        { session }
      )
      // Có thể một attempt cũ từng báo thất bại rồi thanh toán thành công muộn,
      // trong khi khách đã tạo attempt retry. Đóng attempt retry để backend không
      // coi nó là giao dịch còn hoạt động; callback nếu vẫn thu tiền sẽ vào review.
      await PaymentAttempt.updateMany(
        { booking: booking._id, _id: { $ne: attempt._id }, active: true },
        { $set: { active: false, status: 'expired', responseCode: 'BOOKING_PAID_OTHER_ATTEMPT', processedAt: now } },
        { session }
      )
      await createNotification({
        user: booking.user,
        type: 'payment',
        title: 'Thanh toán thành công',
        message: `Đơn ${booking.bookingCode} đã được thanh toán thành công qua ${{ vnpay: 'VNPay', momo: 'MoMo' }[provider] || provider}.`,
        link: `/bookings/${booking._id}`,
        uniqueKey: `payment-paid:${booking._id}`,
      }, session)
      await ensureTicketForBooking(booking, session)
      await useVoucherForBooking(booking._id, session)
      outcome = { accepted: true, code: 'PAID', bookingId: booking._id, bookingCode: booking.bookingCode }
      return
    }

    // Tiền về sau khi đơn hết hạn/hủy hoặc một attempt khác đã thanh toán: không
    // tự tái chiếm chỗ. Ghi nhận để admin đối soát và hoàn tiền thủ công.
    if (booking.status === 'pending_payment' && booking.paymentExpiresAt <= now) {
      booking.status = 'cancelled'
      booking.statusHistory.push({ from: 'pending_payment', to: 'cancelled', byUserId: null, source: 'system', reason: 'Thanh toán về sau thời hạn giữ chỗ', at: now })
      await booking.save({ session })
      await releaseVoucherForBooking(booking._id, session)
      if (booking.departureId) {
        const restored = await Tour.updateOne(
          { _id: booking.tour, 'departures._id': booking.departureId },
          { $inc: { 'departures.$.availableSlots': booking.guests } },
          { session }
        )
        if (restored.modifiedCount !== 1) throw new Error(`Không hoàn được chỗ cho ${booking.bookingCode}`)
      }
    }

    await PaymentAttempt.updateOne(
      { _id: attempt._id },
      { $set: { active: false, status: 'review_required', providerTxnId: result.txnId, responseCode: result.responseCode, processedAt: now } },
      { session }
    )
    await createNotification({
      user: booking.user,
      type: 'payment',
      title: 'Giao dịch cần được đối soát',
      message: `Giao dịch cho đơn ${booking.bookingCode} đã về sau khi đơn không còn hiệu lực. Vui lòng liên hệ hỗ trợ.`,
      link: `/bookings/${booking._id}`,
      uniqueKey: `payment-review:${attempt.orderId}`,
    }, session)
    outcome = { accepted: true, code: 'REVIEW_REQUIRED', bookingId: booking._id, bookingCode: booking.bookingCode }
  })
  return outcome
}
