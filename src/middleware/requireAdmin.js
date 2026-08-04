// ============================================================
//  src/middleware/requireAdmin.js
//  Chặn route chỉ dành cho Admin — đặt SAU middleware protect.
//
//  Ví dụ:
//    router.use(protect)
//    router.use(requireAdmin)
// ============================================================

/**
 * requireAdmin — chỉ cho qua khi req.user.role === 'admin'.
 *
 * protect đã xác thực token và gắn req.user từ DB; middleware này
 * chỉ kiểm quyền. Nếu bị gọi mà chưa qua protect (thiếu req.user)
 * thì trả 401 thay vì crash.
 */
export default function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Bạn chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.',
      code: 'AUTH_REQUIRED',
    })
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Chỉ Admin mới được truy cập tài nguyên này.',
      code: 'ADMIN_ONLY',
    })
  }

  next()
}
