import mongoose from 'mongoose'
import Voucher from '../models/Voucher.js'

function payload(body, userId) {
  return {
    code: String(body.code || '').trim().toUpperCase(),
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    discountType: body.discountType,
    value: Number(body.value),
    maxDiscount: Number(body.maxDiscount) || 0,
    minOrderValue: Number(body.minOrderValue) || 0,
    startAt: new Date(body.startAt),
    endAt: new Date(body.endAt),
    usageLimit: Number(body.usageLimit),
    perUserLimit: Number(body.perUserLimit),
    isActive: body.isActive !== false,
    ...(userId ? { createdBy: userId } : {}),
  }
}

function validationMessage(error) {
  if (error.code === 11000) return 'Mã voucher đã tồn tại.'
  if (error.name === 'ValidationError') return Object.values(error.errors)[0]?.message || 'Dữ liệu voucher không hợp lệ.'
  return ''
}

export async function listVouchers(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15))
    const q = String(req.query.q || '').trim()
    const filter = q ? { $or: [{ code: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] } : {}
    const [vouchers, total] = await Promise.all([Voucher.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit).lean(), Voucher.countDocuments(filter)])
    res.json({ success: true, vouchers, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) })
  } catch (error) {
    console.error('[listVouchers]', error)
    res.status(500).json({ success: false, message: 'Không tải được voucher.' })
  }
}

export async function createVoucher(req, res) {
  try {
    const voucher = await Voucher.create(payload(req.body, req.user._id))
    res.status(201).json({ success: true, message: 'Đã tạo voucher.', voucher })
  } catch (error) {
    const message = validationMessage(error)
    if (message) return res.status(error.code === 11000 ? 409 : 400).json({ success: false, message })
    console.error('[createVoucher]', error)
    res.status(500).json({ success: false, message: 'Không tạo được voucher.' })
  }
}

export async function updateVoucher(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Mã voucher không hợp lệ.' })
    const current = await Voucher.findById(req.params.id)
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy voucher.' })
    const next = payload(req.body)
    if (next.usageLimit < current.usedCount) return res.status(400).json({ success: false, message: `Giới hạn tổng không được nhỏ hơn ${current.usedCount} lượt đã giữ/dùng.` })
    Object.assign(current, next)
    await current.save()
    res.json({ success: true, message: 'Đã cập nhật voucher.', voucher: current })
  } catch (error) {
    const message = validationMessage(error)
    if (message) return res.status(error.code === 11000 ? 409 : 400).json({ success: false, message })
    console.error('[updateVoucher]', error)
    res.status(500).json({ success: false, message: 'Không cập nhật được voucher.' })
  }
}

export async function toggleVoucher(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || typeof req.body?.isActive !== 'boolean') return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' })
    const voucher = await Voucher.findByIdAndUpdate(req.params.id, { $set: { isActive: req.body.isActive } }, { new: true })
    if (!voucher) return res.status(404).json({ success: false, message: 'Không tìm thấy voucher.' })
    res.json({ success: true, message: voucher.isActive ? 'Đã bật voucher.' : 'Đã tắt voucher.', voucher })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Không cập nhật được voucher.' })
  }
}
