const { generateChatReply } = require("../config/gemini");

/**
 * Khác biệt cốt lõi so với bộ lọc truyền thống nằm ở đây: thay vì luôn chạy
 * filter ngay khi có input, hệ thống để LLM đọc TOÀN BỘ lịch sử hội thoại rồi
 * tự quyết định 1 trong 2 hành động:
 *
 *   - "clarify"   : thông tin chưa đủ để tư vấn tốt -> hỏi lại NGƯỜI DÙNG một
 *                    câu duy nhất, không chạy truy hồi, không bịa gợi ý.
 *   - "recommend" : đủ thông tin (hoặc người dùng đã từ chối cung cấp thêm) ->
 *                    tổng hợp toàn bộ ràng buộc CỨNG (giá/khu vực/số ngày) đã
 *                    nêu rải rác qua nhiều lượt, cùng mô tả sở thích MỀM
 *                    (không có field tương ứng trong DB) để dùng cho semantic
 *                    search, rồi mới tiến hành truy hồi.
 *
 * Đây là phần khiến chatbot khác bộ lọc: bộ lọc không có khái niệm "chưa đủ
 * thông tin để lọc tốt, cần hỏi thêm" — nó luôn trả kết quả ngay với input
 * đang có, dù input rỗng hay mơ hồ.
 */

const SYSTEM_INSTRUCTION = `Bạn là trợ lý tư vấn tour du lịch, đang đọc lại một đoạn hội thoại với khách hàng.
Nhiệm vụ: phân tích TOÀN BỘ hội thoại (không chỉ tin nhắn cuối) và trả về DUY NHẤT một JSON thuần,
không kèm giải thích, không dùng markdown code fence, theo đúng cấu trúc:

{
  "maxPrice": number|null,
  "region": "Miền Bắc"|"Miền Trung"|"Miền Nam"|null,
  "days": number|null,
  "softPreferences": string|null,
  "readyToRecommend": boolean,
  "clarifyingQuestion": string|null,
  "searchQuery": string
}

Quy tắc:
- maxPrice/region/days: gộp ràng buộc CỨNG khách hàng đã nêu ở BẤT KỲ lượt nào trong hội thoại,
  không chỉ tin nhắn mới nhất. Nếu một lượt sau khách hàng thay đổi ý (VD: đổi ngân sách),
  lấy giá trị MỚI NHẤT.
- softPreferences: các yêu cầu MỀM không có field cụ thể trong database (VD: "ít đông người",
  "phù hợp người lớn tuổi", "có thể làm việc từ xa", "thích trải nghiệm văn hóa địa phương").
  Gộp tất cả sở thích mềm khách hàng từng nêu thành một câu mô tả súc tích. null nếu không có.
- readyToRecommend: 
    true nếu đã có ĐỦ thông tin để đưa ra gợi ý tour có ý nghĩa (tối thiểu cần biết được khu vực
    HOẶC loại hình mong muốn, cộng với việc khách hàng không có ý định cung cấp thêm — ví dụ họ
    nói "gợi ý đại đi", "sao cũng được", hoặc đã được hỏi 1 lần rồi mà vẫn trả lời mơ hồ);
    false nếu tin nhắn đầu tiên/gần nhất quá mơ hồ (VD: "tôi muốn đi du lịch") và ĐÂY LÀ LẦN ĐẦU
    hỏi, nên hỏi lại một câu để làm rõ trước khi tư vấn.
    QUAN TRỌNG: không hỏi lại quá 1 lần liên tiếp cho cùng một mong muốn — nếu trong lịch sử đã có
    một lượt hỏi lại rồi, lượt này PHẢI để readyToRecommend = true, dùng thông tin hiện có dù chưa
    đầy đủ.
- clarifyingQuestion: câu hỏi làm rõ NGẮN GỌN (1 câu), CHỈ có giá trị khi readyToRecommend = false.
  Hỏi đúng 1 điều còn thiếu quan trọng nhất (VD: loại hình mong muốn, hoặc khu vực/ngân sách),
  không hỏi dồn nhiều câu cùng lúc. null khi readyToRecommend = true.
- searchQuery: câu truy vấn tổng hợp lại TOÀN BỘ mong muốn của khách hàng qua các lượt (cả ràng
  buộc cứng lẫn sở thích mềm) thành MỘT đoạn văn liền mạch, dùng để tìm kiếm ngữ nghĩa. Luôn phải
  có giá trị kể cả khi readyToRecommend = false (dùng câu hỏi gốc làm searchQuery tạm thời).
- Chỉ trả về JSON, không thêm bất kỳ văn bản nào khác.`;

function stripCodeFence(raw) {
  return raw
    .trim()
    .replace(/^```(json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

function formatHistoryAsTranscript(history) {
  return history
    .map((m) => `${m.role === "user" ? "Khách hàng" : "Trợ lý"}: ${m.text}`)
    .join("\n");
}

const FALLBACK_DECISION = (lastUserMessage) => ({
  maxPrice: null,
  region: null,
  days: null,
  softPreferences: null,
  readyToRecommend: true, // fallback an toàn: không kẹt hội thoại nếu LLM lỗi
  clarifyingQuestion: null,
  searchQuery: lastUserMessage,
});

/**
 * @param {Array<{role: 'user'|'assistant', text: string}>} history - toàn bộ lịch sử, tin nhắn mới nhất ở cuối
 * @returns {Promise<{maxPrice:number|null, region:string|null, days:number|null, softPreferences:string|null, readyToRecommend:boolean, clarifyingQuestion:string|null, searchQuery:string}>}
 */
async function analyzeConversation(history) {
  const lastUserMessage = [...history].reverse().find((m) => m.role === "user")?.text || "";

  try {
    const transcript = formatHistoryAsTranscript(history);
    const raw = await generateChatReply(
      `Hội thoại cần phân tích:\n${transcript}`,
      SYSTEM_INSTRUCTION
    );
    const parsed = JSON.parse(stripCodeFence(raw));

    return {
      maxPrice: typeof parsed.maxPrice === "number" ? parsed.maxPrice : null,
      region: typeof parsed.region === "string" ? parsed.region : null,
      days: typeof parsed.days === "number" ? parsed.days : null,
      softPreferences: typeof parsed.softPreferences === "string" ? parsed.softPreferences : null,
      readyToRecommend: Boolean(parsed.readyToRecommend),
      clarifyingQuestion:
        typeof parsed.clarifyingQuestion === "string" ? parsed.clarifyingQuestion : null,
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : lastUserMessage,
    };
  } catch (err) {
    console.warn("[conversationEngine] Không phân tích được hội thoại, fallback:", err.message);
    return FALLBACK_DECISION(lastUserMessage);
  }
}

module.exports = { analyzeConversation };
