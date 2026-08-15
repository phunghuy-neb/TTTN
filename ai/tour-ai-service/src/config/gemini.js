const { GoogleGenAI } = require("@google/genai");

/**
 * Module dùng chung để gọi Gemini API.
 *
 * Ghi chú (rút ra từ quá trình triển khai Tuần 2):
 * SDK cũ @google/generative-ai và các model gemini-1.5-flash / gemini-2.5-flash
 * đã ngừng phục vụ người dùng mới nên dự án dùng SDK mới @google/genai.
 * Tên model KHÔNG hard-code mà lấy từ .env (GEMINI_CHAT_MODEL, GEMINI_EMBEDDING_MODEL)
 * để chỉ cần sửa .env khi nhà cung cấp đổi/khai tử model, không phải sửa code.
 */

let client = null;

function positiveTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withTimeout(promise, timeoutMs, operation) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${operation} timed out`);
      error.code = "GEMINI_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Thiếu biến môi trường GEMINI_API_KEY trong file .env");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * Sinh câu trả lời hội thoại tự nhiên.
 * @param {string} prompt - Nội dung người dùng hỏi
 * @param {string} [systemInstruction] - Chỉ dẫn hệ thống (VD: yêu cầu trả lời dựa trên context)
 * @returns {Promise<string>}
 */
async function generateChatReply(prompt, systemInstruction) {
  const ai = getClient();
  const model = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash";

  const response = await withTimeout(
    ai.models.generateContent({
      model,
      contents: prompt,
      ...(systemInstruction
        ? { config: { systemInstruction } }
        : {}),
    }),
    positiveTimeout(process.env.GEMINI_GENERATION_TIMEOUT_MS, 20_000),
    "Gemini generation"
  );

  return response.text?.trim() || "";
}

/**
 * Sinh vector embedding cho MỘT đoạn văn bản.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const [vector] = await embedBatch([text]);
  return vector;
}

/**
 * Sinh vector embedding cho NHIỀU đoạn văn bản trong một lần gọi (batch),
 * dùng khi đồng bộ toàn bộ chunk của một tour trong syncTourVectors.js.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  const ai = getClient();
  const model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

  const response = await withTimeout(
    ai.models.embedContent({
      model,
      contents: texts,
    }),
    positiveTimeout(process.env.GEMINI_EMBEDDING_TIMEOUT_MS, 12_000),
    "Gemini embedding"
  );

  // SDK trả về mảng embeddings tương ứng thứ tự input
  return response.embeddings.map((e) => e.values);
}

module.exports = { generateChatReply, embedText, embedBatch, getClient, withTimeout };
