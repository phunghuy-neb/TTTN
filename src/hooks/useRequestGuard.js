import { useRef, useCallback } from 'react'

// Chống race condition khi nhiều request cùng bay (đổi bộ lọc/slug liên tiếp):
// request cũ về sau sẽ ghi đè kết quả mới nếu không bỏ qua kết quả lỗi thời.
// Gộp pattern `requestId = useRef(0)` lặp ở TourList / TourDetail / Bookings.
//
// Cách dùng:
//   const beginRequest = useRequestGuard()
//   async function load() {
//     const isCurrent = beginRequest()          // đánh số request này
//     const res = await goiApi()
//     if (!isCurrent()) return                  // đã có request mới hơn — bỏ kết quả này
//     ...setState...
//   }
export function useRequestGuard() {
  const requestId = useRef(0)

  return useCallback(() => {
    const id = ++requestId.current
    return () => id === requestId.current
  }, [])
}
