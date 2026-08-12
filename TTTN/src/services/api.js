// Tầng gọi HTTP dùng chung — bọc fetch, gắn header và xử lý lỗi tập trung.
// Base URL lấy từ biến môi trường Vite (.env)

import { emitSessionExpired } from './authEvents.js'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

export async function downloadFile(path, fallbackName = 'download') {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { credentials: 'include' })
    if (res.status === 401) {
      localStorage.removeItem('auth')
      emitSessionExpired()
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { success: false, message: data.message || 'Không tải được tệp.', status: res.status }
    }
    const blob = await res.blob()
    const disposition = res.headers.get('content-disposition') || ''
    const match = disposition.match(/filename="?([^";]+)"?/i)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = match?.[1] || fallbackName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return { success: true }
  } catch {
    return { success: false, message: 'Không thể kết nối máy chủ.' }
  }
}

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

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    })

    // Luôn parse để không vỡ khi body rỗng
    const data = await res.json().catch(() => ({}))

    // Token sai/hết hạn trên request CÓ auth — xóa phiên và phát sự kiện để AuthContext
    // reset user ngay lập tức (không đợi F5). 401 của /auth/login (auth: false, sai
    // mật khẩu) không đi vào nhánh này nên không ảnh hưởng form đăng nhập.
    if (res.status === 401 && auth) {
      localStorage.removeItem('auth')
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

    // Trả nguyên response; AuthContext chỉ lưu user, không lưu token.
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
