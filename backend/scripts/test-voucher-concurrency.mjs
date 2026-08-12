import 'dotenv/config'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import User from '../src/models/User.js'
import Voucher from '../src/models/Voucher.js'
import VoucherUserCounter from '../src/models/VoucherUserCounter.js'
import { reserveVoucher } from '../src/services/voucherService.js'

if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI.')
await mongoose.connect(process.env.MONGO_URI)
let voucher
try {
  const user = await User.findOne().select('_id')
  if (!user) throw new Error('Cần ít nhất một user để chạy kiểm thử.')
  const code = `RACE${Date.now()}`
  voucher = await Voucher.create({
    code, name: 'Concurrency test', discountType: 'percentage', value: 10,
    startAt: new Date(Date.now() - 60000), endAt: new Date(Date.now() + 3600000),
    usageLimit: 1, perUserLimit: 1, createdBy: user._id,
  })
  const compete = () => mongoose.connection.transaction((session) => reserveVoucher({ code, userId: user._id, originalPrice: 1_000_000, session }))
  const results = await Promise.allSettled([compete(), compete()])
  const successes = results.filter((item) => item.status === 'fulfilled').length
  const stored = await Voucher.findById(voucher._id).lean()
  const counter = await VoucherUserCounter.findOne({ voucher: voucher._id, user: user._id }).lean()
  assert.equal(successes, 1, 'Chỉ một request đồng thời được phép giữ voucher cuối cùng.')
  assert.equal(stored.usedCount, 1, 'usedCount phải đúng bằng 1.')
  assert.equal(counter.count, 1, 'Bộ đếm mỗi user phải đúng bằng 1.')
  console.log(JSON.stringify({ success: true, concurrentRequests: 2, accepted: successes, usedCount: stored.usedCount, perUserCount: counter.count }))
} finally {
  if (voucher?._id) {
    await VoucherUserCounter.deleteMany({ voucher: voucher._id })
    await Voucher.deleteOne({ _id: voucher._id })
  }
  await mongoose.disconnect()
}
