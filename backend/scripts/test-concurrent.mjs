// ============================================================
//  scripts/test-concurrent.mjs — Bằng chứng chống race condition
//
//  Kịch bản: thêm một đợt khởi hành TEST còn đúng 5 chỗ vào một tour
//  published, rồi cho 20 KHÁCH KHÁC NHAU cùng bấm đặt 1 chỗ SONG SONG.
//  Kỳ vọng: đúng 5 thành công, 15 nhận 409 SLOT_UNAVAILABLE,
//  availableSlots trong DB = 0 (không âm, không hụt).
//
//  VÌ SAO PHẢI LÀ 20 KHÁCH KHÁC NHAU: từ Batch 8, Backend có khóa chống
//  đơn trùng (idempotencyKey) — cùng một ý định gửi lại chỉ tính là MỘT lần.
//  Dùng chung một tài khoản sẽ đo nhầm
//  cơ chế chống-trùng thay vì cơ chế chống-oversell.
//
//  Yêu cầu: Backend đang chạy (npm run dev) + MongoDB.
//  Chạy:  node scripts/test-concurrent.mjs
//  Giữ lại dữ liệu test để soi: thêm cờ --keep
// ============================================================

import 'dotenv/config'
import mongoose from 'mongoose'

const BASE = `http://localhost:${process.env.PORT || 5000}/api`
const KEEP = process.argv.includes('--keep')
const DUOI_EMAIL = '@concurrent.test'
const MAT_KHAU = 'matkhau123'
const SO_CHO = 5
const SO_REQUEST = 20

// Tạo (hoặc dùng lại) một tài khoản khách và trả về token
async function taoKhach(i) {
  const email = `khach${i}${DUOI_EMAIL}`
  await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Khách Đồng Thời ${i}`, email, password: MAT_KHAU }),
  }).catch(() => {})
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: MAT_KHAU }),
  }).then((r) => r.json())
  if (!res.token) throw new Error(`Không đăng nhập được ${email}: ${res.message}`)
  return res.token
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI trong .env')
  await mongoose.connect(process.env.MONGO_URI)
  const toursCol = mongoose.connection.db.collection('tours')
  const bookingsCol = mongoose.connection.db.collection('bookings')

  // Server còn sống không?
  await fetch(`${BASE.replace('/api', '')}/`).catch(() => {
    throw new Error(`Backend chưa chạy tại ${BASE} — hãy npm run dev trước.`)
  })

  // 1. Chọn một tour published, gắn đợt TEST còn đúng 5 chỗ
  const tour = await toursCol.findOne({ status: 'published' })
  if (!tour) throw new Error('Không có tour published nào trong DB.')

  const depId = new mongoose.Types.ObjectId()
  const ngayTest = new Date()
  ngayTest.setDate(ngayTest.getDate() + 60)
  await toursCol.updateOne(
    { _id: tour._id },
    {
      $push: {
        departures: {
          _id: depId,
          date: ngayTest,
          totalSlots: SO_CHO,
          availableSlots: SO_CHO,
          price: tour.basePrice || 1000000,
        },
      },
    }
  )
  console.log(`Đã gắn đợt TEST ${depId} (${SO_CHO} chỗ) vào tour "${tour.name}".`)

  // Mỗi request một khách riêng — xem ghi chú ở đầu file
  console.log(`Chuẩn bị ${SO_REQUEST} tài khoản khách...`)
  const tokens = await Promise.all(Array.from({ length: SO_REQUEST }, (_, i) => taoKhach(i + 1)))

  // 2. Cho 20 khách cùng bấm đặt 1 chỗ SONG SONG
  console.log(`Bắn ${SO_REQUEST} request đặt 1 chỗ song song (20 khách khác nhau)...`)
  const ketQua = await Promise.all(
    tokens.map((token, i) =>
      fetch(`${BASE}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tourId: String(tour._id),
          departureId: String(depId),
          guests: 1,
          contact: { name: `Khách ${i + 1}`, phone: '0900000001', email: `khach${i + 1}${DUOI_EMAIL}` },
          paymentMethod: 'later',
          idempotencyKey: `concurrent_test_${String(i + 1).padStart(3, '0')}_${String(depId)}`,
        }),
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
    )
  )

  // 3. Tally kết quả
  const thanhCong = ketQua.filter((k) => k.status === 201)
  const bi409 = ketQua.filter((k) => k.status === 409 && k.body.code === 'SLOT_UNAVAILABLE')
  const khac = ketQua.filter((k) => k.status !== 201 && !(k.status === 409 && k.body.code === 'SLOT_UNAVAILABLE'))

  const tourSau = await toursCol.findOne({ _id: tour._id })
  const depSau = (tourSau.departures || []).find((d) => String(d._id) === String(depId))

  console.log('─'.repeat(60))
  console.log(`Thành công (201)            : ${thanhCong.length}   (kỳ vọng ${SO_CHO})`)
  console.log(`409 SLOT_UNAVAILABLE        : ${bi409.length}   (kỳ vọng ${SO_REQUEST - SO_CHO})`)
  console.log(`Kết quả khác                : ${khac.length}   (kỳ vọng 0)`)
  for (const k of khac) console.log('  ✗', k.status, JSON.stringify(k.body).slice(0, 160))
  console.log(`availableSlots trong DB     : ${depSau?.availableSlots}   (kỳ vọng 0)`)
  const dat =
    thanhCong.length === SO_CHO &&
    bi409.length === SO_REQUEST - SO_CHO &&
    khac.length === 0 &&
    depSau?.availableSlots === 0
  console.log(dat ? '✔ PASS — không oversell, không hụt chỗ.' : '✘ FAIL — xem lại logic trừ chỗ!')

  // 4. Dọn dữ liệu test (trừ khi --keep) — dọn cả 20 USER test để DB không còn rác
  if (!KEEP) {
    const usersCol = mongoose.connection.db.collection('users')
    const khachTest = await usersCol.find({ email: new RegExp(`${DUOI_EMAIL}$`) }).toArray()
    const rBk = await bookingsCol.deleteMany({ user: { $in: khachTest.map((u) => u._id) } })
    await toursCol.updateOne({ _id: tour._id }, { $pull: { departures: { _id: depId } } })
    const rUser = await usersCol.deleteMany({ email: new RegExp(`${DUOI_EMAIL}$`) })
    console.log(`Đã dọn: ${rBk.deletedCount} đơn test + đợt TEST + ${rUser.deletedCount} tài khoản khách test.`)
  } else {
    console.log('--keep: giữ nguyên dữ liệu test để soi tay.')
  }

  await mongoose.disconnect()
  process.exit(dat ? 0 : 1)
}

main().catch((err) => {
  console.error('TEST THẤT BẠI:', err.message)
  mongoose.disconnect().finally(() => process.exit(1))
})
