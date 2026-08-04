// ============================================================
//  src/controllers/adminController.js
//  Số liệu tổng quan cho Admin Dashboard
// ============================================================
import Tour from '../models/Tour.js'
import User from '../models/User.js'
import Booking from '../models/Booking.js'

// ============================================================
//  @route   GET /api/admin/stats
//  @desc    Thống kê tổng quan: tổng tour / đơn / user + doanh thu
//  @access  Private — Admin
// ============================================================
export const getAdminStats = async (req, res) => {
  try {
    // Doanh thu = tổng totalPrice của đơn đã thu tiền (paid) hoặc đã hoàn thành
    // (completed cũng là đơn đã thanh toán xong vòng đời). Đơn pending/cancelled không tính.
    const [totalTours, totalBookings, totalUsers, doanhThu] = await Promise.all([
      Tour.countDocuments(),
      Booking.countDocuments(),
      User.countDocuments(),
      Booking.aggregate([
        { $match: { status: { $in: ['paid', 'completed'] } } },
        { $group: { _id: null, revenue: { $sum: '$totalPrice' } } },
      ]),
    ])

    res.json({
      success: true,
      stats: {
        totalTours,
        totalBookings,
        totalUsers,
        revenue: doanhThu[0]?.revenue || 0,
      },
    })
  } catch (error) {
    console.error('[getAdminStats]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}
