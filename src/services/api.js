// Tầng gọi HTTP dùng chung — bọc fetch, gắn header và xử lý lỗi tập trung.
// Base URL lấy từ biến môi trường Vite (.env)

import { emitSessionExpired } from './authEvents.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

// Key lưu phiên trong localStorage — trùng với AuthContext
const STORAGE_KEY = 'auth'

/**
 * Gọi API tới backend. Hỗ trợ mọi method (GET/POST/PUT/PATCH/DELETE) và body FormData.
 * @param {string} path - đường dẫn tương đối, vd '/auth/login'
 * @param {{ method?: string, body?: object|FormData, auth?: boolean }} options
 * @returns {Promise<object>} data từ server, hoặc { success: false, message, code }
 */
export async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {}

  // FormData: KHÔNG set Content-Type — browser tự set kèm boundary cho multipart.
  // Chỉ body JSON mới cần khai báo application/json.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  if (body && !isFormData) headers['Content-Type'] = 'application/json'

  // Gắn token nếu route cần xác thực
  if (auth) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const saved = raw ? JSON.parse(raw) : null
      if (saved?.token) headers.Authorization = `Bearer ${saved.token}`
    } catch {
      // Dữ liệu localStorage hỏng — bỏ qua, gọi như chưa đăng nhập
    }
  }

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    })

    // Luôn parse để không vỡ khi body rỗng
    const data = await res.json().catch(() => ({}))

    // Token sai/hết hạn trên request CÓ auth — xóa phiên và phát sự kiện để AuthContext
    // reset user ngay lập tức (không đợi F5). 401 của /auth/login (auth: false, sai
    // mật khẩu) không đi vào nhánh này nên không ảnh hưởng form đăng nhập.
    if (res.status === 401 && auth) {
      localStorage.removeItem(STORAGE_KEY)
      emitSessionExpired()
    }

    if (!res.ok) {
      return {
        success: false,
        message: data.message || 'Có lỗi xảy ra.',
        code: data.code || 'REQUEST_ERROR',
        status: res.status,
      }
    }

    // BE đã trả sẵn { success, message, token, user } — trả nguyên vẹn
    return data
  } catch {
    // fetch ném lỗi — mất mạng hoặc server tắt
    return {
      success: false,
      message: 'Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối mạng.',
      code: 'NETWORK_ERROR',
    }
  }
}
