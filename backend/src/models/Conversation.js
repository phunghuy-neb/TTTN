import mongoose from 'mongoose'

const ConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      default: 'Cuộc trò chuyện mới',
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    // Danh dau conversation nhan cac message cu chua co conversationId.
    isDefault: {
      type: Boolean,
      default: false,
    },
    constraintState: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    entityState: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    historyEpoch: {
      type: Number,
      min: 0,
      default: 0,
    },
    nextTurnSequence: {
      type: Number,
      min: 0,
      default: 0,
    },
    committedTurnSequence: {
      type: Number,
      min: 0,
      default: 0,
    },
    stateTurnSequence: {
      type: Number,
      min: 0,
      default: 0,
    },
    processingTurnId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatTurn',
      default: null,
    },
    processingOwner: {
      type: String,
      default: null,
    },
    processingLeaseUntil: {
      type: Date,
      default: null,
    },
    type: {
      type: String,
      enum: ['GENERAL', 'BOOKING_SUPPORT'],
      default: 'GENERAL',
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
  },
  { timestamps: true, collection: 'conversations' }
)

ConversationSchema.index({ userId: 1, lastMessageAt: -1 })
ConversationSchema.index(
  { userId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
)

export default mongoose.model('Conversation', ConversationSchema)
