import { useState } from 'react'

// Cụm icon nổi: Zalo + Messenger + Trợ lý AI.
// Tuần 2 chỉ dựng UI — panel chat là khung tĩnh, chưa nối logic chat thật.
export default function FloatingContact() {
  const [chatOpen, setChatOpen] = useState(false)

  return (
    <>
      {/* Khung chat AI (chỉ UI) */}
      <div
        className={`fixed bottom-[98px] right-[26px] z-[60] w-[360px] max-w-[calc(100vw-40px)] overflow-hidden rounded-[20px] border border-line bg-white shadow-2xl transition ${
          chatOpen ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-5 opacity-0'
        }`}
      >
        <div className="flex items-center gap-3 bg-gradient-to-br from-teal to-jade px-[18px] py-4 text-white">
          <span className="grid h-[38px] w-[38px] place-items-center rounded-[12px] bg-white/20 text-[18px]">✦</span>
          <div>
            <b className="font-heading text-[16px]">Trợ lý du lịch</b>
            <small className="block text-xs text-[#C9EBE2]">Thường trả lời tức thì</small>
          </div>
        </div>
        <div className="flex h-[220px] flex-col gap-2.5 overflow-y-auto bg-bg p-4">
          <div className="max-w-[88%] rounded-[14px] rounded-bl-[4px] border border-line bg-white px-[13px] py-2.5 text-[13.5px]">
            Xin chào 👋 Mình là trợ lý du lịch VietVoyage. Tính năng chat sẽ sớm ra mắt!
          </div>
        </div>
        <div className="flex gap-2 border-t border-line bg-white p-3">
          <input
            className="flex-1 rounded-[11px] border-[1.5px] border-line px-3 py-2.5 text-sm outline-none"
            placeholder="Nhập tin nhắn…"
            disabled
          />
          <button className="w-[42px] rounded-[11px] bg-teal text-[16px] text-white" disabled aria-label="Gửi">
            ➜
          </button>
        </div>
      </div>

      {/* Cụm nút nổi */}
      <div className="fixed bottom-[26px] right-[26px] z-[60] flex flex-col items-center gap-3">
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
        <button
          onClick={() => setChatOpen((v) => !v)}
          aria-label="Trợ lý AI"
          title="Trợ lý AI"
          className="grid h-[60px] w-[60px] place-items-center rounded-full bg-coral text-[24px] text-white shadow-float transition hover:scale-105"
        >
          💬
        </button>
      </div>
    </>
  )
}
