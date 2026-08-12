import { Router } from 'express'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'
import { getPayment, listPayments, resolvePayment } from '../controllers/adminPaymentController.js'
const router = Router()
router.use(protect, requireAdmin)
router.get('/', listPayments)
router.get('/:id', getPayment)
router.patch('/:id/reconciliation', resolvePayment)
export default router
