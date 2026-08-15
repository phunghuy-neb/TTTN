// ============================================================
//  src/models/ChatMessage.js
//  Một tin nhắn trong hội thoại với trợ lý AI (UC-07)
//  Shape cố định đã chốt với AI service: { userId, role, content, tourId, at }
// ============================================================
import mongoose from 'mongoose'

const ChatMessageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
      index: true,
    },

    logicalTurnId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    turnSequence: {
      type: Number,
      min: 1,
      default: null,
    },

    historyEpoch: {
      type: Number,
      min: 0,
      default: 0,
    },

    // 'user' = người dùng gõ, 'assistant' = trợ lý trả lời
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },

    content: {
      type: String,
      required: true,
      trim: true,
    },

    // Tour đang xem khi chat (context) — null nếu chat từ trang thường
    tourId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tour',
      default: null,
    },

    pageContext: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    referencedTourIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tour',
    }],

    suggestedTourIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tour',
    }],

    // Presentation snapshot for reload only. Factual follow-ups always rehydrate by ID.
    suggestedTours: {
      type: [mongoose.Schema.Types.Mixed],
      default: undefined,
    },

    candidateList: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    referencedBookingIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
    }],

    structuredContent: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    contractVersion: {
      type: Number,
      default: null,
    },

    outcome: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    serviceStatus: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    warnings: {
      type: [String],
      default: undefined,
    },

    at: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'chatMessages' }
)

ChatMessageSchema.index({ userId: 1, at: -1 })
ChatMessageSchema.index({ conversationId: 1, at: -1 })
ChatMessageSchema.index(
  { conversationId: 1, logicalTurnId: 1, role: 1 },
  { unique: true, partialFilterExpression: { logicalTurnId: { $type: 'string' } } }
)

export default mongoose.model('ChatMessage', ChatMessageSchema)
