import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDepartureCalendar } from '../../services/adminOperationsService.js'
import { formatPrice } from '../../utils/format.js'
import Skeleton from '../../components/ui/Skeleton.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import { useToast } from '../../components/ui/Toast.jsx'

const localYmd = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 10)
}

export default function Calendar() {
  const today = new Date()
  const [month, setMonth] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(year, monthNumber - 1, 1)
  const last = new Date(year, monthNumber, 0)
  useEffect(() => {
    setLoading(true)
    getDepartureCalendar({ from: localYmd(first), to: localYmd(last) }).then((res) => {
      if (res.success) setRows(res.departures); else toast(res.message, 'error')
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])
  const byDay = useMemo(() => {
    const map = new Map()
    for (const row of rows) { const day = new Date(row.date).getDate(); map.set(day, [...(map.get(day) || []), row]) }
    return map
  }, [rows])
  const cells = [...Array((first.getDay() + 6) % 7).fill(null), ...Array.from({ length: last.getDate() }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  return <div>
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">LỊCH VẬN HÀNH</p><h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Lịch khởi hành</h1><p className="mt-1 text-[14px] text-muted">Theo dõi số chỗ và doanh thu từng đợt</p></div><input type="month" className="field-input !w-[190px]" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
    {loading ? <Skeleton className="mt-5 h-[620px] rounded-card" /> : rows.length === 0 ? <EmptyState className="mt-5" title="Tháng này chưa có lịch khởi hành." /> : <div className="card-surface mt-5 overflow-x-auto"><div className="grid min-w-[940px] grid-cols-7 border-b border-line bg-sand/60">{['Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7','Chủ nhật'].map((d) => <div key={d} className="px-3 py-2 text-center text-[12px] font-bold text-muted">{d}</div>)}</div><div className="grid min-w-[940px] grid-cols-7">{cells.map((day, index) => <div key={index} className="min-h-[145px] border-b border-r border-line p-2 last:border-r-0"><p className={`text-[12px] font-bold ${day && localYmd(new Date(year, monthNumber - 1, day)) === localYmd(today) ? 'text-coralD' : 'text-muted'}`}>{day || ''}</p><div className="mt-1 space-y-1.5">{day && (byDay.get(day) || []).map((d) => { const stats = Object.fromEntries((d.bookingStats || []).map((s) => [s._id, s])); const revenue = (d.bookingStats || []).reduce((sum, s) => sum + s.revenue, 0); return <Link key={d.departureId} to={`/admin/bookings?tourId=${d.tourId}`} className="block rounded-[8px] bg-teal/5 p-2 text-[11.5px] hover:bg-teal/10"><b className="line-clamp-2 text-teal">{d.tourName}</b><span className="mt-1 block text-muted">Còn {d.availableSlots}/{d.totalSlots} chỗ</span><span className="block text-jade">{(stats.paid?.bookings || 0) + (stats.completed?.bookings || 0)} đơn thu · {formatPrice(revenue)}</span></Link> })}</div></div>)}</div></div>}
  </div>
}
