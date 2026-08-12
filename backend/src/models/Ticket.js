import crypto from 'crypto'
import mongoose from 'mongoose'

const TicketSchema = new mongoose.Schema(
  {
    ticketCode: { type: String, unique: true, index: true },
    verificationToken: { type: String, unique: true, index: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tour: { type: mongoose.Schema.Types.ObjectId, ref: 'Tour', required: true, index: true },
    status: { type: String, enum: ['valid', 'used', 'revoked'], default: 'valid', index: true },
    issuedAt: { type: Date, default: Date.now },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

TicketSchema.index({ status: 1, issuedAt: -1 })

TicketSchema.pre('validate', function (next) {
  if (!this.ticketCode) {
    const date = new Date().toISOString().slice(2, 10).replace(/-/g, '')
    this.ticketCode = `VVT-${date}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
  }
  if (!this.verificationToken) this.verificationToken = crypto.randomBytes(24).toString('hex')
  next()
})

export default mongoose.model('Ticket', TicketSchema)
