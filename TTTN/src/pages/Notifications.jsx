import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notificationService.js'
import { useNotifications } from '../context/NotificationsContext.jsx'
import Button from '../components/ui/Button.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Pagination from '../components/ui/Pagination.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'

const ICON = { booking: '🧾', payment: '💳', trip: '🧳', review: '★', system: '🔔' }
const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' })

export default function Notifications() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const unreadOnly = searchParams.get('unread') === '1'
  const notificationContext = useNotifications()
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    const res = await getNotifications({ page, unreadOnly })
    if (res.success) {
      setItems(res.data)
      setPagination(res.pagination)
      setUnreadCount(res.unreadCount)
    } else setError(res.message || 'Không tải được thông báo.')
    setLoading(false)
  }

  useEffect(() => { load() }, [page, unreadOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  async function read(item) {
    if (item.isRead) return
    const res = await markNotificationRead(item._id)
    if (res.success) {
      setItems((current) => unreadOnly
        ? current.filter((row) => row._id !== item._id)
        : current.map((row) => row._id === item._id ? { ...row, isRead: true } : row))
      if (unreadOnly) setPagination((current) => current ? { ...current, total: Math.max(0, current.total - 1) } : current)
      setUnreadCount((count) => Math.max(0, count - 1))
      notificationContext.refresh()
    }
  }

  async function readAll() {
    const res = await markAllNotificationsRead()
    if (res.success) {
      setItems((current) => unreadOnly ? [] : current.map((item) => ({ ...item, isRead: true })))
      if (unreadOnly) setPagination((current) => current ? { ...current, total: 0, totalPages: 1 } : current)
      setUnreadCount(0)
      notificationContext.refresh()
    }
  }

  return (
    <div className="wrap py-[56px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">CẬP NHẬT CỦA BẠN</p>
          <h1 className="mt-2 font-heading text-[30px] font-semibold text-ink">Trung tâm thông báo</h1>
          <p className="mt-2 text-[14px] text-muted">{unreadCount} thông báo chưa đọc</p>
        </div>
        {unreadCount > 0 && <Button variant="ghost" onClick={readAll}>Đánh dấu tất cả đã đọc</Button>}
      </div>

      <div className="mt-6 flex gap-2">
        <button onClick={() => setSearchParams({})} className={!unreadOnly ? 'rounded-pill bg-teal px-4 py-2 text-[14px] font-semibold text-white' : 'rounded-pill border border-line px-4 py-2 text-[14px]'}>Tất cả</button>
        <button onClick={() => setSearchParams({ unread: '1' })} className={unreadOnly ? 'rounded-pill bg-teal px-4 py-2 text-[14px] font-semibold text-white' : 'rounded-pill border border-line px-4 py-2 text-[14px]'}>Chưa đọc</button>
      </div>

      {loading && <div className="mt-6 space-y-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[110px] rounded-card" />)}</div>}
      {!loading && error && <div className="card-surface mt-6 p-6 text-center text-coralD">{error}</div>}
      {!loading && !error && items.length === 0 && <EmptyState className="mt-6" title={unreadOnly ? 'Không có thông báo chưa đọc' : 'Bạn chưa có thông báo nào'} />}

      {!loading && !error && items.length > 0 && (
        <div className="mt-6 space-y-3">
          {items.map((item) => (
            <article key={item._id} className={`card-surface flex gap-4 p-5 ${item.isRead ? 'opacity-75' : 'border-jade/40 bg-jade/[0.025]'}`}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sand text-[20px]">{ICON[item.type] || '🔔'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <h2 className="font-semibold text-ink">{item.title}</h2>
                  {!item.isRead && <span className="h-2.5 w-2.5 rounded-full bg-coral" title="Chưa đọc" />}
                </div>
                <p className="mt-1 text-[14px] leading-[1.6] text-muted">{item.message}</p>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-[12.5px] text-muted">
                  <time>{dateTimeFormatter.format(new Date(item.createdAt))}</time>
                  {item.link && <Link to={item.link} onClick={() => read(item)} className="font-semibold text-teal hover:text-teal2">Xem chi tiết →</Link>}
                  {!item.isRead && <button type="button" onClick={() => read(item)} className="font-semibold text-jade hover:text-teal">Đánh dấu đã đọc</button>}
                </div>
              </div>
            </article>
          ))}
          <Pagination page={page} totalPages={pagination?.totalPages || 1} onPageChange={(next) => {
            const params = {}
            if (unreadOnly) params.unread = '1'
            if (next > 1) params.page = String(next)
            setSearchParams(params)
          }} />
        </div>
      )}
    </div>
  )
}
