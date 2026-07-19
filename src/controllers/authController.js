// ============================================================
//  src/controllers/authController.js
//  Logic xử lý Đăng ký, Đăng nhập, Lấy thông tin bản thân
// ============================================================
import jwt from 'jsonwebtoken'
import User from '../models/User.js'

// ── Helper: Tạo JWT token từ user ID ────────────────────────
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  })
}

// ── Helper: Chuẩn hóa dữ liệu user trả về client ───────────
// (Bỏ qua các field nhạy cảm như password)
const formatUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  avatar: user.avatar,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt,
})

// ============================================================
//  @route   POST /api/auth/register
//  @desc    Đăng ký tài khoản mới
//  @access  Public
// ============================================================
export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body

    // 1. Validate đầu vào cơ bản
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng điền đầy đủ họ tên, email và mật khẩu.',
      })
    }

    // 2. Kiểm tra email đã tồn tại chưa
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() })
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email này đã được sử dụng. Vui lòng dùng email khác hoặc đăng nhập.',
      })
    }

    // 3. Tạo user mới (password sẽ được hash tự động bởi pre-save hook trong model)
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
    })

    // 4. Tạo JWT token
    const token = generateToken(user._id)

    res.status(201).json({
      success: true,
      message: 'Đăng ký thành công! Chào mừng bạn đến với VietVoyage.',
      token,
      user: formatUser(user),
    })
  } catch (error) {
    // Xử lý lỗi validation từ Mongoose
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message)
      return res.status(400).json({
        success: false,
        message: messages[0],
      })
    }
    console.error('[register] Lỗi:', error)
    res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ. Vui lòng thử lại sau.',
    })
  }
}

// ============================================================
//  @route   POST /api/auth/login
//  @desc    Đăng nhập, nhận JWT token
//  @access  Public
// ============================================================
export const login = async (req, res) => {
  try {
    const { email, password } = req.body

    // 1. Validate đầu vào
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập email và mật khẩu.',
      })
    }

    // 2. Tìm user theo email — phải select('+password') vì schema dùng select:false
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password')

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không đúng.',
      })
    }

    // 3. Kiểm tra tài khoản có bị khóa không
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.',
      })
    }

    // 4. So sánh mật khẩu
    const isMatch = await user.matchPassword(password)
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không đúng.',
      })
    }

    // 5. Tạo JWT token
    const token = generateToken(user._id)

    res.status(200).json({
      success: true,
      message: 'Đăng nhập thành công!',
      token,
      user: formatUser(user),
    })
  } catch (error) {
    console.error('[login] Lỗi:', error)
    res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ. Vui lòng thử lại sau.',
    })
  }
}

// ============================================================
//  @route   GET /api/auth/me
//  @desc    Lấy thông tin người dùng đang đăng nhập
//  @access  Private (cần JWT)
// ============================================================
export const getMe = async (req, res) => {
  // req.user đã được gắn bởi middleware protect
  res.status(200).json({
    success: true,
    user: formatUser(req.user),
  })
}

// ============================================================
//  @route   GET /api/admin/users
//  @desc    Lấy danh sách toàn bộ user (Admin only)
//  @access  Private — chỉ role 'admin'
// ============================================================
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 })

    res.status(200).json({
      success: true,
      total: users.length,
      users: users.map(formatUser),
    })
  } catch (error) {
    console.error('[getAllUsers] Lỗi:', error)
    res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ. Vui lòng thử lại sau.',
    })
  }
}
