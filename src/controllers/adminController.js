// ============================================================
//  src/controllers/adminController.js
//  Số liệu tổng quan cho Admin Dashboard
// ============================================================
import Tour from '../models/Tour.js'
import User from '../models/User.js'
import Booking from '../models/Booking.js'

// Trạng thái đơn tính doanh thu — tiền đã thực thu
const TRANG_THAI_DOANH_THU = ['paid', 'completed']

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

    const [totalTours, totalBookings, totalUsers, doanhThu, theoThang, theoTrangThai, topTours, donMoi] =
      await Promise.all([
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
      ])

    const byStatus = {}
    for (const s of theoTrangThai) byStatus[s._id] = s.count

    res.json({
      success: true,
      stats: {
        totalTours,
        totalBookings,
        totalUsers,
        revenue: doanhThu[0]?.revenue || 0,
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
      },
    })
  } catch (error) {
    console.error('[getAdminStats]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}
