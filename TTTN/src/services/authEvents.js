// Cầu nối một chiều từ tầng HTTP (api.js) lên AuthContext.
// api.js KHÔNG được import context trực tiếp (context → service → api.js sẽ thành
// vòng lặp phụ thuộc), nên tầng HTTP chỉ phát sự kiện; AuthContext tự đăng ký lắng nghe.

const listeners = new Set()

// Đăng ký lắng nghe sự kiện phiên hết hạn — trả về hàm hủy đăng ký (dùng trong useEffect)
export function onSessionExpired(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// api.js gọi khi request có auth bị 401 — phiên trên server đã chết
export function emitSessionExpired() {
  for (const listener of [...listeners]) listener()
}
