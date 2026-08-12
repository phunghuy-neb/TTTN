const PAYMENT_WINDOW_KEY = '__vietVoyagePaymentWindow'
const PAYMENT_WINDOW_NAME = 'vietvoyage-payment-gateway'
const PAYMENT_WINDOW_FEATURES = 'popup=yes,width=1120,height=820,left=80,top=40,resizable=yes,scrollbars=yes'

function getPaymentWindow() {
  if (typeof window === 'undefined') return null
  return window[PAYMENT_WINDOW_KEY] || null
}

// Mở cổng trong cửa sổ do VietVoyage quản lý. Giữ WindowProxy ở tab gốc để
// khi callback cổng hoặc admin xác nhận MoMo booking, trung tâm thanh toán có thể đóng cổng và
// đưa khách về website mà không cần bấm "Hủy giao dịch" trên VNPay.
export function openPaymentWindow(url, provider = 'gateway') {
  if (typeof window === 'undefined' || !url) return false

  const current = getPaymentWindow()
  const popup = current && !current.closed
    ? current
    : window.open('', PAYMENT_WINDOW_NAME, PAYMENT_WINDOW_FEATURES)
  if (!popup) return false

  // Không xóa `opener`: tab VietVoyage cần giữ quan hệ cửa sổ do chính nó mở để
  // có quyền đóng VNPay sau khi webhook/admin cập nhật booking.
  try {
    popup.location.href = url
    popup.focus()
  } catch {
    const retargeted = window.open(url, PAYMENT_WINDOW_NAME, PAYMENT_WINDOW_FEATURES)
    if (!retargeted) return false
    window[PAYMENT_WINDOW_KEY] = retargeted
    return true
  }
  window[PAYMENT_WINDOW_KEY] = popup
  return true
}

// Gọi trực tiếp trong thao tác click/submit, trước các lệnh `await`. Nhờ đó
// trình duyệt ghi nhận đây là popup do VietVoyage tạo và cho phép đóng về sau.
export function preparePaymentWindow(provider = 'gateway') {
  if (typeof window === 'undefined') return false
  const current = getPaymentWindow()
  if (current && !current.closed) {
    try { current.focus(); return true } catch { /* Tạo lại bên dưới. */ }
  }

  const popup = window.open('', PAYMENT_WINDOW_NAME, PAYMENT_WINDOW_FEATURES)
  if (!popup) return false
  window[PAYMENT_WINDOW_KEY] = popup
  try {
    popup.document.title = `Đang kết nối ${provider === 'vnpay' ? 'VNPay' : 'cổng thanh toán'}…`
    popup.document.body.innerHTML = '<main style="font-family:Arial,sans-serif;max-width:520px;margin:80px auto;padding:28px;text-align:center"><h1 style="font-size:22px">Đang kết nối cổng thanh toán…</h1><p style="color:#667085;line-height:1.6">Vui lòng giữ cửa sổ này mở trong giây lát.</p></main>'
  } catch { /* Cửa sổ có thể đã được trình duyệt khôi phục ở origin khác. */ }
  return true
}

export function closePaymentWindow({ focusWebsite = true } = {}) {
  if (typeof window === 'undefined') return
  const popup = getPaymentWindow()
  if (popup && !popup.closed) {
    try {
      popup.close()
      if (!popup.closed) window.setTimeout(() => { try { popup.close() } catch { /* Trình duyệt chặn. */ } }, 100)
    } catch { /* Người dùng đã tự đóng hoặc trình duyệt chặn. */ }
  }
  window[PAYMENT_WINDOW_KEY] = null
  if (focusWebsite) {
    window.setTimeout(() => {
      try { window.focus() } catch { /* Không phải trình duyệt nào cũng cho giành focus. */ }
    }, 0)
  }
}
