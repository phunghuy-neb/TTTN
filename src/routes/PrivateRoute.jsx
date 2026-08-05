import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// Chặn route riêng tư — chưa đăng nhập thì đẩy về /login, giữ lại nơi định đến
export function PrivateRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  // Chờ khôi phục phiên xong mới quyết định, tránh chớp giao diện
  if (loading) return null
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <Outlet />
}

// Route chỉ dành cho khách — đã đăng nhập thì đẩy về trang chủ
export function GuestRoute() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}
