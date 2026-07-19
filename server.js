// ============================================================
//  server.js — Entry point của VietVoyage Backend
//  Chạy: npm run dev
// ============================================================
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import connectDB from './src/config/db.js'
import authRoutes from './src/routes/authRoutes.js'

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

// ── Routes ────────────────────────────────────────────────────
// Health check — kiểm tra server còn sống
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🌏 VietVoyage API đang chạy!',
    version: '1.0.0',
    endpoints: {
      register: 'POST /api/auth/register',
      login: 'POST /api/auth/login',
      me: 'GET /api/auth/me  (cần JWT)',
      adminUsers: 'GET /api/admin/users  (cần JWT + role admin)',
    },
  })
})

// Auth & Admin routes (tất cả đều đi qua /api/auth hoặc /api/admin)
app.use('/api/auth', authRoutes)
app.use('/api', authRoutes) // Route /api/admin/users cũng đặt ở đây

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
