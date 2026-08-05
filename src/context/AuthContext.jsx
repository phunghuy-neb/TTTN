import { createContext, useContext, useEffect, useState } from 'react'
import {
  login as loginService,
  register as registerService,
  getMe,
} from '../services/authService.js'
import { onSessionExpired } from '../services/authEvents.js'

// Key lưu phiên trong localStorage
const STORAGE_KEY = 'auth'

const AuthContext = createContext(null)

// Đọc role từ payload JWT (base64url) — nguồn phụ khi saved.user thiếu role
// (phiên lưu từ trước khi có phân quyền). Nguồn chính thức vẫn là /auth/me.
function docRoleTuToken(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role || null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Khôi phục phiên khi mount: dùng ngay dữ liệu localStorage để không chớp giao diện,
  // rồi gọi /auth/me xác thực lại với server để lấy role/thông tin mới nhất.
  useEffect(() => {
    let token = null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved?.user) {
          token = saved.token || null
          const role = saved.user.role || (token ? docRoleTuToken(token) : null)
          setUser(role ? { ...saved.user, role } : saved.user)
        }
      }
    } catch {
      // Dữ liệu hỏng — xóa để tránh lỗi lặp lại
      localStorage.removeItem(STORAGE_KEY)
    }
    setLoading(false)

    // Xác thực lại với server. Token hỏng/hết hạn → api.js xóa phiên và phát sự kiện
    // session-expired (listener bên dưới reset user). Lỗi mạng → giữ tạm phiên local.
    if (token) {
      getMe().then((res) => {
        if (res.success && res.user) {
          setUser(res.user)
          try {
            const raw = localStorage.getItem(STORAGE_KEY)
            const saved = raw ? JSON.parse(raw) : null
            if (saved?.token) {
              localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, user: res.user }))
            }
          } catch {
            // localStorage hỏng — bỏ qua, state trong bộ nhớ đã đúng
          }
        }
      })
    }
  }, [])

  // Tầng HTTP phát hiện 401 trên request có auth (token hết hạn/bị sửa) → reset state
  // để toàn bộ UI (Header, PrivateRoute, AdminRoute) đăng xuất NGAY, không cần F5.
  useEffect(() => onSessionExpired(() => setUser(null)), [])

  // Đăng nhập — gọi service, lưu phiên nếu thành công, luôn trả res để trang tự xử lý lỗi
  const login = async (payload) => {
    const res = await loginService(payload)
    if (res.success === true) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: res.user, token: res.token }))
      setUser(res.user)
    }
    return res
  }

  // Đăng ký — tương tự đăng nhập
  const register = async (payload) => {
    const res = await registerService(payload)
    if (res.success === true) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: res.user, token: res.token }))
      setUser(res.user)
    }
    return res
  }

  // Đăng xuất — xóa phiên
  const logout = () => {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }

  // Cập nhật user sau khi tự sửa hồ sơ — đồng bộ cả state lẫn localStorage
  const updateUser = (userMoi) => {
    setUser(userMoi)
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const saved = raw ? JSON.parse(raw) : null
      if (saved?.token) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, user: userMoi }))
      }
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
