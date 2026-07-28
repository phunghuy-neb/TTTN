// ============================================================
//  scripts/backfillSearchText.mjs
//  Chạy MỘT LẦN sau khi pull thay đổi thêm trường searchText.
//  Tour tạo trước thay đổi này không có searchText nên tìm kiếm
//  trả rỗng; script lưu lại từng document để hook pre('save')
//  tính lại trường đó.
//
//  Chạy từ thư mục gốc Backend:  node scripts/backfillSearchText.mjs
// ============================================================

import 'dotenv/config'
import mongoose from 'mongoose'
import Tour from '../src/models/Tour.js'

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong .env')
  }

  await mongoose.connect(process.env.MONGO_URI)
  console.log(`Đã kết nối: ${process.env.MONGO_URI}`)

  const tours = await Tour.find({})
  console.log(`Tìm thấy ${tours.length} tour.`)

  let soLoi = 0
  for (const tour of tours) {
    try {
      // Dùng .save() chứ KHÔNG dùng updateMany — chỉ .save() mới kích hoạt hook.
      await tour.save()
    } catch (err) {
      soLoi += 1
      console.error(`  ✗ ${tour.name}: ${err.message}`)
    }
  }

  console.log(`Hoàn tất. Thành công: ${tours.length - soLoi}. Lỗi: ${soLoi}.`)
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('BACKFILL THẤT BẠI:', err.message)
  mongoose.disconnect().finally(() => process.exit(1))
})
