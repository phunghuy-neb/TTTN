import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { useChat } from '../../context/ChatContext.jsx'
import { formatPrice } from '../../utils/format.js'
import ChatMessageContent from './ChatMessageContent.jsx'
import { BotIcon, SendIcon } from './ChatIcons.jsx'

export default function ChatSurface({ compact = false, className = '', onNavigate }) {
  const { user } = useAuth()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const {
    messages,
    loadingMessages,
    loadingOlderMessages,
    messagePagination,
    sending,
    creatingConversation,
    loadOlderMessages,
    sendMessage,
  } = useChat()
  const [input, setInput] = useState('')
  const endRef = useRef(null)
  const lastRenderedMessageId = useRef('')
  const tourId = pathname.match(/^\/tour\/([^/]+)$/)?.[1] || ''
  const bookingId = pathname.match(/^\/bookings\/([^/]+)$/)?.[1] || ''

  function buildPageContext() {
    const searchParams = new URLSearchParams(search)
    const pageBookingId = bookingId || (pathname === '/payment' ? searchParams.get('bookingId') || '' : '')
    const searchContext = {}
    for (const key of ['q', 'region', 'minPrice', 'maxPrice', 'days', 'sort']) {
      const value = searchParams.get(key)
      if (value) searchContext[key] = value
    }

    let pageType = 'OTHER'
    if (pathname === '/') pageType = 'HOME'
    else if (pathname === '/tours') pageType = 'TOUR_LIST'
    else if (tourId) pageType = 'TOUR_DETAIL'
    else if (pathname === '/ai-assistant') pageType = 'AI_ASSISTANT'
    else if (pathname === '/checkout') pageType = 'CHECKOUT'
    else if (pathname === '/payment') pageType = 'PAYMENT'
    else if (pathname === '/bookings') pageType = 'MY_BOOKINGS'
    else if (/^\/bookings\/[^/]+$/.test(pathname)) pageType = 'BOOKING_DETAIL'

    return {
      pageType,
      ...(tourId ? { tourId } : {}),
      ...(pageBookingId ? { bookingId: pageBookingId } : {}),
      ...(Object.keys(searchContext).length ? { searchContext } : {}),
    }
  }

  useEffect(() => {
    const lastId = messages.at(-1)?._id || ''
    if (sending || lastId !== lastRenderedMessageId.current) {
      endRef.current?.scrollIntoView({ block: 'end' })
    }
    lastRenderedMessageId.current = lastId
  }, [messages, sending])

  async function submit(event) {
    event.preventDefault()
    const content = input.trim()
    if (!content || sending || creatingConversation) return
    setInput('')
    await sendMessage({ message: content, tourId, pageContext: buildPageContext() })
  }

  const goToTour = (tour) => {
    onNavigate?.()
    navigate(`/tour/${tour._id}`)
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      <div
        className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-bg ${compact ? 'p-3.5' : 'p-4 sm:p-6'}`}
      >
        {!loadingMessages && messagePagination.hasMore && (
          <button
            type="button"
            onClick={loadOlderMessages}
            disabled={loadingOlderMessages}
            className="mx-auto rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold text-teal transition hover:border-jade disabled:cursor-wait disabled:opacity-60"
          >
            {loadingOlderMessages ? 'Đang tải…' : 'Tải tin nhắn cũ hơn'}
          </button>
        )}
        {loadingMessages ? (
          <div className="m-auto flex items-center gap-2 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-jade" />
            Đang tải hội thoại…
          </div>
        ) : messages.length === 0 ? (
          <div className={`m-auto max-w-md text-center ${compact ? 'px-3 py-6' : 'px-6 py-12'}`}>
            <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-jade/10 text-jade">
              <BotIcon className="h-7 w-7" />
            </span>
            <h2 className="font-heading text-lg text-teal">Xin chào {user?.name || 'bạn'}!</h2>
            <p className="mt-1.5 text-sm text-muted">
              Mình có thể tư vấn giá, lịch trình và cách đặt tour. Bạn muốn hỏi gì?
            </p>
          </div>
        ) : (
          messages.map((message) =>
            message.role === 'user' ? (
              <div key={message._id} className="flex justify-end">
                <div
                  className={`max-w-[88%] rounded-2xl rounded-br-md bg-teal px-3.5 py-2.5 text-white ${
                    compact ? 'text-[13px]' : 'text-sm sm:max-w-[72%]'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ) : (
              <div key={message._id} className={`flex flex-col gap-2 ${compact ? 'max-w-[94%]' : 'max-w-[92%] lg:max-w-[82%]'}`}>
                <div
                  className={`rounded-2xl rounded-bl-md border px-3.5 py-2.5 ${
                    message.error
                      ? 'border-coral/40 bg-coral/5 text-coralD'
                      : 'border-line bg-white text-ink'
                  } ${compact ? 'text-[13px]' : 'text-sm'}`}
                >
                  <ChatMessageContent content={message.content} compact={compact} />
                </div>

                {message.suggestedTours?.map((tour) => (
                  <button
                    key={tour._id}
                    type="button"
                    onClick={() => !tour.unavailable && goToTour(tour)}
                    disabled={tour.unavailable}
                    className={`flex items-center gap-3 rounded-xl border border-line bg-white text-left transition hover:border-jade hover:shadow-soft ${
                      compact ? 'p-2' : 'p-3'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {tour.image ? (
                      <img
                        src={tour.image}
                        alt=""
                        className={`shrink-0 rounded-lg object-cover ${compact ? 'h-11 w-16' : 'h-14 w-20'}`}
                      />
                    ) : (
                      <span className={`grid shrink-0 place-items-center rounded-lg bg-sand text-jade ${compact ? 'h-11 w-16' : 'h-14 w-20'}`}>
                        <BotIcon className="h-5 w-5" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink">{tour.title}</span>
                      <span className="block text-[12.5px] font-semibold text-coralD">
                        {tour.unavailable ? 'Không còn khả dụng' : formatPrice(tour.price)}
                      </span>
                    </span>
                    <span className="text-lg text-muted">›</span>
                  </button>
                ))}
              </div>
            )
          )
        )}

        {sending && (
          <div className="flex w-[66px] items-center justify-center gap-1 rounded-2xl rounded-bl-md border border-line bg-white px-3 py-3">
            {[0, 120, 240].map((delay) => (
              <span
                key={delay}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className={`flex shrink-0 gap-2 border-t border-line bg-white ${compact ? 'p-3' : 'p-4'}`}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="field-input min-w-0 flex-1 !py-2.5 text-sm"
          placeholder={tourId ? 'Hỏi về tour đang xem…' : 'Nhập tin nhắn…'}
          maxLength={1000}
          aria-label="Nội dung chat"
          disabled={creatingConversation}
        />
        <button
          type="submit"
          disabled={sending || creatingConversation || !input.trim()}
          aria-label="Gửi tin nhắn"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal text-white transition hover:bg-teal2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendIcon />
        </button>
      </form>
    </div>
  )
}
