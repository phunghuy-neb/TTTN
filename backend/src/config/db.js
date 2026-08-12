// ============================================================
//  src/config/db.js
//  Kết nối MongoDB bằng Mongoose
// ============================================================
import mongoose from 'mongoose'

/**
 * Kết nối tới MongoDB.
 * Hàm này được gọi một lần duy nhất khi server khởi động.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI)
    const hello = await conn.connection.db.admin().command({ hello: 1 })
    if (!hello.setName) {
      throw new Error('MongoDB phải chạy replica set để transaction booking/slot an toàn. Xem README mục MongoDB replica set.')
    }
    console.log(`✅ MongoDB kết nối thành công: ${conn.connection.host}`)
  } catch (error) {
    console.error(`❌ MongoDB lỗi kết nối: ${error.message}`)
    process.exit(1) // Dừng server nếu không kết nối được DB
  }
}

export default connectDB
