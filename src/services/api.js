// Tầng gọi HTTP dùng chung — bọc fetch, gắn header và xử lý lỗi tập trung.
// Base URL lấy từ biến môi trường Vite (.env)

const BASE_URL = import.meta.env.VITE_API_BASE_URL

// Key lưu phiên trong localStorage — trùng với AuthContext
const STORAGE_KEY = 'auth'

/**
 * Gọi API tới backend.
 * @param {string} path - đường dẫn tương đối, vd '/auth/login'
 * @param {{ method?: string, body?: object, auth?: boolean }} options
 * @returns {Promise<object>} data từ server, hoặc { success: false, message }
 */
export async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }

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
      body: body ? JSON.stringify(body) : undefined,
    })

    // Luôn parse để không vỡ khi body rỗng
    const data = await res.json().catch(() => ({}))

    // Token sai/hết hạn — xóa phiên, để PrivateRoute/AuthContext tự điều hướng
    if (res.status === 401) {
      localStorage.removeItem(STORAGE_KEY)
    }

    if (!res.ok) {
      return { success: false, message: data.message || 'Có lỗi xảy ra.' }
    }

    // BE đã trả sẵn { success, message, token, user } — trả nguyên vẹn
    return data
  } catch {
    // fetch ném lỗi — mất mạng hoặc server tắt
    return { success: false, message: 'Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối mạng.' }
  }
}
