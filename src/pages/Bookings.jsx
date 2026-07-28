import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getMyBookings, cancelBooking } from '../services/bookingService.js'
import { formatPrice, formatDate } from '../utils/format.js'

// Nhãn tiếng Việt + màu phân biệt cho từng trạng thái đơn — chỉ dùng token màu sẵn có
const TRANG_THAI = {
  pending_payment: { label: 'Chờ thanh toán', className: 'bg-gold/15 text-gold' },
  paid: { label: 'Đã thanh toán', className: 'bg-jade/10 text-jade' },
  cancelled: { label: 'Đã hủy', className: 'bg-coral/10 text-coralD' },
  completed: { label: 'Hoàn thành', className: 'bg-teal/10 text-teal' },
}

// Bộ lọc trạng thái — giá trị rỗng nghĩa là xem tất cả
const BO_LOC = [
  { value: '', label: 'Tất cả' },
  { value: 'pending_payment', label: 'Chờ thanh toán' },
  { value: 'paid', label: 'Đã thanh toán' },
  { value: 'cancelled', label: 'Đã hủy' },
  { value: 'completed', label: 'Hoàn thành' },
]

// Trang lịch sử đặt tour (UC-10) — bộ lọc + phân trang lấy URL query string làm nguồn duy nhất
export default function Bookings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [bookings, setBookings] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Hủy đơn: id đang chờ người dùng xác nhận, id đang gửi API, lỗi hủy gần nhất
  const [huyId, setHuyId] = useState('')
  const [huyDangGui, setHuyDangGui] = useState('')
  const [loiHuy, setLoiHuy] = useState('')

  // Tăng để buộc effect tải lại theo ĐÚNG bộ lọc hiện tại trên URL — gọi thẳng load()
  // từ closure hủy đơn sẽ dùng status/page cũ nếu người dùng vừa đổi bộ lọc
  const [refreshKey, setRefreshKey] = useState(0)

  // Đọc bộ lọc TỪ URL
  const page = Number(searchParams.get('page')) || 1
  const status = searchParams.get('status') || ''

  // Đánh số mỗi lần gọi: đổi bộ lọc/trang liên tiếp khiến nhiều request cùng bay,
  // request cũ về sau sẽ ghi đè kết quả của bộ lọc mới nếu không bỏ qua kết quả lỗi thời.
  const requestId = useRef(0)

  // Tải danh sách đơn theo bộ lọc hiện tại trên URL
  async function load() {
    const id = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const res = await getMyBookings({ status, page })
      if (id !== requestId.current) return // đã có request mới hơn — bỏ kết quả này
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
      if (id !== requestId.current) return
      setError('Không tải được lịch sử đặt tour.')
    } finally {
      if (id === requestId.current) setLoading(false)
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
    setHuyId('')
    setLoiHuy('')
  }

  // Đổi trang — chỉ ghi page, giữ nguyên bộ lọc, cuộn lên đầu
  function goToPage(p) {
    const params = new URLSearchParams(searchParams)
    if (p <= 1) params.delete('page')
    else params.set('page', String(p))
    setSearchParams(params)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Gọi API hủy sau khi người dùng đã bấm xác nhận — thành công thì tải lại danh sách
  async function xacNhanHuy(id) {
    setHuyDangGui(id)
    setLoiHuy('')
    const res = await cancelBooking(id)
    setHuyDangGui('')
    setHuyId('')
    if (!res.success) {
      setLoiHuy(res.message || 'Không hủy được đơn. Vui lòng thử lại.')
      return
    }
    // Tải lại qua refreshKey để effect đọc đúng bộ lọc/trang hiện tại trên URL
    setRefreshKey((k) => k + 1)
  }

  const totalPages = pagination?.totalPages ?? 1
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)

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

      {/* Lỗi hủy đơn gần nhất — message thật từ Backend */}
      {loiHuy && (
        <div className="mt-4 rounded-[11px] border border-coral/40 bg-coral/5 px-3.5 py-2.5 text-[13.5px] text-coralD">
          {loiHuy}
        </div>
      )}

      {/* Đang tải — 3 khối skeleton dạng thẻ đơn */}
      {loading && (
        <div className="mt-7 flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-card bg-sand animate-pulse">
              <div className="flex flex-col sm:flex-row">
                <div className="h-[150px] w-full bg-sand sm:w-[220px]" />
                <div className="flex-1 p-5">
                  <div className="h-4 w-1/3 rounded bg-line" />
                  <div className="mt-3 h-5 w-2/3 rounded bg-line" />
                  <div className="mt-3 h-4 w-1/2 rounded bg-line" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lỗi tải */}
      {!loading && error && (
        <div className="card-surface mt-7 p-6 text-center">
          <p className="text-coralD">{error}</p>
          <button type="button" className="btn-teal mt-4" onClick={load}>
            Thử lại
          </button>
        </div>
      )}

      {/* Rỗng */}
      {!loading && !error && bookings.length === 0 && (
        <div className="card-surface mt-7 p-8 text-center">
          <p className="font-heading text-[20px] font-semibold text-ink">
            {status ? 'Không có đơn nào ở trạng thái này.' : 'Bạn chưa đặt tour nào.'}
          </p>
          <p className="mt-2 text-[14.5px] text-muted">
            Khám phá các hành trình và đặt chuyến đi đầu tiên của bạn.
          </p>
          <Link to="/tours" className="btn-teal mt-5">
            Khám phá tour
          </Link>
        </div>
      )}

      {/* Có dữ liệu — danh sách thẻ đơn */}
      {!loading && !error && bookings.length > 0 && (
        <>
          <div className="mt-7 flex flex-col gap-4">
            {bookings.map((b) => {
              const tt = TRANG_THAI[b.status] || { label: b.status, className: 'bg-sand text-muted' }
              const anh = b.tour?.images?.[0] || ''
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

                      {/* Hủy đơn — chỉ với đơn chờ thanh toán, hỏi xác nhận trước khi gọi API */}
                      {b.status === 'pending_payment' && (
                        huyId === b._id ? (
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <span className="text-[14px] font-semibold text-coralD">
                              Bạn chắc chắn muốn hủy đơn này?
                            </span>
                            <button
                              type="button"
                              className="btn-coral !px-4 !py-2 text-[14px]"
                              disabled={huyDangGui === b._id}
                              onClick={() => xacNhanHuy(b._id)}
                            >
                              {huyDangGui === b._id ? 'Đang hủy…' : 'Xác nhận hủy'}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost !px-4 !py-2 text-[14px]"
                              disabled={huyDangGui === b._id}
                              onClick={() => setHuyId('')}
                            >
                              Không
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-ghost mt-4 !px-4 !py-2 text-[14px] !text-coralD hover:!border-coral"
                            onClick={() => {
                              setHuyId(b._id)
                              setLoiHuy('')
                            }}
                          >
                            Hủy đơn
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>

          {/* Phân trang */}
          {totalPages > 1 && (
            <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                className="btn-ghost disabled:cursor-not-allowed disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                Trước
              </button>

              {pageNumbers.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => goToPage(p)}
                  className={
                    p === page
                      ? 'min-w-[40px] rounded-pill bg-teal px-3 py-2 font-semibold text-white'
                      : 'min-w-[40px] rounded-pill border border-line px-3 py-2 text-ink hover:bg-sand'
                  }
                >
                  {p}
                </button>
              ))}

              <button
                type="button"
                className="btn-ghost disabled:cursor-not-allowed disabled:opacity-40"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Sau
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
