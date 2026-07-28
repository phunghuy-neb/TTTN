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
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
})

// ============================================================
//  @route   POST /api/bookings
//  @desc    Tạo đơn đặt tour — tính tổng tiền tự động
//  @access  Private (User đã đăng nhập)
// ============================================================
export const createBooking = async (req, res) => {
  try {
    const { tourId, departureDate, guests, contact, paymentMethod, note } = req.body

    // 1. Validate đầu vào cơ bản
    if (!tourId || !departureDate || !guests || !contact) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ: tourId, departureDate, guests, contact.',
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

    // 3. Tìm đúng đợt khởi hành theo ngày
    const depDate = new Date(departureDate)
    const departure = tour.departures.find((d) => {
      const dDate = new Date(d.date)
      return dDate.toDateString() === depDate.toDateString()
    })

    if (!departure) {
      return res.status(400).json({
        success: false,
        message: 'Không tìm thấy đợt khởi hành vào ngày đã chọn.',
      })
    }

    // Không cho đặt đợt đã khởi hành
    if (new Date(departure.date) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Đợt khởi hành này đã qua. Vui lòng chọn đợt khác.',
      })
    }

    // 4. Kiểm tra đủ chỗ trống
    if (departure.availableSlots < guestCount) {
      return res.status(400).json({
        success: false,
        message: `Đợt khởi hành chỉ còn ${departure.availableSlots} chỗ. Vui lòng giảm số khách hoặc chọn đợt khác.`,
      })
    }

    // 5. Tính giá tiền: unitPrice lấy từ đợt khởi hành cụ thể
    const unitPrice = departure.price
    const totalPrice = unitPrice * guestCount

    // 6. Trừ chỗ TRƯỚC khi tạo đơn, bằng một cập nhật nguyên tử có điều kiện.
    // Điều kiện $gte nằm ngay trong query nên hai request đồng thời không thể
    // cùng trừ vào chỗ cuối — MongoDB chỉ cho một request khớp điều kiện.
    const ketQuaTruCho = await Tour.updateOne(
      {
        _id: tour._id,
        departures: {
          $elemMatch: { date: departure.date, availableSlots: { $gte: guestCount } },
        },
      },
      { $inc: { 'departures.$.availableSlots': -guestCount } }
    )

    if (ketQuaTruCho.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'Đợt khởi hành vừa hết chỗ. Vui lòng chọn đợt khác hoặc giảm số khách.',
      })
    }

    // 7. Tạo đơn đặt tour (snapshot tourName và unitPrice)
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
            departureDate: depDate,
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
      // Tạo đơn hỏng thì phải trả chỗ lại, nếu không số chỗ bị hụt vĩnh viễn
      await Tour.updateOne(
        { _id: tour._id, 'departures.date': departure.date },
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
      { $set: { status: 'cancelled' } },
      { new: true }
    )

    if (!daHuy) {
      return res.status(400).json({
        success: false,
        message: 'Đơn này đã được xử lý bởi một thao tác khác. Vui lòng tải lại trang.',
      })
    }

    // Hoàn lại số chỗ trống vào đợt khởi hành. So khớp theo NGÀY thay vì theo
    // mốc thời gian tuyệt đối, tránh trượt khi giờ/phút/giây lệch nhau giữa
    // lúc tạo đơn và lúc hủy.
    const dauNgay = new Date(daHuy.departureDate)
    dauNgay.setHours(0, 0, 0, 0)
    const cuoiNgay = new Date(daHuy.departureDate)
    cuoiNgay.setHours(23, 59, 59, 999)

    const ketQuaHoan = await Tour.updateOne(
      {
        _id: daHuy.tour,
        departures: { $elemMatch: { date: { $gte: dauNgay, $lte: cuoiNgay } } },
      },
      { $inc: { 'departures.$.availableSlots': daHuy.guests } }
    )

    if (ketQuaHoan.modifiedCount === 0) {
      console.error('[cancelBooking] Không hoàn được chỗ cho đơn', daHuy.bookingCode)
    }

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
      sort = '-createdAt',
      page = 1,
      limit = 20,
    } = req.query

    const filter = {}
    if (status) filter.status = status
    if (tourId) filter.tour = tourId
    if (userId) filter.user = userId
    if (search) {
      filter.$or = [
        { bookingCode: { $regex: search, $options: 'i' } },
        { tourName: { $regex: search, $options: 'i' } },
        { 'contact.name': { $regex: search, $options: 'i' } },
        { 'contact.email': { $regex: search, $options: 'i' } },
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
//  @route   PATCH /api/admin/bookings/:id/status
//  @desc    Admin cập nhật trạng thái đơn (paid / completed / cancelled)
//  @access  Private — Admin
// ============================================================
export const updateBookingStatus = async (req, res) => {
  try {
    const { status, txnRef, paymentMethod } = req.body

    const allowedStatuses = ['pending_payment', 'paid', 'cancelled', 'completed']
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Trạng thái không hợp lệ. Chọn một trong: ${allowedStatuses.join(', ')}.`,
      })
    }

    const booking = await Booking.findById(req.params.id)
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt.' })
    }

    const prevStatus = booking.status
    booking.status = status

    // Nếu đổi sang paid → ghi nhận thời điểm và phương thức thanh toán
    if (status === 'paid' && prevStatus !== 'paid') {
      booking.paidAt = new Date()
      if (paymentMethod) booking.paymentMethod = paymentMethod
      if (txnRef) booking.txnRef = txnRef
    }

    // Nếu Admin hủy một đơn đang pending → hoàn lại chỗ trống.
    // So khớp theo NGÀY như cancelBooking, tránh trượt khi giờ/phút/giây lệch.
    if (status === 'cancelled' && prevStatus === 'pending_payment') {
      const dauNgay = new Date(booking.departureDate)
      dauNgay.setHours(0, 0, 0, 0)
      const cuoiNgay = new Date(booking.departureDate)
      cuoiNgay.setHours(23, 59, 59, 999)

      await Tour.updateOne(
        {
          _id: booking.tour,
          departures: { $elemMatch: { date: { $gte: dauNgay, $lte: cuoiNgay } } },
        },
        { $inc: { 'departures.$.availableSlots': booking.guests } }
      )
    }

    await booking.save()

    res.json({
      success: true,
      message: `Cập nhật trạng thái đơn ${booking.bookingCode} thành "${status}" thành công.`,
      booking: formatBooking(booking),
    })
  } catch (error) {
    console.error('[updateBookingStatus]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
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
