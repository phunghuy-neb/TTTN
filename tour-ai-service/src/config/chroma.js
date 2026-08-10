const { ChromaClient } = require("chromadb");

/**
 * ChromaDB dùng để lưu vector embedding của các chunk tour, phục vụ
 * semantic search (tìm tour phù hợp theo ngữ nghĩa câu hỏi, không cần
 * trùng khớp từ khóa chính xác).
 */

let chromaClient = null;
let collection = null;

function getChromaClient() {
  if (!chromaClient) {
    chromaClient = new ChromaClient({
      path: process.env.CHROMA_URL || "http://localhost:8000",
    });
  }
  return chromaClient;
}

async function getTourCollection() {
  if (collection) return collection;

  const chroma = getChromaClient();
  const name = process.env.CHROMA_COLLECTION || "tour_vectors";

  collection = await chroma.getOrCreateCollection({
    name,
    metadata: { description: "Vector embeddings của các chunk tour du lịch" },
  });

  return collection;
}

module.exports = { getChromaClient, getTourCollection };
