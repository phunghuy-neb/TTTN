import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { useChat } from '../../context/ChatContext.jsx'
import { getPublicSettings } from '../../services/settingsService.js'
import { onOpenChat } from './chatEvents.js'
import ChatSurface from './ChatSurface.jsx'
import ConversationList from './ConversationList.jsx'
import {
  ArrowUpRightIcon,
  BotIcon,
  CloseIcon,
  HistoryIcon,
  PlusIcon,
} from './ChatIcons.jsx'

export default function ChatWidget() {
  const { user } = useAuth()
  const {
    conversations,
    activeConversationId,
    loadingConversations,
    loadingMoreConversations,
    conversationPagination,
    creatingConversation,
    loadMoreConversations,
    createNewConversation,
    selectConversation,
  } = useChat()
  const [open, setOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [chatEnabled, setChatEnabled] = useState(true)

  useEffect(() => {
    getPublicSettings().then((res) => {
      if (res.success && res.chatEnabled === false) setChatEnabled(false)
    })
  }, [])

  useEffect(() => onOpenChat(() => setOpen(true)), [])

  useEffect(() => {
    setHistoryOpen(false)
  }, [user?._id])

  async function newChat() {
    if (!user) return
    await createNewConversation()
    setHistoryOpen(false)
  }

  async function chooseConversation(conversationId) {
    await selectConversation(conversationId)
    setHistoryOpen(false)
  }

  if (!chatEnabled) return null

  return (
    <>
      <section
        className={`fixed bottom-[196px] right-3 z-[70] flex h-[min(580px,calc(100dvh-300px))] w-[min(390px,calc(100vw-24px))] flex-col overflow-hidden rounded-[22px] border border-line bg-white shadow-2xl transition sm:bottom-[210px] sm:right-[26px] sm:h-[min(620px,calc(100dvh-244px))] ${
          open
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-4 opacity-0'
        }`}
        role="dialog"
        aria-label="Trợ lý VietVoyage"
        aria-hidden={!open}
      >
        <header className="flex shrink-0 items-center gap-2 bg-gradient-to-br from-teal to-jade px-3.5 py-3 text-white">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15">
            <BotIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-heading text-[16px] font-semibold">Trợ lý VietVoyage</h2>
            <p className="truncate text-[11.5px] text-white/75">Tư vấn hành trình của riêng bạn</p>
          </div>
          <button
            type="button"
            onClick={() => setHistoryOpen((value) => !value)}
            aria-label="Mở lịch sử trò chuyện"
            aria-expanded={historyOpen}
            title="Lịch sử trò chuyện"
            className={`grid h-9 w-9 place-items-center rounded-lg transition hover:bg-white/15 ${
              historyOpen ? 'bg-white/20' : ''
            }`}
          >
            <HistoryIcon />
          </button>
          <button
            type="button"
            onClick={newChat}
            disabled={creatingConversation}
            aria-label="Tạo chat mới"
            title="Chat mới"
            className="grid h-9 w-9 place-items-center rounded-lg transition hover:bg-white/15 disabled:cursor-wait disabled:opacity-50"
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Đóng chat"
            title="Đóng"
            className="grid h-9 w-9 place-items-center rounded-lg transition hover:bg-white/15"
          >
            <CloseIcon />
          </button>
        </header>

        {!user ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-bg p-7 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-jade/10 text-jade">
              <BotIcon className="h-8 w-8" />
            </span>
            <p className="text-sm text-muted">
              Đăng nhập để trò chuyện và lưu lại lịch sử tư vấn của bạn.
            </p>
            <Link to="/login" className="btn-teal !py-2.5 text-sm" onClick={() => setOpen(false)}>
              Đăng nhập
            </Link>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {historyOpen && (
              <div className="absolute inset-0 z-10 flex min-h-0 flex-col bg-[#FBFAF6]">
                <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3 shadow-[0_5px_18px_-16px_rgba(13,74,69,0.65)]">
                  <div>
                    <p className="font-heading text-[15px] font-semibold text-teal">Lịch sử trò chuyện</p>
                    <p className="text-[11.5px] text-muted">Chọn để tiếp tục nơi bạn đã dừng</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(false)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-sand"
                    aria-label="Đóng lịch sử"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
                <ConversationList
                  conversations={conversations}
                  activeConversationId={activeConversationId}
                  onSelect={chooseConversation}
                  onCreate={newChat}
                  loading={loadingConversations}
                  hasMore={conversationPagination.hasMore}
                  loadingMore={loadingMoreConversations}
                  onLoadMore={loadMoreConversations}
                  creating={creatingConversation}
                  showCreate
                  historyPanel
                  className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#FBFAF6] p-3"
                />
              </div>
            )}
            <ChatSurface compact onNavigate={() => setOpen(false)} />
          </div>
        )}

        <Link
          to="/ai-assistant"
          onClick={() => setOpen(false)}
          className="flex shrink-0 items-center justify-center gap-1.5 border-t border-line bg-white px-4 py-3 text-[13px] font-semibold text-jade transition hover:bg-bg hover:text-teal"
        >
          Mở trợ lý đầy đủ <ArrowUpRightIcon />
        </Link>
      </section>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Trợ lý AI"
        aria-expanded={open}
        title="Trợ lý AI"
        className="grid h-12 w-12 place-items-center rounded-full bg-coral text-white shadow-float transition hover:-translate-y-0.5 hover:scale-105 hover:bg-coralD focus:outline-none focus:ring-4 focus:ring-coral/20"
      >
        <BotIcon className="h-7 w-7" />
      </button>
    </>
  )
}
