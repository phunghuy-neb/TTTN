import mongoose from 'mongoose'

const ChatTurnSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },
    logicalTurnId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    requestHash: {
      type: String,
      required: true,
    },
    requestId: {
      type: String,
      default: null,
      maxlength: 128,
    },
    requestIds: {
      type: [String],
      default: [],
    },
    request: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    historyEpoch: {
      type: Number,
      required: true,
      min: 0,
    },
    sequence: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    attemptCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    response: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    failure: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    trace: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, collection: 'chatTurns' }
)

ChatTurnSchema.index({ conversationId: 1, logicalTurnId: 1 }, { unique: true })
ChatTurnSchema.index({ conversationId: 1, historyEpoch: 1, sequence: 1 }, { unique: true })
ChatTurnSchema.index({ conversationId: 1, historyEpoch: 1, status: 1, sequence: 1 })

export default mongoose.model('ChatTurn', ChatTurnSchema)
