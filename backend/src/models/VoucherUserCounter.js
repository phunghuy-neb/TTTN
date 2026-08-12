import mongoose from 'mongoose'

const VoucherUserCounterSchema = new mongoose.Schema({
  voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  count: { type: Number, min: 0, default: 0 },
}, { timestamps: true })
VoucherUserCounterSchema.index({ voucher: 1, user: 1 }, { unique: true })
export default mongoose.model('VoucherUserCounter', VoucherUserCounterSchema)
