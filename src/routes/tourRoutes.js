// ============================================================
//  src/routes/tourRoutes.js
//  Tất cả endpoint liên quan đến Tour
// ============================================================
import { Router } from 'express'
import {
  getTours,
  getTour,
  createTour,
  updateTour,
  deleteTour,
  uploadImage,
} from '../controllers/tourController.js'
import { protect, authorize } from '../middleware/auth.js'
import upload from '../middleware/upload.js'

const router = Router()

// ── Public routes ─────────────────────────────────────────────
// GET  /api/tours              → Danh sách tour (public, nhưng middleware tuỳ chọn)
// Dùng protect tuỳ chọn để Admin xem được cả draft/archived
router.get('/', (req, res, next) => {
  // Nếu có token thì xác thực, không có cũng không sao
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return protect(req, res, next)
  }
  next()
}, getTours)

// GET  /api/tours/:idOrSlug    → Chi tiết 1 tour
router.get('/:idOrSlug', (req, res, next) => {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return protect(req, res, next)
  }
  next()
}, getTour)

// ── Admin-only routes ─────────────────────────────────────────
// POST /api/tours/upload       → Upload ảnh đơn lẻ
router.post(
  '/upload',
  protect,
  authorize('admin'),
  upload.single('image'),
  uploadImage
)

// POST /api/tours              → Tạo tour mới (hỗ trợ upload nhiều ảnh)
router.post(
  '/',
  protect,
  authorize('admin'),
  upload.array('images', 10), // Tối đa 10 ảnh
  createTour
)

// PUT  /api/tours/:id          → Cập nhật tour
router.put(
  '/:id',
  protect,
  authorize('admin'),
  upload.array('images', 10),
  updateTour
)

// DELETE /api/tours/:id        → Ẩn tour (soft delete → archived)
router.delete('/:id', protect, authorize('admin'), deleteTour)

export default router
