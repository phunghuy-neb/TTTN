import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getAdminTickets, updateTicketStatus } from '../../services/ticketService.js'
import Button from '../../components/ui/Button.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import Pagination from '../../components/ui/Pagination.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import Table from '../../components/ui/Table.jsx'
import { useToast } from '../../components/ui/Toast.jsx'
import { formatDate } from '../../utils/format.js'

const LABEL = { valid: 'Hợp lệ', used: 'Đã sử dụng', revoked: 'Thu hồi' }
const CLASS = { valid: 'bg-jade/10 text-jade', used: 'bg-gold/15 text-gold', revoked: 'bg-coral/10 text-coralD' }

export default function Tickets() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const status = params.get('status') || ''
  const q = params.get('q') || ''
  const [keyword, setKeyword] = useState(q)
  const [data, setData] = useState({ tickets: [], total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState('')
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    const res = await getAdminTickets({ page, status, q })
    if (res.success) setData(res)
    else toast(res.message, 'error')
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, status, q])

  function filter(changes) {
    const next = { q, status, ...changes }
    const value = {}
    for (const [key, item] of Object.entries(next)) if (item) value[key] = item
    setParams(value)
  }
  async function toggle(ticket) {
    const next = ticket.status === 'used' ? 'valid' : 'used'
    setUpdating(ticket._id)
    const res = await updateTicketStatus(ticket._id, next)
    setUpdating('')
    if (!res.success) return toast(res.message, 'error')
    setData((current) => ({ ...current, tickets: current.tickets.map((item) => item._id === ticket._id ? res.ticket : item) }))
    toast(res.message)
  }
  const columns = [
    { key: 'code', label: 'Vé', render: (t) => <div><Link className="font-semibold text-teal" to={`/tickets/${t.booking?._id}`}>{t.ticketCode}</Link><p className="text-[12px] text-muted">{t.booking?.bookingCode}</p></div> },
    { key: 'tour', label: 'Tour / ngày đi', render: (t) => <div className="max-w-[260px]"><p className="truncate font-semibold">{t.booking?.tourName}</p><p className="text-[12px] text-muted">{t.booking?.departureDate ? formatDate(t.booking.departureDate) : '—'} · {t.booking?.guests || 0} khách</p></div> },
    { key: 'customer', label: 'Khách hàng', render: (t) => <div><p>{t.user?.name || '—'}</p><p className="text-[12px] text-muted">{t.user?.email || '—'}</p></div> },
    { key: 'status', label: 'Trạng thái', render: (t) => <span className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold ${CLASS[t.status]}`}>{LABEL[t.status]}</span> },
    { key: 'action', label: '', render: (t) => t.status !== 'revoked' && <Button variant="ghost" className="!px-3 !py-1.5 text-[13px]" disabled={updating === t._id} onClick={() => toggle(t)}>{updating === t._id ? 'Đang lưu…' : t.status === 'used' ? 'Khôi phục' : 'Check-in'}</Button> },
  ]
  return <div>
    <p className="eyebrow">VẬN HÀNH CHUYẾN ĐI</p>
    <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Vé điện tử</h1>
    <p className="mt-1 text-[14px] text-muted">{data.total} vé đã phát hành</p>
    <form className="mt-5 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); filter({ q: keyword.trim() }) }}>
      <input className="field-input !w-[260px]" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Mã vé…" />
      <Button type="submit" className="!py-2.5">Tìm</Button>
      <select className="field-input !w-[170px]" value={status} onChange={(e) => filter({ status: e.target.value })}><option value="">Mọi trạng thái</option><option value="valid">Hợp lệ</option><option value="used">Đã sử dụng</option><option value="revoked">Thu hồi</option></select>
    </form>
    {loading ? <div className="mt-5 space-y-2">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-[70px] rounded-card" />)}</div> : data.tickets.length ? <><div className="mt-5"><Table columns={columns} rows={data.tickets} rowKey={(t) => t._id} /></div><Pagination page={page} totalPages={data.totalPages} onPageChange={(value) => filter({ page: value > 1 ? value : '' })} /></> : <EmptyState className="mt-5" title="Chưa có vé phù hợp." />}
  </div>
}
