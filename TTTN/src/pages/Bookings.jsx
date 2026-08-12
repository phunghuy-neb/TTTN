import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getMyBookings, cancelBooking } from '../services/bookingService.js'
import { formatPrice, formatDate } from '../utils/format.js'
import Button from '../components/ui/Button.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Modal from '../components/ui/Modal.jsx'
import Pagination from '../components/ui/Pagination.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'
import BookingCountdown from '../components/BookingCountdown.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { useRequestGuard } from '../hooks/useRequestGuard.js'
import { nhanTrangThai } from '../utils/bookingStatus.js'

// Bộ lọc trạng thái — giá trị rỗng nghĩa là xem tất cả
const BO_LOC = [
  { value: '', label: 'Tất cả' },
  { value: 'pending_payment', label: 'Chờ thanh toán' },
  { value: 'paid', label: 'Đã thanh toán' },
  { value: 'cancelled', label: 'Đã hủy' },
  { value: 'completed', label: 'Hoàn thành' },
]

const TRANG_THAI_GIAO_DICH = {
  creating: 'Đang khởi tạo giao dịch',
  initiated: 'Đang chờ thanh toán tại cổng',
  paid: 'Giao dịch thành công',
  failed: 'Lần thanh toán gần nhất chưa thành công',
  expired: 'Giao dịch gần nhất đã hết hiệu lực',
  review_required: 'Giao dịch cần đối soát',
}

// Trang lịch sử đặt tour (UC-10) — bộ lọc + phân trang lấy URL query string làm nguồn duy nhất
export default function Bookings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const [bookings, setBookings] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Hủy đơn: đơn đang chờ người dùng xác nhận trong Modal + cờ đang gửi API
  const [donChoHuy, setDonChoHuy] = useState(null)
  const [huyDangGui, setHuyDangGui] = useState(false)
  const [expiredIds, setExpiredIds] = useState(() => new Set())

  // Tăng để buộc effect tải lại theo ĐÚNG bộ lọc hiện tại trên URL — gọi thẳng load()
  // từ closure hủy đơn sẽ dùng status/page cũ nếu người dùng vừa đổi bộ lọc
  const [refreshKey, setRefreshKey] = useState(0)

  // Đọc bộ lọc TỪ URL
  const page = Number(searchParams.get('page')) || 1
  const status = searchParams.get('status') || ''

  // Chống race condition khi đổi bộ lọc/trang liên tiếp — xem hooks/useRequestGuard.js
  const beginRequest = useRequestGuard()

  // Tải danh sách đơn theo bộ lọc hiện tại trên URL
  async function load() {
    const isCurrent = beginRequest()
    setLoading(true)
    setError('')
    try {
      const res = await getMyBookings({ status, page })
      if (!isCurrent()) return // đã có request mới hơn — bỏ kết quả này
      if (!res.success) {
        setError(res.message || 'Không tải được lịch sử đặt tour.')
        return
      }
      // Trang vượt quá số trang thực (VD hủy đơn cuối của trang cuối, hoặc gõ ?page=99)
      // → lùi về trang hợp lệ cuối thay vì hiện trạng thái rỗng sai
      if (res.data.length === 0 && page > 1) {
        goToPage(Math.max(1, res.pagination.totalPages))
        return
      }
      setBookings(res.data)
      setPagination(res.pagination)
    } catch {
      if (!isCurrent()) return
      setError('Không tải được lịch sử đặt tour.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, refreshKey])

  // Đổi bộ lọc trạng thái — ghi vào URL, bỏ tham số rỗng, reset page về 1
  function chonTrangThai(value) {
    const params = {}
    if (value) params.status = value
    setSearchParams(params)
    setDonChoHuy(null)
  }

  // Đổi trang — chỉ ghi page, giữ nguyên bộ lọc, cuộn lên đầu
  function goToPage(p) {
    const params = new URLSearchParams(searchParams)
    if (p <= 1) params.delete('page')
    else params.set('page', String(p))
    setSearchParams(params)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Gọi API hủy sau khi người dùng đã bấm xác nhận trong Modal — báo kết quả bằng toast
  async function xacNhanHuy() {
    if (!donChoHuy) return
    setHuyDangGui(true)
    const res = await cancelBooking(donChoHuy._id)
    setHuyDangGui(false)
    setDonChoHuy(null)
    if (!res.success) {
      toast(res.message || 'Không hủy được đơn. Vui lòng thử lại.', 'error')
      return
    }
    toast(res.message || 'Đã hủy đơn thành công.')
    // Tải lại qua refreshKey để effect đọc đúng bộ lọc/trang hiện tại trên URL
    setRefreshKey((k) => k + 1)
  }

  const totalPages = pagination?.totalPages ?? 1

  return (
    <div className="wrap py-[56px]">
      {/* Đầu trang */}
      <p className="eyebrow">LỊCH SỬ ĐẶT TOUR</p>
      <h1 className="mt-2 font-heading text-[30px] font-semibold text-ink">Đơn đặt tour của tôi</h1>
      {pagination && !loading && (
        <p className="mt-2 text-[14px] text-muted">Tìm thấy {pagination.total} đơn</p>
      )}

      {/* Bộ lọc trạng thái */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {BO_LOC.map((bl) => (
          <button
            key={bl.value}
            type="button"
            onClick={() => chonTrangThai(bl.value)}
            className={
              bl.value === status
                ? 'rounded-pill bg-teal px-4 py-2 text-[14px] font-semibold text-white'
                : 'rounded-pill border border-line px-4 py-2 text-[14px] text-ink transition hover:bg-sand'
            }
          >
            {bl.label}
          </button>
        ))}
      </div>

      {/* Đang tải — 3 khối skeleton dạng thẻ đơn */}
      {loading && (
        <div className="mt-7 flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="overflow-hidden rounded-card">
              <div className="flex flex-col sm:flex-row">
                <div className="h-[150px] w-full bg-sand sm:w-[220px]" />
                <div className="flex-1 p-5">
                  <div className="h-4 w-1/3 rounded bg-line" />
                  <div className="mt-3 h-5 w-2/3 rounded bg-line" />
                  <div className="mt-3 h-4 w-1/2 rounded bg-line" />
                </div>
              </div>
            </Skeleton>
          ))}
        </div>
      )}

      {/* Lỗi tải */}
      {!loading && error && (
        <div className="card-surface mt-7 p-6 text-center">
          <p className="text-coralD">{error}</p>
          <Button className="mt-4" onClick={load}>
            Thử lại
          </Button>
        </div>
      )}

      {/* Rỗng */}
      {!loading && !error && bookings.length === 0 && (
        <EmptyState
          className="mt-7"
          title={status ? 'Không có đơn nào ở trạng thái này.' : 'Bạn chưa đặt tour nào.'}
          description="Khám phá các hành trình và đặt chuyến đi đầu tiên của bạn."
          action={
            <Link to="/tours" className="btn-teal">
              Khám phá tour
            </Link>
          }
        />
      )}

      {/* Có dữ liệu — danh sách thẻ đơn */}
      {!loading && !error && bookings.length > 0 && (
        <>
          <div className="mt-7 flex flex-col gap-4">
            {bookings.map((b) => {
              const tt = nhanTrangThai(b.status)
              const anh = b.tour?.images?.[0] || ''
              const daHetHan = expiredIds.has(b._id)
              const tourUrl = b.tour?.slug ? `/tour/${b.tour.slug}` : '/tours'
              return (
                <article key={b._id} className="card-surface overflow-hidden">
                  <div className="flex flex-col sm:flex-row">
                    {anh ? (
                      <img
                        src={anh}
                        alt={b.tourName}
                        className="h-[150px] w-full object-cover sm:h-auto sm:w-[220px]"
                      />
                    ) : (
                      <div className="grid h-[150px] w-full place-items-center bg-sand text-[26px] text-muted sm:h-auto sm:w-[220px]">
                        ✦
                      </div>
                    )}
                    <div className="flex-1 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-muted">
                          Mã đơn: <span className="text-teal">{b.bookingCode}</span>
                        </span>
                        <span className={`rounded-pill px-3 py-1 text-[13px] font-semibold ${tt.className}`}>
                          {tt.label}
                        </span>
                      </div>

                      {/* Tên tour bấm được — dẫn về trang chi tiết */}
                      {b.tour?.slug ? (
                        <Link
                          to={`/tour/${b.tour.slug}`}
                          className="mt-2 block font-heading text-[18px] font-semibold text-ink transition hover:text-teal"
                        >
                          {b.tourName}
                        </Link>
                      ) : (
                        <p className="mt-2 font-heading text-[18px] font-semibold text-ink">{b.tourName}</p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[14px] text-muted">
                        <span>
                          Khởi hành: <b className="font-semibold text-ink">{formatDate(b.departureDate)}</b>
                        </span>
                        <span>
                          Số khách: <b className="font-semibold text-ink">{b.guests}</b>
                        </span>
                        <span>
                          Tổng tiền: <b className="font-semibold text-coralD">{formatPrice(b.totalPrice)}</b>
                        </span>
                      </div>

                      {b.status === 'pending_payment' && b.paymentExpiresAt && (
                        <p className="mt-3 text-[13.5px] text-muted">
                          Giữ chỗ còn:{' '}
                          <BookingCountdown
                            expiresAt={b.paymentExpiresAt}
                            compact
                            onExpire={() => setExpiredIds((ids) => {
                              if (ids.has(b._id)) return ids
                              const next = new Set(ids)
                              next.add(b._id)
                              return next
                            })}
                          />
                        </p>
                      )}

                      {b.paymentReviewRequired && (
                        <p className="mt-3 rounded-[9px] bg-gold/10 px-3 py-2 text-[13px] text-gold">
                          Giao dịch đang chờ quản trị viên đối soát. Không thanh toán lại.
                        </p>
                      )}

                      {b.lastPaymentAttempt && !b.paymentReviewRequired && (
                        <p className="mt-3 text-[13px] text-muted">
                          {TRANG_THAI_GIAO_DICH[b.lastPaymentAttempt.status] || b.lastPaymentAttempt.status} · {{ vnpay: 'VNPay', momo: 'MoMo' }[b.lastPaymentAttempt.provider] || b.lastPaymentAttempt.provider}
                        </p>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link to={`/bookings/${b._id}`} className="btn-ghost !px-4 !py-2 text-[14px]">
                          Xem chi tiết
                        </Link>
                        {['paid', 'completed'].includes(b.status) && (
                          <Link to={`/tickets/${b._id}`} className="btn-teal !px-4 !py-2 text-[14px]">🎫 Xem vé</Link>
                        )}
                        {b.status === 'pending_payment' && !daHetHan && !b.paymentReviewRequired && (
                          <>
                            {['vnpay', 'momo'].includes(b.paymentMethod) && (
                              <Link to={`/payment?bookingId=${b._id}`} className="btn-teal !px-4 !py-2 text-[14px]">
                                Tiếp tục thanh toán
                              </Link>
                            )}
                          <Button
                            variant="ghost"
                            className="!px-4 !py-2 text-[14px] !text-coralD hover:!border-coral"
                            onClick={() => setDonChoHuy(b)}
                          >
                            Hủy đơn
                          </Button>
                          </>
                        )}
                        {['cancelled', 'completed'].includes(b.status) && (
                          <Link to={tourUrl} state={{ rebookGuests: b.guests }} className="btn-teal !px-4 !py-2 text-[14px]">
                            Đặt lại tour
                          </Link>
                        )}
                        {b.status === 'completed' && !b.reviewed && (
                          <Link to={`/bookings/${b._id}`} state={{ openReview: true }} className="btn-coral !px-4 !py-2 text-[14px]">
                            ★ Đánh giá
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>

          <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} />
        </>
      )}

      {/* Modal xác nhận hủy đơn */}
      <Modal
        open={!!donChoHuy}
        title="Hủy đơn đặt tour"
        onClose={() => !huyDangGui && setDonChoHuy(null)}
        actions={
          <>
            <Button variant="ghost" className="!px-4 !py-2 text-[14px]" disabled={huyDangGui} onClick={() => setDonChoHuy(null)}>
              Không
            </Button>
            <Button variant="coral" className="!px-4 !py-2 text-[14px]" disabled={huyDangGui} onClick={xacNhanHuy}>
              {huyDangGui ? 'Đang hủy…' : 'Xác nhận hủy'}
            </Button>
          </>
        }
      >
        Bạn chắc chắn muốn hủy đơn <b className="text-ink">{donChoHuy?.bookingCode}</b>
        {donChoHuy?.tourName ? ` — ${donChoHuy.tourName}` : ''}? Chỗ đã giữ sẽ được hoàn lại cho đợt khởi hành.
      </Modal>
    </div>
  )
}
