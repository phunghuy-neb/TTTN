import { useState, useEffect } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from 'recharts'
import { getStats } from '../../services/adminService.js'
import { formatPrice, formatDate } from '../../utils/format.js'
import { nhanTrangThai } from '../../utils/bookingStatus.js'
import Button from '../../components/ui/Button.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import Table from '../../components/ui/Table.jsx'
import { useRequestGuard } from '../../hooks/useRequestGuard.js'

// Bốn thẻ số liệu — khớp response GET /api/admin/stats
const THE_SO_LIEU = [
  { key: 'totalTours', label: 'Tổng số tour', icon: '🗺' },
  { key: 'totalBookings', label: 'Tổng đơn đặt', icon: '🧾' },
  { key: 'totalUsers', label: 'Người dùng', icon: '👥' },
  { key: 'revenue', label: 'Doanh thu', icon: '💰', money: true },
]

// Màu biểu đồ — palette ĐÃ CHẠY QUA validator dataviz (CVD/chroma/contrast pass):
// doanh thu 1 series teal; trạng thái theo thứ tự trục pending→paid→cancelled→completed.
const MAU_DOANH_THU = '#12645C'
const TRANG_THAI_BIEU_DO = [
  { status: 'pending_payment', mau: '#C87E12' },
  { status: 'paid', mau: '#1E8A6E' },
  { status: 'cancelled', mau: '#D9542F' },
  { status: 'completed', mau: '#009B7D' },
]

// Trục/lưới lặng lẽ — chữ dùng token text, không dùng màu series
const TRUC = { fill: '#5E6F6A', fontSize: 12 }
const LUOI = '#E6E0D4'

// Rút gọn tiền cho trục: 94000000 → "94tr"
const tienGon = (v) => (v >= 1e6 ? `${Math.round(v / 1e6)}tr` : v > 0 ? `${Math.round(v / 1e3)}k` : '0')

// Tooltip chung — thẻ trắng viền line, số dùng token chữ
function ChartTooltip({ active, payload, label, money }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[10px] border border-line bg-white px-3 py-2 text-[13px] shadow-soft">
      <p className="font-semibold text-ink">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-muted">
          {p.name}: <b className="text-ink">{money ? formatPrice(p.value) : p.value}</b>
        </p>
      ))}
    </div>
  )
}

// Dàn khung 6 tháng gần nhất (kể cả tháng trống) từ dữ liệu aggregate của BE
function khung6Thang(monthlyRevenue) {
  const banDo = new Map((monthlyRevenue || []).map((t) => [`${t.year}-${t.month}`, t]))
  const out = []
  const bayGio = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(bayGio.getFullYear(), bayGio.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`
    const t = banDo.get(key)
    out.push({ thang: `T${d.getMonth() + 1}`, doanhThu: t?.revenue || 0, soDon: t?.count || 0 })
  }
  return out
}

// Trang tổng quan khu admin — mọi số liệu là aggregate thật từ GET /api/admin/stats
export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const beginRequest = useRequestGuard()

  async function load() {
    const isCurrent = beginRequest()
    setLoading(true)
    setError('')
    try {
      const res = await getStats()
      if (!isCurrent()) return
      if (!res.success) {
        setError(res.message || 'Không tải được số liệu tổng quan.')
        return
      }
      setStats(res.data)
    } catch {
      if (!isCurrent()) return
      setError('Không tải được số liệu tổng quan.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const duLieuThang = stats ? khung6Thang(stats.monthlyRevenue) : []
  const duLieuTrangThai = stats
    ? TRANG_THAI_BIEU_DO.map((t) => ({
        ...t,
        label: nhanTrangThai(t.status).label,
        soDon: stats.byStatus?.[t.status] || 0,
      }))
    : []

  return (
    <div>
      <p className="eyebrow">TỔNG QUAN</p>
      <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Dashboard</h1>

      {loading && (
        <div className="mt-6 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[110px] rounded-card" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-[320px] rounded-card" />
            <Skeleton className="h-[320px] rounded-card" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="card-surface mt-6 p-6 text-center">
          <p className="text-coralD">{error}</p>
          <Button className="mt-4" onClick={load}>Thử lại</Button>
        </div>
      )}

      {!loading && !error && stats && (
        <div className="mt-6 flex flex-col gap-4">
          {/* 4 thẻ số */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {THE_SO_LIEU.map((the) => (
              <div key={the.key} className="card-surface p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">{the.label}</p>
                  <span className="text-[20px]">{the.icon}</span>
                </div>
                <p className="mt-2 font-heading text-[28px] font-semibold text-ink">
                  {the.money ? formatPrice(stats[the.key] ?? 0) : (stats[the.key] ?? 0)}
                </p>
              </div>
            ))}
          </div>

          {/* 2 biểu đồ */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card-surface p-5">
              <h2 className="font-heading text-[17px] font-semibold text-ink">
                Doanh thu 6 tháng gần nhất
              </h2>
              <div className="mt-3 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={duLieuThang} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={LUOI} />
                    <XAxis dataKey="thang" tick={TRUC} axisLine={{ stroke: LUOI }} tickLine={false} />
                    <YAxis tick={TRUC} tickFormatter={tienGon} axisLine={false} tickLine={false} width={44} />
                    <Tooltip cursor={{ fill: '#F1ECE0', opacity: 0.5 }} content={<ChartTooltip money />} />
                    <Bar dataKey="doanhThu" name="Doanh thu" fill={MAU_DOANH_THU} barSize={28} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card-surface p-5">
              <h2 className="font-heading text-[17px] font-semibold text-ink">Đơn theo trạng thái</h2>
              <div className="mt-3 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={duLieuTrangThai} layout="vertical" margin={{ top: 8, right: 34, left: 8, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke={LUOI} />
                    <XAxis type="number" tick={TRUC} allowDecimals={false} axisLine={{ stroke: LUOI }} tickLine={false} />
                    <YAxis type="category" dataKey="label" tick={TRUC} width={110} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#F1ECE0', opacity: 0.5 }} content={<ChartTooltip />} />
                    <Bar dataKey="soDon" name="Số đơn" barSize={22} radius={[0, 4, 4, 0]}>
                      {duLieuTrangThai.map((d) => (
                        <Cell key={d.status} fill={d.mau} />
                      ))}
                      <LabelList dataKey="soDon" position="right" fill="#152623" fontSize={13} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* 2 bảng */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 font-heading text-[17px] font-semibold text-ink">Top 5 tour nhiều đơn nhất</h2>
              <Table
                columns={[
                  { key: 'tourName', label: 'Tour', render: (t) => <span className="text-ink">{t.tourName}</span> },
                  { key: 'soDon', label: 'Số đơn' },
                  {
                    key: 'doanhThu',
                    label: 'Doanh thu',
                    render: (t) => <span className="font-semibold text-coralD">{formatPrice(t.doanhThu)}</span>,
                  },
                ]}
                rows={stats.topTours || []}
                rowKey={(t) => t.tourId}
              />
            </div>
            <div>
              <h2 className="mb-3 font-heading text-[17px] font-semibold text-ink">5 đơn mới nhất</h2>
              <Table
                columns={[
                  { key: 'bookingCode', label: 'Mã đơn', render: (b) => <span className="font-semibold text-teal">{b.bookingCode}</span> },
                  {
                    key: 'tourName',
                    label: 'Tour / Khách',
                    render: (b) => (
                      <div className="max-w-[200px]">
                        <p className="truncate text-ink">{b.tourName}</p>
                        <p className="truncate text-[12.5px] text-muted">{b.user?.name || '—'}</p>
                      </div>
                    ),
                  },
                  { key: 'totalPrice', label: 'Tổng tiền', render: (b) => formatPrice(b.totalPrice) },
                  {
                    key: 'status',
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
                  { key: 'createdAt', label: 'Ngày đặt', render: (b) => formatDate(b.createdAt) },
                ]}
                rows={stats.latestBookings || []}
                rowKey={(b) => b._id}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
