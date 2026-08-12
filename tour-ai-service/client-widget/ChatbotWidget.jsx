import { useEffect, useRef, useState } from "react";

/**
 * ChatbotWidget — hội thoại đa lượt, không còn xử lý mỗi câu độc lập.
 *
 * Khác biệt so với bản filter-có-giao-diện-chat trước đây:
 *  - Giữ `sessionId` xuyên suốt phiên (lưu localStorage để refresh trang vẫn
 *    tiếp tục hội thoại cũ), gửi kèm mỗi lượt để AI Service gộp được ràng
 *    buộc nêu rải rác qua nhiều câu.
 *  - Khi AI trả về `clarifying: true` (đang hỏi lại vì chưa đủ thông tin),
 *    widget hiển thị tin nhắn đó như một câu hỏi bình thường của trợ lý —
 *    KHÔNG hiển thị card tour rỗng, không giả vờ đã tư vấn.
 *  - Có nút "Cuộc trò chuyện mới" để xóa session, bắt đầu lại từ đầu.
 *
 * Props:
 *  - aiServiceUrl: base URL của tour-ai-service, mặc định http://localhost:4000
 */
export default function ChatbotWidget({ aiServiceUrl = "http://localhost:4000" }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Xin chào! Tôi là Hướng dẫn viên ảo. Bạn đang muốn tìm loại tour như thế nào?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [sessionId, setSessionId] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("tour_ai_session_id") : null;
    if (saved) setSessionId(saved);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function persistSessionId(id) {
    setSessionId(id);
    if (typeof window !== "undefined") window.localStorage.setItem("tour_ai_session_id", id);
  }

  function speak(text) {
    if (!ttsEnabled || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "vi-VN";
    window.speechSynthesis.speak(utterance);
  }

  async function startNewConversation() {
    if (sessionId) {
      try {
        await fetch(`${aiServiceUrl}/api/ai/session/${sessionId}`, { method: "DELETE" });
      } catch (err) {
        console.warn("[ChatbotWidget] Không xóa được session cũ:", err);
      }
    }
    if (typeof window !== "undefined") window.localStorage.removeItem("tour_ai_session_id");
    setSessionId(null);
    setMessages([
      { role: "assistant", text: "Xin chào! Tôi là Hướng dẫn viên ảo. Bạn đang muốn tìm loại tour như thế nào?" },
    ]);
  }

  async function sendMessage() {
    const message = input.trim();
    if (!message || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: message }]);
    setInput("");
    setLoading(true);
    setMessages((prev) => [...prev, { role: "assistant", text: "", tours: [] }]);

    try {
      const res = await fetch(`${aiServiceUrl}/api/ai/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });

      if (!res.body) throw new Error("Trình duyệt không hỗ trợ streaming response");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();

        for (const evt of events) {
          const eventLine = evt.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const eventType = eventLine.replace("event:", "").trim();
          const data = JSON.parse(dataLine.replace("data:", "").trim());

          if (eventType === "session") {
            persistSessionId(data.sessionId);
          } else if (eventType === "chunk") {
            fullText += data.text;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "assistant", text: fullText };
              return updated;
            });
          } else if (eventType === "done") {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                text: fullText,
                tours: data.tours || [],
                clarifying: data.clarifying,
              };
              return updated;
            });
            speak(fullText);
          } else if (eventType === "error") {
            throw new Error(data.message);
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          text: "Xin lỗi, hiện tôi chưa thể trả lời. Bạn vui lòng thử lại sau ít phút.",
        };
        return updated;
      });
      console.error("[ChatbotWidget] Lỗi stream:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div style={styles.wrapper}>
      {open && (
        <div style={styles.panel}>
          <div style={styles.header}>
            <span>Hướng dẫn viên ảo</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={styles.iconButton} title="Cuộc trò chuyện mới" onClick={startNewConversation}>
                ↺
              </button>
              <button
                style={styles.iconButton}
                title={ttsEnabled ? "Tắt đọc giọng nói" : "Bật đọc giọng nói"}
                onClick={() => setTtsEnabled((v) => !v)}
              >
                {ttsEnabled ? "🔊" : "🔇"}
              </button>
              <button style={styles.iconButton} onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
          </div>

          <div style={styles.messages}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  ...styles.bubble,
                  ...(m.role === "user" ? styles.userBubble : styles.assistantBubble),
                  ...(m.clarifying ? styles.clarifyingBubble : {}),
                }}
              >
                <div>{m.text || "…"}</div>
                {m.tours?.length > 0 && (
                  <div style={styles.tourList}>
                    {m.tours.slice(0, 3).map((t) => (
                      <div key={t._id} style={styles.tourCard}>
                        <strong>{t.name}</strong>
                        <div>{t.days} ngày · {t.basePrice?.toLocaleString("vi-VN")}đ</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div style={styles.inputRow}>
            <input
              style={styles.input}
              value={input}
              placeholder="Nhắn cho hướng dẫn viên ảo..."
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button style={styles.sendButton} onClick={sendMessage} disabled={loading}>
              {loading ? "..." : "Gửi"}
            </button>
          </div>
        </div>
      )}

      <button style={styles.fab} onClick={() => setOpen((v) => !v)}>
        💬
      </button>
    </div>
  );
}

const styles = {
  wrapper: { position: "fixed", bottom: 24, right: 24, zIndex: 1000, fontFamily: "sans-serif" },
  fab: {
    width: 56, height: 56, borderRadius: "50%", border: "none",
    background: "#0f766e", color: "#fff", fontSize: 24, cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
  },
  panel: {
    width: 340, height: 480, background: "#fff", borderRadius: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column",
    marginBottom: 12, overflow: "hidden",
  },
  header: {
    background: "#0f766e", color: "#fff", padding: "10px 14px",
    display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600,
  },
  iconButton: { background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontSize: 14 },
  messages: { flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  bubble: { maxWidth: "85%", padding: "8px 12px", borderRadius: 10, fontSize: 14, lineHeight: 1.4 },
  userBubble: { alignSelf: "flex-end", background: "#0f766e", color: "#fff" },
  assistantBubble: { alignSelf: "flex-start", background: "#f1f5f9", color: "#0f172a" },
  clarifyingBubble: { border: "1px dashed #94a3b8" },
  tourList: { marginTop: 8, display: "flex", flexDirection: "column", gap: 6 },
  tourCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 13 },
  inputRow: { display: "flex", borderTop: "1px solid #e2e8f0", padding: 8, gap: 8 },
  input: { flex: 1, border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 14 },
  sendButton: { background: "#0f766e", color: "#fff", border: "none", borderRadius: 8, padding: "0 14px", cursor: "pointer" },
};
