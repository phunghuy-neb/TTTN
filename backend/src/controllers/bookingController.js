// ============================================================
//  src/controllers/bookingController.js
//  Xử lý đặt tour, tính giá tiền, quản lý đơn
// ============================================================
import Booking from '../models/Booking.js'
import Tour from '../models/Tour.js'
import PaymentAttempt from '../models/PaymentAttempt.js'
import mongoose from 'mongoose'
import { createNotification } from '../services/notificationService.js'
import { ensureTicketForBooking } from '../services/ticketService.js'
import { createVoucherUsage, releaseVoucherForBooking, reserveVoucher, useVoucherForBooking } from '../services/voucherService.js'

// ── Helper: Format booking trả về client ─────────────────────
const formatBooking = (b) => ({
  _id: b._id,
  bookingCode: b.bookingCode,
  user: b.user,
  tour: b.tour,
  tourName: b.tourName,
  unitPrice: b.unitPrice,
  originalPrice: b.originalPrice || b.unitPrice * b.guests,
  discountAmount: b.discountAmount || 0,
  voucher: b.voucher || null,
  departureId: b.departureId,
  departureDate: b.departureDate,
  guests: b.guests,
  totalPrice: b.totalPrice,
  contact: b.contact,
  status: b.status,
  paymentMethod: b.paymentMethod,
  txnRef: b.txnRef,
  paidAt: b.paidAt,
  paymentExpiresAt: b.paymentExpiresAt,
  reviewed: b.reviewed,
  note: b.note,
  statusHistory: b.statusHistory || [],
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
})

const formatPaymentAttempt = (attempt) => attempt ? ({
  _id: attempt._id,
  provider: attempt.provider,
  status: attempt.status,
  amount: attempt.amount,
  responseCode: attempt.responseCode || '',
  processedAt: attempt.processedAt,
  expiresAt: attempt.expiresAt,
  createdAt: attempt.createdAt,
  updatedAt: attempt.updatedAt,
}) : null

async function getPaymentMetadata(bookingIds) {
  if (!bookingIds.length) return { latestByBooking: new Map(), reviewSet: new Set() }
  const attempts = await PaymentAttempt.find({ booking: { $in: bookingIds } })
    .sort({ createdAt: -1 })
    .select('booking provider status amount responseCode processedAt expiresAt createdAt updatedAt')
    .lean()
  const latestByBooking = new Map()
  const reviewSet = new Set()
  for (const attempt of attempts) {
    const bookingId = String(attempt.booking)
    if (!latestByBooking.has(bookingId)) latestByBooking.set(bookingId, formatPaymentAttempt(attempt))
    if (attempt.status === 'review_required') reviewSet.add(bookingId)
  }
  return { latestByBooking, reviewSet }
}

// Trạng thái đơn còn giữ chỗ — dùng cho cả kiểm trùng lẫn thống kê
const TRANG_THAI_GIU_CHO = ['pending_payment', 'paid', 'completed']

const PHUONG_THUC_HOP_LE = ['vnpay', 'momo', 'later']

function laySoPhutGiuCho(paymentMethod) {
  const tenBien = paymentMethod === 'later' ? 'LATER_HOLD_MINUTES' : 'BOOKING_HOLD_MINUTES'
  const macDinh = paymentMethod === 'later' ? 24 * 60 : 30
  const giaTri = Number(process.env[tenBien])
  return Number.isFinite(giaTri) && giaTri > 0 ? Math.floor(giaTri) : macDinh
}

// Máy trạng thái đơn (Batch 4) — NGHIÊM NGẶT, không cho nhảy tùy ý.
// completed/cancelled là trạng thái cuối, không đổi được nữa.
const CHUYEN_TRANG_THAI = {
  pending_payment: ['paid', 'cancelled'],
  // Đơn đã thu tiền không được hủy bằng một cú đổi trạng thái vì như vậy không
  // hoàn tiền tại cổng thanh toán. Hoàn tiền cần một luồng refund/đối soát riêng.
  paid: ['completed'],
  completed: [],
  cancelled: [],
}

// Hoàn chỗ về đúng đợt theo departureId — dùng chung cho user hủy lẫn admin hủy.
// Đơn mồ côi (departureId null) → bỏ qua + ghi log, tuyệt đối không đoán theo ngày.
async function hoanChoTheoDot(booking, nhan, session = null) {
  if (!booking.departureId) {
    console.error(
      `[${nhan}] Đơn`,
      booking.bookingCode,
      'không có departureId (xem C:\\TTTN\\orphan-bookings.json) — bỏ qua hoàn chỗ.'
    )
    return
  }
  const ketQua = await Tour.updateOne(
    { _id: booking.tour, 'departures._id': booking.departureId },
    { $inc: { 'departures.$.availableSlots': booking.guests } },
    { session }
  )
  if (ketQua.modifiedCount === 0) {
    throw new Error(`[${nhan}] Không hoàn được chỗ cho đơn ${booking.bookingCode}`)
  }
}

// ============================================================
//  @route   POST /api/bookings
//  @desc    Tạo đơn đặt tour — tính tổng tiền tự động
//  @access  Private (User đã đăng nhập)
// ============================================================
export const createBooking = async (req, res) => {
  try {
    const { tourId, departureId, guests, contact, paymentMethod = 'later', note, idempotencyKey, voucherCode } = req.body

    // 1. Validate đầu vào cơ bản — đợt khởi hành định danh bằng departureId
    // (departures._id trong Tour), không còn nhận/khớp chuỗi ngày.
    if (!tourId || !departureId || !guests || !contact || !idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ: tourId, departureId, guests, contact, idempotencyKey.',
        code: 'VALIDATION_ERROR',
      })
    }
    if (!mongoose.isValidObjectId(tourId) || !mongoose.isValidObjectId(departureId)) {
      return res.status(400).json({ success: false, message: 'Mã tour hoặc đợt khởi hành không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(String(idempotencyKey))) {
      return res.status(400).json({ success: false, message: 'idempotencyKey không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    if (!PHUONG_THUC_HOP_LE.includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Phương thức thanh toán không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    if (!contact.name || !contact.phone || !contact.email) {
      return res.status(400).json({
        success: false,
        message: 'Thông tin liên hệ cần có: họ tên, số điện thoại, email.',
      })
    }
    const contactDaChuanHoa = {
      name: String(contact.name).trim(),
      phone: String(contact.phone).trim(),
      email: String(contact.email).trim().toLowerCase(),
    }
    if (contactDaChuanHoa.name.length > 100 || !/^0\d{9}$/.test(contactDaChuanHoa.phone) || !/^\S+@\S+\.\S+$/.test(contactDaChuanHoa.email)) {
      return res.status(400).json({ success: false, message: 'Thông tin liên hệ không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    if (String(note || '').length > 1000) {
      return res.status(400).json({ success: false, message: 'Ghi chú tối đa 1000 ký tự.', code: 'VALIDATION_ERROR' })
    }
    if (voucherCode && !/^[A-Za-z0-9_-]{3,30}$/.test(String(voucherCode).trim())) {
      return res.status(400).json({ success: false, message: 'Mã voucher không hợp lệ.', code: 'VALIDATION_ERROR' })
    }

    const guestCount = Number(guests)
    if (!Number.isInteger(guestCount) || guestCount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Số lượng khách phải là số nguyên lớn hơn 0.',
      })
    }

    // Idempotency do client tạo một lần cho mỗi ý định đặt tour và giữ nguyên khi
    // retry. Không phụ thuộc cửa sổ thời gian và không gộp nhầm hai đơn hợp lệ.
    const idemKey = `${req.user._id}:${idempotencyKey}`
    const donVuaTao = await Booking.findOne({ idemKey })

    if (donVuaTao) {
      return res.status(200).json({
        success: true,
        message: `Đặt tour thành công! Mã đơn: ${donVuaTao.bookingCode}`,
        booking: formatBooking(donVuaTao),
        duplicate: true, // để FE/log biết đây là lần gửi lặp, không phải đơn mới
      })
    }

    let booking
    let duplicate = false
    try {
      await mongoose.connection.transaction(async (session) => {
        const daCo = await Booking.findOne({ idemKey }).session(session)
        if (daCo) {
          booking = daCo
          duplicate = true
          return
        }

        const tour = await Tour.findOne({ _id: tourId, status: 'published', isActive: { $ne: false } }).session(session)
        if (!tour) throw Object.assign(new Error('Tour không tồn tại hoặc đã ngưng hoạt động.'), { statusCode: 404, code: 'TOUR_UNAVAILABLE' })

        const departure = tour.departures.id(departureId)
        if (!departure) throw Object.assign(new Error('Không tìm thấy đợt khởi hành đã chọn. Vui lòng tải lại trang.'), { statusCode: 400, code: 'DEPARTURE_NOT_FOUND' })
        if (new Date(departure.date) <= new Date()) throw Object.assign(new Error('Đợt khởi hành này đã qua. Vui lòng chọn đợt khác.'), { statusCode: 400, code: 'DEPARTURE_PAST' })

        const ketQuaTruCho = await Tour.updateOne(
          {
            _id: tour._id,
            status: 'published',
            isActive: { $ne: false },
            departures: { $elemMatch: { _id: departure._id, availableSlots: { $gte: guestCount } } },
          },
          { $inc: { 'departures.$.availableSlots': -guestCount } },
          { session }
        )
        if (ketQuaTruCho.modifiedCount !== 1) throw Object.assign(new Error(`Đợt khởi hành không còn đủ ${guestCount} chỗ. Vui lòng giảm số khách hoặc chọn đợt khác.`), { statusCode: 409, code: 'SLOT_UNAVAILABLE' })

        const unitPrice = departure.price
        const originalPrice = unitPrice * guestCount
        const reservation = voucherCode
          ? await reserveVoucher({ code: voucherCode, userId: req.user._id, originalPrice, session })
          : null
        const [donMoi] = await Booking.create([{
          user: req.user._id,
          tour: tour._id,
          tourName: tour.name,
          unitPrice,
          departureId: departure._id,
          departureDate: departure.date,
          guests: guestCount,
          originalPrice,
          discountAmount: reservation?.discountAmount || 0,
          voucher: reservation?.snapshot || null,
          totalPrice: reservation?.totalPrice ?? originalPrice,
          contact: contactDaChuanHoa,
          paymentMethod,
          paymentExpiresAt: new Date(Date.now() + laySoPhutGiuCho(paymentMethod) * 60_000),
          note: String(note || '').trim(),
          status: 'pending_payment',
          statusHistory: [{
            from: 'created',
            to: 'pending_payment',
            byUserId: req.user._id,
            source: 'customer',
            reason: 'Khách hàng tạo đơn đặt tour',
            at: new Date(),
          }],
          idemKey,
        }], { session })
        await createVoucherUsage({ reservation, booking: donMoi, userId: req.user._id, session })
        booking = donMoi
        await createNotification({
          user: req.user._id,
          type: 'booking',
          title: 'Đặt tour thành công',
          message: `Đơn ${donMoi.bookingCode} đã được tạo và đang giữ ${guestCount} chỗ.`,
          link: `/bookings/${donMoi._id}`,
          uniqueKey: `booking-created:${donMoi._id}`,
        }, session)
      })
    } catch (err) {
      // Request song song cùng idempotencyKey: transaction thua bị rollback cả
      // phần trừ chỗ, sau đó trả lại đúng đơn đã thắng.
      if (err.code === 11000) {
        booking = await Booking.findOne({ idemKey })
        if (booking) {
          return res.status(200).json({ success: true, message: `Đặt tour thành công! Mã đơn: ${booking.bookingCode}`, booking: formatBooking(booking), duplicate: true })
        }
      }
      throw err
    }

    res.status(duplicate ? 200 : 201).json({
      success: true,
      message: `Đặt tour thành công! Mã đơn: ${booking.bookingCode}`,
      booking: formatBooking(booking),
      ...(duplicate ? { duplicate: true } : {}),
    })
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code || 'BOOKING_ERROR' })
    }
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message)[0]
      return res.status(400).json({ success: false, message: msg })
    }
    console.error('[createBooking]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   GET /api/bookings/my
//  @desc    Xem lịch sử đặt tour của user đang đăng nhập
//  @access  Private (User)
// ============================================================
export const getMyBookings = async (req, res) => {
  try {
    const {
      status,
      page = 1,
      limit = 10,
    } = req.query

    const filter = { user: req.user._id }

    // Chặn giá trị status lạ — trả 400 thay vì âm thầm trả danh sách rỗng
    const TRANG_THAI_HOP_LE = ['pending_payment', 'paid', 'cancelled', 'completed']
    if (status) {
      if (!TRANG_THAI_HOP_LE.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Trạng thái "${status}" không hợp lệ.`,
        })
      }
      filter.status = status
    }

    const pageNum = Math.max(1, Number(page))
    const limitNum = Math.min(50, Math.max(1, Number(limit)))
    const skip = (pageNum - 1) * limitNum

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort('-createdAt')
        .skip(skip)
        .limit(limitNum)
        .populate('tour', 'images slug location days'),
      Booking.countDocuments(filter),
    ])
    const { latestByBooking, reviewSet } = await getPaymentMetadata(bookings.map((booking) => booking._id))

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      bookings: bookings.map((booking) => ({
        ...formatBooking(booking),
        paymentReviewRequired: reviewSet.has(String(booking._id)),
        lastPaymentAttempt: latestByBooking.get(String(booking._id)) || null,
      })),
    })
  } catch (error) {
    console.error('[getMyBookings]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   GET /api/bookings/:id
//  @desc    Xem chi tiết 1 đơn (chỉ chủ đơn hoặc admin)
//  @access  Private
// ============================================================
export const getBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('tour', 'name images slug location days summary itinerary highlights')

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt.' })
    }

    // Chỉ chủ đơn hoặc admin mới xem được
    if (
      booking.user._id.toString() !== req.user._id.toString() &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền xem đơn này.' })
    }

    const { latestByBooking, reviewSet } = await getPaymentMetadata([booking._id])
    res.json({
      success: true,
      booking: {
        ...formatBooking(booking),
        paymentReviewRequired: reviewSet.has(String(booking._id)),
        lastPaymentAttempt: latestByBooking.get(String(booking._id)) || null,
      },
    })
  } catch (error) {
    console.error('[getBooking]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// Tra cứu bằng bookingCode cho trang trở về từ cổng thanh toán. Vẫn yêu cầu JWT
// và chỉ chủ đơn/admin được xem nên mã đơn không trở thành khóa truy cập bí mật.
export const getBookingByCode = async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingCode: req.params.code })
      .populate('user', 'name email phone')
      .populate('tour', 'name images slug location days summary itinerary highlights')
    if (!booking) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt.', code: 'NOT_FOUND' })
    if (booking.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền xem đơn này.', code: 'FORBIDDEN' })
    }
    const { latestByBooking, reviewSet } = await getPaymentMetadata([booking._id])
    res.json({
      success: true,
      booking: {
        ...formatBooking(booking),
        paymentReviewRequired: reviewSet.has(String(booking._id)),
        lastPaymentAttempt: latestByBooking.get(String(booking._id)) || null,
      },
    })
  } catch (error) {
    console.error('[getBookingByCode]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   PATCH /api/bookings/:id/cancel
//  @desc    Hủy đơn đặt (chỉ chủ đơn, chỉ khi pending_payment)
//  @access  Private (User)
// ============================================================
export const cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt.' })
    }

    // Chỉ chủ đơn mới được hủy
    if (booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền hủy đơn này.' })
    }

    // Chỉ hủy được khi trạng thái là pending_payment
    if (booking.status !== 'pending_payment') {
      return res.status(400).json({
        success: false,
        message: `Không thể hủy đơn ở trạng thái "${booking.status}". Chỉ hủy được khi chưa thanh toán.`,
      })
    }

    let daHuy
    await mongoose.connection.transaction(async (session) => {
      daHuy = await Booking.findOneAndUpdate(
        { _id: booking._id, user: req.user._id, status: 'pending_payment' },
        {
          $set: { status: 'cancelled' },
          $push: {
            statusHistory: { from: 'pending_payment', to: 'cancelled', byUserId: req.user._id, source: 'customer', reason: 'Khách hàng tự hủy', at: new Date() },
          },
        },
        { new: true, session }
      )

      if (!daHuy) throw Object.assign(new Error('Đơn này đã được xử lý bởi một thao tác khác. Vui lòng tải lại trang.'), { code: 'BOOKING_CHANGED' })
      await hoanChoTheoDot(daHuy, 'cancelBooking', session)
      await releaseVoucherForBooking(daHuy._id, session)
      await PaymentAttempt.updateMany(
        { booking: daHuy._id, active: true },
        { $set: { active: false, status: 'expired', processedAt: new Date(), responseCode: 'BOOKING_CANCELLED' } },
        { session }
      )
      await createNotification({
        user: req.user._id,
        type: 'booking',
        title: 'Đơn đặt tour đã hủy',
        message: `Đơn ${daHuy.bookingCode} đã được hủy và chỗ đã được hoàn lại.`,
        link: `/bookings/${daHuy._id}`,
        uniqueKey: `booking-cancelled:${daHuy._id}`,
      }, session)
    })

    if (!daHuy) {
      return res.status(400).json({
        success: false,
        message: 'Đơn này đã được xử lý bởi một thao tác khác. Vui lòng tải lại trang.',
      })
    }

    res.json({
      success: true,
      message: `Đơn ${daHuy.bookingCode} đã được hủy thành công.`,
      booking: formatBooking(daHuy),
    })
  } catch (error) {
    if (error.code === 'BOOKING_CHANGED') {
      return res.status(409).json({ success: false, message: error.message, code: error.code })
    }
    console.error('[cancelBooking]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   GET /api/admin/bookings
//  @desc    Admin xem toàn bộ danh sách đơn (filter, phân trang)
//  @access  Private — Admin
// ============================================================
export const getAllBookings = async (req, res) => {
  try {
    const {
      status,
      tourId,
      userId,
      search,
      dateFrom,
      dateTo,
      sort = '-createdAt',
      page = 1,
      limit = 20,
    } = req.query

    const filter = {}
    if (status) filter.status = status
    if (tourId) filter.tour = tourId
    if (userId) filter.user = userId
    // Khoảng ngày ĐẶT đơn (createdAt) — đầu ngày from → cuối ngày to
    if (dateFrom || dateTo) {
      filter.createdAt = {}
      if (dateFrom) {
        const tu = new Date(dateFrom)
        tu.setHours(0, 0, 0, 0)
        filter.createdAt.$gte = tu
      }
      if (dateTo) {
        const den = new Date(dateTo)
        den.setHours(23, 59, 59, 999)
        filter.createdAt.$lte = den
      }
    }
    if (search) {
      filter.$or = [
        { bookingCode: { $regex: search, $options: 'i' } },
        { tourName: { $regex: search, $options: 'i' } },
        { 'contact.name': { $regex: search, $options: 'i' } },
        { 'contact.email': { $regex: search, $options: 'i' } },
        { 'contact.phone': { $regex: search, $options: 'i' } },
      ]
    }

    const pageNum = Math.max(1, Number(page))
    const limitNum = Math.min(100, Math.max(1, Number(limit)))
    const skip = (pageNum - 1) * limitNum

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .populate('user', 'name email')
        .populate('tour', 'name slug images'),
      Booking.countDocuments(filter),
    ])

    const reviewAttempts = await PaymentAttempt.find({
      booking: { $in: bookings.map((booking) => booking._id) },
      status: 'review_required',
    }).distinct('booking')
    const reviewSet = new Set(reviewAttempts.map(String))

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      bookings: bookings.map((booking) => ({
        ...formatBooking(booking),
        paymentReviewRequired: reviewSet.has(String(booking._id)),
      })),
    })
  } catch (error) {
    console.error('[getAllBookings]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   GET /api/admin/bookings/:id
//  @desc    Admin xem chi tiết đầy đủ 1 đơn (kèm statusHistory)
//  @access  Private — Admin
// ============================================================
export const getAdminBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('tour', 'name slug images location days')
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt.', code: 'NOT_FOUND' })
    }
    const paymentReviewRequired = await PaymentAttempt.exists({ booking: booking._id, status: 'review_required' })
    res.json({ success: true, booking: { ...formatBooking(booking), paymentReviewRequired: !!paymentReviewRequired } })
  } catch (error) {
    console.error('[getAdminBooking]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   PATCH /api/admin/bookings/:id/status
//  @desc    Admin đổi trạng thái đơn theo máy trạng thái NGHIÊM NGẶT:
//             pending_payment → paid | cancelled
//             paid            → completed
//             completed / cancelled → trạng thái cuối, không đổi được
//           Sai luồng → 409 INVALID_STATUS_TRANSITION.
//           Chuyển sang cancelled → hoàn chỗ nguyên tử theo departureId.
//  @access  Private — Admin
// ============================================================
export const updateBookingStatus = async (req, res) => {
  try {
    const { status, txnRef } = req.body

    if (!status || !(status in CHUYEN_TRANG_THAI)) {
      return res.status(400).json({
        success: false,
        message: `Trạng thái không hợp lệ. Chọn một trong: ${Object.keys(CHUYEN_TRANG_THAI).join(', ')}.`,
        code: 'VALIDATION_ERROR',
      })
    }

    const booking = await Booking.findById(req.params.id)
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt.', code: 'NOT_FOUND' })
    }

    // Máy trạng thái — chặn nhảy tùy ý (kể cả gọi thẳng API không qua UI)
    if (!CHUYEN_TRANG_THAI[booking.status].includes(status)) {
      return res.status(409).json({
        success: false,
        message: `Không thể chuyển đơn từ "${booking.status}" sang "${status}". Các bước hợp lệ: ${
          CHUYEN_TRANG_THAI[booking.status].join(', ') || 'không còn (trạng thái cuối)'
        }.`,
        code: 'INVALID_STATUS_TRANSITION',
        currentStatus: booking.status,
      })
    }

    if (status === 'paid' && ['vnpay', 'momo'].includes(booking.paymentMethod)) {
      return res.status(409).json({
        success: false,
        message: 'Đơn thanh toán online chỉ được xác nhận bởi callback đã kiểm tra chữ ký từ cổng thanh toán.',
        code: 'PAYMENT_CALLBACK_REQUIRED',
      })
    }
    if (txnRef !== undefined && (typeof txnRef !== 'string' || txnRef.trim().length > 100)) {
      return res.status(400).json({ success: false, message: 'Mã giao dịch không hợp lệ.', code: 'VALIDATION_ERROR' })
    }

    // Flip trạng thái CÓ ĐIỀU KIỆN: chỉ request khớp đúng trạng thái cũ mới thắng —
    // hai admin bấm đồng thời thì người sau nhận 409, không có chuyện hoàn chỗ hai lần.
    let daDoi
    await mongoose.connection.transaction(async (session) => {
      const capNhat = {
        $set: { status },
        $push: {
          statusHistory: { from: booking.status, to: status, byUserId: req.user._id, source: 'admin', reason: 'Admin cập nhật trạng thái', at: new Date() },
        },
      }
      if (status === 'paid') {
        capNhat.$set.paidAt = new Date()
        if (txnRef?.trim()) capNhat.$set.txnRef = txnRef.trim()
      }

      daDoi = await Booking.findOneAndUpdate(
        { _id: booking._id, status: booking.status },
        capNhat,
        { new: true, session }
      )
      if (!daDoi) throw Object.assign(new Error('Đơn vừa được xử lý bởi một thao tác khác. Vui lòng tải lại trang.'), { code: 'INVALID_STATUS_TRANSITION' })

      if (status === 'cancelled') {
        await hoanChoTheoDot(daDoi, 'updateBookingStatus', session)
        await releaseVoucherForBooking(daDoi._id, session)
        await PaymentAttempt.updateMany(
          { booking: daDoi._id, active: true },
          { $set: { active: false, status: 'expired', processedAt: new Date(), responseCode: 'BOOKING_CANCELLED' } },
          { session }
        )
      }

      const noiDung = status === 'paid'
        ? { type: 'payment', title: 'Đã xác nhận thanh toán', message: `Đơn ${daDoi.bookingCode} đã được xác nhận thanh toán.` }
        : status === 'completed'
          ? { type: 'trip', title: 'Tour đã hoàn thành', message: `Chuyến đi của đơn ${daDoi.bookingCode} đã hoàn thành. Bạn có thể gửi đánh giá ngay.` }
          : { type: 'booking', title: 'Đơn đặt tour đã hủy', message: `Đơn ${daDoi.bookingCode} đã được quản trị viên hủy.` }
      await createNotification({
        user: daDoi.user,
        ...noiDung,
        link: `/bookings/${daDoi._id}`,
        uniqueKey: `booking-status:${daDoi._id}:${status}`,
      }, session)
      if (status === 'paid') await ensureTicketForBooking(daDoi, session)
      if (status === 'paid') await useVoucherForBooking(daDoi._id, session)
    })

    res.json({
      success: true,
      message: `Cập nhật trạng thái đơn ${daDoi.bookingCode} thành "${status}" thành công.`,
      booking: formatBooking(daDoi),
    })
  } catch (error) {
    if (error.code === 'INVALID_STATUS_TRANSITION') {
      return res.status(409).json({ success: false, message: error.message, code: error.code })
    }
    console.error('[updateBookingStatus]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   GET /api/admin/bookings/stats
//  @desc    Thống kê tổng quan cho Admin Dashboard
//  @access  Private — Admin
// ============================================================
export const getBookingStats = async (req, res) => {
  try {
    // Đếm số đơn theo từng trạng thái
    const statusCounts = await Booking.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])

    // Tổng doanh thu: paid và completed đều là tiền đã thu.
    const revenueResult = await Booking.aggregate([
      { $match: { status: { $in: ['paid', 'completed'] } } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } },
    ])
    const totalRevenue = revenueResult[0]?.total || 0

    // Doanh thu theo tháng (6 tháng gần nhất)
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
    sixMonthsAgo.setDate(1)
    sixMonthsAgo.setHours(0, 0, 0, 0)

    const monthlyRevenue = await Booking.aggregate([
      { $match: { status: { $in: ['paid', 'completed'] }, createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          revenue: { $sum: '$totalPrice' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ])

    // Tổng số booking
    const totalBookings = await Booking.countDocuments()

    // Số booking đang chờ xử lý
    const pendingCount = await Booking.countDocuments({ status: 'pending_payment' })

    const statusMap = {}
    statusCounts.forEach((s) => { statusMap[s._id] = s.count })

    res.json({
      success: true,
      stats: {
        totalBookings,
        pendingCount,
        totalRevenue,
        byStatus: statusMap,
        monthlyRevenue,
      },
    })
  } catch (error) {
    console.error('[getBookingStats]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}
