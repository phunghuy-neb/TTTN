// ============================================================
//  src/routes/userRoutes.js
//  API quản lý User dành cho Admin
// ============================================================
import { Router } from 'express'
import {
  getUsers,
  getUser,
  updateUser,
  toggleLockUser,
} from '../controllers/userController.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

// Tất cả các route ở đây đều yêu cầu đăng nhập và có quyền admin
router.use(protect)
router.use(authorize('admin'))

// GET /api/admin/users         → Danh sách user (đã được định nghĩa bên authRoutes, nhưng đưa vào đây hợp lý hơn, tuy nhiên để tương thích ta giữ nguyên bên authRoutes hoặc tạo thêm)
// Chú ý: Ở authRoutes đã có GET /api/admin/users (gọi getAllUsers). Để đầy đủ, ta map lại getUsers ở đây.
router.route('/')
  .get(getUsers)

router.route('/:id')
  .get(getUser)
  .put(updateUser)

// PATCH /api/admin/users/:id/lock → Khóa/mở khóa
router.patch('/:id/lock', toggleLockUser)

export default router
