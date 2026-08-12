const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Schema Tour — collection trung tâm, lưu toàn bộ thông tin nghiệp vụ của một tour.
 * Thiết kế từ Tuần 1: description là nguồn chính để sinh embedding cho AI;
 * vectorSync là cầu nối theo dõi trạng thái đồng bộ sang ChromaDB (Tuần 2-3).
 */

const ItineraryDaySchema = new Schema(
  {
    dayNumber: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    meals: [{ type: String }],
    accommodation: { type: String, default: "" },
  },
  { _id: false }
);

const DepartureSchema = new Schema(
  {
    date: { type: Date, required: true },
    totalSlots: { type: Number, required: true, min: 0 },
    availableSlots: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true },
  }
);

const ReviewSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User" },
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Trường vectorSync — cầu nối sang ChromaDB (thiết kế Tuần 1, dùng ở script Tuần 2)
const VectorSyncSchema = new Schema(
  {
    isSynced: { type: Boolean, default: false },
    lastSyncedAt: { type: Date, default: null },
    chromaId: { type: String, default: null },
  },
  { _id: false }
);

const TourSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true },
    region: { type: String, required: true }, // VD: "Miền Bắc"
    location: { type: String, required: true }, // VD: "Hạ Long"
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    summary: { type: String, default: "" },
    description: { type: String, default: "" }, // nguồn chính để sinh embedding
    inclusions: { type: String, default: "" },
    exclusions: { type: String, default: "" },
    days: { type: Number, required: true },
    basePrice: { type: Number, required: true },
    oldPrice: { type: Number, default: null },
    departures: [DepartureSchema],
    itinerary: [ItineraryDaySchema],
    tags: [{ type: String }],
    images: [{ type: String }],
    cancellationPolicy: { type: String, default: "" },
    reviews: [ReviewSchema],
    avgRating: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
    },
    isActive: { type: Boolean, default: true },
    vectorSync: { type: VectorSyncSchema, default: () => ({}) },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Chỉ mục (Index) — thiết kế Tuần 1
TourSchema.index({ region: 1, basePrice: 1 }); // lọc theo khu vực + khoảng giá
TourSchema.index({ status: 1 }); // chỉ lấy tour đã published
TourSchema.index({ slug: 1 }, { unique: true }); // theo URL, chống trùng

module.exports = mongoose.models.Tour || mongoose.model("Tour", TourSchema);
