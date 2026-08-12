// ============================================================
//  src/controllers/adminController.js
//  Số liệu tổng quan cho Admin Dashboard
// ============================================================
import Tour from '../models/Tour.js'
import User from '../models/User.js'
import Booking from '../models/Booking.js'
import PaymentAttempt from '../models/PaymentAttempt.js'

// Trạng thái đơn tính doanh thu — tiền đã thực thu
const TRANG_THAI_DOANH_THU = ['paid', 'completed']

// Khớp enum region trong Tour model — miền không có doanh thu vẫn phải trả
// revenue 0 để pie chart FE luôn đủ 3 phần
const CAC_MIEN = ['Miền Bắc', 'Miền Trung', 'Miền Nam']

// ============================================================
//  @route   GET /api/admin/stats
//  @desc    Thống kê dashboard — toàn bộ aggregate chạy ở DB, FE chỉ hiển thị:
//           4 số tổng + doanh thu 6 tháng + đơn theo trạng thái
//           + top 5 tour nhiều đơn + 5 đơn mới nhất
//  @access  Private — Admin
// ============================================================
export const getAdminStats = async (req, res) => {
  try {
    // Mốc đầu tháng của 6 tháng gần nhất (tính cả tháng hiện tại)
    const tuThang = new Date()
    tuThang.setMonth(tuThang.getMonth() - 5)
    tuThang.setDate(1)
    tuThang.setHours(0, 0, 0, 0)

    // Mốc đầu tháng hiện tại — cho currentMonthRevenue
    const dauThangNay = new Date()
    dauThangNay.setDate(1)
    dauThangNay.setHours(0, 0, 0, 0)

    const [
      totalTours,
      totalBookings,
      totalUsers,
      doanhThu,
      theoThang,
      theoTrangThai,
      topTours,
      donMoi,
      doanhThuThangNay,
      pendingBookings,
      activeTours,
      theoMien,
      paymentStatuses,
    ] = await Promise.all([
        Tour.countDocuments(),
        Booking.countDocuments(),
        User.countDocuments(),

        // Tổng doanh thu (đơn paid + completed)
        Booking.aggregate([
          { $match: { status: { $in: TRANG_THAI_DOANH_THU } } },
          { $group: { _id: null, revenue: { $sum: '$totalPrice' } } },
        ]),

        // Doanh thu + số đơn theo tháng, 6 tháng gần nhất (theo ngày đặt)
        Booking.aggregate([
          { $match: { status: { $in: TRANG_THAI_DOANH_THU }, createdAt: { $gte: tuThang } } },
          {
            $group: {
              _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
              revenue: { $sum: '$totalPrice' },
              count: { $sum: 1 },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]),

        // Số đơn theo từng trạng thái
        Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

        // Top 5 tour nhiều đơn nhất (không tính đơn đã hủy) — tourName là snapshot
        // trong đơn nên không cần $lookup
        Booking.aggregate([
          { $match: { status: { $ne: 'cancelled' } } },
          {
            $group: {
              _id: '$tour',
              tourName: { $first: '$tourName' },
              soDon: { $sum: 1 },
              doanhThu: {
                $sum: {
                  $cond: [{ $in: ['$status', TRANG_THAI_DOANH_THU] }, '$totalPrice', 0],
                },
              },
            },
          },
          { $sort: { soDon: -1, doanhThu: -1 } },
          { $limit: 5 },
        ]),

        // 5 đơn mới nhất
        Booking.find()
          .sort('-createdAt')
          .limit(5)
          .populate('user', 'name email')
          .lean(),

        // Doanh thu THÁNG HIỆN TẠI (khác mảng monthlyRevenue 6 tháng ở trên)
        Booking.aggregate([
          { $match: { status: { $in: TRANG_THAI_DOANH_THU }, createdAt: { $gte: dauThangNay } } },
          { $group: { _id: null, revenue: { $sum: '$totalPrice' } } },
        ]),

        // Đơn đang chờ thanh toán
        Booking.countDocuments({ status: 'pending_payment' }),

        // Tour đang hoạt động (chưa bị soft delete)
        Tour.countDocuments({ isActive: { $ne: false } }),

        // Doanh thu + số đơn theo MIỀN: đơn paid/completed → lookup Tour → group region
        Booking.aggregate([
          { $match: { status: { $in: TRANG_THAI_DOANH_THU } } },
          { $lookup: { from: 'tours', localField: 'tour', foreignField: '_id', as: 'tourDoc' } },
          { $unwind: '$tourDoc' },
          {
            $group: {
              _id: '$tourDoc.region',
              revenue: { $sum: '$totalPrice' },
              bookings: { $sum: 1 },
            },
          },
        ]),
        PaymentAttempt.aggregate([{ $match: { status: { $in: ['paid', 'failed'] } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      ])

    const byStatus = {}
    for (const s of theoTrangThai) byStatus[s._id] = s.count
    const paymentMap = Object.fromEntries(paymentStatuses.map((item) => [item._id, item.count]))
    const paymentFinalized = (paymentMap.paid || 0) + (paymentMap.failed || 0)

    // Đủ 3 miền kể cả miền doanh thu 0 — pie FE luôn đủ 3 phần
    const banDoMien = new Map(theoMien.map((m) => [m._id, m]))
    const revenueByRegion = CAC_MIEN.map((region) => ({
      region,
      revenue: banDoMien.get(region)?.revenue || 0,
      bookings: banDoMien.get(region)?.bookings || 0,
    }))

    res.json({
      success: true,
      stats: {
        totalTours,
        totalBookings,
        totalUsers,
        revenue: doanhThu[0]?.revenue || 0,
        currentMonthRevenue: doanhThuThangNay[0]?.revenue || 0,
        pendingBookings,
        activeTours,
        revenueByRegion,
        monthlyRevenue: theoThang.map((t) => ({
          year: t._id.year,
          month: t._id.month,
          revenue: t.revenue,
          count: t.count,
        })),
        byStatus,
        topTours: topTours.map((t) => ({
          tourId: t._id,
          tourName: t.tourName,
          soDon: t.soDon,
          doanhThu: t.doanhThu,
        })),
        latestBookings: donMoi.map((b) => ({
          _id: b._id,
          bookingCode: b.bookingCode,
          tourName: b.tourName,
          user: b.user ? { name: b.user.name, email: b.user.email } : null,
          totalPrice: b.totalPrice,
          status: b.status,
          createdAt: b.createdAt,
        })),
        paymentSuccessRate: paymentFinalized ? Math.round((paymentMap.paid || 0) * 1000 / paymentFinalized) / 10 : 0,
        paymentFailureRate: paymentFinalized ? Math.round((paymentMap.failed || 0) * 1000 / paymentFinalized) / 10 : 0,
        cancellationRate: totalBookings ? Math.round((byStatus.cancelled || 0) * 1000 / totalBookings) / 10 : 0,
        paymentAttempts: paymentMap,
      },
    })
  } catch (error) {
    console.error('[getAdminStats]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}
