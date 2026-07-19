import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="wrap py-24 text-center">
      <div className="mb-3 font-heading text-[64px] text-teal">404</div>
      <h1 className="mb-2 text-[24px]">Không tìm thấy trang</h1>
      <p className="mb-6 text-[15px] text-muted">Trang bạn tìm không tồn tại hoặc đã được di chuyển.</p>
      <Link to="/" className="btn-coral">Về trang chủ</Link>
    </div>
  )
}
