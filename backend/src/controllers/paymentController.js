import PaymentAttempt from '../models/PaymentAttempt.js'
import Booking from '../models/Booking.js'
import mongoose from 'mongoose'
import QRCode from 'qrcode'
import { initiatePayment, processPaymentResult } from '../services/paymentService.js'
import {
  verifyVnpayCallback,
  verifyMomoCallback,
  verifyMomoDemoToken,
  isMomoDemoMode,
  getPaymentProviderConfig,
  PaymentConfigError,
} from '../services/paymentProviders.js'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character])
}

function momoDemoHtml(attempt, token) {
  const booking = attempt.booking || {}
  const action = `/api/payments/momo/demo/${encodeURIComponent(attempt.orderId)}?token=${encodeURIComponent(token)}`
  const amount = Number(attempt.amount).toLocaleString('vi-VN')
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MoMo Demo - VietVoyage</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#fff1f6;color:#351825;font-family:Arial,sans-serif}
    main{width:min(92%,520px);margin:56px auto;background:#fff;border:1px solid #f2bfd2;border-radius:20px;padding:30px;box-shadow:0 16px 45px #a5004020}
    .brand{color:#a50064;font-size:28px;font-weight:800}.badge{display:inline-block;margin-top:8px;padding:6px 10px;border-radius:999px;background:#ffe0eb;color:#8f004d;font-size:12px;font-weight:700}
    h1{font-size:22px;margin:24px 0 8px}.note{color:#765463;line-height:1.6}.info{margin:22px 0;padding:16px;border-radius:12px;background:#fff7fa}.row{display:flex;justify-content:space-between;gap:20px;padding:7px 0}.row strong{text-align:right}
    form{display:grid;gap:10px}button{width:100%;border:0;border-radius:11px;padding:13px;font-size:15px;font-weight:700;cursor:pointer}.success{background:#a50064;color:#fff}.cancel{background:#f4e5eb;color:#6b354d}
    small{display:block;margin-top:18px;color:#896877;line-height:1.5}
  </style>
</head>
<body><main>
  <div class="brand">MoMo</div><span class="badge">MÔ PHỎNG SANDBOX</span>
  <h1>Xác nhận thanh toán tour</h1>
  <p class="note">Trang này chỉ dùng trình diễn đồ án, không kết nối ví và không thu tiền thật.</p>
  <div class="info">
    <div class="row"><span>Mã đơn</span><strong>${escapeHtml(booking.bookingCode || attempt.orderId)}</strong></div>
    <div class="row"><span>Tour</span><strong>${escapeHtml(booking.tourName || 'VietVoyage')}</strong></div>
    <div class="row"><span>Số tiền</span><strong>${amount} ₫</strong></div>
  </div>
  <form method="post" action="${action}">
    <button class="success" type="submit" name="result" value="success">Mô phỏng thanh toán thành công</button>
    <button class="cancel" type="submit" name="result" value="cancel">Mô phỏng hủy giao dịch</button>
  </form>
  <small>Khi có Partner Code, Access Key và Secret Key hợp lệ, đặt MOMO_MODE=sandbox để dùng cổng MoMo Test chính thức.</small>
</main></body></html>`
}

function clientPaymentUrl(outcome, provider) {
  const base = String(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '')
  const result = outcome.code === 'PAID' || outcome.code === 'ALREADY_PAID'
    ? 'success'
    : outcome.code === 'PENDING'
      ? 'pending'
    : outcome.code === 'PAYMENT_FAILED'
      ? 'failed'
      : outcome.code === 'REVIEW_REQUIRED'
        ? 'review'
        : 'invalid'
  const params = new URLSearchParams({ provider, result })
  if (outcome.bookingCode) params.set('bookingCode', outcome.bookingCode)
  return `${base}/payment?${params.toString()}`
}

function handleError(error, res) {
  if (error.statusCode || error instanceof PaymentConfigError) {
    return res.status(error.statusCode || 503).json({ success: false, message: error.message, code: error.code || 'PAYMENT_ERROR' })
  }
  console.error('[payment]', error)
  return res.status(502).json({ success: false, message: 'Không kết nối được cổng thanh toán. Vui lòng thử lại.', code: 'PAYMENT_GATEWAY_ERROR' })
}

export function getPaymentConfig(req, res) {
  res.json({
    success: true,
    providers: getPaymentProviderConfig(),
  })
}

export async function postInitiatePayment(req, res) {
  try {
    const provider = req.body?.provider
    const { attempt, reused } = await initiatePayment({
      bookingId: req.params.bookingId,
      userId: req.user._id,
      provider,
      ipAddress: req.ip,
    })
    const paymentQrDataUrl = attempt.qrCodeData
      ? await QRCode.toDataURL(attempt.qrCodeData, { width: 360, margin: 1, errorCorrectionLevel: 'M' })
      : ''
    res.json({
      success: true,
      provider: attempt.provider,
      paymentUrl: attempt.payUrl,
      paymentQrDataUrl,
      deeplink: attempt.deeplink || '',
      expiresAt: attempt.expiresAt,
      reused,
    })
  } catch (error) {
    handleError(error, res)
  }
}

const SANDBOX_PAYMENT_METHODS = ['qr', 'bank_account', 'bank_card', 'wallet']

export async function postSandboxConfirmationRequest(req, res) {
  try {
    const bookingId = req.params.bookingId
    const provider = String(req.body?.provider || '').trim().toLowerCase()
    const paymentMethod = String(req.body?.paymentMethod || '').trim().toLowerCase()
    if (!mongoose.isValidObjectId(bookingId) || provider !== 'momo' || !SANDBOX_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Chỉ MoMo Sandbox hỗ trợ bước yêu cầu admin xác nhận.',
        code: 'VALIDATION_ERROR',
      })
    }

    const providerConfig = getPaymentProviderConfig()[provider]
    if (!providerConfig?.enabled || !providerConfig.testMode || providerConfig.mode !== 'sandbox') {
      return res.status(409).json({
        success: false,
        message: 'Bước xác nhận thủ công chỉ dùng cho MoMo Sandbox.',
        code: 'SANDBOX_ONLY',
      })
    }

    const booking = await Booking.findOne({ _id: bookingId, user: req.user._id })
      .select('_id status paymentExpiresAt paymentMethod')
      .lean()
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt tour.', code: 'NOT_FOUND' })
    }
    if (
      booking.status !== 'pending_payment'
      || booking.paymentMethod !== provider
      || !booking.paymentExpiresAt
      || booking.paymentExpiresAt <= new Date()
    ) {
      return res.status(409).json({
        success: false,
        message: 'Đơn không còn ở trạng thái có thể yêu cầu admin xác nhận.',
        code: 'BOOKING_NOT_PAYABLE',
      })
    }

    const requestedAt = new Date()
    const attempt = await PaymentAttempt.findOneAndUpdate(
      {
        booking: booking._id,
        user: req.user._id,
        provider,
        status: 'initiated',
        active: true,
        expiresAt: { $gt: requestedAt },
      },
      {
        $set: {
          sandboxConfirmationRequestedAt: requestedAt,
          sandboxPaymentMethod: paymentMethod,
        },
      },
      { new: true }
    ).lean()
    if (!attempt) {
      return res.status(409).json({
        success: false,
        message: 'Không có giao dịch Sandbox đang chờ cho đơn này.',
        code: 'PAYMENT_NOT_PENDING',
      })
    }

    res.json({
      success: true,
      message: 'Đã báo admin rằng bạn đã chọn xong phương thức trên cổng thanh toán.',
      attempt: {
        _id: attempt._id,
        provider: attempt.provider,
        status: attempt.status,
        sandboxConfirmationRequestedAt: attempt.sandboxConfirmationRequestedAt,
        sandboxPaymentMethod: attempt.sandboxPaymentMethod,
      },
    })
  } catch (error) {
    console.error('[postSandboxConfirmationRequest]', error)
    res.status(500).json({
      success: false,
      message: 'Không gửi được yêu cầu xác nhận Sandbox.',
      code: 'SERVER_ERROR',
    })
  }
}

export async function vnpayReturn(req, res) {
  try {
    const result = verifyVnpayCallback(req.query)
    const outcome = await processPaymentResult({ provider: 'vnpay', result })
    res.redirect(302, clientPaymentUrl(outcome, 'vnpay'))
  } catch (error) {
    console.error('[vnpayReturn]', error.message)
    res.redirect(302, clientPaymentUrl({ code: 'ERROR' }, 'vnpay'))
  }
}

export async function vnpayIpn(req, res) {
  try {
    const result = verifyVnpayCallback(req.query)
    const outcome = await processPaymentResult({ provider: 'vnpay', result })
    const responses = {
      INVALID_SIGNATURE: { RspCode: '97', Message: 'Invalid signature' },
      ORDER_NOT_FOUND: { RspCode: '01', Message: 'Order not found' },
      INVALID_AMOUNT: { RspCode: '04', Message: 'Invalid amount' },
      ALREADY_PAID: { RspCode: '02', Message: 'Order already confirmed' },
    }
    res.json(responses[outcome.code] || { RspCode: '00', Message: 'Confirm Success' })
  } catch (error) {
    console.error('[vnpayIpn]', error.message)
    res.json({ RspCode: '99', Message: 'Unknown error' })
  }
}

export async function momoReturn(req, res) {
  try {
    const result = verifyMomoCallback(req.query)
    const outcome = await processPaymentResult({ provider: 'momo', result })
    res.redirect(302, clientPaymentUrl(outcome, 'momo'))
  } catch (error) {
    console.error('[momoReturn]', error.message)
    res.redirect(302, clientPaymentUrl({ code: 'ERROR' }, 'momo'))
  }
}

export async function momoIpn(req, res) {
  try {
    const result = verifyMomoCallback(req.body || {})
    const outcome = await processPaymentResult({ provider: 'momo', result })
    if (outcome.code === 'INVALID_SIGNATURE') return res.status(400).json({ resultCode: 97, message: 'Invalid signature' })
    if (outcome.code === 'ORDER_NOT_FOUND') return res.status(404).json({ resultCode: 1, message: 'Order not found' })
    if (outcome.code === 'INVALID_AMOUNT') return res.status(400).json({ resultCode: 4, message: 'Invalid amount' })
    res.status(204).end()
  } catch (error) {
    console.error('[momoIpn]', error.message)
    res.status(500).json({ resultCode: 99, message: 'Unknown error' })
  }
}

export async function momoDemoPage(req, res) {
  try {
    if (!isMomoDemoMode() || !verifyMomoDemoToken(req.params.orderId, req.query.token)) {
      return res.status(404).send('Không tìm thấy giao dịch demo.')
    }
    const attempt = await PaymentAttempt.findOne({
      provider: 'momo', orderId: req.params.orderId, active: true,
    }).populate('booking', 'bookingCode tourName')
    if (!attempt) return res.status(404).send('Giao dịch không còn hiệu lực.')
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'")
    res.type('html').send(momoDemoHtml(attempt, req.query.token))
  } catch (error) {
    console.error('[momoDemoPage]', error.message)
    res.status(404).send('Không tìm thấy giao dịch demo.')
  }
}

export async function postMomoDemoResult(req, res) {
  try {
    if (!isMomoDemoMode() || !verifyMomoDemoToken(req.params.orderId, req.query.token)) {
      return res.status(404).send('Không tìm thấy giao dịch demo.')
    }
    const attempt = await PaymentAttempt.findOne({
      provider: 'momo', orderId: req.params.orderId, active: true,
    })
    if (!attempt) return res.status(404).send('Giao dịch không còn hiệu lực.')

    const success = req.body?.result === 'success'
    const outcome = await processPaymentResult({
      provider: 'momo',
      result: {
        valid: true,
        orderId: attempt.orderId,
        amount: attempt.amount,
        success,
        txnId: success ? `MOMO-DEMO-${Date.now()}` : '',
        responseCode: success ? '0' : '1006',
      },
    })
    res.redirect(303, clientPaymentUrl(outcome, 'momo'))
  } catch (error) {
    console.error('[postMomoDemoResult]', error.message)
    res.redirect(303, clientPaymentUrl({ code: 'ERROR' }, 'momo'))
  }
}

export async function getReviewRequiredPayments(req, res) {
  try {
    const attempts = await PaymentAttempt.find({ status: 'review_required' })
      .sort({ processedAt: -1 })
      .limit(100)
      .populate('booking', 'bookingCode tourName totalPrice status contact')
      .populate('user', 'name email')
      .select('-payUrl')
      .lean()
    res.json({ success: true, attempts })
  } catch (error) {
    console.error('[getReviewRequiredPayments]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}
