// ============================================================
//  src/routes/adminBookingRoutes.js
//  Định tuyến API quản lý Booking dành cho Admin
// ============================================================
import { Router } from 'express'
import {
  getAllBookings,
  updateBookingStatus,
  getBookingStats,
} from '../controllers/bookingController.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

// Tất cả route đây đều cần đăng nhập + quyền admin
router.use(protect)
router.use(authorize('admin'))

// GET  /api/admin/bookings/stats    → Thống kê tổng quan (Dashboard)
// ⚠️ Phải đặt TRƯỚC /:id để tránh nhầm "stats" thành một ID
router.get('/stats', getBookingStats)

// GET  /api/admin/bookings          → Danh sách tất cả đơn
router.get('/', getAllBookings)

// PATCH /api/admin/bookings/:id/status → Cập nhật trạng thái đơn
router.patch('/:id/status', updateBookingStatus)

export default router
