// ============================================================
//  src/routes/authRoutes.js
//  Khai báo tất cả các API endpoint liên quan đến Auth
// ============================================================
import { Router } from 'express'
import {
  register,
  login,
  getMe,
  getAllUsers,
  updateProfile,
  changePassword,
} from '../controllers/authController.js'
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

// PUT /api/auth/profile    →  Tự sửa họ tên / SĐT
router.put('/profile', protect, updateProfile)

// PATCH /api/auth/password →  Tự đổi mật khẩu (sai mật khẩu cũ → 400 WRONG_PASSWORD)
router.patch('/password', protect, changePassword)

// ── Admin routes (Private — chỉ role 'admin') ────────────────
// GET /api/admin/users     →  Danh sách toàn bộ user
router.get('/admin/users', protect, authorize('admin'), getAllUsers)

export default router
