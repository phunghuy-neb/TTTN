// ============================================================
//  scripts/cleanup-demo.mjs — Dọn dữ liệu kiểm thử (Batch 6)
//
//  XÓA:
//    - booking mồ côi (không departureId / trỏ tour không tồn tại)
//    - booking VV-DEMO-* (demo doanh thu cũ)
//    - tour kiểm thử (slug/tên chứa kiem-thu | test | batch)
//    - user test: @test.local, *batch*, prefix test+ / browsertest+
//    - booking + chatMessages của các user/tour bị xóa (tránh sinh mồ côi mới)
//  GIỮ:
//    - 8 tour gốc, tài khoản thật (phunghuy*@gmail.com, @seed.local)
//
//  An toàn:
//    - Đơn active bị xóa mà còn departureId + tour còn sống → HOÀN CHỖ nguyên tử
//    - Toàn bộ bản ghi bị xóa ghi ra C:\TTTN\deleted-batch6.json TRƯỚC khi xóa
//    - Sau khi xóa: kiểm bất biến availableSlots + đang giữ = totalSlots,
//      lệch chỉ BÁO CÁO, không tự sửa
//
//  Chạy thử:  node scripts/cleanup-demo.mjs --dry-run
//  Chạy thật: node scripts/cleanup-demo.mjs
// ============================================================

import 'dotenv/config'
import mongoose from 'mongoose'
import { writeFileSync } from 'node:fs'

const DRY_RUN = process.argv.includes('--dry-run')
const FILE_BANG_CHUNG = 'C:\\TTTN\\deleted-batch6.json'
const TRANG_THAI_GIU_CHO = ['pending_payment', 'paid', 'completed']

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI trong .env')
  await mongoose.connect(process.env.MONGO_URI)
  console.log(`Đã kết nối: ${process.env.MONGO_URI}${DRY_RUN ? '   [DRY-RUN — không xóa gì]' : ''}`)

  const db = mongoose.connection.db
  const toursCol = db.collection('tours')
  const bookingsCol = db.collection('bookings')
  const usersCol = db.collection('users')
  const chatCol = db.collection('chatMessages')

  const tours = await toursCol.find({}).toArray()
  const bookings = await bookingsCol.find({}).toArray()
  const users = await usersCol.find({}).toArray()
  const tourIds = new Set(tours.map((t) => String(t._id)))

  // ── Xác định diện xóa ──────────────────────────────────────
  const tourXoa = tours.filter(
    (t) => /kiem-thu|test|batch/i.test(t.slug || '') || /kiểm thử|test|batch/i.test(t.name || '')
  )
  const tourXoaIds = new Set(tourXoa.map((t) => String(t._id)))

  const userXoa = users.filter(
    (u) =>
      /@test\.local$/i.test(u.email) ||
      /batch/i.test(u.email) ||
      /^(test|browsertest)\+/i.test(u.email) // rác test cũ trên domain dự án — tiêu chí bổ sung, đã báo cáo
  )
  const userXoaIds = new Set(userXoa.map((u) => String(u._id)))

  const bookingXoa = bookings.filter(
    (b) =>
      !b.departureId || // mồ côi từ trước migration
      !tourIds.has(String(b.tour)) || // trỏ tour đã chết
      /^VV-DEMO-/.test(b.bookingCode) || // demo doanh thu cũ
      tourXoaIds.has(String(b.tour)) || // đơn của tour kiểm thử
      userXoaIds.has(String(b.user)) // đơn của user test
  )

  const chatXoa = await chatCol
    .find({ userId: { $in: [...userXoaIds].map((id) => new mongoose.Types.ObjectId(id)) } })
    .toArray()

  // ── Kế hoạch hoàn chỗ: đơn active + có departureId + tour còn sống, không thuộc tour bị xóa ──
  const hoanCho = bookingXoa.filter(
    (b) =>
      b.departureId &&
      TRANG_THAI_GIU_CHO.includes(b.status) &&
      tourIds.has(String(b.tour)) &&
      !tourXoaIds.has(String(b.tour))
  )

  console.log('─'.repeat(60))
  console.log(`Booking sẽ xóa   : ${bookingXoa.length}/${bookings.length}`)
  for (const b of bookingXoa) console.log(`   - ${b.bookingCode} | ${b.status}${b.departureId ? '' : ' | MỒ CÔI'}`)
  console.log(`Tour sẽ xóa      : ${tourXoa.length}/${tours.length}`)
  for (const t of tourXoa) console.log(`   - ${t.name} (${t.slug})`)
  console.log(`User sẽ xóa      : ${userXoa.length}/${users.length}`)
  for (const u of userXoa) console.log(`   - ${u.email}`)
  console.log(`ChatMessage sẽ xóa: ${chatXoa.length}`)
  console.log(`Đơn cần HOÀN CHỖ trước khi xóa: ${hoanCho.length}`)
  for (const b of hoanCho) console.log(`   - ${b.bookingCode}: +${b.guests} chỗ về đợt ${b.departureId}`)

  if (DRY_RUN) {
    console.log('─'.repeat(60))
    console.log('DRY-RUN: chưa xóa gì. Chạy lại không có --dry-run để dọn thật.')
    await mongoose.disconnect()
    return
  }

  // ── Ghi bằng chứng TRƯỚC khi xóa ───────────────────────────
  writeFileSync(
    FILE_BANG_CHUNG,
    JSON.stringify(
      {
        thoiDiem: new Date().toISOString(),
        bookings: bookingXoa,
        tours: tourXoa,
        users: userXoa.map(({ password, ...u }) => u), // không ghi hash mật khẩu ra file
        chatMessages: chatXoa,
      },
      null,
      2
    )
  )
  console.log(`Đã ghi toàn bộ bản ghi bị xóa ra ${FILE_BANG_CHUNG}`)

  // ── Hoàn chỗ cho đơn active bị xóa ─────────────────────────
  for (const b of hoanCho) {
    const kq = await toursCol.updateOne(
      { _id: b.tour, 'departures._id': b.departureId },
      { $inc: { 'departures.$.availableSlots': b.guests } }
    )
    if (kq.modifiedCount === 0) console.error(`   ✗ Không hoàn được chỗ cho ${b.bookingCode}`)
  }

  // ── Xóa ────────────────────────────────────────────────────
  const kqBk = await bookingsCol.deleteMany({ _id: { $in: bookingXoa.map((b) => b._id) } })
  const kqTour = await toursCol.deleteMany({ _id: { $in: tourXoa.map((t) => t._id) } })
  const kqUser = await usersCol.deleteMany({ _id: { $in: userXoa.map((u) => u._id) } })
  const kqChat = await chatCol.deleteMany({ _id: { $in: chatXoa.map((c) => c._id) } })
  console.log(`Đã xóa: ${kqBk.deletedCount} booking, ${kqTour.deletedCount} tour, ${kqUser.deletedCount} user, ${kqChat.deletedCount} chatMessage.`)

  // ── Kiểm bất biến slot trên MỌI đợt (chỉ báo cáo) ──────────
  const toursSau = await toursCol.find({}).toArray()
  const bookingsSau = await bookingsCol.find({}).toArray()
  let lech = 0
  let tongDot = 0
  for (const t of toursSau) {
    for (const d of t.departures || []) {
      tongDot++
      const dangGiu = bookingsSau
        .filter((b) => String(b.departureId) === String(d._id) && TRANG_THAI_GIU_CHO.includes(b.status))
        .reduce((s, b) => s + (b.guests || 0), 0)
      if (d.availableSlots + dangGiu !== d.totalSlots) {
        lech++
        console.log(
          `   ✗ LỆCH: "${t.name}" đợt ${new Date(d.date).toISOString().slice(0, 10)}: ${d.availableSlots} + ${dangGiu} ≠ ${d.totalSlots}`
        )
      }
    }
  }
  console.log(`Bất biến slot: ${tongDot - lech}/${tongDot} đợt đúng${lech ? ` — ${lech} đợt LỆCH (không tự sửa, xem trên)` : ''}`)

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('CLEANUP THẤT BẠI:', err.message)
  mongoose.disconnect().finally(() => process.exit(1))
})
