import mongoose from 'mongoose'

const VoucherUsageSchema = new mongoose.Schema({
  voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
  status: { type: String, enum: ['reserved', 'used', 'released'], default: 'reserved', index: true },
  discountAmount: { type: Number, required: true, min: 0 },
  reservedAt: { type: Date, default: Date.now },
  usedAt: { type: Date, default: null },
  releasedAt: { type: Date, default: null },
}, { timestamps: true })

VoucherUsageSchema.index({ voucher: 1, user: 1, status: 1 })
export default mongoose.model('VoucherUsage', VoucherUsageSchema)
