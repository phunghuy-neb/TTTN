import mongoose from 'mongoose'
import Tour from '../models/Tour.js'
import { validateVoucher } from '../services/voucherService.js'

export async function previewVoucher(req, res) {
  try {
    const { code, tourId, departureId, guests } = req.body || {}
    if (!mongoose.isValidObjectId(tourId) || !mongoose.isValidObjectId(departureId) || !Number.isInteger(Number(guests)) || Number(guests) < 1) {
      return res.status(400).json({ success: false, message: 'Thông tin tour, đợt khởi hành hoặc số khách không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    const tour = await Tour.findOne({ _id: tourId, status: 'published', isActive: { $ne: false } })
    const departure = tour?.departures?.id(departureId)
    if (!departure || new Date(departure.date) <= new Date()) return res.status(404).json({ success: false, message: 'Đợt khởi hành không còn khả dụng.', code: 'DEPARTURE_NOT_FOUND' })
    const originalPrice = departure.price * Number(guests)
    const result = await validateVoucher({ code, userId: req.user._id, originalPrice })
    res.json({ success: true, voucher: { code: result.voucher.code, name: result.voucher.name, discountType: result.voucher.discountType, value: result.voucher.value }, originalPrice, discountAmount: result.discountAmount, totalPrice: result.totalPrice })
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Không kiểm tra được voucher.', code: error.code || 'SERVER_ERROR' })
  }
}
