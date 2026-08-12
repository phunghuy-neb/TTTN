import { Router } from 'express'
import { getAdminReviews, updateReviewVisibility } from '../controllers/adminReviewController.js'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'

const router = Router()
router.use(protect)
router.use(requireAdmin)
router.get('/', getAdminReviews)
router.patch('/:tourId/:reviewId/visibility', updateReviewVisibility)

export default router
