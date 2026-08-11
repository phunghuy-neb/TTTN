import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// Chặn khu vực admin: chưa đăng nhập → /login (giữ nơi định đến),
// đăng nhập nhưng không phải admin → /403. PrivateRoute giữ nguyên cho khu client.
export function AdminRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  // Chờ khôi phục phiên xong mới quyết định, tránh chớp giao diện
  if (loading) return null
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (user.role !== 'admin') return <Navigate to="/403" replace />
  return <Outlet />
}
