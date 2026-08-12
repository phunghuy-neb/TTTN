const express = require("express");
const { converse, converseStream } = require("../services/chatService");
const { syncTourVectors } = require("../services/syncService");
const sessionService = require("../services/sessionService");

const router = express.Router();

/**
 * POST /api/ai/chat
 * Body: { sessionId?: string, message: string }
 * Nếu không truyền sessionId, hệ thống tự tạo mới và trả về trong response —
 * client phải lưu lại (localStorage/state) và gửi kèm ở các lượt chat sau,
 * nếu không AI sẽ mất ngữ cảnh và xử lý mỗi câu như hội thoại mới.
 *
 * Response có thể là 1 trong 2 dạng, phân biệt bằng field "clarifying":
 *   clarifying = true  -> AI đang hỏi lại, "tours" luôn rỗng.
 *   clarifying = false -> AI đã tư vấn, kèm "tours" liên quan.
 */
router.post("/chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Thiếu trường 'message' (string) trong body" });
    }

    const result = await converse(sessionId, message);
    res.json(result);
  } catch (err) {
    console.error("[POST /api/ai/chat]", err);
    res.status(500).json({ error: "Lỗi xử lý chat", detail: err.message });
  }
});

/**
 * POST /api/ai/chat/stream
 * Body giống /api/ai/chat. Trả về Server-Sent Events:
 *   event: session -> { sessionId }               (gửi ngay đầu, để client lưu lại)
 *   event: chunk   -> { text }                      (nhiều lần, từng đoạn văn bản)
 *   event: done    -> { tours, clarifying, intent }  (kết thúc)
 *   event: error   -> { message }
 */
router.post("/chat/stream", async (req, res) => {
  const { sessionId, message } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Thiếu trường 'message' (string) trong body" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await converseStream(sessionId, message, (chunkText) => {
      send("chunk", { text: chunkText });
    });
    send("session", { sessionId: result.sessionId });
    send("done", { tours: result.tours, clarifying: result.clarifying, intent: result.intent });
  } catch (err) {
    console.error("[POST /api/ai/chat/stream]", err);
    send("error", { message: err.message });
  } finally {
    res.end();
  }
});

/** DELETE /api/ai/session/:sessionId — reset hội thoại, dùng khi user bấm "Chat mới". */
router.delete("/session/:sessionId", (req, res) => {
  sessionService.resetSession(req.params.sessionId);
  res.json({ ok: true });
});

/**
 * POST /api/ai/sync-vectors
 * Cho phép Admin kích hoạt đồng bộ dữ liệu Tour -> ChromaDB thủ công.
 * Body tùy chọn: { force: boolean } — true để đồng bộ lại toàn bộ, kể cả tour đã synced.
 */
router.post("/sync-vectors", async (req, res) => {
  try {
    const force = Boolean(req.body?.force);
    const result = await syncTourVectors({ force });
    res.json(result);
  } catch (err) {
    console.error("[POST /api/ai/sync-vectors]", err);
    res.status(500).json({ error: "Lỗi đồng bộ vector", detail: err.message });
  }
});

/** GET /health — kiểm tra server còn sống */
router.get("/health", (req, res) => {
  res.json({ status: "ok", service: "tour-ai-service", time: new Date().toISOString() });
});

module.exports = router;
