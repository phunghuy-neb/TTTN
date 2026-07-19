// Tầng service xác thực — TUẦN 2 trả về dữ liệu MOCK.
// Tuần sau chỉ cần thay phần mock bằng fetch() gọi API backend, không đổi chữ ký hàm.

// Mô phỏng độ trễ mạng cho giống gọi API thật
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Tài khoản demo (MOCK) — khớp app.html
const MOCK_USER = {
  name: 'Người dùng Demo',
  email: 'demo@vietvoyage.vn',
  password: '123456',
}

/**
 * Đăng nhập (MOCK).
 * @param {{ email: string, password: string }} payload
 * @returns {Promise<{ success: boolean, message?: string, user?: object, token?: string }>}
 */
export async function login({ email, password }) {
  await delay(400)
  const ok =
    email.trim().toLowerCase() === MOCK_USER.email && password === MOCK_USER.password
  if (!ok) {
    return { success: false, message: 'Email hoặc mật khẩu không đúng.' }
  }
  return {
    success: true,
    user: { name: MOCK_USER.name, email: MOCK_USER.email },
    token: 'mock-token',
  }
}

/**
 * Đăng ký (MOCK).
 * @param {{ name: string, email: string, password: string }} payload
 * @returns {Promise<{ success: boolean, message?: string, user?: object, token?: string }>}
 */
export async function register({ name, email, password }) {
  await delay(400)
  // Mô phỏng email đã tồn tại (tài khoản demo)
  if (email.trim().toLowerCase() === MOCK_USER.email) {
    return { success: false, message: 'Email đã được sử dụng.' }
  }
  // eslint-disable-next-line no-unused-vars
  const _ = password // MOCK: bỏ qua, tuần sau gửi lên backend
  return {
    success: true,
    user: { name: name.trim(), email: email.trim().toLowerCase() },
    token: 'mock-token',
  }
}
