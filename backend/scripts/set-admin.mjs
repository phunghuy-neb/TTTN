// ============================================================
//  scripts/set-admin.mjs — Cấp quyền admin cho một tài khoản
//
//  Chạy từ thư mục gốc Backend:
//    node scripts/set-admin.mjs email@example.com
// ============================================================

import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../src/models/User.js'

async function main() {
  const email = process.argv[2]
  if (!email) {
    throw new Error('Thiếu email. Cách dùng: node scripts/set-admin.mjs email@example.com')
  }
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong .env')
  }

  await mongoose.connect(process.env.MONGO_URI)
  console.log('Đã kết nối MongoDB (URI được che khỏi log).')

  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    { $set: { role: 'admin' } },
    { new: true }
  )

  if (!user) {
    throw new Error(`Không tìm thấy tài khoản với email: ${email}`)
  }

  console.log(`✔ Đã cấp quyền admin cho "${user.name}" <${user.email}>.`)
  console.log('  Lưu ý: token đã cấp trước đó vẫn mang role cũ — đăng nhập lại để nhận token mới.')
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('SET-ADMIN THẤT BẠI:', err.message)
  mongoose.disconnect().finally(() => process.exit(1))
})
