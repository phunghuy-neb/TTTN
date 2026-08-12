const express = require("express");
const { getRagContext } = require("../services/ragService");
const { generateChatAnswer, streamChatAnswer } = require("../services/chatService");
const { syncTourVectors } = require("../services/syncService");

const router = express.Router();

/**
 * POST /api/ai/context
 * Nhiệm vụ chính Tuần 3 — nhận { prompt }, trả về context liên quan
 * (chưa sinh câu trả lời tự nhiên).
 */
router.post("/context", async (req, res) => {
  try {
    const { prompt, tourContext = null, history = [], userName = '' } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Thiếu trường 'prompt' (string) trong body" });
    }

    const { intent, tours, contextText, matchedChunks } = await getRagContext(prompt, tourContext);
    res.json({ intent, tours, contextText, matchedChunks });
  } catch (err) {
    console.error("[POST /api/ai/context]", err);
    res.status(500).json({ error: "Lỗi xử lý context", detail: err.message });
  }
});

/**
 * POST /api/ai/chat
 * Trả về cả context lẫn câu trả lời tự nhiên do Gemini sinh dựa trên context
 * (không streaming — dùng khi client không cần trải nghiệm gõ chữ realtime).
 */
router.post("/chat", async (req, res) => {
  try {
    const { prompt, tourContext = null, history = [], userName = '' } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Thiếu trường 'prompt' (string) trong body" });
    }

    const { reply, intent, tours } = await generateChatAnswer(prompt, tourContext, history, userName);
    res.json({ reply, intent, tours });
  } catch (err) {
    console.error("[POST /api/ai/chat]", err);
    res.status(500).json({ error: "Lỗi xử lý chat", detail: err.message });
  }
});

/**
 * POST /api/ai/chat/stream
 * Tuần 4 — phiên bản streaming của /api/ai/chat, dùng Server-Sent Events (SSE).
 * Mỗi sự kiện "chunk" chứa một đoạn text nhỏ, sự kiện "done" báo kết thúc kèm
 * intent + tours để Frontend hiển thị card gợi ý tour bên cạnh câu trả lời.
 */
router.post("/chat/stream", async (req, res) => {
  const { prompt, tourContext = null } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Thiếu trường 'prompt' (string) trong body" });
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
    const { intent, tours, fullReply } = await streamChatAnswer(prompt, (chunkText) => {
      send("chunk", { text: chunkText });
    }, tourContext);
    send("done", { intent, tours, fullReply });
  } catch (err) {
    console.error("[POST /api/ai/chat/stream]", err);
    send("error", { message: err.message });
  } finally {
    res.end();
  }
});

/**
 * POST /api/ai/sync-vectors
 * Cho phép Admin (Backend chính gọi hộ, hoặc gọi trực tiếp) kích hoạt đồng bộ
 * dữ liệu Tour -> ChromaDB thủ công, theo đặc tả "Quản trị hệ thống AI (Vector Sync)".
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
