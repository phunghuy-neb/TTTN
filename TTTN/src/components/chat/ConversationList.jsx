import { PlusIcon } from './ChatIcons.jsx'

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

export default function ConversationList({
  conversations,
  activeConversationId,
  onSelect,
  onCreate,
  limit,
  showCreate = false,
  loading = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  creating = false,
  historyPanel = false,
  className = '',
}) {
  const visible = typeof limit === 'number' ? conversations.slice(0, limit) : conversations

  return (
    <div className={className}>
      {showCreate && (
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-coral px-4 py-3 text-sm font-semibold text-white shadow-coral transition hover:bg-coralD disabled:cursor-wait disabled:opacity-60"
        >
          <PlusIcon /> Chat mới
        </button>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-14 animate-pulse rounded-xl bg-sand/70" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
          Chưa có cuộc trò chuyện nào.
        </p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((conversation) => {
            const active = conversation._id === activeConversationId
            return (
              <button
                key={conversation._id}
                type="button"
                onClick={() => onSelect(conversation._id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                  active
                    ? historyPanel
                      ? 'border-jade bg-white text-teal shadow-soft'
                      : 'border-jade bg-jade/10 text-teal'
                    : historyPanel
                      ? 'border-line bg-[#FFFEFB] text-ink hover:border-jade/60 hover:bg-white hover:shadow-sm'
                      : 'border-transparent text-ink hover:border-line hover:bg-white'
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${active ? 'bg-jade' : 'bg-line'}`} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {conversation.title || 'Cuộc trò chuyện mới'}
                </span>
                <span className={`shrink-0 text-[11px] ${historyPanel ? 'font-medium text-[#53635F]' : 'text-muted'}`}>
                  {formatTime(conversation.lastMessageAt)}
                </span>
              </button>
            )
          })}
          {hasMore && onLoadMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-xs font-semibold text-teal transition hover:border-jade disabled:cursor-wait disabled:opacity-60"
            >
              {loadingMore ? 'Đang tải…' : 'Tải thêm cuộc trò chuyện'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
