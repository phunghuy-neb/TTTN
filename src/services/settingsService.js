// Tầng service cài đặt công khai — client đọc không cần đăng nhập (Batch 7).
import { request } from './api.js'

// { success, chatEnabled } — FE quyết định có render ChatWidget không
export async function getPublicSettings() {
  return request('/settings/public')
}
