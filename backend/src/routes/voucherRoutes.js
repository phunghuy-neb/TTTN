import { Router } from 'express'
import { protect } from '../middleware/auth.js'
import { previewVoucher } from '../controllers/voucherController.js'
const router = Router()
router.post('/validate', protect, previewVoucher)
export default router
