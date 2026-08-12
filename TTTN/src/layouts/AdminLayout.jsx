import { useState, useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { getStats } from '../services/adminService.js'
import { formatPrice } from '../utils/format.js'
import { nhanTrangThai } from '../utils/bookingStatus.js'

// Bố cục khu admin (mockup báo cáo): sidebar 5 mục + Đăng xuất ở đáy,
// topbar = tiêu đề trang + chuông thông báo + avatar. Chỉ render trong AdminRoute.

const NAV = [
  { to: '/admin', label: 'Tổng quan', icon: '▦', end: true },
  { to: '/admin/tours', label: 'Quản lý Tour', icon: '🗺', end: false },
  { to: '/admin/bookings', label: 'Quản lý Booking', icon: '🧾', end: false },
  { to: '/admin/reviews', label: 'Quản lý đánh giá', icon: '★', end: false },
  { to: '/admin/tickets', label: 'Vé & check-in', icon: '🎫', end: false },
  { to: '/admin/vouchers', label: 'Voucher', icon: '🏷', end: false },
  { to: '/admin/payments', label: 'Giao dịch', icon: '💳', end: false },
  { to: '/admin/calendar', label: 'Lịch khởi hành', icon: '📅', end: false },
  { to: '/admin/reports', label: 'Báo cáo', icon: '📊', end: false },
  { to: '/admin/users', label: 'Khách hàng', icon: '👥', end: false },
  { to: '/admin/ai-settings', label: 'Cài đặt AI', icon: '🤖', end: false },
]

// Tiêu đề trang cho topbar — khớp exact trước, rồi tới pattern
function tieuDeTrang(pathname) {
  if (pathname === '/admin') return 'Tổng quan'
  if (pathname === '/admin/tours') return 'Quản lý Tour'
  if (pathname === '/admin/tours/new') return 'Thêm tour'
  if (/^\/admin\/tours\/[^/]+\/edit$/.test(pathname)) return 'Sửa tour'
  if (pathname === '/admin/bookings') return 'Quản lý Booking'
  if (pathname === '/admin/reviews') return 'Quản lý đánh giá'
  if (pathname === '/admin/tickets') return 'Vé & check-in'
  if (pathname === '/admin/vouchers') return 'Quản lý voucher'
  if (pathname === '/admin/payments') return 'Giao dịch & đối soát'
  if (pathname === '/admin/calendar') return 'Lịch khởi hành'
  if (pathname === '/admin/reports') return 'Báo cáo & xuất dữ liệu'
  if (pathname === '/admin/users') return 'Khách hàng'
  if (pathname === '/admin/ai-settings') return 'Cài đặt AI'
  return 'Không tìm thấy'
}

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // Dropdown chuông + avatar — mở cái này thì đóng cái kia
  const [moChuong, setMoChuong] = useState(false)
  const [moAvatar, setMoAvatar] = useState(false)
  const [donMoi, setDonMoi] = useState(null) // null = chưa nạp
  const dangNap = useRef(false)

  // Đăng xuất rồi về màn hình đăng nhập; admin không đi qua giao diện khách.
  const onLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  // Chuông: nạp 5 đơn mới nhất LẦN ĐẦU mở (dùng latestBookings sẵn có của /admin/stats)
  async function toggleChuong() {
    setMoAvatar(false)
    setMoChuong((v) => !v)
    if (donMoi === null && !dangNap.current) {
      dangNap.current = true
      const res = await getStats()
      dangNap.current = false
      if (res.success) setDonMoi(res.data.latestBookings || [])
      else setDonMoi([])
    }
  }

  // Đổi trang thì đóng mọi dropdown
  useEffect(() => {
    setMoChuong(false)
    setMoAvatar(false)
  }, [pathname])

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar — ẩn ở mobile (có nav ngang thay thế bên dưới topbar) */}
      <aside className="hidden w-[230px] shrink-0 flex-col border-r border-line bg-white md:flex">
        <Link
          to="/admin"
          className="flex items-center gap-2.5 border-b border-line px-5 py-[18px] font-heading text-[19px] font-semibold text-teal"
        >
          <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-gradient-to-br from-teal to-jade text-[15px] text-white">
            ✦
          </span>
          VietVoyage Admin
        </Link>

        <nav className="flex flex-col gap-1 p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-[11px] px-3.5 py-2.5 text-[14.5px] font-semibold transition ${
                  isActive ? 'bg-teal text-white' : 'text-muted hover:bg-sand hover:text-teal'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Đáy sidebar chỉ có đăng xuất — admin không có lối sang giao diện khách. */}
        <div className="mt-auto flex flex-col gap-1 border-t border-line p-3">
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 rounded-[11px] px-3.5 py-2.5 text-left text-[14px] font-semibold text-coralD transition hover:bg-coral/5"
          >
            ⎋ Đăng xuất
          </button>
        </div>
      </aside>

      {/* Cột phải: topbar + nội dung */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[62px] items-center justify-between gap-3 border-b border-line bg-bg/85 px-5 backdrop-blur-md">
          {/* Tiêu đề trang (mockup) */}
          <h1 className="truncate font-heading text-[19px] font-semibold text-ink">
            {tieuDeTrang(pathname)}
          </h1>

          <div className="relative flex items-center gap-2">
            {/* Chuông thông báo — dropdown 5 đơn mới nhất */}
            <button
              type="button"
              aria-label="Thông báo đơn mới"
              onClick={toggleChuong}
              className={`grid h-9 w-9 place-items-center rounded-full text-[17px] transition hover:bg-sand ${moChuong ? 'bg-sand' : ''}`}
            >
              🔔
            </button>

            {/* Avatar chữ cái — thông tin admin / Đăng xuất */}
            <button
              type="button"
              aria-label="Menu tài khoản"
              onClick={() => {
                setMoChuong(false)
                setMoAvatar((v) => !v)
              }}
              className="grid h-9 w-9 place-items-center rounded-full bg-teal font-semibold text-white transition hover:opacity-90"
            >
              {user?.name?.charAt(0)}
            </button>

            {/* Dropdown chuông */}
            {moChuong && (
              <div className="absolute right-0 top-[46px] w-[320px] overflow-hidden rounded-card border border-line bg-white shadow-soft">
                <p className="border-b border-line px-4 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-muted">
                  Đơn mới nhất
                </p>
                {donMoi === null && <p className="px-4 py-3 text-[13.5px] text-muted">Đang tải…</p>}
                {donMoi?.length === 0 && <p className="px-4 py-3 text-[13.5px] text-muted">Chưa có đơn nào.</p>}
                {donMoi?.map((b) => {
                  const tt = nhanTrangThai(b.status)
                  return (
                    <button
                      key={b._id}
                      type="button"
                      onClick={() => navigate(`/admin/bookings?q=${b.bookingCode}&open=${b._id}`)}
                      className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition hover:bg-sand/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold text-ink">
                          {b.user?.name || '—'} · {b.bookingCode}
                        </span>
                        <span className="block truncate text-[12.5px] text-muted">
                          {b.tourName} · {formatPrice(b.totalPrice)}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[11.5px] font-semibold ${tt.className}`}>
                        {tt.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Dropdown avatar */}
            {moAvatar && (
              <div className="absolute right-0 top-[46px] w-[200px] overflow-hidden rounded-card border border-line bg-white shadow-soft">
                <div className="border-b border-line px-4 py-2.5">
                  <p className="text-[13.5px] font-semibold text-ink">{user?.name}</p>
                  <p className="mt-0.5 truncate text-[12px] text-muted">{user?.email}</p>
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  className="block w-full px-4 py-2.5 text-left text-[14px] text-coralD transition hover:bg-coral/5"
                >
                  Đăng xuất
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Nav ngang cho mobile — sidebar ẩn dưới md nên cần lối đi thay thế */}
        <nav className="flex gap-1.5 overflow-x-auto border-b border-line bg-white px-3 py-2 md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `shrink-0 rounded-pill px-3.5 py-1.5 text-[13.5px] font-semibold transition ${
                  isActive ? 'bg-teal text-white' : 'text-muted hover:bg-sand'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 p-5 md:p-7">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
