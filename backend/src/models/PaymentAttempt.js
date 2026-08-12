import mongoose from 'mongoose'

const PaymentAttemptSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['vnpay', 'momo'],
      required: true,
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    requestId: { type: String, default: '' },
    amount: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['creating', 'initiated', 'paid', 'failed', 'expired', 'review_required'],
      default: 'creating',
      index: true,
    },
    // Chỉ cho một attempt còn hoạt động trên mỗi booking. Partial unique index
    // tránh tạo hai payUrl có thể cùng thu tiền cho một đơn.
    active: { type: Boolean, default: true },
    payUrl: { type: String, default: '' },
    // MoMo trả dữ liệu QR/deep link cùng payUrl. Lưu lại để khách có thể tiếp
    // tục thanh toán ngay trên trang của VietVoyage thay vì bị buộc rời website.
    qrCodeData: { type: String, default: '', select: false },
    deeplink: { type: String, default: '' },
    deeplinkMiniApp: { type: String, default: '' },
    providerTxnId: { type: String, default: '' },
    responseCode: { type: String, default: '' },
    processedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: true },
    reconciliation: {
      type: new mongoose.Schema({
        status: { type: String, enum: ['pending', 'confirmed', 'refunded', 'ignored'], default: 'pending' },
        note: { type: String, trim: true, maxlength: 1000, default: '' },
        resolvedAt: { type: Date, default: null },
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      }, { _id: false }),
      default: () => ({ status: 'pending' }),
    },
  },
  { timestamps: true }
)

PaymentAttemptSchema.index(
  { booking: 1 },
  { unique: true, partialFilterExpression: { active: true } }
)
PaymentAttemptSchema.index({ status: 1, 'reconciliation.status': 1, createdAt: -1 })
PaymentAttemptSchema.index(
  { provider: 1, providerTxnId: 1 },
  { unique: true, partialFilterExpression: { providerTxnId: { $type: 'string', $gt: '' } } }
)

export default mongoose.model('PaymentAttempt', PaymentAttemptSchema)
