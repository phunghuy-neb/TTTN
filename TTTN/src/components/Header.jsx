import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useNotifications } from '../context/NotificationsContext.jsx'

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
  const { recent, unreadCount, loading: notificationsLoading, refresh: refreshNotifications, markRead } = useNotifications()
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const accountRef = useRef(null)
  const notificationRef = useRef(null)

  // URL hiện tại gồm cả hash — dùng so khớp mục menu đang chọn
  const current = `${pathname}${hash}`

  // Đăng xuất rồi về trang chủ
  const onLogout = () => {
    setAccountOpen(false)
    logout()
    navigate('/')
  }

  useEffect(() => {
    setMenuOpen(false)
    setAccountOpen(false)
    setNotificationOpen(false)
  }, [pathname, hash])

  useEffect(() => {
    if (!accountOpen && !notificationOpen) return undefined
    const closeOutside = (event) => {
      if (accountOpen && !accountRef.current?.contains(event.target)) setAccountOpen(false)
      if (notificationOpen && !notificationRef.current?.contains(event.target)) setNotificationOpen(false)
    }
    const closeWithEscape = (event) => {
      if (event.key === 'Escape') {
        setAccountOpen(false)
        setNotificationOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeWithEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeWithEscape)
    }
  }, [accountOpen, notificationOpen])

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
              <div ref={notificationRef} className="relative">
                <button
                  type="button"
                  aria-label={`Thông báo${unreadCount ? `, ${unreadCount} chưa đọc` : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={notificationOpen}
                  onClick={() => {
                    setNotificationOpen((open) => !open)
                    setAccountOpen(false)
                    refreshNotifications()
                  }}
                  className="relative grid h-10 w-10 place-items-center rounded-full text-[20px] text-teal transition hover:bg-sand"
                >
                  🔔
                  {unreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-coral px-1 text-[10px] font-bold text-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {notificationOpen && (
                  <div role="menu" className="absolute right-0 top-[48px] z-50 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-card border border-line bg-white shadow-soft">
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                      <p className="font-semibold text-ink">Thông báo</p>
                      <Link to="/notifications" className="text-[12.5px] font-semibold text-teal">Xem tất cả</Link>
                    </div>
                    {notificationsLoading && <p className="px-4 py-5 text-center text-[13px] text-muted">Đang tải thông báo…</p>}
                    {!notificationsLoading && recent.length === 0 && <p className="px-4 py-6 text-center text-[13.5px] text-muted">Bạn chưa có thông báo nào.</p>}
                    {!notificationsLoading && recent.map((item) => (
                      <Link
                        key={item._id}
                        role="menuitem"
                        to={item.link || '/notifications'}
                        onClick={() => { if (!item.isRead) markRead(item._id); setNotificationOpen(false) }}
                        className={`block border-b border-line px-4 py-3 last:border-0 hover:bg-sand/60 ${item.isRead ? '' : 'bg-jade/[0.04]'}`}
                      >
                        <div className="flex items-start gap-2">
                          {!item.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-coral" />}
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-semibold text-ink">{item.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{item.message}</p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div ref={accountRef} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((open) => !open)}
                className="flex items-center gap-2 rounded-pill py-1 pl-1 pr-2 text-[15px] font-semibold text-teal transition hover:bg-sand"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-sand text-teal">
                  {user.name?.charAt(0)}
                </span>
                <span className="hidden sm:inline">{user.name}</span>
                <span className={`text-[11px] text-muted transition ${accountOpen ? 'rotate-180' : ''}`}>▼</span>
              </button>

              {accountOpen && (
                <div role="menu" className="absolute right-0 top-[48px] z-50 w-[250px] overflow-hidden rounded-card border border-line bg-white p-2 shadow-soft">
                  <div className="border-b border-line px-3 py-2.5">
                    <p className="truncate font-semibold text-ink">{user.name}</p>
                    <p className="truncate text-[12.5px] text-muted">{user.email}</p>
                  </div>
                  <Link role="menuitem" to="/profile" onClick={() => setAccountOpen(false)} className="mt-1 flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium text-ink hover:bg-sand">
                    <span aria-hidden="true">👤</span> Hồ sơ cá nhân
                  </Link>
                  <Link role="menuitem" to="/bookings" onClick={() => setAccountOpen(false)} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium text-ink hover:bg-sand">
                    <span aria-hidden="true">🧾</span> Đơn đặt tour của tôi
                  </Link>
                  <Link role="menuitem" to="/favorites" onClick={() => setAccountOpen(false)} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium text-ink hover:bg-sand">
                    <span aria-hidden="true">♥</span> Tour yêu thích
                  </Link>
                  <Link role="menuitem" to="/notifications" onClick={() => setAccountOpen(false)} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium text-ink hover:bg-sand">
                    <span aria-hidden="true">🔔</span> Thông báo {unreadCount > 0 ? `(${unreadCount})` : ''}
                  </Link>
                  {user.role === 'admin' && (
                    <Link role="menuitem" to="/admin" onClick={() => setAccountOpen(false)} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium text-ink hover:bg-sand">
                      <span aria-hidden="true">⚙</span> Trang quản trị
                    </Link>
                  )}
                  <button role="menuitem" type="button" onClick={onLogout} className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[14px] font-medium text-coralD hover:bg-coral/5">
                    <span aria-hidden="true">↪</span> Đăng xuất
                  </button>
                </div>
              )}
              </div>
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
