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
