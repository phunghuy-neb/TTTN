const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * ITINERARY SUB-SCHEMA
 * Chi tiết lịch trình từng ngày trong tour
 */
const ItineraryDaySchema = new Schema({
  dayNumber: { type: Number, required: true },      // Ngày thứ mấy
  title: { type: String, required: true },           // VD: "Khám phá Vịnh Hạ Long"
  description: { type: String, required: true },     // Mô tả chi tiết hoạt động trong ngày
  meals: [{ type: String, enum: ['breakfast', 'lunch', 'dinner'] }],
  accommodation: { type: String },                   // Khách sạn/resort lưu trú
}, { _id: false });

/**
 * REVIEW SUB-SCHEMA
 */
const ReviewSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

/**
 * DEPARTURE (LỊCH KHỞI HÀNH) SUB-SCHEMA
 */
const DepartureSchema = new Schema({
  date: { type: Date, required: true },
  availableSlots: { type: Number, required: true },
  price: { type: Number, required: true },           // Giá có thể khác nhau theo từng đợt khởi hành
}, { _id: false });

/**
 * TOUR SCHEMA (collection chính)
 */
const TourSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, index: true },

  destination: {
    region: { type: String, required: true },        // VD: "Miền Bắc", "Miền Trung"
    location: { type: String, required: true },       // VD: "Hạ Long, Quảng Ninh"
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
  },

  summary: { type: String, required: true },          // Mô tả ngắn — dùng để hiển thị danh sách
  description: { type: String, required: true },      // Mô tả đầy đủ — nguồn chính để tạo embedding

  duration: {
    days: { type: Number, required: true },
    nights: { type: Number, required: true },
  },

  basePrice: { type: Number, required: true },         // Giá cơ bản (VNĐ)
  departures: [DepartureSchema],                        // Các đợt khởi hành cụ thể

  itinerary: [ItineraryDaySchema],

  category: [{ type: String }],                         // VD: ["biển", "nghỉ dưỡng", "gia đình"]
  tags: [{ type: String }],                              // Từ khóa hỗ trợ tìm kiếm / gợi ý AI

  images: [{ type: String }],                            // URL ảnh
  cancellationPolicy: { type: String },

  reviews: [ReviewSchema],
  avgRating: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft',
  },

  // Đánh dấu để script đồng bộ Vector DB biết tour này đã/chưa được embedding
  vectorSync: {
    isSynced: { type: Boolean, default: false },
    lastSyncedAt: { type: Date },
    chromaId: { type: String },                         // Liên kết ngược sang ChromaDB document id
  },

  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

TourSchema.index({ 'destination.region': 1, basePrice: 1 });
TourSchema.index({ status: 1 });

module.exports = mongoose.model('Tour', TourSchema);
