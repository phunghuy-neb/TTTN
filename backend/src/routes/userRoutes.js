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
  changeUserRole,
} from '../controllers/userController.js'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'

const router = Router()

// Tất cả các route ở đây đều yêu cầu đăng nhập và có quyền admin
router.use(protect)
router.use(requireAdmin)

// GET /api/admin/users            → Danh sách user (phân trang, search, lọc role, kèm số đơn)
router.route('/')
  .get(getUsers)

router.route('/:id')
  .get(getUser)
  .put(updateUser)

// PATCH /api/admin/users/:id/lock → Khóa/mở khóa (không tự khóa mình — 409 CANNOT_LOCK_SELF)
router.patch('/:id/lock', toggleLockUser)

// PATCH /api/admin/users/:id/role → Đổi quyền (không tự hạ quyền — 409 CANNOT_DEMOTE_SELF)
router.patch('/:id/role', changeUserRole)

export default router
