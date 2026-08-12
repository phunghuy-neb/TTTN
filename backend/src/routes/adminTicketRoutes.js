import { Router } from 'express'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'
import { getAdminTickets, updateTicketStatus } from '../controllers/adminTicketController.js'

const router = Router()
router.use(protect)
router.use(requireAdmin)
router.get('/', getAdminTickets)
router.patch('/:id/status', updateTicketStatus)

export default router
