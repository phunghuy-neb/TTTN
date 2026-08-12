const { getClient } = require("../config/gemini");
const { getRagContext } = require("./ragService");

/**
 * Tuần 4 — "Đưa mô hình AI vào API thực tế (tích hợp vào luồng chat).
 * Xử lý Streaming text để phản hồi mượt mà hơn."
 *
 * Thay vì chờ Gemini sinh xong toàn bộ câu trả lời rồi mới trả về (độ trễ cao,
 * trải nghiệm "đứng hình"), service này stream từng phần nhỏ (chunk) của câu
 * trả lời ngay khi Gemini sinh ra, đẩy qua Server-Sent Events (SSE) tới client
 * (kết hợp Socket.io/EventSource ở Frontend Tuần 5).
 */

const SYSTEM_INSTRUCTION = `Bạn là Hướng dẫn viên du lịch ảo của VietVoyage, tư vấn như một nhân viên giàu kinh nghiệm.
Chỉ được trả lời DỰA TRÊN context được cung cấp bên dưới — không tự bịa thông tin
về giá, lịch trình hay chính sách hủy nếu không có trong context.
Nếu context không có tour phù hợp, hãy nói rõ là chưa tìm thấy tour phù hợp và
gợi ý người dùng cung cấp thêm chi tiết (ngân sách, số ngày, khu vực mong muốn).
Trả lời bằng tiếng Việt, tự nhiên, cụ thể và có cấu trúc. Không lặp lại lời chào
ở mọi lượt. Nếu người dùng hỏi tiếp, hãy dùng lịch sử hội thoại để trả lời đúng
ngữ cảnh. Với giá/lịch khởi hành, luôn nêu rõ đơn vị và điều kiện áp dụng.
Nếu có nhiều lựa chọn, hãy so sánh ngắn gọn và đưa ra khuyến nghị phù hợp.`;

function buildGenerationPrompt(userPrompt, contextText, history = [], userName = '') {
  const historyText = history.length
    ? history.map((item) => `${item.role === 'assistant' ? 'Tư vấn viên' : 'Khách'}: ${item.content}`).join('\n')
    : '(Chưa có lịch sử hội thoại)';
  return `Context (dữ liệu tour liên quan, lấy trực tiếp từ cơ sở dữ liệu):
${contextText}

Tên khách hàng: ${userName || 'khách'}
Lịch sử hội thoại gần đây:
${historyText}

Câu hỏi của khách hàng: "${userPrompt}"

Hãy trả lời đúng câu hỏi mới nhất, dựa trên context và lịch sử ở trên. Không nhắc
đến các nhãn "context", "RAG" hay quy trình nội bộ.`;
}

/**
 * Sinh câu trả lời KHÔNG streaming (dùng cho /api/ai/chat khi client không hỗ trợ SSE).
 * @param {string} userPrompt
 * @returns {Promise<{reply: string, intent: object, tours: Array}>}
 */
async function generateChatAnswer(userPrompt, tourContext = null, history = [], userName = '') {
  const { intent, tours, contextText } = await getRagContext(userPrompt, tourContext);
  const ai = getClient();
  const model = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash";

  const response = await ai.models.generateContent({
    model,
    contents: buildGenerationPrompt(userPrompt, contextText, history, userName),
    config: { systemInstruction: SYSTEM_INSTRUCTION },
  });

  return { reply: response.text?.trim() || "", intent, tours };
}

/**
 * Sinh câu trả lời CÓ streaming — gọi `onChunk(text)` mỗi khi có phần văn bản mới.
 * Dùng cho route /api/ai/chat/stream (SSE).
 * @param {string} userPrompt
 * @param {(chunkText: string) => void} onChunk
 * @returns {Promise<{intent: object, tours: Array, fullReply: string}>}
 */
async function streamChatAnswer(userPrompt, onChunk, tourContext = null, history = [], userName = '') {
  const { intent, tours, contextText } = await getRagContext(userPrompt, tourContext);
  const ai = getClient();
  const model = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash";

  const stream = await ai.models.generateContentStream({
    model,
    contents: buildGenerationPrompt(userPrompt, contextText, history, userName),
    config: { systemInstruction: SYSTEM_INSTRUCTION },
  });

  let fullReply = "";
  for await (const chunk of stream) {
    const piece = chunk.text || "";
    if (piece) {
      fullReply += piece;
      onChunk(piece);
    }
  }

  return { intent, tours, fullReply };
}

module.exports = { generateChatAnswer, streamChatAnswer };
