// ============================================================
//  src/routes/adminTourRoutes.js
//  CRUD Tour dành cho Admin (Batch 3) — mount tại /api/admin/tours
// ============================================================
import { Router } from 'express'
import {
  getAdminTours,
  getAdminTour,
  createAdminTour,
  updateAdminTour,
  deleteAdminTour,
} from '../controllers/adminTourController.js'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'
import upload from '../middleware/upload.js'

const router = Router()

// Tất cả route đều cần đăng nhập + quyền admin
router.use(protect)
router.use(requireAdmin)

// GET  /api/admin/tours       → danh sách (phân trang, search, lọc isActive, kèm số đơn active)
router.get('/', getAdminTours)

// POST /api/admin/tours       → tạo tour (JSON hoặc multipart kèm images)
router.post('/', upload.array('images', 10), createAdminTour)

// GET  /api/admin/tours/:id   → chi tiết cho form sửa (kèm số đơn theo từng đợt)
router.get('/:id', getAdminTour)

// PUT  /api/admin/tours/:id   → cập nhật — merge departures theo _id, chống mồ côi
router.put('/:id', upload.array('images', 10), updateAdminTour)

// DELETE /api/admin/tours/:id → soft delete (isActive=false)
router.delete('/:id', deleteAdminTour)

export default router
