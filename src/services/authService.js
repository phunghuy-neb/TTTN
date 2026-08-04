// Tầng service xác thực — gọi API thật tới backend qua request().
// Giữ nguyên chữ ký hàm để AuthContext dùng như cũ.

import { request } from './api.js'

/**
 * Đăng nhập.
 * @param {{ email: string, password: string }} payload
 * @returns {Promise<{ success: boolean, message?: string, user?: object, token?: string }>}
 */
export async function login({ email, password }) {
  return request('/auth/login', { method: 'POST', body: { email, password } })
}

/**
 * Đăng ký.
 * @param {{ name: string, email: string, password: string }} payload
 * @returns {Promise<{ success: boolean, message?: string, user?: object, token?: string }>}
 */
export async function register({ name, email, password }) {
  return request('/auth/register', { method: 'POST', body: { name, email, password } })
}

/**
 * Lấy thông tin user đang đăng nhập (kèm role) từ token hiện tại.
 * Token hỏng/hết hạn → api.js tự xóa phiên và phát sự kiện session-expired.
 * @returns {Promise<{ success: boolean, message?: string, user?: object }>}
 */
export async function getMe() {
  return request('/auth/me', { auth: true })
}

/**
 * Tự cập nhật hồ sơ (họ tên, SĐT).
 * @param {{ name?: string, phone?: string }} payload
 */
export async function updateProfile(payload) {
  return request('/auth/profile', { method: 'PUT', body: payload, auth: true })
}

/**
 * Tự đổi mật khẩu — sai mật khẩu cũ nhận 400 WRONG_PASSWORD.
 * @param {{ oldPassword: string, newPassword: string }} payload
 */
export async function changePassword(payload) {
  return request('/auth/password', { method: 'PATCH', body: payload, auth: true })
}
