// ============================================================
//  src/routes/tourRoutes.js
//  Endpoint Tour phía CLIENT + upload ảnh cho admin.
//  CRUD tour của admin đã chuyển sang /api/admin/tours (Batch 3) —
//  route PUT/POST/DELETE cũ ở đây bị gỡ vì gán đè cả mảng departures
//  là đường sinh ra đơn mồ côi.
// ============================================================
import { Router } from 'express'
import { getTours, getTour, uploadImage } from '../controllers/tourController.js'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'
import upload from '../middleware/upload.js'
import { createReview } from '../controllers/reviewController.js'

const router = Router()

// Người dùng chỉ được đánh giá bằng một booking đã hoàn thành của chính mình.
router.post('/:tourId/reviews', protect, upload.array('images', 5), createReview)

// ── Public routes ─────────────────────────────────────────────
// GET  /api/tours              → Danh sách tour (public, nhưng middleware tuỳ chọn)
// Dùng protect tuỳ chọn để Admin xem được cả draft/archived/ẩn
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

// ── Admin-only: upload ảnh đơn lẻ (dùng cho form tour) ───────
// POST /api/tours/upload       → trả URL ảnh để gắn vào images[]
router.post(
  '/upload',
  protect,
  requireAdmin,
  upload.single('image'),
  uploadImage
)

export default router
