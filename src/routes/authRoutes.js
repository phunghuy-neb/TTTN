// ============================================================
//  src/routes/authRoutes.js
//  Khai báo tất cả các API endpoint liên quan đến Auth
// ============================================================
import { Router } from 'express'
import { register, login, getMe, getAllUsers } from '../controllers/authController.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

// ── Auth routes (Public) ─────────────────────────────────────
// POST /api/auth/register  →  Đăng ký
router.post('/register', register)

// POST /api/auth/login     →  Đăng nhập
router.post('/login', login)

// ── Auth routes (Private — cần JWT) ──────────────────────────
// GET /api/auth/me         →  Thông tin bản thân
router.get('/me', protect, getMe)

// ── Admin routes (Private — chỉ role 'admin') ────────────────
// GET /api/admin/users     →  Danh sách toàn bộ user
router.get('/admin/users', protect, authorize('admin'), getAllUsers)

export default router
