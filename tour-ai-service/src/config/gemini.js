const { GoogleGenAI } = require('@google/genai');

if (!process.env.GEMINI_API_KEY) {
  throw new Error('Thiếu GEMINI_API_KEY trong file .env');
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash';

/**
 * Sinh câu trả lời từ Gemini (dùng cho phần chat/RAG ở Tuần 3).
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function generateChatReply(prompt) {
  const response = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents: prompt,
  });
  return response.text;
}

/**
 * Sinh vector embedding cho MỘT đoạn văn bản.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  return response.embeddings[0].values;
}

/**
 * Sinh vector embedding cho NHIỀU đoạn văn bản cùng lúc (batch).
 * Lưu ý: nên giới hạn ~100 đoạn/lần gọi để tránh vượt quá giới hạn request của API.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
  });
  return response.embeddings.map((e) => e.values);
}

module.exports = { ai, generateChatReply, embedText, embedBatch, EMBEDDING_MODEL, CHAT_MODEL };
