import Voucher from '../models/Voucher.js'
import VoucherUsage from '../models/VoucherUsage.js'
import VoucherUserCounter from '../models/VoucherUserCounter.js'

const MINIMUM_PAYABLE = 1000

function voucherError(message, code = 'VOUCHER_INVALID', statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode })
}

export function calculateVoucherDiscount(voucher, originalPrice) {
  const raw = voucher.discountType === 'percentage'
    ? Math.floor(originalPrice * voucher.value / 100)
    : voucher.value
  const limited = voucher.maxDiscount > 0 ? Math.min(raw, voucher.maxDiscount) : raw
  return Math.max(0, Math.min(limited, Math.max(0, originalPrice - MINIMUM_PAYABLE)))
}

export async function validateVoucher({ code, userId, originalPrice, session = null }) {
  const normalized = String(code || '').trim().toUpperCase()
  if (!normalized) throw voucherError('Vui lòng nhập mã voucher.', 'VOUCHER_REQUIRED')
  const now = new Date()
  const voucher = await Voucher.findOne({ code: normalized }).session(session)
  if (!voucher || !voucher.isActive) throw voucherError('Mã voucher không tồn tại hoặc đã tắt.', 'VOUCHER_NOT_FOUND', 404)
  if (voucher.startAt > now) throw voucherError('Voucher chưa đến thời gian sử dụng.', 'VOUCHER_NOT_STARTED')
  if (voucher.endAt < now) throw voucherError('Voucher đã hết hạn.', 'VOUCHER_EXPIRED')
  if (originalPrice < voucher.minOrderValue) throw voucherError(`Đơn hàng chưa đạt giá trị tối thiểu ${voucher.minOrderValue.toLocaleString('vi-VN')} ₫.`, 'VOUCHER_MIN_ORDER')
  if (voucher.usedCount >= voucher.usageLimit) throw voucherError('Voucher đã hết lượt sử dụng.', 'VOUCHER_LIMIT_REACHED', 409)
  const counter = await VoucherUserCounter.findOne({ voucher: voucher._id, user: userId }).session(session)
  if ((counter?.count || 0) >= voucher.perUserLimit) throw voucherError('Bạn đã dùng hết số lượt cho voucher này.', 'VOUCHER_USER_LIMIT', 409)
  const discountAmount = calculateVoucherDiscount(voucher, originalPrice)
  if (discountAmount <= 0) throw voucherError('Voucher không tạo ra mức giảm hợp lệ cho đơn này.', 'VOUCHER_NO_DISCOUNT')
  return { voucher, discountAmount, totalPrice: originalPrice - discountAmount }
}

export async function reserveVoucher({ code, userId, originalPrice, session }) {
  const checked = await validateVoucher({ code, userId, originalPrice, session })
  const voucher = await Voucher.findOneAndUpdate(
    { _id: checked.voucher._id, isActive: true, startAt: { $lte: new Date() }, endAt: { $gte: new Date() }, $expr: { $lt: ['$usedCount', '$usageLimit'] } },
    { $inc: { usedCount: 1 } }, { new: true, session }
  )
  if (!voucher) throw voucherError('Voucher vừa hết lượt hoặc không còn hiệu lực.', 'VOUCHER_LIMIT_REACHED', 409)
  const counter = await VoucherUserCounter.findOneAndUpdate(
    { voucher: voucher._id, user: userId },
    { $inc: { count: 1 }, $setOnInsert: { voucher: voucher._id, user: userId } },
    { upsert: true, new: true, session, setDefaultsOnInsert: true }
  )
  if (counter.count > voucher.perUserLimit) throw voucherError('Bạn vừa dùng hết số lượt cho voucher này.', 'VOUCHER_USER_LIMIT', 409)
  return {
    voucher,
    discountAmount: checked.discountAmount,
    totalPrice: checked.totalPrice,
    snapshot: { voucherId: voucher._id, code: voucher.code, discountType: voucher.discountType, value: voucher.value, maxDiscount: voucher.maxDiscount },
  }
}

export async function createVoucherUsage({ reservation, booking, userId, session }) {
  if (!reservation) return null
  const [usage] = await VoucherUsage.create([{
    voucher: reservation.voucher._id, user: userId, booking: booking._id,
    discountAmount: reservation.discountAmount, status: 'reserved',
  }], { session })
  return usage
}

export async function useVoucherForBooking(bookingId, session) {
  await VoucherUsage.updateOne(
    { booking: bookingId, status: 'reserved' },
    { $set: { status: 'used', usedAt: new Date() } }, { session }
  )
}

export async function releaseVoucherForBooking(bookingId, session) {
  const usage = await VoucherUsage.findOneAndUpdate(
    { booking: bookingId, status: 'reserved' },
    { $set: { status: 'released', releasedAt: new Date() } }, { new: true, session }
  )
  if (!usage) return false
  const voucherResult = await Voucher.updateOne({ _id: usage.voucher, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session })
  const userResult = await VoucherUserCounter.updateOne({ voucher: usage.voucher, user: usage.user, count: { $gt: 0 } }, { $inc: { count: -1 } }, { session })
  if (voucherResult.modifiedCount !== 1 || userResult.modifiedCount !== 1) throw new Error('Không hoàn được lượt voucher một cách nhất quán.')
  return true
}
