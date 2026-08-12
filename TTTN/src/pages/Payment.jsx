import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { formatPrice, formatDate } from '../utils/format.js'
import { cancelBooking, getBooking, getBookingByCode } from '../services/bookingService.js'
import { getPaymentConfig, initiatePayment } from '../services/paymentService.js'
import BookingCountdown from '../components/BookingCountdown.jsx'
import Button from '../components/ui/Button.jsx'
import Modal from '../components/ui/Modal.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { closePaymentWindow, openPaymentWindow, preparePaymentWindow } from '../utils/paymentWindow.js'

const STATUS = {
  pending_payment: { label: 'Chờ thanh toán', className: 'bg-gold/15 text-gold' },
  paid: { label: 'Đã thanh toán', className: 'bg-jade/10 text-jade' },
  completed: { label: 'Hoàn thành', className: 'bg-teal/10 text-teal' },
  cancelled: { label: 'Đã hủy / hết hạn', className: 'bg-coral/10 text-coralD' },
}

const ONLINE_PROVIDERS = ['vnpay', 'momo']
const PROVIDER = { vnpay: 'VNPay', momo: 'MoMo', later: 'Thanh toán sau' }
const ATTEMPT_STATUS = {
  creating: 'Đang khởi tạo',
  initiated: 'Đang chờ thanh toán',
  paid: 'Thành công',
  failed: 'Chưa thành công',
  expired: 'Đã hết hiệu lực',
  review_required: 'Cần đối soát',
}

export default function Payment() {
  const { state } = useLocation()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const bookingCode = searchParams.get('bookingCode')
  const bookingId = searchParams.get('bookingId')
  const callbackResult = searchParams.get('result')
  const [booking, setBooking] = useState(state?.booking || null)
  const [loading, setLoading] = useState(!!(bookingCode || bookingId))
  const [error, setError] = useState(state?.paymentError || '')
  const [paying, setPaying] = useState(false)
  const [expired, setExpired] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState(
    ONLINE_PROVIDERS.includes(state?.booking?.paymentMethod) ? state.booking.paymentMethod : 'vnpay'
  )
  const [paymentConfig, setPaymentConfig] = useState({ vnpay: { enabled: false }, momo: { enabled: false } })
  const [gatewayPayment, setGatewayPayment] = useState(state?.gatewayPayment || null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    getPaymentConfig().then((res) => {
      if (res.success) setPaymentConfig(res.data)
    })
  }, [])

  useEffect(() => {
    if (!callbackResult || !window.opener || window.opener.closed) return
    try {
      window.opener.postMessage({ type: 'vietvoyage-payment-callback' }, window.location.origin)
      window.setTimeout(() => window.close(), 250)
    } catch { /* Trình duyệt không cho popup tự đóng; trang cha vẫn tự cập nhật. */ }
  }, [callbackResult])

  useEffect(() => {
    if (!bookingCode && !bookingId) return
    let active = true
    ;(async () => {
      setLoading(true)
      const res = bookingCode ? await getBookingByCode(bookingCode) : await getBooking(bookingId)
      if (!active) return
      if (res.success) {
        setBooking(res.data)
        if (ONLINE_PROVIDERS.includes(res.data.paymentMethod)) setSelectedProvider(res.data.paymentMethod)
        setExpired(false)
      }
      else setError(res.message || 'Không tải được kết quả thanh toán.')
      setLoading(false)
    })()
    return () => { active = false }
  }, [bookingCode, bookingId])

  // Cổng VNPay/MoMo mở ở tab riêng nên trung tâm thanh toán này chủ động đọc lại
  // booking. Nhờ đó callback hoặc admin xác nhận Sandbox sẽ hiện thành công mà
  // người dùng không cần F5 hay bấm hủy ở trang cổng.
  useEffect(() => {
    if (!booking?._id || booking.status !== 'pending_payment' || !ONLINE_PROVIDERS.includes(booking.paymentMethod)) return undefined
    let active = true
    const refresh = async () => {
      const res = await getBooking(booking._id)
      if (!active || !res.success) return
      setBooking(res.data)
      if (res.data.status !== 'pending_payment') {
        setGatewayPayment(null)
        closePaymentWindow()
      }
    }
    const handleCallback = (event) => {
      if (event.origin === window.location.origin && event.data?.type === 'vietvoyage-payment-callback') refresh()
    }
    const timer = window.setInterval(refresh, 1_500)
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    window.addEventListener('message', handleCallback)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('message', handleCallback)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [booking?._id, booking?.paymentMethod, booking?.status])

  async function thanhToanLai() {
    if (!booking || expired || !ONLINE_PROVIDERS.includes(selectedProvider) || paymentConfig[selectedProvider]?.enabled === false) return
    setPaying(true)
    setError('')
    if (selectedProvider === 'vnpay') preparePaymentWindow(selectedProvider)
    const res = await initiatePayment(booking._id, selectedProvider)
    if (res.success && res.paymentUrl) {
      setGatewayPayment(res)
      if (selectedProvider === 'momo') {
        window.location.assign(res.paymentUrl)
        return
      }
      openPaymentWindow(res.paymentUrl, selectedProvider)
      setPaying(false)
      return
    }
    setPaying(false)
    if (selectedProvider === 'vnpay') closePaymentWindow({ focusWebsite: false })
    setError(res.message || 'Không khởi tạo được giao dịch. Vui lòng thử lại.')
  }


  async function huyDon() {
    if (!booking?._id || cancelling) return
    setCancelling(true)
    const res = await cancelBooking(booking._id)
    setCancelling(false)
    setConfirmCancel(false)
    if (!res.success) {
      toast(res.message || 'Không hủy được đơn.', 'error')
      return
    }
    setBooking((current) => ({ ...current, ...res.data }))
    setGatewayPayment(null)
    closePaymentWindow()
    toast(res.message || 'Đã hủy đơn.')
  }

  if (loading) {
    return (
      <div className="wrap py-[56px]">
        <Skeleton className="mx-auto h-[460px] max-w-[640px] rounded-card" />
      </div>
    )
  }

  if (!booking) {
    return (
      <div className="wrap py-[56px]">
        <div className="card-surface mx-auto max-w-[560px] p-8 text-center">
          <p className="font-heading text-[20px] font-semibold text-ink">Không có đơn nào để hiển thị</p>
          <p className="mt-2 text-[14.5px] text-muted">{error || 'Bạn có thể xem lại các đơn trong lịch sử đặt tour.'}</p>
          <Link to="/bookings" className="btn-teal mt-5">Xem lịch sử đặt tour</Link>
        </div>
      </div>
    )
  }

  const status = STATUS[booking.status] || { label: booking.status, className: 'bg-sand text-muted' }
  const paid = booking.status === 'paid' || booking.status === 'completed'
  const lastAttempt = booking.lastPaymentAttempt
  const attemptActive = ['creating', 'initiated'].includes(lastAttempt?.status)
  const selectedConfig = paymentConfig[selectedProvider]

  return (
    <div className="wrap py-[56px]">
      <div className="card-surface mx-auto max-w-[640px] p-8">
        <div className={`mx-auto grid h-[56px] w-[56px] place-items-center rounded-full text-[26px] ${paid ? 'bg-jade/10 text-jade' : 'bg-gold/15 text-gold'}`}>
          {paid ? '✓' : '⌛'}
        </div>
        <h1 className="mt-4 text-center font-heading text-[26px] font-semibold text-ink">
          {paid ? 'Thanh toán thành công!' : 'Đơn tour đã được ghi nhận'}
        </h1>
        <p className="mt-2 text-center text-[14.5px] text-muted">
          Trạng thái hiện tại:{' '}
          <span className={`inline-block rounded-pill px-3 py-0.5 font-semibold ${status.className}`}>{status.label}</span>
        </p>

        {callbackResult === 'failed' && booking.status === 'pending_payment' && (
          <p className="mt-4 rounded-[11px] border border-coral/40 bg-coral/5 px-4 py-3 text-[13.5px] text-coralD">
            Giao dịch chưa thành công. Đơn vẫn được giữ chỗ tới thời hạn bên dưới và bạn có thể thử lại.
          </p>
        )}
        {callbackResult === 'review' && (
          <p className="mt-4 rounded-[11px] border border-gold/40 bg-gold/5 px-4 py-3 text-[13.5px] text-gold">
            Giao dịch cần được đối soát. Không thanh toán lại; vui lòng liên hệ hỗ trợ và cung cấp mã đơn.
          </p>
        )}
        {error && <p className="mt-4 rounded-[11px] border border-coral/40 bg-coral/5 px-4 py-3 text-[13.5px] text-coralD">{error}</p>}

        {booking.status === 'pending_payment' && selectedConfig?.testMode && (
          <p className="mt-4 rounded-[11px] border border-jade/30 bg-jade/5 px-4 py-3 text-[13.5px] leading-[1.65] text-teal">
            <b>Môi trường kiểm thử:</b> {PROVIDER[selectedProvider]} đang chạy ở chế độ {selectedConfig.mode === 'demo' ? 'mô phỏng Demo' : 'Sandbox'}. Không trừ tiền thật; {selectedProvider === 'momo' ? 'admin có thể xác nhận mô phỏng khi không có ứng dụng UAT.' : 'VNPay chỉ được xác nhận bằng callback chính thức của cổng, admin không thể xác nhận thay.'}
          </p>
        )}

        <dl className="mt-6 divide-y divide-line rounded-card border border-line">
          <div className="flex items-center justify-between gap-3 px-4 py-3"><dt className="text-muted">Mã đơn</dt><dd className="font-semibold text-teal">{booking.bookingCode}</dd></div>
          <div className="flex items-center justify-between gap-3 px-4 py-3"><dt className="text-muted">Tour</dt><dd className="text-right font-semibold text-ink">{booking.tourName}</dd></div>
          <div className="flex items-center justify-between gap-3 px-4 py-3"><dt className="text-muted">Ngày khởi hành</dt><dd className="font-semibold text-ink">{formatDate(booking.departureDate)}</dd></div>
          <div className="flex items-center justify-between gap-3 px-4 py-3"><dt className="text-muted">Số khách</dt><dd className="font-semibold text-ink">{booking.guests} khách</dd></div>
          <div className="flex items-center justify-between gap-3 px-4 py-3"><dt className="text-muted">Phương thức</dt><dd className="font-semibold text-ink">{PROVIDER[booking.paymentMethod] || '—'}</dd></div>
          {lastAttempt && (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-muted">Lần thanh toán gần nhất</dt>
              <dd className="text-right font-semibold text-ink">
                {PROVIDER[lastAttempt.provider]} · {ATTEMPT_STATUS[lastAttempt.status] || lastAttempt.status}
                <span className="mt-0.5 block text-[12px] font-normal text-muted">{new Date(lastAttempt.createdAt).toLocaleString('vi-VN')}</span>
              </dd>
            </div>
          )}
          {booking.status === 'pending_payment' && booking.paymentExpiresAt && (
            <div className="flex items-center justify-between gap-3 px-4 py-3"><dt className="text-muted">Giữ chỗ đến</dt><dd className="font-semibold text-gold">{new Date(booking.paymentExpiresAt).toLocaleString('vi-VN')}</dd></div>
          )}
          <div className="flex items-center justify-between gap-3 px-4 py-3"><dt className="text-muted">Tổng tiền</dt><dd className="font-heading text-[20px] font-semibold text-coralD">{formatPrice(booking.totalPrice)}</dd></div>
        </dl>

        {booking.status === 'pending_payment' && booking.paymentExpiresAt && (
          <div className="mt-5">
            <BookingCountdown expiresAt={booking.paymentExpiresAt} onExpire={() => setExpired(true)} />
            <p className="mt-2 text-center text-[12.5px] leading-relaxed text-muted">
              Đây là thời hạn giữ chỗ chính thức áp dụng chung cho các cổng online. Giao dịch chỉ được ghi nhận khi hoàn tất trước thời điểm này.
            </p>
          </div>
        )}

        {booking.status === 'pending_payment' && !expired && ONLINE_PROVIDERS.includes(gatewayPayment?.provider) && (
          <section className="mt-5 flex flex-wrap items-center justify-center gap-3 rounded-card border border-teal/25 bg-teal/5 p-4">
            <p className="text-[13px] text-muted">
              Đang chờ xác nhận từ {PROVIDER[gatewayPayment.provider]}…
            </p>
            <button type="button" onClick={() => openPaymentWindow(gatewayPayment.paymentUrl, gatewayPayment.provider)} className="btn-ghost !px-3 !py-2 text-[13px]">
              Mở lại {PROVIDER[gatewayPayment.provider]}
            </button>
          </section>
        )}

        {booking.status === 'pending_payment' && !expired && ONLINE_PROVIDERS.includes(booking.paymentMethod) && callbackResult !== 'review' && !gatewayPayment && (
          <div className="mt-5">
            <p className="text-[13px] font-semibold text-muted">Chọn cổng thanh toán</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ONLINE_PROVIDERS.map((provider) => (
                <button
                  key={provider}
                  type="button"
                  disabled={paying || paymentConfig[provider]?.enabled === false || (attemptActive && provider !== lastAttempt.provider)}
                  onClick={() => { setSelectedProvider(provider); setError('') }}
                  className={`rounded-[11px] border px-4 py-3 text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${selectedProvider === provider ? 'border-teal bg-teal/5 text-teal' : 'border-line text-muted hover:border-teal/50'}`}
                >
                  {PROVIDER[provider]}
                </button>
              ))}
            </div>
            {attemptActive && (
              <p className="mt-2 text-[12.5px] text-muted">Giao dịch đang hoạt động chỉ có thể tiếp tục bằng {PROVIDER[lastAttempt.provider]}. Bạn có thể đổi cổng sau khi giao dịch thất bại hoặc hết hiệu lực.</p>
            )}
            <Button variant="coral" disabled={paying || selectedConfig?.enabled === false} onClick={thanhToanLai} className="mt-3 w-full">
              {paying ? 'Đang mở cổng thanh toán…' : `Thanh toán bằng ${PROVIDER[selectedProvider]}`}
            </Button>
          </div>
        )}
        {booking.status === 'pending_payment' && booking.paymentMethod === 'later' && (
          <p className="mt-5 rounded-[11px] bg-sand px-4 py-3 text-[13.5px] leading-[1.7] text-muted">
            Công ty sẽ liên hệ qua số điện thoại/email bạn đã cung cấp để xác nhận và hướng dẫn thanh toán.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link to={`/bookings/${booking._id}`} className="btn-teal">Xem chi tiết đơn</Link>
          <Link to="/bookings" className="btn-ghost">Lịch sử đặt tour</Link>
          <Link to="/tours" className="btn-ghost">Tiếp tục khám phá tour</Link>
          {booking.status === 'pending_payment' && !expired && (
            <button type="button" onClick={() => setConfirmCancel(true)} className="px-3 py-2 text-[13.5px] font-semibold text-coralD hover:underline">
              Hủy đơn và dừng giữ chỗ
            </button>
          )}
        </div>
      </div>

      <Modal
        open={confirmCancel}
        title="Hủy đơn đặt tour?"
        onClose={() => !cancelling && setConfirmCancel(false)}
        actions={<>
          <Button variant="ghost" disabled={cancelling} onClick={() => setConfirmCancel(false)}>Tiếp tục thanh toán</Button>
          <Button variant="coral" disabled={cancelling} onClick={huyDon}>{cancelling ? 'Đang hủy…' : 'Xác nhận hủy đơn'}</Button>
        </>}
      >
        Thao tác này hủy cả lần thanh toán đang chờ, trả lại chỗ và không thể hoàn tác. Nếu chỉ muốn xem lại đơn, hãy đóng hộp thoại và chọn “Quay lại đơn”.
      </Modal>
    </div>
  )
}
