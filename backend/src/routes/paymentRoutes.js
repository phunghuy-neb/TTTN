import { Router, urlencoded } from 'express'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'
import {
  postInitiatePayment,
  vnpayReturn,
  vnpayIpn,
  momoReturn,
  momoIpn,
  momoDemoPage,
  postMomoDemoResult,
  getReviewRequiredPayments,
  getPaymentConfig,
} from '../controllers/paymentController.js'

const router = Router()

router.get('/config', getPaymentConfig)

// Callback/IPN công khai nhưng dữ liệu chỉ được chấp nhận sau khi kiểm tra HMAC.
router.get('/vnpay/return', vnpayReturn)
router.get('/vnpay/ipn', vnpayIpn)
router.get('/momo/return', momoReturn)
router.post('/momo/ipn', momoIpn)
router.get('/momo/demo/:orderId', momoDemoPage)
router.post('/momo/demo/:orderId', urlencoded({ extended: false, limit: '2kb' }), postMomoDemoResult)

router.get('/review-required', protect, requireAdmin, getReviewRequiredPayments)
router.post('/:bookingId/initiate', protect, postInitiatePayment)

export default router
