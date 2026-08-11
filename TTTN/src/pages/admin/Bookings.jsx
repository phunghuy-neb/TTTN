import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getAdminBookings,
  getAdminBooking,
  updateBookingStatus,
} from '../../services/adminBookingService.js'
import { getAdminTours } from '../../services/adminTourService.js'
import { formatPrice, formatDate } from '../../utils/format.js'
import { nhanTrangThai, CHUYEN_TRANG_THAI, TRANG_THAI_DON } from '../../utils/bookingStatus.js'
import Button from '../../components/ui/Button.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import Modal from '../../components/ui/Modal.jsx'
import Pagination from '../../components/ui/Pagination.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import Table from '../../components/ui/Table.jsx'
import { useToast } from '../../components/ui/Toast.jsx'
import { useRequestGuard } from '../../hooks/useRequestGuard.js'

// Nhãn nút hành động theo trạng thái đích
const NHAN_HANH_DONG = {
  paid: 'Xác nhận đã thanh toán',
  completed: 'Đánh dấu hoàn thành',
  cancelled: 'Hủy đơn',
}

// Trang quản lý đơn đặt (admin) — mọi bộ lọc lấy URL query string làm nguồn duy nhất
export default function Bookings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const [bookings, setBookings] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tourOptions, setTourOptions] = useState([])

  // Modal chi tiết: đơn đang xem + chế độ xác nhận hủy + cờ đang gửi
  const [donChiTiet, setDonChiTiet] = useState(null)
  const [choXacNhanHuy, setChoXacNhanHuy] = useState(false)
  const [dangGui, setDangGui] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Đọc bộ lọc TỪ URL
  const page = Number(searchParams.get('page')) || 1
  const status = searchParams.get('status') || ''
  const tourId = searchParams.get('tourId') || ''
  const dateFrom = searchParams.get('dateFrom') || ''
  const dateTo = searchParams.get('dateTo') || ''
  const q = searchParams.get('q') || ''
  const openId = searchParams.get('open') || '' // chuông topbar nhảy thẳng vào 1 đơn
  const [tuKhoa, setTuKhoa] = useState(q)

  // ?open=<id> → tự mở modal chi tiết đúng đơn (rồi gỡ param để không mở lại khi đổi lọc)
  useEffect(() => {
    if (!openId) return
    moChiTiet(openId)
    const params = new URLSearchParams(searchParams)
    params.delete('open')
    setSearchParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  const beginRequest = useRequestGuard()

  async function load() {
    const isCurrent = beginRequest()
    setLoading(true)
    setError('')
    try {
      const res = await getAdminBookings({ page, status, tourId, dateFrom, dateTo, q })
      if (!isCurrent()) return
      if (!res.success) {
        setError(res.message || 'Không tải được danh sách đơn.')
        return
      }
      setBookings(res.data)
      setPagination(res.pagination)
    } catch {
      if (!isCurrent()) return
      setError('Không tải được danh sách đơn.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, tourId, dateFrom, dateTo, q, refreshKey])

  // Nạp danh sách tour cho select lọc (1 lần)
  useEffect(() => {
    getAdminTours({ limit: 50 }).then((res) => {
      if (res.success) setTourOptions(res.data.map((t) => ({ value: t._id, label: t.name })))
    })
  }, [])

  // Ghi một phần bộ lọc vào URL — reset page về 1
  function apDungBoLoc(thayDoi) {
    const hienTai = { status, tourId, dateFrom, dateTo, q, ...thayDoi }
    const params = {}
    for (const [k, v] of Object.entries(hienTai)) if (v) params[k] = v
    setSearchParams(params)
  }

  function goToPage(p) {
    const params = new URLSearchParams(searchParams)
    if (p <= 1) params.delete('page')
    else params.set('page', String(p))
    setSearchParams(params)
  }

  // Mở modal chi tiết — nạp bản đầy đủ (kèm statusHistory)
  async function moChiTiet(id) {
    setChoXacNhanHuy(false)
    const res = await getAdminBooking(id)
    if (!res.success) {
      toast(res.message || 'Không tải được chi tiết đơn.', 'error')
      return
    }
    setDonChiTiet(res.data)
  }

  // Đổi trạng thái — hủy phải qua bước xác nhận riêng trong modal
  async function doiTrangThai(trangThaiMoi) {
    if (trangThaiMoi === 'cancelled' && !choXacNhanHuy) {
      setChoXacNhanHuy(true)
      return
    }
    setDangGui(true)
    const res = await updateBookingStatus(donChiTiet._id, trangThaiMoi)
    setDangGui(false)
    setChoXacNhanHuy(false)
    if (!res.success) {
      toast(res.message, 'error')
      return
    }
    toast(res.message)
    setDonChiTiet(res.data) // giữ modal mở với trạng thái mới + history mới
    setRefreshKey((k) => k + 1)
  }

  const totalPages = pagination?.totalPages ?? 1

  const columns = [
    {
      key: 'ma',
      label: 'Mã đơn',
      render: (b) => <span className="font-semibold text-teal">{b.bookingCode}</span>,
    },
    {
      key: 'khach',
      label: 'Khách',
      render: (b) => (
        <div className="max-w-[180px]">
          <p className="truncate font-semibold text-ink">{b.contact?.name}</p>
          <p className="truncate text-[12.5px] text-muted">{b.contact?.email}</p>
        </div>
      ),
    },
    {
      key: 'tour',
      label: 'Tour / Ngày đi',
      render: (b) => (
        <div className="max-w-[220px]">
          <p className="truncate text-ink">{b.tourName}</p>
          <p className="text-[12.5px] text-muted">
            {formatDate(b.departureDate)} · {b.guests} khách
          </p>
        </div>
      ),
    },
    {
      key: 'tien',
      label: 'Tổng tiền',
      render: (b) => <span className="font-semibold text-coralD">{formatPrice(b.totalPrice)}</span>,
    },
    {
      key: 'trangThai',
      label: 'Trạng thái',
      render: (b) => {
        const tt = nhanTrangThai(b.status)
        return (
          <span className={`rounded-pill px-2.5 py-0.5 text-[12.5px] font-semibold ${tt.className}`}>
            {tt.label}
          </span>
        )
      },
    },
    { key: 'ngayDat', label: 'Ngày đặt', render: (b) => formatDate(b.createdAt) },
    {
      key: 'thaoTac',
      label: '',
      render: (b) => (
        <Button variant="ghost" className="!px-3 !py-1.5 text-[13px]" onClick={() => moChiTiet(b._id)}>
          Chi tiết
        </Button>
      ),
    },
  ]

  const cacBuocTiepTheo = donChiTiet ? CHUYEN_TRANG_THAI[donChiTiet.status] || [] : []

  return (
    <div>
      <p className="eyebrow">QUẢN LÝ ĐƠN ĐẶT</p>
      <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Danh sách đơn</h1>
      {pagination && !loading && (
        <p className="mt-1 text-[14px] text-muted">Tìm thấy {pagination.total} đơn</p>
      )}

      {/* Filter bar: search + status + tour + khoảng ngày đặt */}
      <form
        className="mt-5 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          apDungBoLoc({ q: tuKhoa.trim() })
        }}
      >
        <input
          type="search"
          placeholder="Mã đơn, tên, email, SĐT…"
          value={tuKhoa}
          onChange={(e) => setTuKhoa(e.target.value)}
          className="field-input !w-[220px]"
        />
        <Button type="submit" className="!px-4 !py-2.5 text-[14px]">
          Tìm
        </Button>
        <select
          value={status}
          onChange={(e) => apDungBoLoc({ status: e.target.value })}
          className="field-input !w-[170px]"
          aria-label="Lọc trạng thái"
        >
          <option value="">Mọi trạng thái</option>
          {Object.entries(TRANG_THAI_DON).map(([value, tt]) => (
            <option key={value} value={value}>{tt.label}</option>
          ))}
        </select>
        <select
          value={tourId}
          onChange={(e) => apDungBoLoc({ tourId: e.target.value })}
          className="field-input !w-[220px]"
          aria-label="Lọc theo tour"
        >
          <option value="">Mọi tour</option>
          {tourOptions.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          Đặt từ
          <input type="date" value={dateFrom} onChange={(e) => apDungBoLoc({ dateFrom: e.target.value })} className="field-input !w-[150px]" />
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          đến
          <input type="date" value={dateTo} onChange={(e) => apDungBoLoc({ dateTo: e.target.value })} className="field-input !w-[150px]" />
        </label>
      </form>

      {loading && (
        <div className="mt-5 flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[54px] rounded-card" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="card-surface mt-5 p-6 text-center">
          <p className="text-coralD">{error}</p>
          <Button className="mt-4" onClick={load}>Thử lại</Button>
        </div>
      )}

      {!loading && !error && bookings.length === 0 && (
        <EmptyState className="mt-5" title="Không có đơn nào khớp bộ lọc." description="Thử nới điều kiện lọc hoặc xóa từ khóa." />
      )}

      {!loading && !error && bookings.length > 0 && (
        <>
          <div className="mt-5">
            <Table columns={columns} rows={bookings} rowKey={(b) => b._id} />
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} />
        </>
      )}

      {/* Modal chi tiết đơn + hành động theo máy trạng thái */}
      <Modal
        open={!!donChiTiet}
        title={donChiTiet ? `Đơn ${donChiTiet.bookingCode}` : ''}
        onClose={() => !dangGui && setDonChiTiet(null)}
        actions={
          donChiTiet && (
            <>
              {choXacNhanHuy ? (
                <>
                  <Button variant="ghost" className="!px-4 !py-2 text-[14px]" disabled={dangGui} onClick={() => setChoXacNhanHuy(false)}>
                    Không hủy
                  </Button>
                  <Button variant="coral" className="!px-4 !py-2 text-[14px]" disabled={dangGui} onClick={() => doiTrangThai('cancelled')}>
                    {dangGui ? 'Đang hủy…' : 'Xác nhận hủy đơn'}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" className="!px-4 !py-2 text-[14px]" disabled={dangGui} onClick={() => setDonChiTiet(null)}>
                    Đóng
                  </Button>
                  {/* Chỉ hiện các bước hợp lệ theo máy trạng thái — trạng thái cuối không có nút */}
                  {cacBuocTiepTheo.map((buoc) => (
                    <Button
                      key={buoc}
                      variant={buoc === 'cancelled' ? 'ghost' : 'teal'}
                      className={`!px-4 !py-2 text-[14px] ${buoc === 'cancelled' ? '!text-coralD hover:!border-coral' : ''}`}
                      disabled={dangGui}
                      onClick={() => doiTrangThai(buoc)}
                    >
                      {dangGui ? 'Đang xử lý…' : NHAN_HANH_DONG[buoc]}
                    </Button>
                  ))}
                </>
              )}
            </>
          )
        }
      >
        {donChiTiet && (
          <div className="flex flex-col gap-2 text-[14px]">
            {choXacNhanHuy && (
              <p className="rounded-[11px] border border-coral/40 bg-coral/5 px-3 py-2 font-semibold text-coralD">
                Hủy đơn sẽ hoàn {donChiTiet.guests} chỗ về đợt khởi hành. Chắc chắn?
              </p>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-muted">Trạng thái</span>
              <span className={`rounded-pill px-2.5 py-0.5 text-[12.5px] font-semibold ${nhanTrangThai(donChiTiet.status).className}`}>
                {nhanTrangThai(donChiTiet.status).label}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Tour</span>
              <span className="text-right font-semibold text-ink">{donChiTiet.tourName}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Ngày khởi hành</span>
              <b className="text-ink">{formatDate(donChiTiet.departureDate)}</b>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Số khách × đơn giá</span>
              <span className="text-ink">
                {donChiTiet.guests} × {formatPrice(donChiTiet.unitPrice)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Tổng tiền</span>
              <b className="text-coralD">{formatPrice(donChiTiet.totalPrice)}</b>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Khách</span>
              <span className="text-right text-ink">
                {donChiTiet.contact?.name} · {donChiTiet.contact?.phone}
                <br />
                {donChiTiet.contact?.email}
              </span>
            </div>
            {donChiTiet.note && (
              <div className="flex justify-between gap-3">
                <span className="text-muted">Ghi chú</span>
                <span className="text-right text-ink">{donChiTiet.note}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-muted">Ngày đặt</span>
              <span className="text-ink">{formatDate(donChiTiet.createdAt)}</span>
            </div>

            {/* Lịch sử trạng thái — audit trail từ statusHistory */}
            {donChiTiet.statusHistory?.length > 0 && (
              <div className="mt-1 border-t border-line pt-2">
                <p className="mb-1 text-[12.5px] font-semibold uppercase tracking-wide text-muted">
                  Lịch sử trạng thái
                </p>
                {donChiTiet.statusHistory.map((h, i) => (
                  <p key={i} className="text-[13px] text-muted">
                    {formatDate(h.at)}: <b className="text-ink">{nhanTrangThai(h.from).label}</b> →{' '}
                    <b className="text-ink">{nhanTrangThai(h.to).label}</b>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
