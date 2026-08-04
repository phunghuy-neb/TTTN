// ============================================================
//  src/routes/adminBookingRoutes.js
//  Định tuyến API quản lý Booking dành cho Admin
// ============================================================
import { Router } from 'express'
import {
  getAllBookings,
  getAdminBooking,
  updateBookingStatus,
  getBookingStats,
} from '../controllers/bookingController.js'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'

const router = Router()

// Tất cả route đây đều cần đăng nhập + quyền admin
router.use(protect)
router.use(requireAdmin)

// GET  /api/admin/bookings/stats    → Thống kê tổng quan (Dashboard)
// ⚠️ Phải đặt TRƯỚC /:id để tránh nhầm "stats" thành một ID
router.get('/stats', getBookingStats)

// GET  /api/admin/bookings          → Danh sách tất cả đơn
router.get('/', getAllBookings)

// GET  /api/admin/bookings/:id      → Chi tiết đầy đủ 1 đơn (kèm statusHistory)
router.get('/:id', getAdminBooking)

// PATCH /api/admin/bookings/:id/status → Đổi trạng thái theo máy trạng thái
router.patch('/:id/status', updateBookingStatus)

export default router
