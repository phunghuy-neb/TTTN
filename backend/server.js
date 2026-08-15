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
import settingsRoutes from './src/routes/settingsRoutes.js'
import paymentRoutes from './src/routes/paymentRoutes.js'
import favoriteRoutes from './src/routes/favoriteRoutes.js'
import notificationRoutes from './src/routes/notificationRoutes.js'
import adminReviewRoutes from './src/routes/adminReviewRoutes.js'
import ticketRoutes from './src/routes/ticketRoutes.js'
import adminTicketRoutes from './src/routes/adminTicketRoutes.js'
import voucherRoutes from './src/routes/voucherRoutes.js'
import adminVoucherRoutes from './src/routes/adminVoucherRoutes.js'
import adminPaymentRoutes from './src/routes/adminPaymentRoutes.js'
import adminOperationsRoutes from './src/routes/adminOperationsRoutes.js'
import { securityHeaders, rateLimit } from './src/middleware/security.js'
import { startBookingExpiryWorker } from './src/services/bookingExpiryService.js'
import { backfillTickets } from './src/services/ticketService.js'

// ── Kết nối MongoDB ───────────────────────────────────────────
const app = express()
app.disable('x-powered-by')
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1)

// ── Middleware toàn cục ───────────────────────────────────────
// Danh sách origin cấu hình theo môi trường; không hard-code localhost khi deploy.
const corsOrigins = String(process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) return callback(null, true)
      return callback(new Error('Origin không được CORS cho phép.'))
    },
    credentials: true,
  })
)
app.use(securityHeaders)
app.use(rateLimit({
  max: Number(process.env.RATE_LIMIT_MAX) || 300,
  // IPN đến từ IP dùng chung của cổng; giới hạn theo IP có thể làm rơi
  // callback hợp lệ. Các route này vẫn chỉ chấp nhận payload có HMAC đúng.
  skip: (req) => req.path.startsWith('/api/chat')
    || ['/api/payments/vnpay/ipn', '/api/payments/momo/ipn'].includes(req.path),
}))

// Parse JSON body từ request
app.use(express.json({ limit: '100kb' }))

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
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  next()
}, express.static('uploads'))

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
// Tour yêu thích đồng bộ theo tài khoản
app.use('/api/favorites', favoriteRoutes)
// Trung tâm thông báo của người dùng
app.use('/api/notifications', notificationRoutes)
// Khởi tạo giao dịch + callback/IPN VNPay/MoMo Sandbox
app.use('/api/payments', paymentRoutes)
// Vé điện tử: trang xác minh công khai và bản đầy đủ chỉ cho chủ đơn/admin
app.use('/api/tickets', ticketRoutes)
app.use('/api/vouchers', voucherRoutes)
// Chat với trợ lý AI (UC-07) — stub khi chưa set AI_SERVICE_URL
app.use('/api/chat', chatRoutes)
// Cài đặt công khai (client đọc chatEnabled, không cần đăng nhập)
app.use('/api/settings', settingsRoutes)
// Admin Booking routes
app.use('/api/admin/bookings', adminBookingRoutes)
app.use('/api/admin/reviews', adminReviewRoutes)
app.use('/api/admin/tickets', adminTicketRoutes)
app.use('/api/admin/vouchers', adminVoucherRoutes)
app.use('/api/admin/payments', adminPaymentRoutes)
app.use('/api/admin/operations', adminOperationsRoutes)
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
  if (err.statusCode) {
    return res.status(err.statusCode).json({ success: false, message: err.message, code: err.code || 'REQUEST_ERROR' })
  }
  if (err.message === 'Origin không được CORS cho phép.') {
    return res.status(403).json({ success: false, message: err.message, code: 'CORS_FORBIDDEN' })
  }
  console.error('[errorHandler]', err)
  res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
})

// ── Khởi động server ──────────────────────────────────────────
const PORT = process.env.PORT || 5000
async function startServer() {
  const missing = ['MONGO_URI', 'JWT_SECRET'].filter((name) => !String(process.env[name] || '').trim())
  if (missing.length) throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`)
  await connectDB()
  const issuedTickets = await backfillTickets()
  if (issuedTickets > 0) console.log(`  🎫 Đã bổ sung ${issuedTickets} vé cho đơn thanh toán cũ`)
  app.listen(PORT, () => {
  console.log(``)
  console.log(`  🚀 VietVoyage Backend đang chạy!`)
  console.log(`  📡 URL: http://localhost:${PORT}`)
  console.log(`  🗄️  DB : đã cấu hình (URI được che khỏi log)`)
  console.log(`  🌍 Môi trường: ${process.env.NODE_ENV}`)
  if (String(process.env.MOMO_MODE || '').toLowerCase() === 'demo') {
    console.log(`  🧪 MoMo: DEMO nội bộ, không thu tiền thật`)
  }
  console.log(``)
  })

  startBookingExpiryWorker()
}

startServer().catch((error) => {
  console.error('[startup]', error.message)
  process.exit(1)
})
