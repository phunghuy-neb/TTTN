import { createContext, useContext, useEffect, useState } from 'react'
import {
  login as loginService,
  register as registerService,
  getMe,
  logout as logoutService,
} from '../services/authService.js'
import { onSessionExpired } from '../services/authEvents.js'

// Key lưu phiên trong localStorage
const STORAGE_KEY = 'auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Khôi phục phiên khi mount: dùng ngay dữ liệu localStorage để không chớp giao diện,
  // rồi gọi /auth/me xác thực lại với server để lấy role/thông tin mới nhất.
  useEffect(() => {
    let hadCachedUser = false
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved?.user) {
          hadCachedUser = true
          // Xóa token cũ nếu trình duyệt từng chạy phiên bản lưu JWT trong localStorage.
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: saved.user }))
          setUser(saved.user)
        }
      }
    } catch {
      // Dữ liệu hỏng — xóa để tránh lỗi lặp lại
      localStorage.removeItem(STORAGE_KEY)
    }
    if (hadCachedUser) setLoading(false)

    // JWT nằm trong cookie HttpOnly; luôn gọi /me để trình duyệt gửi cookie và
    // khôi phục phiên. localStorage chỉ cache dữ liệu hiển thị, không còn secret.
    getMe().then((res) => {
      if (res.success && res.user) {
        setUser(res.user)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: res.user }))
      } else if (res.code !== 'NETWORK_ERROR') {
        setUser(null)
        localStorage.removeItem(STORAGE_KEY)
      }
      setLoading(false)
    })
  }, [])

  // Tầng HTTP phát hiện 401 trên request có auth (token hết hạn/bị sửa) → reset state
  // để toàn bộ UI (Header, PrivateRoute, AdminRoute) đăng xuất NGAY, không cần F5.
  useEffect(() => onSessionExpired(() => setUser(null)), [])

  // Đăng nhập — gọi service, lưu phiên nếu thành công, luôn trả res để trang tự xử lý lỗi
  const login = async (payload) => {
    const res = await loginService(payload)
    if (res.success === true) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: res.user }))
      setUser(res.user)
    }
    return res
  }

  // Đăng ký — tương tự đăng nhập
  const register = async (payload) => {
    const res = await registerService(payload)
    if (res.success === true) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: res.user }))
      setUser(res.user)
    }
    return res
  }

  // Đăng xuất — xóa phiên
  const logout = () => {
    logoutService().catch(() => {})
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }

  // Cập nhật user sau khi tự sửa hồ sơ — đồng bộ cả state lẫn localStorage
  const updateUser = (userMoi) => {
    setUser(userMoi)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: userMoi }))
    } catch {
      // localStorage hỏng — bỏ qua, state trong bộ nhớ đã đúng
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// Hook tiện dụng để lấy context
export function useAuth() {
  return useContext(AuthContext)
}
