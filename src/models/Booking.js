// ============================================================
//  src/models/Booking.js
//  Schema đơn đặt tour — khớp thiết kế Tuần 1 trong báo cáo
// ============================================================
import mongoose from 'mongoose'

// ── Sub-schema: Thông tin liên hệ người đặt ─────────────────
const ContactSchema = new mongoose.Schema(
  {
    name:  { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
  },
  { _id: false }
)

// ── Schema chính: Booking ─────────────────────────────────────
const BookingSchema = new mongoose.Schema(
  {
    // Mã đơn hiển thị cho khách (VD: VV-1721234567-AB12)
    bookingCode: {
      type: String,
      unique: true,
    },

    // Người đặt tour
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Tour được đặt
    tour: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tour',
      required: true,
    },

    // Snapshot tên tour tại thời điểm đặt (không bị ảnh hưởng nếu tour đổi tên sau)
    tourName: {
      type: String,
      required: true,
      trim: true,
    },

    // Snapshot giá một khách tại thời điểm đặt
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    // Đợt khởi hành đã đặt — tham chiếu departures._id trong Tour (khóa ổn định,
    // sống sót khi admin đổi ngày đợt). Đơn cũ migrate không khớp được đợt = null
    // (xem scripts/migrate-departures.mjs + C:\TTTN\orphan-bookings.json).
    departureId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    // Ngày khởi hành — bản sao denormalize để hiển thị/lọc; nguồn sự thật về
    // "đơn thuộc đợt nào" là departureId. GIỮ NGUYÊN cho tới khi FE ổn định.
    departureDate: {
      type: Date,
      required: true,
    },

    // Số lượng khách
    guests: {
      type: Number,
      required: true,
      min: 1,
    },

    // Tổng tiền = unitPrice × guests
    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    // Thông tin liên hệ người đặt
    contact: {
      type: ContactSchema,
      required: true,
    },

    // Trạng thái đơn
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'cancelled', 'completed'],
      default: 'pending_payment',
    },

    // Phương thức thanh toán
    paymentMethod: {
      type: String,
      enum: ['vnpay', 'momo', 'later', null],
      default: null,
    },

    // Mã giao dịch từ cổng thanh toán
    txnRef: {
      type: String,
      default: null,
    },

    // Thời điểm thanh toán thành công
    paidAt: {
      type: Date,
      default: null,
    },

    // Đơn đã được khách đánh giá tour hay chưa
    reviewed: {
      type: Boolean,
      default: false,
    },

    // Ghi chú từ khách hàng (tuỳ chọn)
    note: {
      type: String,
      trim: true,
      default: '',
    },

    // Lịch sử đổi trạng thái (Batch 4) — phục vụ báo cáo/audit.
    // byUserId: người thực hiện (admin đổi trạng thái, hoặc chính khách khi tự hủy).
    statusHistory: [
      new mongoose.Schema(
        {
          from: { type: String, required: true },
          to: { type: String, required: true },
          byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          at: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
    ],
  },
  {
    timestamps: true,
  }
)

// ── Index tối ưu truy vấn ─────────────────────────────────────
BookingSchema.index({ user: 1, createdAt: -1 })
BookingSchema.index({ tour: 1 })
BookingSchema.index({ status: 1 })
// bookingCode: unique index đã tạo tự động qua { unique: true } trong field definition

// ── Pre-save: Tự động sinh bookingCode nếu chưa có ───────────
BookingSchema.pre('save', function (next) {
  if (!this.bookingCode) {
    const timestamp = Date.now().toString()
    const random = Math.random().toString(36).toUpperCase().slice(2, 6)
    this.bookingCode = `VV-${timestamp.slice(-7)}-${random}`
  }
  next()
})

export default mongoose.model('Booking', BookingSchema)
