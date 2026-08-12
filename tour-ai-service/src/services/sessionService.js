const crypto = require("crypto");

/**
 * Lưu trạng thái hội thoại theo session, để AI có thể:
 *  - Gộp ràng buộc người dùng nêu rải rác qua nhiều lượt chat
 *  - Biết đã hỏi gì trước đó, tránh hỏi lại
 *  - Tư vấn có ngữ cảnh (VD: nhắc lại điều user vừa nói ở câu trước)
 *
 * Lưu ý: đây là in-memory store (Map), phù hợp demo/1 instance server.
 * Khi triển khai production nhiều instance, cần thay bằng Redis hoặc
 * lưu vào MongoDB (collection ChatSession) để không mất state khi restart
 * hoặc khi request rơi vào instance khác.
 */

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 phút không hoạt động thì hết hạn
const sessions = new Map();

function createSessionId() {
  return crypto.randomUUID();
}

function getOrCreateSession(sessionId) {
  const id = sessionId && sessions.has(sessionId) ? sessionId : createSessionId();

  if (!sessions.has(id)) {
    sessions.set(id, { history: [], updatedAt: Date.now() });
  }

  return { id, session: sessions.get(id) };
}

function appendMessage(sessionId, role, text) {
  const { session } = getOrCreateSession(sessionId);
  session.history.push({ role, text, at: Date.now() });
  session.updatedAt = Date.now();
}

function getHistory(sessionId) {
  const { session } = getOrCreateSession(sessionId);
  return session.history;
}

function resetSession(sessionId) {
  sessions.delete(sessionId);
}

/** Dọn các session không hoạt động quá lâu, tránh rò rỉ bộ nhớ. */
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}
setInterval(cleanupExpiredSessions, 5 * 60 * 1000).unref();

module.exports = { getOrCreateSession, appendMessage, getHistory, resetSession, createSessionId };
