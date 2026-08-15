import ChatWidget from './chat/ChatWidget.jsx'
import { MessengerIcon, ZaloIcon } from './chat/ChatIcons.jsx'

const floatingButtonClass =
  'grid h-12 w-12 place-items-center rounded-full shadow-float transition hover:-translate-y-0.5 hover:scale-105 focus:outline-none focus:ring-4'

export default function FloatingContact() {
  return (
    <div className="fixed bottom-4 right-3 z-[60] flex flex-col items-center gap-2.5 sm:bottom-[26px] sm:right-[26px]">
      <a
        href="https://zalo.me/0349347004"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat qua Zalo"
        title="Zalo"
        className={`${floatingButtonClass} bg-[#0068ff] text-white focus:ring-[#0068ff]/20`}
      >
        <ZaloIcon />
      </a>
      <a
        href="https://m.me/huy.phung.918686"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat qua Messenger"
        title="Messenger"
        className={`${floatingButtonClass} bg-gradient-to-br from-[#00b2ff] via-[#168aff] to-[#8b5cf6] text-white focus:ring-[#168aff]/20`}
      >
        <MessengerIcon />
      </a>
      <ChatWidget />
    </div>
  )
}
