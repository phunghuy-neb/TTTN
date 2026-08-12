import mongoose from 'mongoose'
import PaymentAttempt from '../models/PaymentAttempt.js'
import Booking from '../models/Booking.js'
import { createNotification } from '../services/notificationService.js'
import { ensureTicketForBooking } from '../services/ticketService.js'
import { useVoucherForBooking } from '../services/voucherService.js'
import { getPaymentProviderConfig } from '../services/paymentProviders.js'

function escapeRegex(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export async function listPayments(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15))
    const filter = {}
    const clauses = []
    if (req.query.provider && ['vnpay', 'momo'].includes(req.query.provider)) filter.provider = req.query.provider
    if (req.query.status && ['creating', 'initiated', 'paid', 'failed', 'expired', 'review_required'].includes(req.query.status)) filter.status = req.query.status
    if (req.query.reconciliation && ['pending', 'confirmed', 'refunded', 'ignored'].includes(req.query.reconciliation)) {
      if (req.query.reconciliation === 'pending') clauses.push({ $or: [{ 'reconciliation.status': 'pending' }, { reconciliation: { $exists: false } }] })
      else filter['reconciliation.status'] = req.query.reconciliation
    }
    if (req.query.needsReview === 'true') {
      filter.status = 'review_required'
      clauses.push({ $or: [{ 'reconciliation.status': 'pending' }, { reconciliation: { $exists: false } }] })
    }
    const q = String(req.query.q || '').trim()
    if (q) clauses.push({ $or: [{ orderId: new RegExp(escapeRegex(q), 'i') }, { providerTxnId: new RegExp(escapeRegex(q), 'i') }] })
    if (clauses.length) filter.$and = clauses
    const [payments, total] = await Promise.all([
      PaymentAttempt.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit)
        .populate('booking', 'bookingCode tourName status totalPrice contact')
        .populate('user', 'name email phone').populate('reconciliation.resolvedBy', 'name email').lean(),
      PaymentAttempt.countDocuments(filter),
    ])
    res.json({ success: true, payments, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) })
  } catch (error) {
    console.error('[listPayments]', error)
    res.status(500).json({ success: false, message: 'Không tải được danh sách giao dịch.' })
  }
}

export async function getPayment(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Mã giao dịch không hợp lệ.' })
    const payment = await PaymentAttempt.findById(req.params.id)
      .populate('booking').populate('user', 'name email phone').populate('reconciliation.resolvedBy', 'name email').lean()
    if (!payment) return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch.' })
    res.json({ success: true, payment })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Không tải được giao dịch.' })
  }
}

export async function confirmSandboxPayment(req, res) {
  try {
    const transactionRef = String(req.body?.transactionRef || '').trim().toUpperCase()
    const note = String(req.body?.note || '').trim()
    if (
      !mongoose.isValidObjectId(req.params.id)
      || !/^[A-Z0-9._-]{4,100}$/.test(transactionRef)
      || note.length > 1000
    ) {
      return res.status(400).json({
        success: false,
        message: 'Mã xác nhận phải có 4–100 ký tự gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới.',
        code: 'VALIDATION_ERROR',
      })
    }

    let bookingId
    await mongoose.connection.transaction(async (session) => {
      const payment = await PaymentAttempt.findOne({
        _id: req.params.id,
        provider: 'momo',
        status: 'initiated',
        active: true,
      }).session(session)
      if (!payment) {
        throw Object.assign(new Error('Chỉ giao dịch MoMo đang chờ mới được admin xác nhận mô phỏng.'), { code: 'PAYMENT_NOT_PENDING' })
      }

      const providerConfig = getPaymentProviderConfig()[payment.provider]
      if (!providerConfig?.enabled || !providerConfig.testMode || providerConfig.mode !== 'sandbox') {
        throw Object.assign(new Error('Chỉ được xác nhận thủ công giao dịch MoMo Sandbox.'), { code: 'SANDBOX_ONLY' })
      }
      if (!payment.sandboxConfirmationRequestedAt) {
        throw Object.assign(new Error('Khách chưa xác nhận đã chọn xong QR, ngân hàng hoặc thẻ trên cổng thanh toán.'), { code: 'CUSTOMER_NOT_READY' })
      }

      const booking = await Booking.findById(payment.booking).session(session)
      if (!booking || booking.status !== 'pending_payment') {
        throw Object.assign(new Error('Booking không còn ở trạng thái chờ thanh toán.'), { code: 'BOOKING_NOT_PAYABLE' })
      }
      const now = new Date()
      if (!booking.paymentExpiresAt || booking.paymentExpiresAt <= now || payment.expiresAt <= now) {
        throw Object.assign(new Error('Booking đã hết thời gian giữ chỗ; không thể xác nhận thanh toán.'), { code: 'BOOKING_EXPIRED' })
      }
      if (Number(payment.amount) !== Number(booking.totalPrice)) {
        throw Object.assign(new Error('Số tiền giao dịch không khớp tổng tiền booking.'), { code: 'INVALID_AMOUNT' })
      }

      booking.status = 'paid'
      booking.paidAt = now
      booking.txnRef = transactionRef
      booking.statusHistory.push({
        from: 'pending_payment',
        to: 'paid',
        byUserId: req.user._id,
        source: 'admin',
        reason: `Admin xác nhận mô phỏng ${payment.provider.toUpperCase()} Sandbox${note ? `: ${note}` : ''}`,
        at: now,
      })
      await booking.save({ session })

      const updated = await PaymentAttempt.updateOne(
        { _id: payment._id, status: 'initiated', active: true },
        {
          $set: {
            active: false,
            status: 'paid',
            providerTxnId: transactionRef,
            responseCode: 'ADMIN_SANDBOX_CONFIRMED',
            processedAt: now,
            reconciliation: {
              status: 'confirmed',
              note: note || 'Admin xác nhận mô phỏng do không có ứng dụng UAT để quét QR.',
              resolvedAt: now,
              resolvedBy: req.user._id,
            },
          },
        },
        { session }
      )
      if (updated.modifiedCount !== 1) {
        throw Object.assign(new Error('Giao dịch vừa được xử lý bởi một yêu cầu khác.'), { code: 'PAYMENT_ALREADY_PROCESSED' })
      }

      await createNotification({
        user: booking.user,
        type: 'payment',
        title: 'Thanh toán MoMo Sandbox đã được xác nhận',
        message: `Admin đã xác nhận mô phỏng giao dịch MoMo cho đơn ${booking.bookingCode}.`,
        link: `/bookings/${booking._id}`,
        uniqueKey: `payment-admin-sandbox:${payment._id}`,
      }, session)
      await ensureTicketForBooking(booking, session)
      await useVoucherForBooking(booking._id, session)
      bookingId = booking._id
    })

    const payment = await PaymentAttempt.findById(req.params.id)
      .populate('booking').populate('user', 'name email phone').populate('reconciliation.resolvedBy', 'name email').lean()
    res.json({
      success: true,
      message: 'Đã xác nhận thanh toán MoMo Sandbox, cập nhật booking và phát hành vé điện tử.',
      payment,
      bookingId,
    })
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Mã xác nhận này đã được dùng cho giao dịch khác.', code: 'TRANSACTION_REF_EXISTS' })
    }
    const conflicts = ['PAYMENT_NOT_PENDING', 'SANDBOX_ONLY', 'CUSTOMER_NOT_READY', 'BOOKING_NOT_PAYABLE', 'BOOKING_EXPIRED', 'INVALID_AMOUNT', 'PAYMENT_ALREADY_PROCESSED']
    if (conflicts.includes(error.code)) {
      return res.status(error.code === 'BOOKING_EXPIRED' ? 410 : 409).json({ success: false, message: error.message, code: error.code })
    }
    console.error('[confirmSandboxPayment]', error)
    res.status(500).json({ success: false, message: 'Không xác nhận được giao dịch MoMo Sandbox.', code: 'SERVER_ERROR' })
  }
}

export async function resolvePayment(req, res) {
  try {
    const { status, note = '' } = req.body || {}
    if (!mongoose.isValidObjectId(req.params.id) || !['confirmed', 'refunded', 'ignored'].includes(status) || String(note).length > 1000) {
      return res.status(400).json({ success: false, message: 'Dữ liệu đối soát không hợp lệ.' })
    }
    let payment
    await mongoose.connection.transaction(async (session) => {
      payment = await PaymentAttempt.findOneAndUpdate(
        { _id: req.params.id, status: 'review_required', $or: [{ 'reconciliation.status': 'pending' }, { reconciliation: { $exists: false } }] },
        { $set: { reconciliation: { status, note: String(note).trim(), resolvedAt: new Date(), resolvedBy: req.user._id } } },
        { new: true, session }
      ).populate('booking', 'bookingCode tourName').populate('user', 'name email')
      if (!payment) throw Object.assign(new Error('Giao dịch không còn ở trạng thái chờ đối soát.'), { code: 'PAYMENT_ALREADY_RESOLVED' })
      const label = status === 'refunded' ? 'đã hoàn tiền' : status === 'confirmed' ? 'đã xác nhận' : 'đã đóng'
      await createNotification({
        user: payment.user._id,
        type: 'payment',
        title: 'Đã xử lý giao dịch đối soát',
        message: `Giao dịch ${payment.orderId} cho đơn ${payment.booking?.bookingCode || ''} ${label}.`,
        link: payment.booking ? `/bookings/${payment.booking._id}` : '/bookings',
        uniqueKey: `payment-reconciled:${payment._id}:${status}`,
      }, session)
    })
    res.json({ success: true, message: 'Đã lưu kết quả đối soát và thông báo cho khách hàng.', payment })
  } catch (error) {
    if (error.code === 'PAYMENT_ALREADY_RESOLVED') return res.status(409).json({ success: false, message: error.message, code: error.code })
    console.error('[resolvePayment]', error)
    res.status(500).json({ success: false, message: 'Không xử lý được giao dịch.' })
  }
}
