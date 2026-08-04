import { useState, useEffect } from 'react'
import { getStats } from '../../services/adminService.js'
import { formatPrice } from '../../utils/format.js'
import Button from '../../components/ui/Button.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import { useRequestGuard } from '../../hooks/useRequestGuard.js'

// Bốn thẻ số liệu — khớp response GET /api/admin/stats
const THE_SO_LIEU = [
  { key: 'totalTours', label: 'Tổng số tour', icon: '🗺' },
  { key: 'totalBookings', label: 'Tổng đơn đặt', icon: '🧾' },
  { key: 'totalUsers', label: 'Người dùng', icon: '👥' },
  { key: 'revenue', label: 'Doanh thu', icon: '💰', money: true },
]

// Trang tổng quan khu admin — số liệu thật từ GET /api/admin/stats
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

  return (
    <div>
      <p className="eyebrow">TỔNG QUAN</p>
      <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Dashboard</h1>

      {/* Đang tải — 4 khối skeleton cùng cỡ thẻ số liệu */}
      {loading && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[110px] rounded-card" />
          ))}
        </div>
      )}

      {/* Lỗi tải */}
      {!loading && error && (
        <div className="card-surface mt-6 p-6 text-center">
          <p className="text-coralD">{error}</p>
          <Button className="mt-4" onClick={load}>
            Thử lại
          </Button>
        </div>
      )}

      {/* Có dữ liệu */}
      {!loading && !error && stats && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {THE_SO_LIEU.map((the) => (
            <div key={the.key} className="card-surface p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                  {the.label}
                </p>
                <span className="text-[20px]">{the.icon}</span>
              </div>
              <p className="mt-2 font-heading text-[28px] font-semibold text-ink">
                {the.money ? formatPrice(stats[the.key] ?? 0) : (stats[the.key] ?? 0)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
