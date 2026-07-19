import { Link, NavLink } from 'react-router-dom'

// Menu chính — giữ nguyên theo Protected Fixes: Trang chủ / Khám phá tour / Ưu đãi / Liên hệ
const MENU = [
  { label: 'Trang chủ', to: '/' },
  { label: 'Khám phá tour', to: '/#tours' },
  { label: 'Ưu đãi', to: '/#uudai' },
  { label: 'Liên hệ', to: '/#lienhe' },
]

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="wrap flex h-[70px] items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 font-heading text-[22px] font-semibold text-teal">
          <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-gradient-to-br from-teal to-jade text-[18px] text-white">
            ✦
          </span>
          VietVoyage
        </Link>

        {/* Menu — ẩn ở mobile giống app.html */}
        <nav className="hidden items-center gap-7 text-[15px] font-medium md:flex">
          {MENU.map((m) => (
            <NavLink
              key={m.label}
              to={m.to}
              end={m.to === '/'}
              className={({ isActive }) =>
                `transition hover:text-teal ${isActive ? 'text-teal' : 'text-muted'}`
              }
            >
              {m.label}
            </NavLink>
          ))}
        </nav>

        {/* CTA đăng nhập / đăng ký */}
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-[15px] font-semibold text-teal hover:text-teal2">
            Đăng nhập
          </Link>
          <Link to="/register" className="btn-coral !py-2.5 text-[15px]">
            Đăng ký
          </Link>
        </div>
      </div>
    </header>
  )
}
