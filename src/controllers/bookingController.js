// ============================================================
//  src/controllers/bookingController.js
//  Xử lý đặt tour, tính giá tiền, quản lý đơn
// ============================================================
import Booking from '../models/Booking.js'
import Tour from '../models/Tour.js'

// ── Helper: Format booking trả về client ─────────────────────
const formatBooking = (b) => ({
  _id: b._id,
  bookingCode: b.bookingCode,
  user: b.user,
  tour: b.tour,
  tourName: b.tourName,
  unitPrice: b.unitPrice,
  departureId: b.departureId,
  departureDate: b.departureDate,
  guests: b.guests,
  totalPrice: b.totalPrice,
  contact: b.contact,
  status: b.status,
  paymentMethod: b.paymentMethod,
  txnRef: b.txnRef,
  paidAt: b.paidAt,
  reviewed: b.reviewed,
  note: b.note,
  statusHistory: b.statusHistory || [],
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
})

// Máy trạng thái đơn (Batch 4) — NGHIÊM NGẶT, không cho nhảy tùy ý.
// completed/cancelled là trạng thái cuối, không đổi được nữa.
const CHUYEN_TRANG_THAI = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

// Hoàn chỗ về đúng đợt theo departureId — dùng chung cho user hủy lẫn admin hủy.
// Đơn mồ côi (departureId null) → bỏ qua + ghi log, tuyệt đối không đoán theo ngày.
async function hoanChoTheoDot(booking, nhan) {
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
    { $inc: { 'departures.$.availableSlots': booking.guests } }
  )
  if (ketQua.modifiedCount === 0) {
    console.error(`[${nhan}] Không hoàn được chỗ cho đơn`, booking.bookingCode)
  }
}

// ============================================================
//  @route   POST /api/bookings
//  @desc    Tạo đơn đặt tour — tính tổng tiền tự động
//  @access  Private (User đã đăng nhập)
// ============================================================
export const createBooking = async (req, res) => {
  try {
    const { tourId, departureId, guests, contact, paymentMethod, note } = req.body

    // 1. Validate đầu vào cơ bản — đợt khởi hành định danh bằng departureId
    // (departures._id trong Tour), không còn nhận/khớp chuỗi ngày.
    if (!tourId || !departureId || !guests || !contact) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ: tourId, departureId, guests, contact.',
        code: 'VALIDATION_ERROR',
      })
    }
    if (!contact.name || !contact.phone || !contact.email) {
      return res.status(400).json({
        success: false,
        message: 'Thông tin liên hệ cần có: họ tên, số điện thoại, email.',
      })
    }

    const guestCount = Number(guests)
    if (!Number.isInteger(guestCount) || guestCount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Số lượng khách phải là số nguyên lớn hơn 0.',
      })
    }

    // 2. Kiểm tra tour tồn tại và đang published
    const tour = await Tour.findById(tourId)
    if (!tour || tour.status !== 'published') {
      return res.status(404).json({
        success: false,
        message: 'Tour không tồn tại hoặc đã ngưng hoạt động.',
      })
    }

    // 3. Tìm đợt khởi hành theo _id — khóa ổn định, sống sót khi admin đổi ngày
    const departure = tour.departures.id(departureId)
    if (!departure) {
      return res.status(400).json({
        success: false,
        message: 'Không tìm thấy đợt khởi hành đã chọn. Vui lòng tải lại trang.',
        code: 'DEPARTURE_NOT_FOUND',
      })
    }

    // Không cho đặt đợt đã khởi hành
    if (new Date(departure.date) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Đợt khởi hành này đã qua. Vui lòng chọn đợt khác.',
        code: 'DEPARTURE_PAST',
      })
    }

    // 4. Tính giá tiền: unitPrice lấy từ đợt khởi hành cụ thể
    const unitPrice = departure.price
    const totalPrice = unitPrice * guestCount

    // 5. Trừ chỗ TRƯỚC khi tạo đơn, bằng một cập nhật nguyên tử theo departureId.
    // Điều kiện _id + $gte nằm trong CÙNG một $elemMatch nên hai request đồng thời
    // không thể cùng trừ vào chỗ cuối — MongoDB chỉ cho một request khớp điều kiện.
    const ketQuaTruCho = await Tour.findOneAndUpdate(
      {
        _id: tour._id,
        departures: {
          $elemMatch: { _id: departure._id, availableSlots: { $gte: guestCount } },
        },
      },
      { $inc: { 'departures.$.availableSlots': -guestCount } },
      { new: true }
    )

    if (!ketQuaTruCho) {
      return res.status(409).json({
        success: false,
        message: `Đợt khởi hành không còn đủ ${guestCount} chỗ. Vui lòng giảm số khách hoặc chọn đợt khác.`,
        code: 'SLOT_UNAVAILABLE',
      })
    }

    // 6. Tạo đơn đặt tour (snapshot tourName, unitPrice và departureDate để hiển thị)
    let booking
    try {
      // bookingCode sinh từ 7 số cuối timestamp + 4 ký tự ngẫu nhiên nên vẫn có
      // xác suất trùng rất nhỏ — gặp lỗi trùng khóa E11000 thì thử lại tối đa 3 lần
      for (let lanThu = 1; ; lanThu++) {
        try {
          booking = await Booking.create({
            user: req.user._id,
            tour: tour._id,
            tourName: tour.name,
            unitPrice,
            departureId: departure._id,
            departureDate: departure.date,
            guests: guestCount,
            totalPrice,
            contact,
            paymentMethod: paymentMethod || null,
            note: note || '',
            status: 'pending_payment',
          })
          break
        } catch (err) {
          if (err.code === 11000 && lanThu < 3) continue
          throw err
        }
      }
    } catch (err) {
      // Tạo đơn hỏng thì phải trả chỗ lại theo departureId, nếu không số chỗ bị hụt vĩnh viễn
      await Tour.updateOne(
        { _id: tour._id, 'departures._id': departure._id },
        { $inc: { 'departures.$.availableSlots': guestCount } }
      )
      throw err
    }

    res.status(201).json({
      success: true,
      message: `Đặt tour thành công! Mã đơn: ${booking.bookingCode}`,
      booking: formatBooking(booking),
    })
  } catch (error) {
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

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      bookings: bookings.map(formatBooking),
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
      .populate('tour', 'name images slug location days')

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

    res.json({ success: true, booking: formatBooking(booking) })
  } catch (error) {
    console.error('[getBooking]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
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

    // Đổi trạng thái bằng cập nhật có điều kiện: chỉ request đầu tiên khớp
    // status = pending_payment mới thành công, request thứ hai trả về null.
    const daHuy = await Booking.findOneAndUpdate(
      { _id: booking._id, status: 'pending_payment' },
      {
        $set: { status: 'cancelled' },
        $push: {
          statusHistory: { from: 'pending_payment', to: 'cancelled', byUserId: req.user._id, at: new Date() },
        },
      },
      { new: true }
    )

    if (!daHuy) {
      return res.status(400).json({
        success: false,
        message: 'Đơn này đã được xử lý bởi một thao tác khác. Vui lòng tải lại trang.',
      })
    }

    // Hoàn lại số chỗ trống theo departureId — khóa ổn định, không phụ thuộc ngày.
    // Chạy SAU cú flip trạng thái có điều kiện nên không thể hoàn hai lần.
    await hoanChoTheoDot(daHuy, 'cancelBooking')

    res.json({
      success: true,
      message: `Đơn ${daHuy.bookingCode} đã được hủy thành công.`,
      booking: formatBooking(daHuy),
    })
  } catch (error) {
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

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      bookings: bookings.map(formatBooking),
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
    res.json({ success: true, booking: formatBooking(booking) })
  } catch (error) {
    console.error('[getAdminBooking]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   PATCH /api/admin/bookings/:id/status
//  @desc    Admin đổi trạng thái đơn theo máy trạng thái NGHIÊM NGẶT:
//             pending_payment → paid | cancelled
//             paid            → completed | cancelled
//             completed / cancelled → trạng thái cuối, không đổi được
//           Sai luồng → 409 INVALID_STATUS_TRANSITION.
//           Chuyển sang cancelled → hoàn chỗ nguyên tử theo departureId.
//  @access  Private — Admin
// ============================================================
export const updateBookingStatus = async (req, res) => {
  try {
    const { status, txnRef, paymentMethod } = req.body

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

    // Flip trạng thái CÓ ĐIỀU KIỆN: chỉ request khớp đúng trạng thái cũ mới thắng —
    // hai admin bấm đồng thời thì người sau nhận 409, không có chuyện hoàn chỗ hai lần.
    const capNhat = {
      $set: { status },
      $push: {
        statusHistory: { from: booking.status, to: status, byUserId: req.user._id, at: new Date() },
      },
    }
    if (status === 'paid') {
      capNhat.$set.paidAt = new Date()
      if (paymentMethod) capNhat.$set.paymentMethod = paymentMethod
      if (txnRef) capNhat.$set.txnRef = txnRef
    }

    const daDoi = await Booking.findOneAndUpdate(
      { _id: booking._id, status: booking.status },
      capNhat,
      { new: true }
    )
    if (!daDoi) {
      return res.status(409).json({
        success: false,
        message: 'Đơn vừa được xử lý bởi một thao tác khác. Vui lòng tải lại trang.',
        code: 'INVALID_STATUS_TRANSITION',
      })
    }

    // Chuyển sang cancelled từ pending/paid (các trạng thái đang giữ chỗ)
    // → hoàn chỗ nguyên tử theo departureId; đơn mồ côi chỉ ghi log.
    if (status === 'cancelled') {
      await hoanChoTheoDot(daDoi, 'updateBookingStatus')
    }

    res.json({
      success: true,
      message: `Cập nhật trạng thái đơn ${daDoi.bookingCode} thành "${status}" thành công.`,
      booking: formatBooking(daDoi),
    })
  } catch (error) {
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

    // Tổng doanh thu (chỉ tính đơn đã paid)
    const revenueResult = await Booking.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } },
    ])
    const totalRevenue = revenueResult[0]?.total || 0

    // Doanh thu theo tháng (6 tháng gần nhất)
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
    sixMonthsAgo.setDate(1)
    sixMonthsAgo.setHours(0, 0, 0, 0)

    const monthlyRevenue = await Booking.aggregate([
      { $match: { status: 'paid', createdAt: { $gte: sixMonthsAgo } } },
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
