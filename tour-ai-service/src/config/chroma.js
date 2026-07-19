const { ChromaClient } = require('chromadb');

const client = new ChromaClient({
  path: process.env.CHROMA_URL || 'http://localhost:8000',
});

const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'tours_embeddings';

/**
 * Lấy (hoặc tạo mới nếu chưa có) collection lưu embedding của tour.
 * embeddingFunction để null vì ta tự sinh vector bằng Gemini
 * rồi truyền thẳng vào upsert(), không để Chroma tự embed.
 */
async function getTourCollection() {
  return client.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: { description: 'Vector embeddings cho dữ liệu tour du lịch' },
  });
}

module.exports = { client, getTourCollection, COLLECTION_NAME };
