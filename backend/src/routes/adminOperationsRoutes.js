import { Router } from 'express'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'
import { exportBookings, exportRevenue, getDepartureCalendar } from '../controllers/adminOperationsController.js'
const router = Router()
router.use(protect, requireAdmin)
router.get('/calendar', getDepartureCalendar)
router.get('/reports/bookings', exportBookings)
router.get('/reports/revenue', exportRevenue)
export default router
