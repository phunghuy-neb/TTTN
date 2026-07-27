// ============================================================
//  src/routes/bookingRoutes.js
//  Định tuyến API cho đặt tour và quản lý đơn
// ============================================================
import { Router } from 'express'
import {
  createBooking,
  getMyBookings,
  getBooking,
  cancelBooking,
} from '../controllers/bookingController.js'
import { protect } from '../middleware/auth.js'

const router = Router()

// Tất cả booking routes đều yêu cầu đăng nhập
router.use(protect)

// POST /api/bookings           → Tạo đơn đặt tour
router.post('/', createBooking)

// GET  /api/bookings/my        → Xem lịch sử đặt tour của bản thân
router.get('/my', getMyBookings)

// GET  /api/bookings/:id       → Xem chi tiết 1 đơn (chủ đơn hoặc admin)
router.get('/:id', getBooking)

// PATCH /api/bookings/:id/cancel → Hủy đơn (chỉ pending_payment)
router.patch('/:id/cancel', cancelBooking)

export default router
