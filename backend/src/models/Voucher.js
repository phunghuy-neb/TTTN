import mongoose from 'mongoose'

const VoucherSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
  value: { type: Number, required: true, min: 1 },
  maxDiscount: { type: Number, min: 0, default: 0 },
  minOrderValue: { type: Number, min: 0, default: 0 },
  startAt: { type: Date, required: true, index: true },
  endAt: { type: Date, required: true, index: true },
  usageLimit: { type: Number, min: 1, default: 100 },
  perUserLimit: { type: Number, min: 1, default: 1 },
  usedCount: { type: Number, min: 0, default: 0 },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

VoucherSchema.pre('validate', function (next) {
  this.code = String(this.code || '').trim().toUpperCase()
  if (!/^[A-Z0-9_-]{3,30}$/.test(this.code)) this.invalidate('code', 'Mã voucher gồm 3–30 ký tự A-Z, 0-9, _ hoặc -.')
  if (this.discountType === 'percentage' && this.value > 100) this.invalidate('value', 'Phần trăm giảm không được vượt quá 100%.')
  if (this.startAt && this.endAt && this.endAt <= this.startAt) this.invalidate('endAt', 'Ngày kết thúc phải sau ngày bắt đầu.')
  next()
})

export default mongoose.model('Voucher', VoucherSchema)
