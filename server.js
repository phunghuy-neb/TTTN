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
// Admin Booking routes
app.use('/api/admin/bookings', adminBookingRoutes)

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Không tìm thấy route: ${req.method} ${req.originalUrl}`,
  })
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
