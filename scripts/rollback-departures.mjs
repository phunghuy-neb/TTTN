// ============================================================
//  scripts/rollback-departures.mjs — Gỡ migration Batch 2 khỏi DB
//
//  - $unset booking.departureId khỏi mọi đơn
//  - Trả tour.departures[] về đúng shape cũ { date, availableSlots, price }
//    (bỏ _id và totalSlots)
//
//  Dùng KÈM việc quay code về trước Batch 2 (git revert/checkout) —
//  code mới đọc departureId sẽ không chạy đúng trên DB đã rollback.
//  Rollback trọn vẹn nhất vẫn là mongorestore từ C:\TTTN\backup-batch2-*.
//
//  Chạy:     node scripts/rollback-departures.mjs
//  DB khác:  MONGO_URI=mongodb://localhost:27017/ten_db node scripts/rollback-departures.mjs
// ============================================================

import 'dotenv/config'
import mongoose from 'mongoose'

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI trong .env')
  await mongoose.connect(process.env.MONGO_URI)
  console.log(`Đã kết nối: ${process.env.MONGO_URI}`)

  const toursCol = mongoose.connection.db.collection('tours')
  const bookingsCol = mongoose.connection.db.collection('bookings')

  // 1. Gỡ departureId khỏi booking
  const kqBooking = await bookingsCol.updateMany({}, { $unset: { departureId: '' } })
  console.log(`Đã gỡ departureId khỏi ${kqBooking.modifiedCount} booking.`)

  // 2. Trả departures[] về shape cũ
  const tours = await toursCol.find({}).toArray()
  let tourGhi = 0
  for (const tour of tours) {
    const dots = tour.departures || []
    if (!dots.some((d) => d._id !== undefined || d.totalSlots !== undefined)) continue
    const departuresCu = dots.map((d) => ({
      date: d.date,
      availableSlots: d.availableSlots,
      price: d.price,
    }))
    await toursCol.updateOne({ _id: tour._id }, { $set: { departures: departuresCu } })
    tourGhi++
  }
  console.log(`Đã trả ${tourGhi}/${tours.length} tour về shape departures cũ.`)

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('ROLLBACK THẤT BẠI:', err.message)
  mongoose.disconnect().finally(() => process.exit(1))
})
