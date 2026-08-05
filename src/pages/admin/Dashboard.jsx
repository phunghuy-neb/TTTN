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
  PieChart,
  Pie,
  Legend,
} from 'recharts'
import { getStats } from '../../services/adminService.js'
import { formatPrice, formatDate } from '../../utils/format.js'
import { nhanTrangThai } from '../../utils/bookingStatus.js'
import { REGIONS } from '../../constants/regions.js'
import Button from '../../components/ui/Button.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import Table from '../../components/ui/Table.jsx'
import { useRequestGuard } from '../../hooks/useRequestGuard.js'

// Màu biểu đồ — ĐÃ CHẠY QUA validator dataviz (CVD/chroma/contrast pass):
// doanh thu 1 series teal; trạng thái pending→paid→cancelled→completed;
// pie 3 miền jade/gold/blue (mọi cặp kề của pie đều pass, kể cả cặp wrap).
const MAU_DOANH_THU = '#12645C'
const TRANG_THAI_BIEU_DO = [
  { status: 'pending_payment', mau: '#C87E12' },
  { status: 'paid', mau: '#1E8A6E' },
  { status: 'cancelled', mau: '#D9542F' },
  { status: 'completed', mau: '#009B7D' },
]
const MAU_MIEN = { 'Miền Bắc': '#1E8A6E', 'Miền Trung': '#C87E12', 'Miền Nam': '#2E6FBF' }

// Badge trạng thái cho danh sách "Booking mới nhất" — MÀU THEO MOCKUP:
// Đã thanh toán xanh lá, Chờ xử lý cam, Đã hủy đỏ, Hoàn thành XANH DƯƠNG
// (khác badge teal dùng chung ở các bảng khác — chỉ áp cho khối mockup này).
const BADGE_MOCKUP = {
  completed: 'bg-[#2E6FBF]/10 text-[#2E6FBF]',
}

const TRUC = { fill: '#5E6F6A', fontSize: 12 }
const LUOI = '#E6E0D4'

// 88400000 → "88,4tr" (mockup rút gọn kiểu VN, phẩy thập phân)
const tienRutGon = (v) => {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace('.', ',')} tỷ`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')}tr`
  if (v > 0) return `${Math.round(v / 1e3)}k`
  return '0đ'
}
const tienGonTruc = (v) => (v >= 1e6 ? `${Math.round(v / 1e6)}tr` : v > 0 ? `${Math.round(v / 1e3)}k` : '0')

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

// Tooltip riêng cho pie khu vực: doanh thu + số đơn
function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-[10px] border border-line bg-white px-3 py-2 text-[13px] shadow-soft">
      <p className="font-semibold text-ink">{d.region}</p>
      <p className="text-muted">
        Doanh thu: <b className="text-ink">{formatPrice(d.revenue)}</b>
      </p>
      <p className="text-muted">
        Số đơn: <b className="text-ink">{d.bookings}</b>
      </p>
    </div>
  )
}

function khung6Thang(monthlyRevenue) {
  const banDo = new Map((monthlyRevenue || []).map((t) => [`${t.year}-${t.month}`, t]))
  const out = []
  const bayGio = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(bayGio.getFullYear(), bayGio.getMonth() - i, 1)
    const t = banDo.get(`${d.getFullYear()}-${d.getMonth() + 1}`)
    out.push({ thang: `T${d.getMonth() + 1}`, doanhThu: t?.revenue || 0, soDon: t?.count || 0 })
  }
  return out
}

// Trang tổng quan khu admin — bố cục theo mockup báo cáo, số liệu aggregate thật
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
  // Pie theo thứ tự REGIONS cố định — màu bám miền, không bám thứ hạng
  const duLieuMien = stats
    ? REGIONS.map((r) => stats.revenueByRegion?.find((m) => m.region === r) || { region: r, revenue: 0, bookings: 0 })
    : []

  // 4 thẻ số theo mockup
  const theSo = stats
    ? [
        { label: 'Doanh thu tháng', giaTri: tienRutGon(stats.currentMonthRevenue), icon: '💰' },
        { label: 'Booking chờ duyệt', giaTri: stats.pendingBookings, icon: '🕐' },
        { label: 'Người dùng', giaTri: stats.totalUsers, icon: '👥' },
        { label: 'Tour đang hoạt động', giaTri: stats.activeTours, icon: '🗺' },
      ]
    : []

  return (
    <div>
      {loading && (
        <div className="flex flex-col gap-4">
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
        <div className="card-surface p-6 text-center">
          <p className="text-coralD">{error}</p>
          <Button className="mt-4" onClick={load}>Thử lại</Button>
        </div>
      )}

      {!loading && !error && stats && (
        <div className="flex flex-col gap-4">
          {/* Hàng 1 — 4 thẻ số theo mockup */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {theSo.map((the) => (
              <div key={the.label} className="card-surface p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">{the.label}</p>
                  <span className="text-[20px]">{the.icon}</span>
                </div>
                <p className="mt-2 font-heading text-[28px] font-semibold text-ink">{the.giaTri}</p>
              </div>
            ))}
          </div>

          {/* Hàng 2 — bar doanh thu 6 tháng + pie tỷ lệ khu vực (mockup) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card-surface p-5">
              <h2 className="font-heading text-[17px] font-semibold text-ink">Doanh thu 6 tháng gần nhất</h2>
              <div className="mt-3 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={duLieuThang} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={LUOI} />
                    <XAxis dataKey="thang" tick={TRUC} axisLine={{ stroke: LUOI }} tickLine={false} />
                    <YAxis tick={TRUC} tickFormatter={tienGonTruc} axisLine={false} tickLine={false} width={44} />
                    <Tooltip cursor={{ fill: '#F1ECE0', opacity: 0.5 }} content={<ChartTooltip money />} />
                    <Bar dataKey="doanhThu" name="Doanh thu" fill={MAU_DOANH_THU} barSize={28} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card-surface p-5">
              <h2 className="font-heading text-[17px] font-semibold text-ink">Tỷ lệ theo khu vực</h2>
              <div className="mt-3 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={duLieuMien}
                      dataKey="revenue"
                      nameKey="region"
                      innerRadius="52%"
                      outerRadius="80%"
                      paddingAngle={2}
                      stroke="#FFFFFF"
                      strokeWidth={2}
                    >
                      {duLieuMien.map((d) => (
                        <Cell key={d.region} fill={MAU_MIEN[d.region]} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend
                      formatter={(value) => <span className="text-[13px] text-ink">{value}</span>}
                      iconType="circle"
                      iconSize={9}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Hàng 3 — đơn theo trạng thái (giữ từ trước) + Booking mới nhất kiểu mockup */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card-surface p-5">
              <h2 className="font-heading text-[17px] font-semibold text-ink">Đơn theo trạng thái</h2>
              <div className="mt-3 h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={duLieuTrangThai} layout="vertical" margin={{ top: 8, right: 34, left: 8, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke={LUOI} />
                    <XAxis type="number" tick={TRUC} allowDecimals={false} axisLine={{ stroke: LUOI }} tickLine={false} />
                    <YAxis type="category" dataKey="label" tick={TRUC} width={110} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#F1ECE0', opacity: 0.5 }} content={<ChartTooltip />} />
                    <Bar dataKey="soDon" name="Số đơn" barSize={20} radius={[0, 4, 4, 0]}>
                      {duLieuTrangThai.map((d) => (
                        <Cell key={d.status} fill={d.mau} />
                      ))}
                      <LabelList dataKey="soDon" position="right" fill="#152623" fontSize={13} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Booking mới nhất — dòng "Tên khách - Tên tour", badge căn phải (mockup) */}
            <div className="card-surface p-5">
              <h2 className="font-heading text-[17px] font-semibold text-ink">Booking mới nhất</h2>
              <div className="mt-2 flex flex-col divide-y divide-line/70">
                {(stats.latestBookings || []).map((b) => {
                  const tt = nhanTrangThai(b.status)
                  return (
                    <div key={b._id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-ink">
                          {b.user?.name || '—'} - {b.tourName}
                        </p>
                        <p className="text-[12.5px] text-muted">
                          {b.bookingCode} · {formatPrice(b.totalPrice)} · {formatDate(b.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-pill px-2.5 py-0.5 text-[12.5px] font-semibold ${
                          BADGE_MOCKUP[b.status] || tt.className
                        }`}
                      >
                        {tt.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Hàng 4 — Top 5 tour (giữ từ trước) */}
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
        </div>
      )}
    </div>
  )
}
