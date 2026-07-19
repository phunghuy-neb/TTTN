import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// Menu chính — giữ nguyên theo Protected Fixes: Trang chủ / Khám phá tour / Ưu đãi / Liên hệ
const MENU = [
  { label: 'Trang chủ', to: '/' },
  { label: 'Khám phá tour', to: '/#tours' },
  { label: 'Ưu đãi', to: '/#uudai' },
  { label: 'Liên hệ', to: '/#lienhe' },
]

export default function Header() {
  const navigate = useNavigate()
  const { pathname, hash } = useLocation()
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  // URL hiện tại gồm cả hash — dùng so khớp mục menu đang chọn
  const current = `${pathname}${hash}`

  // Đăng xuất rồi về trang chủ
  const onLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md relative">
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
            <Link
              key={m.label}
              to={m.to}
              className={`transition hover:text-teal ${current === m.to ? 'text-teal' : 'text-muted'}`}
            >
              {m.label}
            </Link>
          ))}
        </nav>

        {/* Khối bên phải: user đã đăng nhập hoặc CTA đăng nhập/đăng ký */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link to="/profile" className="flex items-center gap-2 text-[15px] font-semibold text-teal">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-sand text-teal">
                  {user.name?.charAt(0)}
                </span>
                <span className="hidden sm:inline">{user.name}</span>
              </Link>
              <button onClick={onLogout} className="text-[15px] font-semibold text-muted hover:text-teal">
                Đăng xuất
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-[15px] font-semibold text-teal hover:text-teal2">
                Đăng nhập
              </Link>
              <Link to="/register" className="btn-coral !py-2.5 text-[15px]">
                Đăng ký
              </Link>
            </>
          )}

          {/* Nút hamburger — chỉ hiện dưới 768px */}
          <button
            type="button"
            aria-label="Mở menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-[10px] border border-line text-teal md:hidden"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Panel menu mobile — xổ ngay dưới thanh header (cao 70px) */}
      {menuOpen && (
        <nav className="absolute left-0 top-[70px] w-full border-b border-line bg-bg md:hidden">
          <div className="wrap flex flex-col py-2 text-[15px] font-medium">
            {MENU.map((m) => (
              <Link
                key={m.label}
                to={m.to}
                onClick={() => setMenuOpen(false)}
                className={`py-2.5 transition hover:text-teal ${current === m.to ? 'text-teal' : 'text-muted'}`}
              >
                {m.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  )
}
