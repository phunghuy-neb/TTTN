// ============================================================
//  src/models/Tour.js
//  Schema Tour — khớp thiết kế Tuần 1 trong báo cáo
// ============================================================
import mongoose from 'mongoose'

// ── Sub-schema: Một ngày trong lịch trình ───────────────────
const ItineraryDaySchema = new mongoose.Schema(
  {
    dayNumber: { type: Number, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    meals: [{ type: String, enum: ['Sáng', 'Trưa', 'Tối'] }],
    accommodation: { type: String, trim: true, default: '' },
  },
  { _id: false }
)

// ── Sub-schema: Một đợt khởi hành ───────────────────────────
const DepartureSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    availableSlots: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
)

// ── Sub-schema: Đánh giá của khách hàng ─────────────────────
const ReviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
)

// ── Sub-schema: Trạng thái đồng bộ sang ChromaDB ─────────────
// (Phục vụ nhiệm vụ của Mai Tuấn Anh — AI Service)
const VectorSyncSchema = new mongoose.Schema(
  {
    isSynced: { type: Boolean, default: false },
    lastSyncedAt: { type: Date, default: null },
    chromaId: { type: String, default: '' },
  },
  { _id: false }
)

// ── Schema chính: Tour ────────────────────────────────────────
const TourSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Vui lòng nhập tên tour'],
      trim: true,
    },

    // Dùng cho URL (VD: ha-long-3n2d)
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },

    // Phân loại khu vực
    region: {
      type: String,
      required: [true, 'Vui lòng chọn khu vực'],
      enum: ['Miền Bắc', 'Miền Trung', 'Miền Nam'],
    },

    location: {
      type: String,
      required: [true, 'Vui lòng nhập địa điểm'],
      trim: true,
    },

    // Tọa độ GPS (hiển thị bản đồ sau)
    coordinates: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    // Mô tả ngắn hiển thị ở danh sách
    summary: {
      type: String,
      trim: true,
      default: '',
    },

    // Mô tả đầy đủ — nguồn chính để sinh embedding cho AI (Tuần 3 AI service)
    description: {
      type: String,
      trim: true,
      default: '',
    },

    days: {
      type: Number,
      required: [true, 'Vui lòng nhập số ngày'],
      min: 1,
    },

    basePrice: {
      type: Number,
      required: [true, 'Vui lòng nhập giá cơ bản'],
      min: 0,
    },

    // Giá gốc (dùng để hiển thị badge khuyến mãi nếu oldPrice > basePrice)
    oldPrice: {
      type: Number,
      default: null,
    },

    // Các đợt khởi hành (ngày, số chỗ, giá riêng theo mùa)
    departures: [DepartureSchema],

    // Chi tiết từng ngày lịch trình
    itinerary: [ItineraryDaySchema],

    // Tags phân loại (VD: biển, núi, văn hóa, ...)
    tags: [{ type: String, trim: true }],

    // Bản đã bỏ dấu của name + location + tags, phục vụ tìm kiếm không dấu.
    // MongoDB không áp collation lên $regex nên phải lưu sẵn trường này.
    searchText: { type: String, default: '', index: true },

    // Ảnh tour — mảng đường dẫn URL
    images: [{ type: String }],

    // Chính sách hủy tour
    cancellationPolicy: {
      type: String,
      trim: true,
      default: '',
    },

    // Đánh giá của khách hàng (nhúng trực tiếp vào document)
    reviews: [ReviewSchema],

    // Điểm đánh giá trung bình (tính lại mỗi lần có review mới)
    avgRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    // Trạng thái tour
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
    },

    // Cầu nối sang ChromaDB (AI Service — Tuần 3 Mai Tuấn Anh)
    vectorSync: {
      type: VectorSyncSchema,
      default: () => ({}),
    },

    // Người tạo/quản lý tour
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
)

// ── Indexes tối ưu truy vấn (từ thiết kế Tuần 1) ─────────────
TourSchema.index({ region: 1, basePrice: 1 })
TourSchema.index({ status: 1 })

// ── Pre-save: Tự động sinh slug từ tên tour ───────────────────
TourSchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
  }

  // Cập nhật searchText mỗi lần lưu.
  // HẠN CHẾ: findByIdAndUpdate KHÔNG kích hoạt hook này, nên updateTour
  // cần tự cập nhật hoặc chuyển sang .save().
  this.searchText = [this.name, this.location, ...(this.tags || [])]
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')

  next()
})

export default mongoose.model('Tour', TourSchema)
