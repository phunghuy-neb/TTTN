import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { sendChatMessage, getChatHistory, clearChatHistory } from '../../services/chatService.js'
import { formatPrice } from '../../utils/format.js'
import { onOpenChat } from './chatEvents.js'
import Button from '../ui/Button.jsx'

// Widget chat với trợ lý AI (UC-07): nút nổi + panel góc phải dưới.
// - Chưa đăng nhập → mời đăng nhập, KHÔNG gọi API nào.
// - Đang ở /tour/:slug → gửi kèm tourId (slug) làm context.
// - BE 503 AI_UNAVAILABLE → thông báo lịch sự trong panel, web còn lại vẫn chạy.
export default function ChatWidget() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([]) // { role, content, suggestedTours? }
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [daNapLichSu, setDaNapLichSu] = useState(false)
  const [choXoa, setChoXoa] = useState(false)
  const cuoiDanhSach = useRef(null)

  // Slug tour đang xem — BE nhận cả slug lẫn ObjectId làm tourId
  const tourId = pathname.match(/^\/tour\/([^/]+)$/)?.[1] || ''

  // Các nút CTA "Hỏi trợ lý AI" ở Home/TourDetail mở panel qua event bus
  useEffect(() => onOpenChat(() => setOpen(true)), [])

  // Đổi tài khoản / đăng xuất → panel nạp lại lịch sử của người mới
  useEffect(() => {
    setMessages([])
    setDaNapLichSu(false)
  }, [user?._id])

  // Nạp lịch sử khi mở panel lần đầu (chỉ khi đã đăng nhập)
  useEffect(() => {
    if (!open || !user || daNapLichSu) return
    ;(async () => {
      const res = await getChatHistory({ limit: 20 })
      setDaNapLichSu(true)
      if (res.success) {
        // BE trả mới → cũ; đảo lại để hiển thị cũ → mới
        setMessages([...res.data].reverse().map((m) => ({ role: m.role, content: m.content })))
      }
    })()
  }, [open, user, daNapLichSu])

  // Tự cuộn xuống cuối khi có tin mới / đang gõ
  useEffect(() => {
    cuoiDanhSach.current?.scrollIntoView({ block: 'end' })
  }, [messages, typing, open])

  async function gui(e) {
    e?.preventDefault()
    const noiDung = input.trim()
    if (!noiDung || typing || !user) return
    setInput('')
    setChoXoa(false)
    setMessages((ms) => [...ms, { role: 'user', content: noiDung }])
    setTyping(true)

    const res = await sendChatMessage({ message: noiDung, tourId })
    setTyping(false)

    if (!res.success) {
      // 503 AI_UNAVAILABLE hoặc lỗi mạng — báo trong panel, không phá gì khác
      setMessages((ms) => [
        ...ms,
        {
          role: 'assistant',
          loi: true,
          content:
            res.code === 'AI_UNAVAILABLE'
              ? res.message || 'Trợ lý AI đang tạm gián đoạn. Bạn thử lại sau ít phút nhé.'
              : res.message || 'Không gửi được tin nhắn. Vui lòng thử lại.',
        },
      ])
      return
    }
    setMessages((ms) => [
      ...ms,
      { role: 'assistant', content: res.reply, suggestedTours: res.suggestedTours || [] },
    ])
  }

  async function xoaHoiThoai() {
    const res = await clearChatHistory()
    setChoXoa(false)
    if (res.success) setMessages([])
  }

  return (
    <>
      {/* Panel chat */}
      <div
        className={`fixed bottom-[98px] right-[16px] z-[60] flex max-h-[70vh] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-[20px] border border-line bg-white shadow-2xl transition sm:right-[26px] ${
          open ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-5 opacity-0'
        }`}
        role="dialog"
        aria-label="Chat với trợ lý AI"
      >
        {/* Header */}
        <div className="flex items-center gap-3 bg-gradient-to-br from-teal to-jade px-[18px] py-3.5 text-white">
          <span className="grid h-[38px] w-[38px] place-items-center rounded-[12px] bg-white/20 text-[18px]">✦</span>
          <div className="flex-1">
            <b className="font-heading text-[16px]">Trợ lý du lịch</b>
            <small className="block text-xs text-[#C9EBE2]">Hỏi về giá, lịch trình, cách đặt tour…</small>
          </div>
          {user && messages.length > 0 && (
            <button
              type="button"
              onClick={() => setChoXoa((v) => !v)}
              className="rounded-[8px] px-2 py-1 text-[12.5px] text-white/85 transition hover:bg-white/15"
              title="Xóa hội thoại"
            >
              Xóa
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Đóng chat"
            className="rounded-[8px] px-2 py-1 text-white/85 transition hover:bg-white/15"
          >
            ✕
          </button>
        </div>

        {/* Xác nhận xóa hội thoại */}
        {choXoa && (
          <div className="flex items-center justify-between gap-2 border-b border-line bg-coral/5 px-4 py-2 text-[13px] text-coralD">
            Xóa toàn bộ hội thoại?
            <span className="flex gap-2">
              <button type="button" className="font-semibold" onClick={xoaHoiThoai}>Xóa</button>
              <button type="button" className="text-muted" onClick={() => setChoXoa(false)}>Thôi</button>
            </span>
          </div>
        )}

        {/* Thân panel */}
        {!user ? (
          <div className="flex flex-col items-center gap-3 bg-bg p-6 text-center">
            <p className="text-[14.5px] text-muted">
              Đăng nhập để trò chuyện với trợ lý và lưu lại lịch sử tư vấn của bạn.
            </p>
            <Link to="/login" className="btn-teal !py-2.5 text-[14px]" onClick={() => setOpen(false)}>
              Đăng nhập
            </Link>
          </div>
        ) : (
          <>
            <div className="flex min-h-[220px] flex-1 flex-col gap-2.5 overflow-y-auto bg-bg p-4">
              {messages.length === 0 && !typing && (
                <div className="max-w-[88%] rounded-[14px] rounded-bl-[4px] border border-line bg-white px-[13px] py-2.5 text-[13.5px] text-ink">
                  Xin chào {user.name} 👋 Mình có thể tư vấn giá, lịch trình và cách đặt tour. Bạn muốn
                  hỏi gì?
                </div>
              )}

              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="self-end">
                    <div className="max-w-[300px] rounded-[14px] rounded-br-[4px] bg-teal px-[13px] py-2.5 text-[13.5px] text-white">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex max-w-[88%] flex-col gap-2">
                    <div
                      className={`rounded-[14px] rounded-bl-[4px] border px-[13px] py-2.5 text-[13.5px] ${
                        m.loi ? 'border-coral/40 bg-coral/5 text-coralD' : 'border-line bg-white text-ink'
                      }`}
                    >
                      {m.content}
                    </div>
                    {/* Tour gợi ý — card bấm được, sang trang chi tiết */}
                    {m.suggestedTours?.length > 0 &&
                      m.suggestedTours.map((t) => (
                        <button
                          key={t._id}
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            navigate(`/tour/${t._id}`)
                          }}
                          className="flex items-center gap-2.5 rounded-[12px] border border-line bg-white p-2 text-left transition hover:border-jade"
                        >
                          {t.image ? (
                            <img src={t.image} alt="" className="h-[42px] w-[58px] rounded-[8px] object-cover" />
                          ) : (
                            <span className="grid h-[42px] w-[58px] place-items-center rounded-[8px] bg-sand text-muted">✦</span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-ink">{t.title}</span>
                            <span className="block text-[12.5px] font-semibold text-coralD">
                              {formatPrice(t.price)}
                            </span>
                          </span>
                          <span className="text-muted">›</span>
                        </button>
                      ))}
                  </div>
                )
              )}

              {/* Trạng thái đang gõ */}
              {typing && (
                <div className="flex w-[64px] items-center justify-center gap-1 rounded-[14px] rounded-bl-[4px] border border-line bg-white px-3 py-3">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:240ms]" />
                </div>
              )}
              <div ref={cuoiDanhSach} />
            </div>

            {/* Ô nhập */}
            <form onSubmit={gui} className="flex gap-2 border-t border-line bg-white p-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="field-input flex-1 !py-2.5 text-sm"
                placeholder={tourId ? 'Hỏi về tour đang xem…' : 'Nhập tin nhắn…'}
                maxLength={1000}
                aria-label="Nội dung chat"
              />
              <Button type="submit" variant="teal" className="!px-4 !py-2 text-[16px]" disabled={typing || !input.trim()} aria-label="Gửi">
                ➜
              </Button>
            </form>
          </>
        )}
      </div>

      {/* Nút nổi mở chat */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Trợ lý AI"
        title="Trợ lý AI"
        className="grid h-[60px] w-[60px] place-items-center rounded-full bg-coral text-[24px] text-white shadow-float transition hover:scale-105"
      >
        💬
      </button>
    </>
  )
}
