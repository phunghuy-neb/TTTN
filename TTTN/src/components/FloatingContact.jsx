import ChatWidget from './chat/ChatWidget.jsx'

// Cụm icon nổi: Zalo + Messenger + Trợ lý AI (chat thật — UC-07).
export default function FloatingContact() {
  return (
    <div className="fixed bottom-[26px] right-[16px] z-[60] flex flex-col items-center gap-3 sm:right-[26px]">
      <a
        href="https://zalo.me/0900000000"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat Zalo"
        title="Chat Zalo"
        className="grid h-[44px] w-[44px] place-items-center rounded-full bg-[#0068FF] text-[17px] font-bold text-white shadow-lg transition hover:scale-105"
      >
        Za
      </a>
      <a
        href="https://m.me/vietvoyage"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat Messenger"
        title="Chat Messenger"
        className="grid h-[44px] w-[44px] place-items-center rounded-full bg-gradient-to-br from-[#00B2FF] to-[#006AFF] text-[17px] font-bold italic text-white shadow-lg transition hover:scale-105"
      >
        f
      </a>
      <ChatWidget />
    </div>
  )
}
