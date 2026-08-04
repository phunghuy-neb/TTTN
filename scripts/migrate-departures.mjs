// ============================================================
//  scripts/migrate-departures.mjs — Migration Batch 2
//
//  1. Cấp _id + totalSlots cho từng phần tử tour.departures[]
//     (totalSlots = availableSlots hiện tại + tổng guests các đơn
//      active đang giữ chỗ của đợt đó, khớp theo NGÀY — lần CUỐI
//      dùng phép khớp ngày, từ đây về sau mọi thứ đi theo _id).
//  2. Backfill booking.departureId bằng khớp tourId + NGÀY departureDate.
//     Đơn không khớp được → ghi C:\TTTN\orphan-bookings.json,
//     KHÔNG sửa, KHÔNG xóa, KHÔNG đoán.
//
//  Idempotent: đợt đã có _id giữ nguyên _id cũ; đơn đã có departureId bỏ qua.
//  Dùng raw collection (không qua Mongoose) để schema mới không tự chèn _id.
//
//  Chạy thử (không ghi DB):  node scripts/migrate-departures.mjs --dry-run
//  Chạy thật:                node scripts/migrate-departures.mjs
//  DB khác (test):           MONGO_URI=mongodb://localhost:27017/ten_db node scripts/migrate-departures.mjs
// ============================================================

import 'dotenv/config'
import mongoose from 'mongoose'
import { writeFileSync } from 'node:fs'

const DRY_RUN = process.argv.includes('--dry-run')
const ORPHAN_FILE = 'C:\\TTTN\\orphan-bookings.json'
const TRANG_THAI_GIU_CHO = ['pending_payment', 'paid', 'completed']

// Khớp theo NGÀY (giờ địa phương) — đúng cách cancelBooking cũ so khớp
function cungNgay(a, b) {
  const d1 = new Date(a)
  const d2 = new Date(b)
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI trong .env')
  await mongoose.connect(process.env.MONGO_URI)
  console.log(`Đã kết nối: ${process.env.MONGO_URI}${DRY_RUN ? '   [DRY-RUN — không ghi DB]' : ''}`)

  const toursCol = mongoose.connection.db.collection('tours')
  const bookingsCol = mongoose.connection.db.collection('bookings')

  const tours = await toursCol.find({}).toArray()
  const bookings = await bookingsCol.find({}).toArray()

  // ── Bước 1: cấp _id + totalSlots cho departures[] ──────────
  let dotCapId = 0
  let dotCapTotal = 0
  let tourGhi = 0

  for (const tour of tours) {
    let doi = false
    const departuresMoi = (tour.departures || []).map((d) => {
      const moi = { ...d }
      if (!moi._id) {
        moi._id = new mongoose.Types.ObjectId()
        dotCapId++
        doi = true
      }
      if (moi.totalSlots == null) {
        // Tổng chỗ = chỗ còn trống + chỗ các đơn active đang giữ (khớp theo ngày)
        const dangGiu = bookings
          .filter(
            (b) =>
              String(b.tour) === String(tour._id) &&
              TRANG_THAI_GIU_CHO.includes(b.status) &&
              cungNgay(b.departureDate, d.date)
          )
          .reduce((s, b) => s + (b.guests || 0), 0)
        moi.totalSlots = (d.availableSlots || 0) + dangGiu
        dotCapTotal++
        doi = true
      }
      return moi
    })

    if (doi) {
      tourGhi++
      if (DRY_RUN) {
        const vd = departuresMoi[0]
        console.log(
          `[dry-run] "${tour.name}": ghi ${departuresMoi.length} đợt — vd đợt 1: ` +
            JSON.stringify({
              _id: String(vd._id),
              date: new Date(vd.date).toISOString().slice(0, 10),
              totalSlots: vd.totalSlots,
              availableSlots: vd.availableSlots,
            })
        )
      } else {
        await toursCol.updateOne({ _id: tour._id }, { $set: { departures: departuresMoi } })
      }
      // Cập nhật bản trong bộ nhớ để Bước 2 thấy _id mới (kể cả dry-run)
      tour.departures = departuresMoi
    }
  }

  // ── Bước 2: backfill booking.departureId ───────────────────
  const tourMap = new Map(tours.map((t) => [String(t._id), t]))
  let daCoTuTruoc = 0
  let ganMoi = 0
  const moCoi = []

  for (const b of bookings) {
    if (b.departureId) {
      daCoTuTruoc++
      continue
    }
    const ghiChung = {
      _id: String(b._id),
      bookingCode: b.bookingCode,
      tour: String(b.tour),
      tourName: b.tourName,
      departureDate: b.departureDate ? new Date(b.departureDate).toISOString() : null,
      status: b.status,
      guests: b.guests,
    }

    const t = tourMap.get(String(b.tour))
    if (!t) {
      moCoi.push({ ...ghiChung, lyDo: 'tour không tồn tại' })
      continue
    }
    const khop = (t.departures || []).filter((d) => cungNgay(d.date, b.departureDate))
    if (khop.length === 1) {
      ganMoi++
      if (DRY_RUN) {
        console.log(`[dry-run] ${b.bookingCode} → departureId ${khop[0]._id}`)
      } else {
        await bookingsCol.updateOne({ _id: b._id }, { $set: { departureId: khop[0]._id } })
      }
    } else if (khop.length === 0) {
      moCoi.push({ ...ghiChung, lyDo: 'không có đợt nào cùng ngày trong tour' })
    } else {
      moCoi.push({ ...ghiChung, lyDo: `nhập nhằng: ${khop.length} đợt cùng ngày` })
    }
  }

  // Ghi danh sách mồ côi ra file (cả dry-run — đây là báo cáo, không phải DB)
  writeFileSync(ORPHAN_FILE, JSON.stringify(moCoi, null, 2))

  // ── Tổng kết ───────────────────────────────────────────────
  console.log('─'.repeat(60))
  console.log(`Tour cần ghi           : ${tourGhi}/${tours.length}`)
  console.log(`Đợt được cấp _id mới   : ${dotCapId}`)
  console.log(`Đợt được cấp totalSlots: ${dotCapTotal}`)
  console.log(`Booking gán departureId: ${ganMoi}${DRY_RUN ? ' (kế hoạch)' : ''}`)
  console.log(`Booking đã có từ trước : ${daCoTuTruoc}`)
  console.log(`Booking MỒ CÔI         : ${moCoi.length}  → ${ORPHAN_FILE}`)
  if (DRY_RUN) console.log('DRY-RUN: chưa ghi gì vào DB. Chạy lại không có --dry-run để migrate thật.')

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('MIGRATION THẤT BẠI:', err.message)
  mongoose.disconnect().finally(() => process.exit(1))
})
