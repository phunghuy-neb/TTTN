const { getClient } = require("../config/gemini");
const { getRagContext } = require("./ragService");
const { analyzeConversation } = require("./conversationEngine");
const sessionService = require("./sessionService");

/**
 * Đây là chỗ chatbot thật sự khác một bộ lọc: luồng xử lý KHÔNG còn là
 * "nhận input -> chạy filter -> trả kết quả" một chiều, mà rẽ nhánh theo
 * quyết định của LLM sau khi đọc toàn bộ hội thoại:
 *
 *   readyToRecommend = false -> hỏi lại 1 câu, KHÔNG chạy truy hồi, không có
 *                                 "tours" giả, không tư vấn khi chưa đủ dữ kiện.
 *   readyToRecommend = true  -> chạy RAG với intent + searchQuery đã gộp từ
 *                                 nhiều lượt, sinh câu trả lời có lập luận
 *                                 (so sánh, giải thích lý do) thay vì liệt kê.
 */

const RECOMMEND_SYSTEM_INSTRUCTION = `Bạn là Hướng dẫn viên du lịch ảo, đang tư vấn cho khách hàng dựa trên
lịch sử hội thoại và context (dữ liệu tour liên quan, lấy trực tiếp từ cơ sở dữ liệu) được cung cấp.

Nguyên tắc bắt buộc:
- CHỈ dùng thông tin có trong context để nói về giá, lịch trình, chính sách hủy — không tự bịa số liệu.
- Nếu context không có tour phù hợp, nói rõ chưa tìm thấy, đừng tự nghĩ ra tour không có thật.
- Nếu có từ 2 tour trở lên trong context, đừng chỉ liệt kê — hãy SO SÁNH ngắn gọn và giải thích
  VÌ SAO một lựa chọn phù hợp hơn với điều khách hàng đã nêu (ngân sách, sở thích, số ngày...).
- Nếu ràng buộc khách hàng nêu (VD: ngân sách) mâu thuẫn với tour tốt nhất tìm được (VD: nhỉnh hơn
  ngân sách một chút), hãy chủ động nêu rõ trade-off và hỏi khách hàng có chấp nhận không, thay vì
  im lặng bỏ qua chênh lệch.
- Trả lời bằng tiếng Việt, giọng văn thân thiện, ngắn gọn, đi thẳng vào thông tin hữu ích.`;

function buildGenerationPrompt(history, contextText) {
  const transcript = history.map((m) => `${m.role === "user" ? "Khách hàng" : "Trợ lý"}: ${m.text}`).join("\n");
  return `Lịch sử hội thoại:
${transcript}

Context (dữ liệu tour liên quan, lấy trực tiếp từ cơ sở dữ liệu):
${contextText}

Hãy trả lời tin nhắn mới nhất của khách hàng, dựa trên context và toàn bộ hội thoại ở trên.`;
}

/**
 * Xử lý một lượt chat trong session, KHÔNG streaming.
 * @param {string} sessionId
 * @param {string} userMessage
 * @returns {Promise<{sessionId: string, reply: string, tours: Array, clarifying: boolean, intent: object}>}
 */
async function converse(sessionId, userMessage) {
  const { id } = sessionService.getOrCreateSession(sessionId);
  sessionService.appendMessage(id, "user", userMessage);
  const history = sessionService.getHistory(id);

  const decision = await analyzeConversation(history);

  if (!decision.readyToRecommend) {
    const reply = decision.clarifyingQuestion || "Bạn có thể cho mình biết thêm chi tiết mong muốn được không?";
    sessionService.appendMessage(id, "assistant", reply);
    return { sessionId: id, reply, tours: [], clarifying: true, intent: decision };
  }

  const { tours, contextText } = await getRagContext(decision.searchQuery, decision);

  const ai = getClient();
  const model = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash";
  const response = await ai.models.generateContent({
    model,
    contents: buildGenerationPrompt(history, contextText),
    config: { systemInstruction: RECOMMEND_SYSTEM_INSTRUCTION },
  });

  const reply = response.text?.trim() || "";
  sessionService.appendMessage(id, "assistant", reply);

  return { sessionId: id, reply, tours, clarifying: false, intent: decision };
}

/**
 * Xử lý một lượt chat trong session CÓ streaming — gọi `onChunk(text)` mỗi khi
 * có phần văn bản mới. Khi hệ thống quyết định hỏi lại, "stream" chỉ là 1 lần
 * gọi onChunk với toàn bộ câu hỏi (không cần streaming từng chữ vì câu ngắn),
 * để giao diện xử lý đồng nhất một luồng sự kiện cho cả 2 trường hợp.
 * @param {string} sessionId
 * @param {string} userMessage
 * @param {(chunkText: string) => void} onChunk
 * @returns {Promise<{sessionId: string, fullReply: string, tours: Array, clarifying: boolean, intent: object}>}
 */
async function converseStream(sessionId, userMessage, onChunk) {
  const { id } = sessionService.getOrCreateSession(sessionId);
  sessionService.appendMessage(id, "user", userMessage);
  const history = sessionService.getHistory(id);

  const decision = await analyzeConversation(history);

  if (!decision.readyToRecommend) {
    const reply = decision.clarifyingQuestion || "Bạn có thể cho mình biết thêm chi tiết mong muốn được không?";
    onChunk(reply);
    sessionService.appendMessage(id, "assistant", reply);
    return { sessionId: id, fullReply: reply, tours: [], clarifying: true, intent: decision };
  }

  const { tours, contextText } = await getRagContext(decision.searchQuery, decision);

  const ai = getClient();
  const model = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash";
  const stream = await ai.models.generateContentStream({
    model,
    contents: buildGenerationPrompt(history, contextText),
    config: { systemInstruction: RECOMMEND_SYSTEM_INSTRUCTION },
  });

  let fullReply = "";
  for await (const chunk of stream) {
    const piece = chunk.text || "";
    if (piece) {
      fullReply += piece;
      onChunk(piece);
    }
  }

  sessionService.appendMessage(id, "assistant", fullReply);
  return { sessionId: id, fullReply, tours, clarifying: false, intent: decision };
}

module.exports = { converse, converseStream };
