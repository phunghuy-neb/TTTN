import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../src/models/User.js'
import Voucher from '../src/models/Voucher.js'
import { backfillTickets } from '../src/services/ticketService.js'

if (process.env.NODE_ENV === 'production') throw new Error('Không chạy seed demo trong production.')
if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI.')
await mongoose.connect(process.env.MONGO_URI)
try {
  async function ensureUser({ name, email, password, role, phone }) {
    const existing = await User.findOne({ email })
    if (existing) return existing
    return User.create({ name, email, password, role, phone, isActive: true })
  }
  const admin = await ensureUser({ name: 'VietVoyage Admin Demo', email: 'codex-admin-ui-20260812@example.com', password: 'CodexAdmin123!', role: 'admin', phone: '0900000001' })
  const customer = await ensureUser({ name: 'Khách hàng Demo', email: 'codex-customer-ui-20260812@example.com', password: 'CodexCustomer123!', role: 'customer', phone: '0900000002' })
  const now = new Date()
  const voucher = await Voucher.findOneAndUpdate(
    { code: 'DEMO10' },
    { $set: { name: 'Giảm 10% cho buổi trình diễn', description: 'Voucher mẫu dành cho môi trường demo.', discountType: 'percentage', value: 10, maxDiscount: 500000, minOrderValue: 500000, startAt: new Date(now.getTime() - 86400000), endAt: new Date(now.getTime() + 365 * 86400000), usageLimit: 100, perUserLimit: 3, isActive: true }, $setOnInsert: { createdBy: admin._id, usedCount: 0 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
  const tickets = await backfillTickets()
  console.log(JSON.stringify({ success: true, admin: admin.email, customer: customer.email, voucher: voucher.code, ticketsBackfilled: tickets }))
} finally {
  await mongoose.disconnect()
}
