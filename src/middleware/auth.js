// ============================================================
//  src/middleware/auth.js
//  Middleware xác thực JWT và phân quyền theo role
// ============================================================
import jwt from 'jsonwebtoken'
import User from '../models/User.js'

/**
 * protect — Bảo vệ route, chỉ cho phép request có JWT hợp lệ.
 *
 * Client cần gửi header:
 *   Authorization: Bearer <token>
 *
 * Nếu hợp lệ → gắn req.user (object user từ DB) vào request.
 * Nếu không hợp lệ → trả lỗi 401.
 */
export const protect = async (req, res, next) => {
  let token

  // Lấy token từ header Authorization
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1]
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Bạn chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.',
    })
  }

  try {
    // Giải mã token
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Lấy thông tin user từ DB (exclude password)
    const user = await User.findById(decoded.id)

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token không hợp lệ. Tài khoản không tồn tại.',
      })
    }

    // Kiểm tra tài khoản bị khóa (isActive)
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.',
      })
    }

    req.user = user
    next()
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
    })
  }
}

/**
 * authorize(...roles) — Middleware phân quyền theo role.
 *
 * Dùng SAU middleware protect. Ví dụ:
 *   router.get('/users', protect, authorize('admin'), getUsers)
 *
 * @param {...string} roles — Danh sách role được phép ('admin', 'customer', ...)
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Bạn không có quyền thực hiện thao tác này. Yêu cầu quyền: ${roles.join(', ')}.`,
      })
    }
    next()
  }
}
