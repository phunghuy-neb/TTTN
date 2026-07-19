import { createContext, useContext, useEffect, useState } from 'react'
import { login as loginService, register as registerService } from '../services/authService.js'

// Key lưu phiên trong localStorage
const STORAGE_KEY = 'auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Khôi phục phiên khi mount — đọc lại từ localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved?.user) setUser(saved.user)
      }
    } catch {
      // Dữ liệu hỏng — xóa để tránh lỗi lặp lại
      localStorage.removeItem(STORAGE_KEY)
    }
    setLoading(false)
  }, [])

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

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// Hook tiện dụng để lấy context
export function useAuth() {
  return useContext(AuthContext)
}
