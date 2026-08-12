import mongoose from 'mongoose'

const NotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['booking', 'payment', 'trip', 'review', 'system'],
      default: 'system',
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    link: { type: String, default: '/notifications', maxlength: 300 },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    // Chống tạo trùng khi cổng thanh toán gửi callback nhiều lần.
    uniqueKey: { type: String, default: undefined },
  },
  { timestamps: true }
)

NotificationSchema.index({ user: 1, createdAt: -1 })
NotificationSchema.index({ user: 1, isRead: 1, createdAt: -1 })
NotificationSchema.index(
  { user: 1, uniqueKey: 1 },
  { unique: true, partialFilterExpression: { uniqueKey: { $type: 'string' } } }
)

export default mongoose.model('Notification', NotificationSchema)
