import { Link } from 'react-router-dom'
import { useChat } from '../context/ChatContext.jsx'
import ChatSurface from '../components/chat/ChatSurface.jsx'
import ConversationList from '../components/chat/ConversationList.jsx'
import { BotIcon, PlusIcon } from '../components/chat/ChatIcons.jsx'

export default function AiAssistant() {
  const {
    conversations,
    activeConversation,
    activeConversationId,
    loadingConversations,
    loadingMoreConversations,
    conversationPagination,
    creatingConversation,
    loadMoreConversations,
    createNewConversation,
    selectConversation,
  } = useChat()

  return (
    <div className="min-h-[calc(100dvh-76px)] bg-[radial-gradient(circle_at_top_left,rgba(30,138,110,0.14),transparent_32%),linear-gradient(135deg,#fbfaf6_0%,#f3eee2_100%)] px-3 py-4 sm:px-6 sm:py-7">
      <div className="mx-auto flex h-[calc(100dvh-108px)] min-h-[560px] max-w-[1240px] overflow-hidden rounded-[24px] border border-line bg-white shadow-soft lg:h-[calc(100dvh-132px)]">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-bg/80 max-md:w-[220px] max-sm:hidden">
          <div className="border-b border-line p-4">
            <button
              type="button"
              onClick={createNewConversation}
              disabled={creatingConversation}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-coral px-4 py-3 text-sm font-semibold text-white shadow-coral transition hover:bg-coralD disabled:cursor-wait disabled:opacity-60"
            >
              <PlusIcon /> Chat mới
            </button>
          </div>
          <ConversationList
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelect={selectConversation}
            onCreate={createNewConversation}
            loading={loadingConversations}
            hasMore={conversationPagination.hasMore}
            loadingMore={loadingMoreConversations}
            onLoadMore={loadMoreConversations}
            creating={creatingConversation}
            className="min-h-0 flex-1 overflow-y-auto p-3"
          />
          <div className="border-t border-line p-4">
            <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-teal hover:text-jade">
              <span aria-hidden="true">←</span> Quay lại trang chủ
            </Link>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-4 py-3.5 sm:px-6">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal text-white">
              <BotIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-heading text-lg text-teal sm:text-xl">
                {activeConversation?.title || 'Trợ lý VietVoyage'}
              </h1>
              <p className="text-xs text-muted">Trợ lý hành trình AI của VietVoyage</p>
            </div>
            <button
              type="button"
              onClick={createNewConversation}
              disabled={creatingConversation}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-teal transition hover:border-jade hover:bg-bg disabled:cursor-wait disabled:opacity-60 sm:hidden"
            >
              <PlusIcon className="h-4 w-4" /> Chat mới
            </button>
          </header>

          <div className="border-b border-line bg-bg/80 p-2 sm:hidden">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {conversations.map((conversation) => (
                <button
                  key={conversation._id}
                  type="button"
                  onClick={() => selectConversation(conversation._id)}
                  className={`max-w-[210px] shrink-0 truncate rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    conversation._id === activeConversationId
                      ? 'border-jade bg-jade/10 text-teal'
                      : 'border-line bg-white text-muted'
                  }`}
                >
                  {conversation.title}
                </button>
              ))}
              {conversationPagination.hasMore && (
                <button
                  type="button"
                  onClick={loadMoreConversations}
                  disabled={loadingMoreConversations}
                  className="shrink-0 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-teal disabled:opacity-60"
                >
                  {loadingMoreConversations ? 'Đang tải…' : 'Tải thêm'}
                </button>
              )}
            </div>
          </div>

          <ChatSurface />

          <Link
            to="/"
            className="flex shrink-0 items-center justify-center gap-2 border-t border-line bg-white px-4 py-2.5 text-xs font-semibold text-teal sm:hidden"
          >
            ← Quay lại trang chủ
          </Link>
        </main>
      </div>
    </div>
  )
}
