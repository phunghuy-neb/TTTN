import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getAdminReviews, updateReviewVisibility } from '../../services/adminReviewService.js'
import Button from '../../components/ui/Button.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import Pagination from '../../components/ui/Pagination.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import Table from '../../components/ui/Table.jsx'
import { useToast } from '../../components/ui/Toast.jsx'
import { useRequestGuard } from '../../hooks/useRequestGuard.js'

const dateFormatter = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' })

export default function Reviews() {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const beginRequest = useRequestGuard()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const q = searchParams.get('q') || ''
  const rating = searchParams.get('rating') || ''
  const visibility = searchParams.get('visibility') || ''
  const [keyword, setKeyword] = useState(q)
  const [rows, setRows] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState('')

  async function load() {
    const isCurrent = beginRequest()
    setLoading(true)
    setError('')
    const res = await getAdminReviews({ page, q, rating, visibility })
    if (!isCurrent()) return
    if (res.success) {
      setRows(res.data)
      setPagination(res.pagination)
    } else setError(res.message || 'Không tải được danh sách đánh giá.')
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, rating, visibility])

  function applyFilters(change) {
    const next = { q, rating, visibility, ...change }
    const params = {}
    for (const [key, value] of Object.entries(next)) if (value) params[key] = value
    setSearchParams(params)
  }

  async function toggle(review) {
    setUpdatingId(review._id)
    const res = await updateReviewVisibility(review.tour._id, review._id, !review.isVisible)
    setUpdatingId('')
    if (!res.success) {
      toast(res.message || 'Không cập nhật được đánh giá.', 'error')
      return
    }
    toast(res.message)
    const nextVisible = !review.isVisible
    const leavesCurrentFilter = (visibility === 'visible' && !nextVisible) || (visibility === 'hidden' && nextVisible)
    setRows((current) => leavesCurrentFilter
      ? current.filter((item) => item._id !== review._id)
      : current.map((item) => item._id === review._id ? { ...item, isVisible: nextVisible } : item))
    if (leavesCurrentFilter) {
      setPagination((current) => current ? { ...current, total: Math.max(0, current.total - 1) } : current)
    }
  }

  const columns = [
    {
      key: 'review',
      label: 'Đánh giá',
      render: (review) => (
        <div className="max-w-[330px]">
          <p className="font-semibold text-gold">{'★'.repeat(review.rating)}<span className="text-line">{'★'.repeat(5 - review.rating)}</span></p>
          <p className="mt-1 line-clamp-2 text-[13.5px] text-ink">{review.comment}</p>
          <p className="mt-1 text-[12px] text-muted">{dateFormatter.format(new Date(review.createdAt))}</p>
        </div>
      ),
    },
    {
      key: 'tour',
      label: 'Tour',
      render: (review) => <Link to={`/tour/${review.tour.slug}#reviews`} className="block max-w-[220px] truncate font-semibold text-teal hover:text-teal2">{review.tour.name}</Link>,
    },
    {
      key: 'customer',
      label: 'Khách hàng',
      render: (review) => (
        <div className="max-w-[190px]">
          <p className="truncate font-semibold text-ink">{review.user?.name || 'Tài khoản đã xóa'}</p>
          <p className="truncate text-[12px] text-muted">{review.user?.email || '—'}</p>
        </div>
      ),
    },
    {
      key: 'images',
      label: 'Ảnh',
      render: (review) => review.images?.[0]
        ? <img src={review.images[0]} alt="Ảnh đánh giá" className="h-12 w-12 rounded-[8px] object-cover" />
        : <span className="text-muted">—</span>,
    },
    {
      key: 'visibility',
      label: 'Hiển thị',
      render: (review) => (
        <span className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold ${review.isVisible ? 'bg-jade/10 text-jade' : 'bg-coral/10 text-coralD'}`}>
          {review.isVisible ? 'Đang hiển thị' : 'Đã ẩn'}
        </span>
      ),
    },
    {
      key: 'action',
      label: '',
      render: (review) => (
        <Button
          variant="ghost"
          disabled={updatingId === review._id}
          className={`!px-3 !py-1.5 text-[13px] ${review.isVisible ? '!text-coralD' : '!text-teal'}`}
          onClick={() => toggle(review)}
        >
          {updatingId === review._id ? 'Đang lưu…' : review.isVisible ? 'Ẩn' : 'Hiện lại'}
        </Button>
      ),
    },
  ]

  return (
    <div>
      <p className="eyebrow">NỘI DUNG KHÁCH HÀNG</p>
      <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Quản lý đánh giá</h1>
      {pagination && !loading && <p className="mt-1 text-[14px] text-muted">Tìm thấy {pagination.total} đánh giá</p>}

      <form className="mt-5 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); applyFilters({ q: keyword.trim() }) }}>
        <input className="field-input !w-[260px]" type="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Tour, khách hàng, nội dung…" />
        <Button type="submit" className="!px-4 !py-2.5 text-[14px]">Tìm</Button>
        <select className="field-input !w-[160px]" value={rating} onChange={(event) => applyFilters({ rating: event.target.value })}>
          <option value="">Mọi số sao</option>
          {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} sao</option>)}
        </select>
        <select className="field-input !w-[170px]" value={visibility} onChange={(event) => applyFilters({ visibility: event.target.value })}>
          <option value="">Mọi trạng thái</option>
          <option value="visible">Đang hiển thị</option>
          <option value="hidden">Đã ẩn</option>
        </select>
      </form>

      {loading && <div className="mt-5 space-y-2">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[72px] rounded-card" />)}</div>}
      {!loading && error && <div className="card-surface mt-5 p-6 text-center text-coralD">{error}</div>}
      {!loading && !error && rows.length === 0 && <EmptyState className="mt-5" title="Không có đánh giá phù hợp." />}
      {!loading && !error && rows.length > 0 && (
        <>
          <div className="mt-5"><Table columns={columns} rows={rows} rowKey={(review) => review._id} /></div>
          <Pagination page={page} totalPages={pagination?.totalPages || 1} onPageChange={(nextPage) => {
            const params = new URLSearchParams(searchParams)
            if (nextPage > 1) params.set('page', String(nextPage)); else params.delete('page')
            setSearchParams(params)
          }} />
        </>
      )}
    </div>
  )
}
