import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { cancelBooking, getBooking } from '../services/bookingService.js'
import { formatDate, formatPrice } from '../utils/format.js'
import { nhanTrangThai } from '../utils/bookingStatus.js'
import BookingCountdown from '../components/BookingCountdown.jsx'
import Button from '../components/ui/Button.jsx'
import Modal from '../components/ui/Modal.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import ReviewModal from '../components/ReviewModal.jsx'
import { useNotifications } from '../context/NotificationsContext.jsx'

const PHUONG_THUC = {
  vnpay: 'VNPay',
  momo: 'MoMo',
  later: 'Thanh toán sau',
}

const NGUON_CAP_NHAT = {
  customer: 'Khách hàng',
  admin: 'Quản trị viên',
  payment: 'Cổng thanh toán',
  system: 'Hệ thống',
}

const TRANG_THAI_GIAO_DICH = {
  creating: 'Đang khởi tạo',
  initiated: 'Đang chờ thanh toán',
  paid: 'Thành công',
  failed: 'Chưa thành công',
  expired: 'Đã hết hiệu lực',
  review_required: 'Cần đối soát',
}

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDateTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date)
}

function taoTimeline(booking) {
  const history = [...(booking.statusHistory || [])]
  if (!history.some((item) => item.from === 'created')) {
    history.unshift({
      from: 'created',
      to: 'pending_payment',
      source: 'customer',
      reason: 'Đơn đặt tour được tạo',
      at: booking.createdAt,
    })
  }
  return history.sort((a, b) => new Date(a.at) - new Date(b.at))
}

export default function BookingDetail() {
  const { id } = useParams()
  const { state } = useLocation()
  const toast = useToast()
  const { refresh: refreshNotifications } = useNotifications()
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [expired, setExpired] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    const res = await getBooking(id)
    if (res.success) setBooking(res.data)
    else setError(res.message || 'Không tải được chi tiết đơn đặt tour.')
    setLoading(false)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError('')
      const res = await getBooking(id)
      if (!active) return
      if (res.success) setBooking(res.data)
      else setError(res.message || 'Không tải được chi tiết đơn đặt tour.')
      setLoading(false)
    })()
    return () => { active = false }
  }, [id])

  useEffect(() => {
    if (state?.openReview && booking?.status === 'completed' && !booking.reviewed) setReviewOpen(true)
  }, [state?.openReview, booking?.status, booking?.reviewed])

  const timeline = useMemo(() => (booking ? taoTimeline(booking) : []), [booking])

  async function xacNhanHuy() {
    if (!booking) return
    setCancelling(true)
    const res = await cancelBooking(booking._id)
    setCancelling(false)
    setConfirmCancel(false)
    if (!res.success) {
      toast(res.message || 'Không hủy được đơn. Vui lòng thử lại.', 'error')
      return
    }
    setBooking((current) => ({ ...current, ...res.data, tour: current.tour }))
    toast(res.message || 'Đã hủy đơn thành công.')
    refreshNotifications()
  }

  if (loading) {
    return (
      <div className="wrap py-[48px]">
        <Skeleton className="h-[32px] w-[220px] rounded" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <Skeleton className="h-[520px] rounded-card" />
          <Skeleton className="h-[360px] rounded-card" />
        </div>
      </div>
    )
  }

  if (!booking || error) {
    return (
      <div className="wrap py-[56px]">
        <div className="card-surface mx-auto max-w-[560px] p-8 text-center">
          <h1 className="font-heading text-[22px] font-semibold text-ink">Không xem được đơn đặt tour</h1>
          <p className="mt-2 text-muted">{error || 'Không tìm thấy thông tin đơn.'}</p>
          <div className="mt-5 flex justify-center gap-3">
            <Button onClick={load}>Thử lại</Button>
            <Link to="/bookings" className="btn-ghost">Về lịch sử</Link>
          </div>
        </div>
      </div>
    )
  }

  const status = nhanTrangThai(booking.status)
  const tourUrl = booking.tour?.slug ? `/tour/${booking.tour.slug}` : '/tours'
  const canPay = booking.status === 'pending_payment' && !expired && ['vnpay', 'momo'].includes(booking.paymentMethod)
  const canCancel = booking.status === 'pending_payment' && !expired
  const canRebook = ['cancelled', 'completed'].includes(booking.status)
  const canReview = booking.status === 'completed' && !booking.reviewed
  const hasTicket = ['paid', 'completed'].includes(booking.status)

  return (
    <div className="wrap py-[48px]">
      <Link to="/bookings" className="text-[14px] font-semibold text-teal hover:text-teal2">← Đơn đặt tour của tôi</Link>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">CHI TIẾT ĐƠN</p>
          <h1 className="mt-2 font-heading text-[30px] font-semibold text-ink">{booking.bookingCode}</h1>
          <p className="mt-1 text-[14px] text-muted">Đặt lúc {formatDateTime(booking.createdAt)}</p>
        </div>
        <span className={`rounded-pill px-4 py-1.5 text-[14px] font-semibold ${status.className}`}>{status.label}</span>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="card-surface overflow-hidden">
            <div className="flex flex-col sm:flex-row">
              {booking.tour?.images?.[0] ? (
                <img src={booking.tour.images[0]} alt={booking.tourName} className="h-[210px] w-full object-cover sm:w-[280px]" />
              ) : (
                <div className="grid h-[180px] w-full place-items-center bg-sand text-[30px] text-muted sm:h-auto sm:w-[280px]">✦</div>
              )}
              <div className="flex-1 p-6">
                <Link to={tourUrl} className="font-heading text-[21px] font-semibold text-ink hover:text-teal">{booking.tourName}</Link>
                <div className="mt-4 grid gap-3 text-[14px] sm:grid-cols-2">
                  <div><p className="text-muted">Ngày khởi hành</p><p className="mt-0.5 font-semibold text-ink">{formatDate(booking.departureDate)}</p></div>
                  <div><p className="text-muted">Số khách</p><p className="mt-0.5 font-semibold text-ink">{booking.guests} khách</p></div>
                  <div><p className="text-muted">Đơn giá</p><p className="mt-0.5 font-semibold text-ink">{formatPrice(booking.unitPrice)} / khách</p></div>
                  <div><p className="text-muted">Phương thức</p><p className="mt-0.5 font-semibold text-ink">{PHUONG_THUC[booking.paymentMethod] || '—'}</p></div>
                </div>
              </div>
            </div>
          </section>

          <section className="card-surface p-6">
            <h2 className="font-heading text-[20px] font-semibold text-ink">Thông tin liên hệ</h2>
            <dl className="mt-4 grid gap-x-8 gap-y-4 text-[14px] sm:grid-cols-2">
              <div><dt className="text-muted">Họ và tên</dt><dd className="mt-0.5 font-semibold text-ink">{booking.contact?.name || '—'}</dd></div>
              <div><dt className="text-muted">Số điện thoại</dt><dd className="mt-0.5 font-semibold text-ink">{booking.contact?.phone || '—'}</dd></div>
              <div><dt className="text-muted">Email</dt><dd className="mt-0.5 break-all font-semibold text-ink">{booking.contact?.email || '—'}</dd></div>
              <div><dt className="text-muted">Ghi chú</dt><dd className="mt-0.5 font-semibold text-ink">{booking.note || 'Không có'}</dd></div>
            </dl>
          </section>

          {booking.tour?.itinerary?.length > 0 && (
            <section className="card-surface p-6">
              <h2 className="font-heading text-[20px] font-semibold text-ink">Lịch trình tour</h2>
              {booking.tour.summary && <p className="mt-2 text-[14px] leading-[1.7] text-muted">{booking.tour.summary}</p>}
              <ol className="mt-5 space-y-4">
                {booking.tour.itinerary.map((day) => (
                  <li key={day.dayNumber} className="flex gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal text-[13px] font-bold text-white">{day.dayNumber}</span>
                    <div>
                      <p className="font-semibold text-ink">Ngày {day.dayNumber}: {day.title}</p>
                      {day.description && <p className="mt-1 text-[13.5px] leading-[1.65] text-muted">{day.description}</p>}
                      {(day.meals?.length > 0 || day.accommodation) && (
                        <p className="mt-1 text-[12.5px] text-muted">
                          {day.meals?.length > 0 ? `Bữa ăn: ${day.meals.join(', ')}` : ''}
                          {day.meals?.length > 0 && day.accommodation ? ' · ' : ''}
                          {day.accommodation ? `Lưu trú: ${day.accommodation}` : ''}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="card-surface p-6">
            <h2 className="font-heading text-[20px] font-semibold text-ink">Lịch sử trạng thái</h2>
            <ol className="mt-5">
              {timeline.map((item, index) => {
                const itemStatus = nhanTrangThai(item.to)
                const isLast = index === timeline.length - 1
                return (
                  <li key={`${item.at}-${index}`} className="relative flex gap-4 pb-6 last:pb-0">
                    {!isLast && <span className="absolute left-[7px] top-4 h-full w-px bg-line" />}
                    <span className={`relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] border-white ring-2 ${isLast ? 'bg-teal ring-teal/30' : 'bg-jade ring-jade/20'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-ink">{itemStatus.label}</p>
                        <time className="text-[12.5px] text-muted">{formatDateTime(item.at)}</time>
                      </div>
                      <p className="mt-1 text-[13.5px] text-muted">{item.reason || 'Cập nhật trạng thái'} · {NGUON_CAP_NHAT[item.source] || 'Hệ thống'}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        </div>

        <aside className="card-surface p-6 lg:sticky lg:top-[94px]">
          <h2 className="font-heading text-[20px] font-semibold text-ink">Thanh toán</h2>
          <dl className="mt-4 space-y-3 text-[14px]">
            {(booking.discountAmount || 0) > 0 && <><div className="flex justify-between gap-3"><dt className="text-muted">Giá gốc</dt><dd className="font-semibold text-ink">{formatPrice(booking.originalPrice)}</dd></div><div className="flex justify-between gap-3 text-jade"><dt>Voucher {booking.voucher?.code}</dt><dd className="font-semibold">−{formatPrice(booking.discountAmount)}</dd></div></>}
            <div className="flex justify-between gap-3"><dt className="text-muted">Tổng tiền</dt><dd className="font-heading text-[22px] font-semibold text-coralD">{formatPrice(booking.totalPrice)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Phương thức</dt><dd className="font-semibold text-ink">{PHUONG_THUC[booking.paymentMethod] || '—'}</dd></div>
            {booking.txnRef && <div className="flex justify-between gap-3"><dt className="text-muted">Mã giao dịch</dt><dd className="break-all text-right font-semibold text-ink">{booking.txnRef}</dd></div>}
            {booking.paidAt && <div className="flex justify-between gap-3"><dt className="text-muted">Thanh toán lúc</dt><dd className="text-right font-semibold text-ink">{formatDateTime(booking.paidAt)}</dd></div>}
            {booking.lastPaymentAttempt && (
              <div className="flex justify-between gap-3 border-t border-line pt-3">
                <dt className="text-muted">Lần gần nhất</dt>
                <dd className="text-right font-semibold text-ink">
                  {PHUONG_THUC[booking.lastPaymentAttempt.provider]} · {TRANG_THAI_GIAO_DICH[booking.lastPaymentAttempt.status] || booking.lastPaymentAttempt.status}
                  <span className="mt-0.5 block text-[12px] font-normal text-muted">{formatDateTime(booking.lastPaymentAttempt.createdAt)}</span>
                </dd>
              </div>
            )}
          </dl>

          {booking.status === 'pending_payment' && booking.paymentExpiresAt && (
            <div className="mt-5"><BookingCountdown expiresAt={booking.paymentExpiresAt} onExpire={() => setExpired(true)} /></div>
          )}

          <div className="mt-5 flex flex-col gap-2.5">
            {hasTicket && <Link to={`/tickets/${booking._id}`} className="btn-teal w-full">🎫 Xem vé điện tử</Link>}
            {canPay && <Link to={`/payment?bookingId=${booking._id}`} className="btn-coral w-full">Tiếp tục thanh toán</Link>}
            {canCancel && <Button variant="ghost" className="w-full !text-coralD" onClick={() => setConfirmCancel(true)}>Hủy đơn</Button>}
            {canRebook && (
              <Link to={tourUrl} state={{ rebookGuests: booking.guests }} className="btn-teal w-full">Đặt lại tour này</Link>
            )}
            {canReview && <Button variant="coral" className="w-full" onClick={() => setReviewOpen(true)}>★ Đánh giá chuyến đi</Button>}
            {booking.status === 'completed' && booking.reviewed && (
              <Link to={`${tourUrl}#reviews`} className="btn-ghost w-full">Xem đánh giá đã đăng</Link>
            )}
            <Link to={tourUrl} className="btn-ghost w-full">Xem thông tin tour</Link>
          </div>
        </aside>
      </div>

      <Modal
        open={confirmCancel}
        title="Hủy đơn đặt tour"
        onClose={() => !cancelling && setConfirmCancel(false)}
        actions={(
          <>
            <Button variant="ghost" disabled={cancelling} onClick={() => setConfirmCancel(false)}>Không</Button>
            <Button variant="coral" disabled={cancelling} onClick={xacNhanHuy}>{cancelling ? 'Đang hủy…' : 'Xác nhận hủy'}</Button>
          </>
        )}
      >
        Bạn chắc chắn muốn hủy đơn <b className="text-ink">{booking.bookingCode}</b>? Chỗ đã giữ sẽ được hoàn lại cho đợt khởi hành.
      </Modal>

      <ReviewModal
        open={reviewOpen}
        booking={booking}
        onClose={() => setReviewOpen(false)}
        onSuccess={() => {
          setBooking((current) => ({ ...current, reviewed: true }))
          setReviewOpen(false)
          toast('Đánh giá của bạn đã được đăng.')
          refreshNotifications()
        }}
      />
    </div>
  )
}
