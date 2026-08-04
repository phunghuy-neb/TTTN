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

    at: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'chatMessages' }
)

ChatMessageSchema.index({ userId: 1, at: -1 })

export default mongoose.model('ChatMessage', ChatMessageSchema)
