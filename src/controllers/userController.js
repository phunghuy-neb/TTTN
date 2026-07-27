// ============================================================
//  src/controllers/userController.js
//  Quản lý User — dành cho Admin (CRUD + khóa tài khoản)
// ============================================================
import User from '../models/User.js'

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

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      users: users.map(fmt),
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
      return res.status(400).json({ success: false, message: 'Không thể tự khóa tài khoản của chính mình.' })
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
