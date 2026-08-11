import { Link } from 'react-router-dom'

// Trang 403 — đã đăng nhập nhưng không đủ quyền (AdminRoute điều hướng về đây)
export default function Forbidden() {
  return (
    <div className="wrap py-24 text-center">
      <div className="mb-3 font-heading text-[64px] text-teal">403</div>
      <h1 className="mb-2 text-[24px]">Không có quyền truy cập</h1>
      <p className="mb-6 text-[15px] text-muted">
        Khu vực này chỉ dành cho quản trị viên. Nếu bạn cho rằng đây là nhầm lẫn, hãy liên hệ Admin.
      </p>
      <Link to="/" className="btn-coral">Về trang chủ</Link>
    </div>
  )
}
