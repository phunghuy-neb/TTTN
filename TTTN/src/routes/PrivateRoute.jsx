import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// Toàn bộ giao diện khách (kể cả trang công khai) không được render cho tài khoản
// admin. Admin chỉ sử dụng layout /admin; gõ URL client thủ công cũng quay về dashboard.
export function ClientRoute() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (user?.role === 'admin') return <Navigate to="/admin" replace />
  return <Outlet />
}

// Chặn route riêng tư — chưa đăng nhập thì đẩy về /login, giữ lại nơi định đến
export function PrivateRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  // Chờ khôi phục phiên xong mới quyết định, tránh chớp giao diện
  if (loading) return null
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (user.role === 'admin') return <Navigate to="/admin" replace />
  return <Outlet />
}

// Route chỉ dành cho khách — đã đăng nhập thì đẩy về trang chủ
export function GuestRoute() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/'} replace />
  return <Outlet />
}
