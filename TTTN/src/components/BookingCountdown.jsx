import { useEffect, useMemo, useRef, useState } from 'react'

function tinhThoiGianConLai(expiresAt, now) {
  const expires = new Date(expiresAt).getTime()
  if (!Number.isFinite(expires)) return null

  const totalSeconds = Math.max(0, Math.floor((expires - now) / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return { totalSeconds, days, hours, minutes, seconds }
}

function haiChuSo(value) {
  return String(value).padStart(2, '0')
}

export default function BookingCountdown({ expiresAt, compact = false, onExpire }) {
  const [now, setNow] = useState(() => Date.now())
  const daBaoHetHan = useRef(false)

  useEffect(() => {
    if (!expiresAt) return undefined
    const expires = new Date(expiresAt).getTime()
    if (!Number.isFinite(expires) || expires <= Date.now()) {
      setNow(Date.now())
      return undefined
    }
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= expires) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  const remaining = useMemo(() => tinhThoiGianConLai(expiresAt, now), [expiresAt, now])

  useEffect(() => {
    if (remaining?.totalSeconds === 0 && !daBaoHetHan.current) {
      daBaoHetHan.current = true
      onExpire?.()
    }
  }, [remaining?.totalSeconds, onExpire])

  if (!remaining) return null

  if (remaining.totalSeconds === 0) {
    return (
      <span className="font-semibold text-coralD" role="status">
        Đã hết thời gian giữ chỗ
      </span>
    )
  }

  const clock = `${remaining.days > 0 ? `${remaining.days} ngày ` : ''}${haiChuSo(remaining.hours)}:${haiChuSo(remaining.minutes)}:${haiChuSo(remaining.seconds)}`

  if (compact) {
    return (
      <span className="font-semibold tabular-nums text-gold" aria-label={`Thời gian giữ chỗ còn lại ${clock}`}>
        {clock}
      </span>
    )
  }

  return (
    <div className="rounded-[11px] border border-gold/30 bg-gold/5 px-4 py-3">
      <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-gold">Thời gian giữ chỗ còn lại</p>
      <p className="mt-1 font-heading text-[24px] font-semibold tabular-nums text-ink" aria-live="polite">
        {clock}
      </p>
      <p className="mt-1 text-[12.5px] text-muted">Hãy hoàn tất thanh toán trước khi thời gian kết thúc.</p>
    </div>
  )
}
