import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// Bố cục khu admin — sidebar + topbar (breadcrumb) — tách hẳn khỏi Layout client.
// Chỉ render bên trong AdminRoute nên user ở đây luôn là admin.

// Mục điều hướng đang hoạt động — thêm dần khi admin có thêm trang
const NAV = [
  { to: '/admin', label: 'Dashboard', icon: '▦', end: true },
  { to: '/admin/tours', label: 'Quản lý tour', icon: '🗺', end: false },
]

// Các khu sẽ làm ở batch sau — hiển thị mờ, không bấm được
const SAP_CO = ['Quản lý đơn đặt', 'Quản lý người dùng']

// Nhãn breadcrumb theo path — khớp exact trước, rồi tới pattern
function tenBreadcrumb(pathname) {
  if (pathname === '/admin') return 'Dashboard'
  if (pathname === '/admin/tours') return 'Quản lý tour'
  if (pathname === '/admin/tours/new') return 'Thêm tour'
  if (/^\/admin\/tours\/[^/]+\/edit$/.test(pathname)) return 'Sửa tour'
  return 'Không tìm thấy'
}

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // Đăng xuất rồi về trang chủ khu client
  const onLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar — ẩn ở mobile, khu admin dùng chủ yếu trên desktop */}
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

        <div className="mt-2 px-3">
          <p className="px-3.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted/70">
            Sắp ra mắt
          </p>
          <div className="mt-1 flex flex-col">
            {SAP_CO.map((label) => (
              <span
                key={label}
                className="cursor-not-allowed px-3.5 py-2 text-[14px] text-muted/50"
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-auto border-t border-line p-3">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-[11px] px-3.5 py-2.5 text-[14px] font-semibold text-muted transition hover:bg-sand hover:text-teal"
          >
            ← Về trang khách
          </Link>
        </div>
      </aside>

      {/* Cột phải: topbar + nội dung */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[62px] items-center justify-between gap-3 border-b border-line bg-bg/85 px-5 backdrop-blur-md">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-[13.5px] text-muted" aria-label="Breadcrumb">
            <Link to="/admin" className="transition hover:text-teal md:pointer-events-none">
              Admin
            </Link>
            <span>/</span>
            <span className="font-semibold text-ink">{tenBreadcrumb(pathname)}</span>
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-[14px] font-semibold text-teal sm:flex">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-sand text-teal">
                {user?.name?.charAt(0)}
              </span>
              {user?.name}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="text-[14px] font-semibold text-muted transition hover:text-teal"
            >
              Đăng xuất
            </button>
          </div>
        </header>

        <main className="flex-1 p-5 md:p-7">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
