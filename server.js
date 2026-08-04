// ============================================================
//  server.js — Entry point của VietVoyage Backend
//  Chạy: npm run dev
// ============================================================
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import connectDB from './src/config/db.js'
import authRoutes from './src/routes/authRoutes.js'
import tourRoutes from './src/routes/tourRoutes.js'
import userRoutes from './src/routes/userRoutes.js'
import bookingRoutes from './src/routes/bookingRoutes.js'
import adminBookingRoutes from './src/routes/adminBookingRoutes.js'
import adminTourRoutes from './src/routes/adminTourRoutes.js'
import adminRoutes from './src/routes/adminRoutes.js'
import chatRoutes from './src/routes/chatRoutes.js'

// ── Kết nối MongoDB ───────────────────────────────────────────
connectDB()

const app = express()

// ── Middleware toàn cục ───────────────────────────────────────
// Cho phép frontend (localhost:5173) gọi API không bị chặn CORS
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  })
)

// Parse JSON body từ request
app.use(express.json())

// Chuẩn hóa error response: mọi lỗi 4xx/5xx đều có { message, code }.
// Controller nào đã tự đặt code cụ thể (EMAIL_TAKEN, TOKEN_INVALID, ...) thì giữ nguyên,
// chỗ nào chưa đặt thì bơm code mặc định theo status để client luôn đọc được body.code.
const MA_LOI_MAC_DINH = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
}
app.use((req, res, next) => {
  const jsonGoc = res.json.bind(res)
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !body.code) {
      body.code =
        MA_LOI_MAC_DINH[res.statusCode] ||
        (res.statusCode >= 500 ? 'SERVER_ERROR' : 'REQUEST_ERROR')
    }
    return jsonGoc(body)
  }
  next()
})

// Phục vụ file tĩnh trong thư mục uploads (ảnh tour)
app.use('/uploads', express.static('uploads'))

// ── Routes ────────────────────────────────────────────────────
// Health check — kiểm tra server còn sống
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🌏 VietVoyage API đang chạy!',
    version: '1.0.0',
    endpoints: {
      auth: 'POST /api/auth/register, /api/auth/login',
      tours: 'GET, POST, PUT, DELETE /api/tours',
      users: 'GET, PUT, PATCH /api/admin/users',
      bookings: 'POST /api/bookings, GET /api/bookings/my, PATCH /api/bookings/:id/cancel',
      adminBookings: 'GET /api/admin/bookings, GET /api/admin/bookings/stats, PATCH /api/admin/bookings/:id/status',
    },
  })
})

// Auth routes
app.use('/api/auth', authRoutes)
// Tour routes
app.use('/api/tours', tourRoutes)
// Admin User routes
app.use('/api/admin/users', userRoutes)
// Booking routes (User)
app.use('/api/bookings', bookingRoutes)
// Chat với trợ lý AI (UC-07) — stub khi chưa set AI_SERVICE_URL
app.use('/api/chat', chatRoutes)
// Admin Booking routes
app.use('/api/admin/bookings', adminBookingRoutes)
// Admin Tour routes (Batch 3 — merge departures theo _id, chống đơn mồ côi)
app.use('/api/admin/tours', adminTourRoutes)
// Admin routes dùng chung (stats, ...) — mount SAU các mount /api/admin/* cụ thể
// để request tới users/bookings không phải đi vòng qua router này
app.use('/api/admin', adminRoutes)

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Không tìm thấy route: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  })
})

// ── Error Handler cuối chuỗi ──────────────────────────────────
// Bắt lỗi ném ra từ middleware/route chưa tự xử lý (VD multer chặn file upload)
// để client luôn nhận JSON { message, code } thay vì trang HTML mặc định của Express.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.name === 'MulterError' || err.message?.startsWith('Chỉ chấp nhận file ảnh')) {
    return res.status(400).json({ success: false, message: err.message, code: 'UPLOAD_ERROR' })
  }
  console.error('[errorHandler]', err)
  res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
})

// ── Khởi động server ──────────────────────────────────────────
const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(``)
  console.log(`  🚀 VietVoyage Backend đang chạy!`)
  console.log(`  📡 URL: http://localhost:${PORT}`)
  console.log(`  🗄️  DB : ${process.env.MONGO_URI}`)
  console.log(`  🌍 Môi trường: ${process.env.NODE_ENV}`)
  console.log(``)
})
