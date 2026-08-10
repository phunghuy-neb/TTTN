const { generateChatReply } = require("../config/gemini");

/**
 * Service trích xuất ý định (intent extraction) — bổ sung ở Tuần 3.
 * Dùng Gemini với system instruction yêu cầu trả về JSON thuần (không giải thích),
 * sau đó parse trực tiếp. Nếu Gemini trả về định dạng không hợp lệ, hệ thống tự
 * động bỏ qua bước lọc cứng và chỉ dựa vào semantic search (fallback an toàn).
 *
 * Input:  "Tôi muốn đi biển 3 ngày, ngân sách 5 triệu"
 * Output: { maxPrice: 5000000, region: null, days: 3 }
 */

const SYSTEM_INSTRUCTION = `Bạn là bộ trích xuất ý định cho hệ thống đặt tour du lịch.
Nhiệm vụ: đọc câu hỏi/yêu cầu của người dùng và trả về DUY NHẤT một JSON thuần,
không kèm giải thích, không dùng markdown code fence, theo đúng cấu trúc:
{"maxPrice": number|null, "region": string|null, "days": number|null}

Quy tắc:
- maxPrice: ngân sách tối đa tính bằng VNĐ nếu người dùng có nhắc tới (ví dụ "5 triệu" -> 5000000). null nếu không có.
- region: một trong "Miền Bắc" | "Miền Trung" | "Miền Nam" nếu suy luận được từ địa danh hoặc từ khóa "biển/núi/..." không đủ để suy ra vùng thì để null.
- days: số ngày tour nếu người dùng có nhắc tới. null nếu không có.
- Nếu không chắc chắn, để giá trị đó là null, không đoán bừa.
- Chỉ trả về JSON, không thêm bất kỳ văn bản nào khác.`;

/**
 * Loại bỏ markdown code fence (```json ... ```) mà Gemini đôi khi vẫn trả về
 * dù đã yêu cầu JSON thuần trong system instruction.
 */
function stripCodeFence(raw) {
  return raw
    .trim()
    .replace(/^```(json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

const EMPTY_INTENT = { maxPrice: null, region: null, days: null };

/**
 * @param {string} prompt - Câu hỏi/yêu cầu gốc của người dùng
 * @returns {Promise<{maxPrice: number|null, region: string|null, days: number|null}>}
 */
async function extractIntent(prompt) {
  try {
    const raw = await generateChatReply(prompt, SYSTEM_INSTRUCTION);
    const cleaned = stripCodeFence(raw);
    const parsed = JSON.parse(cleaned);

    return {
      maxPrice: typeof parsed.maxPrice === "number" ? parsed.maxPrice : null,
      region: typeof parsed.region === "string" ? parsed.region : null,
      days: typeof parsed.days === "number" ? parsed.days : null,
    };
  } catch (err) {
    // Fallback an toàn: nếu Gemini trả JSON không hợp lệ, bỏ qua lọc cứng,
    // để bước Retrieval chỉ dựa vào semantic search.
    console.warn("[intentService] Không trích xuất được ý định, fallback về null:", err.message);
    return { ...EMPTY_INTENT };
  }
}

module.exports = { extractIntent };
