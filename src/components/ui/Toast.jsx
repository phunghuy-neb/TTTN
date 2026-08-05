import { createContext, useCallback, useContext, useRef, useState } from 'react'

// ToastProvider + useToast — thông báo nổi góc phải màn hình, tự ẩn sau vài giây.
// Thay cho việc mỗi trang tự render banner thành công/lỗi riêng lẻ.
//
//   const toast = useToast()
//   toast('Đã hủy đơn thành công.')            // mặc định success
//   toast('Không hủy được đơn.', 'error')

const ToastContext = createContext(null)

const TU_DONG_AN_SAU_MS = 4000

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)

  const toast = useCallback((message, type = 'success') => {
    const id = ++nextId.current
    setToasts((ts) => [...ts, { id, message, type }])
    setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id))
    }, TU_DONG_AN_SAU_MS)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}

      {/* Chồng toast — dưới header (70px), trên mọi nội dung */}
      <div className="pointer-events-none fixed right-4 top-[82px] z-[60] flex w-[calc(100%-32px)] max-w-[360px] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-card border bg-white px-4 py-3 text-[14px] text-ink shadow-soft ${
              t.type === 'error' ? 'border-coral/40' : 'border-jade/40'
            }`}
          >
            <span className={`font-semibold ${t.type === 'error' ? 'text-coralD' : 'text-jade'}`}>
              {t.type === 'error' ? '✕' : '✔'}
            </span>
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
