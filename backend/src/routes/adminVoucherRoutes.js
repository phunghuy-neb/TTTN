import { Router } from 'express'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'
import { createVoucher, listVouchers, toggleVoucher, updateVoucher } from '../controllers/adminVoucherController.js'
const router = Router()
router.use(protect, requireAdmin)
router.get('/', listVouchers)
router.post('/', createVoucher)
router.put('/:id', updateVoucher)
router.patch('/:id/active', toggleVoucher)
export default router
