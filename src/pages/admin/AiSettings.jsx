import { useState, useEffect } from 'react'
import { getAiSettings, patchAiSettings } from '../../services/adminService.js'
import Button from '../../components/ui/Button.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import { useToast } from '../../components/ui/Toast.jsx'
import { useRequestGuard } from '../../hooks/useRequestGuard.js'

// Nhãn + màu cho trạng thái AI service (BE ping thật, timeout 3s)
const TRANG_THAI_AI = {
  not_configured: { label: 'Chưa cấu hình', cham: 'bg-gold', badge: 'bg-gold/15 text-gold' },
  online: { label: 'Đang chạy', cham: 'bg-jade', badge: 'bg-jade/10 text-jade' },
  offline: { label: 'Mất kết nối', cham: 'bg-coralD', badge: 'bg-coral/10 text-coralD' },
}

// Trang Cài đặt AI (admin): trạng thái service, bật/tắt chat toàn site, thống kê dùng chat
export default function AiSettings() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dangKiemTra, setDangKiemTra] = useState(false)
  const [dangLuu, setDangLuu] = useState(false)

  const beginRequest = useRequestGuard()

  async function load({ imLang = false } = {}) {
    const isCurrent = beginRequest()
    if (!imLang) setLoading(true)
    setDangKiemTra(true)
    setError('')
    try {
      const res = await getAiSettings()
      if (!isCurrent()) return
      if (!res.success) {
        setError(res.message || 'Không tải được cài đặt AI.')
        return
      }
      setData(res.data)
    } catch {
      if (!isCurrent()) return
      setError('Không tải được cài đặt AI.')
    } finally {
      if (isCurrent()) {
        setLoading(false)
        setDangKiemTra(false)
      }
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toggle bật/tắt chat widget toàn site
  async function doiChatEnabled() {
    if (!data || dangLuu) return
    setDangLuu(true)
    const res = await patchAiSettings({ chatEnabled: !data.chatEnabled })
    setDangLuu(false)
    if (!res.success) {
      toast(res.message || 'Không lưu được cài đặt.', 'error')
      return
    }
    setData((d) => ({ ...d, chatEnabled: res.chatEnabled }))
    toast(res.message)
  }

  const tt = data ? TRANG_THAI_AI[data.status] || TRANG_THAI_AI.not_configured : null

  if (loading) {
    return (
      <div className="flex max-w-[720px] flex-col gap-4">
        <Skeleton className="h-[140px] rounded-card" />
        <Skeleton className="h-[110px] rounded-card" />
        <Skeleton className="h-[110px] rounded-card" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card-surface max-w-[720px] p-6 text-center">
        <p className="text-coralD">{error}</p>
        <Button className="mt-4" onClick={() => load()}>Thử lại</Button>
      </div>
    )
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      {/* Thẻ trạng thái AI service */}
      <div className="card-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-[17px] font-semibold text-ink">AI service</h2>
            <div className="mt-2 flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${tt.cham}`} />
              <span className={`rounded-pill px-2.5 py-0.5 text-[13px] font-semibold ${tt.badge}`}>{tt.label}</span>
            </div>
            <p className="mt-2 text-[13.5px] text-muted">
              URL: <code className="rounded bg-sand px-1.5 py-0.5 text-ink">{data.aiServiceUrl || '(chưa đặt AI_SERVICE_URL)'}</code>
            </p>
          </div>
          <Button variant="ghost" disabled={dangKiemTra} onClick={() => load({ imLang: true })}>
            {dangKiemTra ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
          </Button>
        </div>
      </div>

      {/* Toggle chat widget toàn site */}
      <div className="card-surface flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="font-heading text-[17px] font-semibold text-ink">Chat trợ lý trên site</h2>
          <p className="mt-1 text-[13.5px] text-muted">
            Tắt là ChatWidget biến mất khỏi toàn bộ trang khách (khách đang mở panel sẽ mất khi tải lại trang).
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={data.chatEnabled}
          aria-label="Bật tắt chat trợ lý"
          disabled={dangLuu}
          onClick={doiChatEnabled}
          className={`relative h-7 w-[52px] shrink-0 rounded-pill transition ${data.chatEnabled ? 'bg-jade' : 'bg-line'} ${dangLuu ? 'opacity-60' : ''}`}
        >
          <span
            className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${
              data.chatEnabled ? 'left-[27px]' : 'left-[3px]'
            }`}
          />
        </button>
      </div>

      {/* Thống kê sử dụng chat */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card-surface p-5">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">Tổng tin nhắn</p>
          <p className="mt-2 font-heading text-[28px] font-semibold text-ink">{data.totalMessages}</p>
        </div>
        <div className="card-surface p-5">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">User đã dùng chat</p>
          <p className="mt-2 font-heading text-[28px] font-semibold text-ink">{data.uniqueUsers}</p>
        </div>
      </div>

      {/* Ghi chú stub */}
      <p className="rounded-[11px] bg-sand px-4 py-3 text-[13.5px] leading-[1.7] text-muted">
        ℹ Trợ lý hiện trả lời bằng <b className="text-ink">stub nội bộ</b> (từ khóa + gợi ý tour thật từ
        DB). Khi AI service của Tuấn Anh sẵn sàng, chỉ cần đặt <code className="rounded bg-white px-1.5 py-0.5">AI_SERVICE_URL</code> trong
        <code className="rounded bg-white px-1.5 py-0.5">.env</code> của Backend rồi bấm "Kiểm tra lại" — không phải sửa code.
      </p>
    </div>
  )
}
