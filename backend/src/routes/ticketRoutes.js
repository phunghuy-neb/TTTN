import { Router } from 'express'
import { protect } from '../middleware/auth.js'
import { downloadTicketPdf, getTicketByBooking, verifyTicket, verifyTicketPage } from '../controllers/ticketController.js'

const router = Router()
router.get('/verify/:token', verifyTicket)
router.get('/verify-page/:token', verifyTicketPage)
router.get('/booking/:bookingId', protect, getTicketByBooking)
router.get('/booking/:bookingId/pdf', protect, downloadTicketPdf)

export default router
