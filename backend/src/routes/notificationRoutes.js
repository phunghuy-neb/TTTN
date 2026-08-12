import { Router } from 'express'
import { protect } from '../middleware/auth.js'
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '../controllers/notificationController.js'

const router = Router()
router.use(protect)
router.get('/', getNotifications)
router.patch('/read-all', markAllNotificationsRead)
router.patch('/:id/read', markNotificationRead)

export default router
