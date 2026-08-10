import { useEffect, useRef, useState } from "react";

/**
 * ChatbotWidget — Tuần 5 (Mai Tuấn Anh - task)
 * "Xây dựng giao diện Chatbot trên Client. Tích hợp công nghệ TTS
 * (Text-to-Speech) để AI có thể đọc phản hồi."
 *
 * Component độc lập, nhúng vào bất kỳ trang Client nào (Home, Tour Detail...).
 * - Nút chat nổi cố định (theo wireframe Tuần 1 - trang Home).
 * - Kết nối tới AI Service qua POST /api/ai/chat/stream (Server-Sent Events)
 *   để hiển thị câu trả lời chạy chữ mượt mà (không phải chờ toàn bộ câu trả lời).
 * - TTS dùng Web Speech API có sẵn trên trình duyệt (SpeechSynthesis), không cần
 *   backend riêng cho giọng nói — bật/tắt bằng nút loa trên mỗi tin nhắn AI.
 *
 * Props:
 *  - aiServiceUrl: base URL của tour-ai-service, mặc định http://localhost:4000
 */
export default function ChatbotWidget({ aiServiceUrl = "http://localhost:4000" }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Xin chào! Tôi là Hướng dẫn viên ảo. Bạn muốn đi đâu, ngân sách và số ngày dự kiến là bao nhiêu?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function speak(text) {
    if (!ttsEnabled) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    window.speechSynthesis.cancel(); // ngắt câu đang đọc dở (nếu có)
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "vi-VN";
    window.speechSynthesis.speak(utterance);
  }

  async function sendMessage() {
    const prompt = input.trim();
    if (!prompt || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: prompt }]);
    setInput("");
    setLoading(true);

    // Thêm sẵn một message rỗng của assistant để cập nhật dần khi stream chạy
    setMessages((prev) => [...prev, { role: "assistant", text: "", tours: [] }]);

    try {
      const res = await fetch(`${aiServiceUrl}/api/ai/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.body) throw new Error("Trình duyệt không hỗ trợ streaming response");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let finalTours = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop(); // phần chưa hoàn chỉnh, giữ lại cho lần đọc sau

        for (const evt of events) {
          const eventLine = evt.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const eventType = eventLine.replace("event:", "").trim();
          const data = JSON.parse(dataLine.replace("data:", "").trim());

          if (eventType === "chunk") {
            fullText += data.text;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: "assistant", text: fullText };
              return updated;
            });
          } else if (eventType === "done") {
            finalTours = data.tours || [];
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                text: data.fullReply || fullText,
                tours: finalTours,
              };
              return updated;
            });
            speak(data.fullReply || fullText);
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
              placeholder="Nhập yêu cầu, ví dụ: đi biển 3 ngày, ngân sách 5 triệu..."
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
    width: 56,
    height: 56,
    borderRadius: "50%",
    border: "none",
    background: "#0f766e",
    color: "#fff",
    fontSize: 24,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
  },
  panel: {
    width: 340,
    height: 460,
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
    display: "flex",
    flexDirection: "column",
    marginBottom: 12,
    overflow: "hidden",
  },
  header: {
    background: "#0f766e",
    color: "#fff",
    padding: "10px 14px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontWeight: 600,
  },
  iconButton: {
    background: "transparent",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
  },
  messages: { flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  bubble: { maxWidth: "85%", padding: "8px 12px", borderRadius: 10, fontSize: 14, lineHeight: 1.4 },
  userBubble: { alignSelf: "flex-end", background: "#0f766e", color: "#fff" },
  assistantBubble: { alignSelf: "flex-start", background: "#f1f5f9", color: "#0f172a" },
  tourList: { marginTop: 8, display: "flex", flexDirection: "column", gap: 6 },
  tourCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 13 },
  inputRow: { display: "flex", borderTop: "1px solid #e2e8f0", padding: 8, gap: 8 },
  input: { flex: 1, border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 14 },
  sendButton: {
    background: "#0f766e",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "0 14px",
    cursor: "pointer",
  },
};
