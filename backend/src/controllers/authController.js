// ============================================================
//  src/controllers/authController.js
//  Logic xử lý Đăng ký, Đăng nhập, Lấy thông tin bản thân
// ============================================================
import jwt from 'jsonwebtoken'
import User from '../models/User.js'

// ── Helper: Tạo JWT token từ user ───────────────────────────
// Payload nhúng cả role để client đọc được quyền ngay từ token;
// middleware protect vẫn lấy role từ DB nên đổi quyền là token cũ hết tác dụng phân quyền.
const generateToken = (user) => {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  })
}

const setAuthCookie = (res, token) => {
  const days = Math.max(1, Number(process.env.JWT_COOKIE_DAYS) || 7)
  res.cookie('vv_session', token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/',
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
  dateOfBirth: user.dateOfBirth,
  gender: user.gender,
  address: user.address,
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
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string' || !name.trim() || !email.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng điền đầy đủ họ tên, email và mật khẩu.',
        code: 'VALIDATION_ERROR',
      })
    }
    if (name.trim().length > 100 || !/^\S+@\S+\.\S+$/.test(email.trim()) || password.length < 6 || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: 'Họ tên, email hoặc mật khẩu không hợp lệ (mật khẩu từ 6–128 ký tự).',
        code: 'VALIDATION_ERROR',
      })
    }

    // 2. Kiểm tra email đã tồn tại chưa
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() })
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email này đã được sử dụng. Vui lòng dùng email khác hoặc đăng nhập.',
        code: 'EMAIL_TAKEN',
      })
    }

    // 3. Tạo user mới (password sẽ được hash tự động bởi pre-save hook trong model)
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
    })

    // 4. Tạo JWT token
    const token = generateToken(user)
    setAuthCookie(res, token)

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
        code: 'VALIDATION_ERROR',
      })
    }
    console.error('[register] Lỗi:', error)
    res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ. Vui lòng thử lại sau.',
      code: 'SERVER_ERROR',
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
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập email và mật khẩu.',
        code: 'VALIDATION_ERROR',
      })
    }
    if (email.length > 254 || password.length > 128) {
      return res.status(400).json({ success: false, message: 'Email hoặc mật khẩu không hợp lệ.', code: 'VALIDATION_ERROR' })
    }

    // 2. Tìm user theo email — phải select('+password') vì schema dùng select:false
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password')

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không đúng.',
        code: 'INVALID_CREDENTIALS',
      })
    }

    // 3. Kiểm tra tài khoản có bị khóa không
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.',
        code: 'ACCOUNT_LOCKED',
      })
    }

    // 4. So sánh mật khẩu
    const isMatch = await user.matchPassword(password)
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không đúng.',
        code: 'INVALID_CREDENTIALS',
      })
    }

    // 5. Tạo JWT token
    const token = generateToken(user)
    setAuthCookie(res, token)

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
      code: 'SERVER_ERROR',
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

export const logout = async (req, res) => {
  res.clearCookie('vv_session', {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    path: '/',
  })
  res.json({ success: true, message: 'Đã đăng xuất.' })
}

// ============================================================
//  @route   PUT /api/auth/profile
//  @desc    Tự cập nhật họ tên / SĐT của chính mình
//  @access  Private
// ============================================================
export const updateProfile = async (req, res) => {
  try {
    const { name, phone, dateOfBirth, gender, address } = req.body

    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Họ tên không được để trống.',
        code: 'VALIDATION_ERROR',
      })
    }
    if (phone !== undefined && phone !== '' && !/^0\d{9}$/.test(String(phone).trim())) {
      return res.status(400).json({
        success: false,
        message: 'Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0).',
        code: 'VALIDATION_ERROR',
      })
    }
    if (gender !== undefined && !['', 'male', 'female', 'other'].includes(String(gender))) {
      return res.status(400).json({ success: false, message: 'Giới tính không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    if (address !== undefined && String(address).trim().length > 250) {
      return res.status(400).json({ success: false, message: 'Địa chỉ không được vượt quá 250 ký tự.', code: 'VALIDATION_ERROR' })
    }
    let parsedDateOfBirth = null
    if (dateOfBirth) {
      parsedDateOfBirth = new Date(`${String(dateOfBirth).slice(0, 10)}T00:00:00.000Z`)
      const earliest = new Date('1900-01-01T00:00:00.000Z')
      const today = new Date()
      today.setUTCHours(23, 59, 59, 999)
      if (Number.isNaN(parsedDateOfBirth.getTime()) || parsedDateOfBirth < earliest || parsedDateOfBirth > today) {
        return res.status(400).json({ success: false, message: 'Ngày sinh không hợp lệ.', code: 'VALIDATION_ERROR' })
      }
    }

    const user = await User.findById(req.user._id)
    if (name !== undefined) user.name = String(name).trim()
    if (phone !== undefined) user.phone = String(phone).trim()
    if (dateOfBirth !== undefined) user.dateOfBirth = parsedDateOfBirth
    if (gender !== undefined) user.gender = String(gender)
    if (address !== undefined) user.address = String(address).trim()
    await user.save()

    res.json({ success: true, message: 'Cập nhật hồ sơ thành công!', user: formatUser(user) })
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message)[0]
      return res.status(400).json({ success: false, message: msg, code: 'VALIDATION_ERROR' })
    }
    console.error('[updateProfile]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   PATCH /api/auth/password
//  @desc    Tự đổi mật khẩu — phải nhập đúng mật khẩu cũ
//  @access  Private
// ============================================================
export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body

    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string' || !oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập mật khẩu cũ và mật khẩu mới.',
        code: 'VALIDATION_ERROR',
      })
    }
    if (newPassword.length < 6 || newPassword.length > 128 || oldPassword.length > 128) {
      return res.status(400).json({
        success: false,
        message: 'Mật khẩu mới phải từ 6–128 ký tự.',
        code: 'VALIDATION_ERROR',
      })
    }

    // Schema để select:false nên phải xin password tường minh
    const user = await User.findById(req.user._id).select('+password')
    const dungMatKhauCu = await user.matchPassword(oldPassword)
    if (!dungMatKhauCu) {
      return res.status(400).json({
        success: false,
        message: 'Mật khẩu cũ không đúng.',
        code: 'WRONG_PASSWORD',
      })
    }

    user.password = newPassword // pre-save hook tự hash
    await user.save()

    res.json({ success: true, message: 'Đổi mật khẩu thành công!' })
  } catch (error) {
    console.error('[changePassword]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
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
