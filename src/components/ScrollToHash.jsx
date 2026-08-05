import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Xử lý cuộn khi đổi route/hash — React Router v6 không tự làm việc này
export default function ScrollToHash() {
  const { pathname, hash, key } = useLocation()

  useEffect(() => {
    if (!hash) {
      // Không có hash — luôn cuộn lên đầu trang (lỗi B)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    // Trễ 1 nhịp vì section có thể chưa render xong tại thời điểm effect chạy
    const timer = setTimeout(() => {
      document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' })
    }, 0)
    return () => clearTimeout(timer)
    // key đổi sau MỖI lần điều hướng nên bấm lại cùng mục vẫn cuộn lại (lỗi C)
  }, [pathname, hash, key])

  return null
}
