import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getAdminTours, deleteAdminTour, restoreAdminTour } from '../../services/adminTourService.js'
import { formatPrice } from '../../utils/format.js'
import Button from '../../components/ui/Button.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import Modal from '../../components/ui/Modal.jsx'
import Pagination from '../../components/ui/Pagination.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import Table from '../../components/ui/Table.jsx'
import { useToast } from '../../components/ui/Toast.jsx'
import { useRequestGuard } from '../../hooks/useRequestGuard.js'

// Bộ lọc trạng thái hiển thị — giá trị rỗng nghĩa là xem tất cả
const BO_LOC = [
  { value: '', label: 'Tất cả' },
  { value: 'true', label: 'Đang hoạt động' },
  { value: 'false', label: 'Đã ẩn' },
]

const NHAN_STATUS = {
  draft: { label: 'Nháp', className: 'bg-sand text-muted' },
  published: { label: 'Đang bán', className: 'bg-jade/10 text-jade' },
  archived: { label: 'Lưu trữ', className: 'bg-sand text-muted' },
}

// Trang quản lý tour (admin) — bộ lọc + phân trang lấy URL query string làm nguồn duy nhất
export default function Tours() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [tours, setTours] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tuKhoa, setTuKhoa] = useState(searchParams.get('q') || '')

  // Tour đang chờ xác nhận ẩn trong Modal + cờ đang gửi
  const [tourChoAn, setTourChoAn] = useState(null)
  const [dangGui, setDangGui] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const page = Number(searchParams.get('page')) || 1
  const q = searchParams.get('q') || ''
  const isActive = searchParams.get('isActive') || ''

  const beginRequest = useRequestGuard()

  async function load() {
    const isCurrent = beginRequest()
    setLoading(true)
    setError('')
    try {
      const res = await getAdminTours({ page, q, isActive })
      if (!isCurrent()) return
      if (!res.success) {
        setError(res.message || 'Không tải được danh sách tour.')
        return
      }
      setTours(res.data)
      setPagination(res.pagination)
    } catch {
      if (!isCurrent()) return
      setError('Không tải được danh sách tour.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, isActive, refreshKey])

  // Ghi bộ lọc vào URL — reset page về 1
  function apDungBoLoc(next) {
    const params = {}
    if (next.q) params.q = next.q
    if (next.isActive) params.isActive = next.isActive
    setSearchParams(params)
  }

  function goToPage(p) {
    const params = new URLSearchParams(searchParams)
    if (p <= 1) params.delete('page')
    else params.set('page', String(p))
    setSearchParams(params)
  }

  // Ẩn / hiện lại tour — kết quả báo bằng toast, lỗi 409 đã map tiếng Việt ở service
  async function xacNhanAn() {
    if (!tourChoAn) return
    setDangGui(true)
    const res = await deleteAdminTour(tourChoAn._id)
    setDangGui(false)
    setTourChoAn(null)
    if (!res.success) {
      toast(res.message, 'error')
      return
    }
    toast(res.message)
    setRefreshKey((k) => k + 1)
  }

  async function hienLai(tour) {
    const res = await restoreAdminTour(tour._id)
    if (!res.success) {
      toast(res.message, 'error')
      return
    }
    toast(res.message)
    setRefreshKey((k) => k + 1)
  }

  const totalPages = pagination?.totalPages ?? 1

  const columns = [
    {
      key: 'anh',
      label: 'Ảnh',
      render: (t) =>
        t.images?.[0] ? (
          <img src={t.images[0]} alt="" className="h-[44px] w-[66px] rounded-[8px] object-cover" />
        ) : (
          <span className="grid h-[44px] w-[66px] place-items-center rounded-[8px] bg-sand text-muted">✦</span>
        ),
    },
    {
      key: 'name',
      label: 'Tour',
      render: (t) => (
        <div className="max-w-[260px]">
          <p className="truncate font-semibold text-ink">{t.name}</p>
          <p className="truncate text-[12.5px] text-muted">/{t.slug}</p>
        </div>
      ),
    },
    {
      key: 'basePrice',
      label: 'Giá từ',
      render: (t) => <span className="font-semibold text-coralD">{formatPrice(t.basePrice)}</span>,
    },
    { key: 'dot', label: 'Đợt', render: (t) => t.departures?.length ?? 0 },
    {
      key: 'donActive',
      label: 'Đơn active',
      render: (t) =>
        t.activeBookings > 0 ? (
          <span className="rounded-pill bg-gold/15 px-2.5 py-0.5 text-[13px] font-semibold text-gold">
            {t.activeBookings} đơn
          </span>
        ) : (
          <span className="text-muted">0</span>
        ),
    },
    {
      key: 'trangThai',
      label: 'Trạng thái',
      render: (t) => {
        const st = NHAN_STATUS[t.status] || { label: t.status, className: 'bg-sand text-muted' }
        return (
          <div className="flex flex-wrap gap-1.5">
            <span className={`rounded-pill px-2.5 py-0.5 text-[12.5px] font-semibold ${st.className}`}>
              {st.label}
            </span>
            {t.isActive === false && (
              <span className="rounded-pill bg-coral/10 px-2.5 py-0.5 text-[12.5px] font-semibold text-coralD">
                Đã ẩn
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: 'thaoTac',
      label: 'Thao tác',
      render: (t) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="!px-3 !py-1.5 text-[13px]" onClick={() => navigate(`/admin/tours/${t._id}/edit`)}>
            Sửa
          </Button>
          {t.isActive === false ? (
            <Button variant="ghost" className="!px-3 !py-1.5 text-[13px]" onClick={() => hienLai(t)}>
              Hiện lại
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="!px-3 !py-1.5 text-[13px] !text-coralD hover:!border-coral"
              onClick={() => setTourChoAn(t)}
            >
              Ẩn
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">QUẢN LÝ TOUR</p>
          <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Danh sách tour</h1>
          {pagination && !loading && (
            <p className="mt-1 text-[14px] text-muted">Tìm thấy {pagination.total} tour</p>
          )}
        </div>
        <Link to="/admin/tours/new" className="btn-coral !py-2.5 text-[14.5px]">
          + Thêm tour
        </Link>
      </div>

      {/* Tìm kiếm + lọc trạng thái */}
      <form
        className="mt-5 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          apDungBoLoc({ q: tuKhoa.trim(), isActive })
        }}
      >
        <input
          type="search"
          placeholder="Tìm theo tên, địa điểm…"
          value={tuKhoa}
          onChange={(e) => setTuKhoa(e.target.value)}
          className="field-input !w-[260px]"
        />
        <Button type="submit" className="!px-4 !py-2.5 text-[14px]">
          Tìm
        </Button>
        <div className="ml-2 flex flex-wrap gap-2">
          {BO_LOC.map((bl) => (
            <button
              key={bl.value}
              type="button"
              onClick={() => apDungBoLoc({ q, isActive: bl.value })}
              className={
                bl.value === isActive
                  ? 'rounded-pill bg-teal px-3.5 py-1.5 text-[13.5px] font-semibold text-white'
                  : 'rounded-pill border border-line px-3.5 py-1.5 text-[13.5px] text-ink transition hover:bg-sand'
              }
            >
              {bl.label}
            </button>
          ))}
        </div>
      </form>

      {/* Đang tải */}
      {loading && (
        <div className="mt-5 flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[58px] rounded-card" />
          ))}
        </div>
      )}

      {/* Lỗi */}
      {!loading && error && (
        <div className="card-surface mt-5 p-6 text-center">
          <p className="text-coralD">{error}</p>
          <Button className="mt-4" onClick={load}>
            Thử lại
          </Button>
        </div>
      )}

      {/* Rỗng */}
      {!loading && !error && tours.length === 0 && (
        <EmptyState
          className="mt-5"
          title={q || isActive ? 'Không có tour nào khớp bộ lọc.' : 'Chưa có tour nào.'}
          description="Bấm “Thêm tour” để tạo tour đầu tiên."
          action={
            <Link to="/admin/tours/new" className="btn-teal">
              Thêm tour
            </Link>
          }
        />
      )}

      {/* Bảng dữ liệu */}
      {!loading && !error && tours.length > 0 && (
        <>
          <div className="mt-5">
            <Table columns={columns} rows={tours} rowKey={(t) => t._id} />
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} />
        </>
      )}

      {/* Modal xác nhận ẩn tour — hiện số đơn active nếu có */}
      <Modal
        open={!!tourChoAn}
        title="Ẩn tour khỏi trang khách"
        onClose={() => !dangGui && setTourChoAn(null)}
        actions={
          <>
            <Button variant="ghost" className="!px-4 !py-2 text-[14px]" disabled={dangGui} onClick={() => setTourChoAn(null)}>
              Không
            </Button>
            <Button variant="coral" className="!px-4 !py-2 text-[14px]" disabled={dangGui} onClick={xacNhanAn}>
              {dangGui ? 'Đang ẩn…' : 'Xác nhận ẩn'}
            </Button>
          </>
        }
      >
        Ẩn tour <b className="text-ink">{tourChoAn?.name}</b> khỏi trang khách? Tour không bị xóa —
        có thể hiện lại bất cứ lúc nào.
        {tourChoAn?.activeBookings > 0 && (
          <span className="mt-2 block font-semibold text-coralD">
            ⚠ Tour đang có {tourChoAn.activeBookings} đơn active — server sẽ từ chối cho tới khi các
            đơn được xử lý xong.
          </span>
        )}
      </Modal>
    </div>
  )
}
