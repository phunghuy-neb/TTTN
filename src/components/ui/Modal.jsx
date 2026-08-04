import { useEffect } from 'react'

// Hộp thoại nổi giữa màn hình — nền mờ, bấm nền hoặc nhấn Esc để đóng.
// Thay cho các khối xác nhận inline (VD xác nhận hủy đơn ở Bookings).
//
//   <Modal open={!!huyId} title="Hủy đơn" onClose={...} actions={<>...nút...</>}>
//     Nội dung mô tả
//   </Modal>
export default function Modal({ open, title, children, onClose, actions }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="card-surface w-full max-w-[440px] p-6" onClick={(e) => e.stopPropagation()}>
        {title && <h3 className="font-heading text-[19px] font-semibold text-ink">{title}</h3>}
        <div className="mt-3 text-[14.5px] leading-[1.65] text-muted">{children}</div>
        {actions && <div className="mt-5 flex flex-wrap justify-end gap-3">{actions}</div>}
      </div>
    </div>
  )
}
