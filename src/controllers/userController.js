// ============================================================
//  src/controllers/userController.js
//  Quản lý User — dành cho Admin (CRUD + khóa tài khoản + đổi quyền)
// ============================================================
import User from '../models/User.js'
import Booking from '../models/Booking.js'

// ── Helper: Format user trả về (bỏ password) ─────────────────
const fmt = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  avatar: u.avatar,
  role: u.role,
  isActive: u.isActive,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
})

// ============================================================
//  @route   GET /api/admin/users
//  @desc    Danh sách toàn bộ user (có phân trang + tìm kiếm)
//  @access  Private — Admin
// ============================================================
export const getUsers = async (req, res) => {
  try {
    const {
      search,
      role,
      isActive,
      sort = '-createdAt',
      page = 1,
      limit = 20,
    } = req.query

    const filter = {}
    if (role) filter.role = role
    if (isActive !== undefined) filter.isActive = isActive === 'true'
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ]
    }

    const pageNum = Math.max(1, Number(page))
    const limitNum = Math.min(100, Math.max(1, Number(limit)))
    const skip = (pageNum - 1) * limitNum

    const [users, total] = await Promise.all([
      User.find(filter).sort(sort).skip(skip).limit(limitNum),
      User.countDocuments(filter),
    ])

    // Số đơn của từng user trong MỘT aggregate — FE hiển thị cột "Số đơn"
    const demDon = await Booking.aggregate([
      { $match: { user: { $in: users.map((u) => u._id) } } },
      { $group: { _id: '$user', soDon: { $sum: 1 } } },
    ])
    const banDoDon = new Map(demDon.map((d) => [String(d._id), d.soDon]))

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      users: users.map((u) => ({ ...fmt(u), soDon: banDoDon.get(String(u._id)) || 0 })),
    })
  } catch (error) {
    console.error('[getUsers]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   GET /api/admin/users/:id
//  @desc    Xem chi tiết 1 user
//  @access  Private — Admin
// ============================================================
export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng.' })
    }
    res.json({ success: true, user: fmt(user) })
  } catch (error) {
    console.error('[getUser]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   PUT /api/admin/users/:id
//  @desc    Cập nhật thông tin user (Admin chỉnh sửa)
//  @access  Private — Admin
// ============================================================
export const updateUser = async (req, res) => {
  try {
    // Các field Admin được phép sửa (không cho đổi password qua đây)
    const { name, phone, avatar, role } = req.body

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng.' })
    }

    // Chặn admin tự hạ quyền chính mình qua đường PUT (cùng luật với PATCH /role)
    if (
      role !== undefined &&
      user._id.toString() === req.user._id.toString() &&
      role !== 'admin'
    ) {
      return res.status(409).json({
        success: false,
        message: 'Không thể tự hạ quyền admin của chính mình.',
        code: 'CANNOT_DEMOTE_SELF',
      })
    }

    if (name !== undefined) user.name = name
    if (phone !== undefined) user.phone = phone
    if (avatar !== undefined) user.avatar = avatar
    if (role !== undefined) user.role = role

    await user.save()
    res.json({ success: true, message: 'Cập nhật người dùng thành công!', user: fmt(user) })
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message)[0]
      return res.status(400).json({ success: false, message: msg })
    }
    console.error('[updateUser]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   PATCH /api/admin/users/:id/lock
//  @desc    Khóa / mở khóa tài khoản (toggle isActive)
//  @access  Private — Admin
// ============================================================
export const toggleLockUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng.' })
    }

    // Không cho Admin tự khóa chính mình
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(409).json({
        success: false,
        message: 'Không thể tự khóa tài khoản của chính mình.',
        code: 'CANNOT_LOCK_SELF',
      })
    }

    user.isActive = !user.isActive
    await user.save()

    const action = user.isActive ? 'Mở khóa' : 'Khóa'
    res.json({
      success: true,
      message: `${action} tài khoản "${user.email}" thành công.`,
      user: fmt(user),
    })
  } catch (error) {
    console.error('[toggleLockUser]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   PATCH /api/admin/users/:id/role
//  @desc    Đổi quyền customer ↔ admin.
//           Admin KHÔNG thể tự hạ quyền chính mình (409 CANNOT_DEMOTE_SELF).
//  @access  Private — Admin
// ============================================================
export const changeUserRole = async (req, res) => {
  try {
    const { role } = req.body
    if (!['customer', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role không hợp lệ. Chọn "customer" hoặc "admin".',
        code: 'VALIDATION_ERROR',
      })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng.', code: 'NOT_FOUND' })
    }

    if (user._id.toString() === req.user._id.toString() && role !== 'admin') {
      return res.status(409).json({
        success: false,
        message: 'Không thể tự hạ quyền admin của chính mình.',
        code: 'CANNOT_DEMOTE_SELF',
      })
    }

    user.role = role
    await user.save()

    res.json({
      success: true,
      message: `Đã đổi quyền "${user.email}" thành ${role === 'admin' ? 'Admin' : 'Khách hàng'}.`,
      user: fmt(user),
    })
  } catch (error) {
    console.error('[changeUserRole]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}
