const Tour = require("../models/Tour");
const { getTourCollection } = require("../config/chroma");
const { embedText } = require("../config/gemini");

/**
 * Luồng truy hồi (Retrieval) trong RAG, gồm 5 bước — KHÔNG còn tự trích xuất ý
 * định ở đây nữa: intent + searchQuery được `conversationEngine.js` phân tích
 * từ TOÀN BỘ lịch sử hội thoại và truyền vào, để một tour có thể được tìm thấy
 * đúng dựa trên ràng buộc nêu rải rác qua nhiều lượt chat, không chỉ câu cuối.
 *
 *  1. Sinh vector embedding cho searchQuery (đã tổng hợp cả hội thoại)
 *  2. Truy vấn ChromaDB: semantic search kết hợp lọc cứng theo intent
 *  3. Gom nhóm chunk kết quả theo tourId, loại trùng, giữ thứ tự liên quan
 *  4. Lấy dữ liệu đầy đủ, chính xác của các tour đó từ MongoDB
 *     (không lấy giá/thông tin từ vector, tránh sai lệch)
 *  5. Ghép thành contextText — chuỗi văn bản sẵn sàng đưa vào prompt Generation
 *
 * Nguyên tắc cốt lõi (giữ từ Tuần 1): ChromaDB chỉ dùng để xác định
 * "tour nào liên quan", còn dữ liệu dùng để TRẢ LỜI luôn lấy trực tiếp
 * từ MongoDB — đảm bảo AI không trả lời sai giá hay thông tin đã lỗi thời.
 */

const TOP_K = 8;

/** Xây dựng bộ lọc cứng ChromaDB `where` từ intent đã trích xuất. */
function buildWhereFilter(intent) {
  const conditions = [];
  if (intent.region) conditions.push({ region: intent.region });
  if (typeof intent.maxPrice === "number") {
    conditions.push({ basePrice: { $lte: intent.maxPrice } });
  }
  conditions.push({ status: "published" });

  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

/**
 * Gom nhóm các chunk kết quả theo tourId, loại trùng, giữ thứ tự theo độ liên quan
 * (một tour có thể xuất hiện nhiều lần do nhiều chunk overview/itinerary/policy
 * cùng lọt vào top-k).
 */
function dedupeTourIdsInOrder(chromaResult) {
  const ids = chromaResult?.metadatas?.[0] || [];
  const seen = new Set();
  const ordered = [];

  for (const meta of ids) {
    if (meta?.tourId && !seen.has(meta.tourId)) {
      seen.add(meta.tourId);
      ordered.push(meta.tourId);
    }
  }
  return ordered;
}

/** Ghép danh sách tour (đầy đủ, lấy từ MongoDB) thành contextText có cấu trúc. */
function buildContextText(tours) {
  return tours
    .map((t, i) => {
      const departuresText = (t.departures || [])
        .slice(0, 3)
        .map(
          (d) =>
            `${new Date(d.date).toLocaleDateString("vi-VN")} (còn ${d.availableSlots} chỗ, giá ${d.price.toLocaleString("vi-VN")}đ)`
        )
        .join("; ");

      return [
        `[Tour ${i + 1}] ${t.name} - ${t.location}, ${t.region}`,
        `Số ngày: ${t.days} | Giá cơ bản: ${t.basePrice.toLocaleString("vi-VN")}đ`,
        t.summary ? `Tóm tắt: ${t.summary}` : null,
        departuresText ? `Các đợt khởi hành gần nhất: ${departuresText}` : null,
        t.cancellationPolicy ? `Chính sách hủy: ${t.cancellationPolicy}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

/**
 * Thực hiện luồng truy hồi dữ liệu tour dựa trên intent + searchQuery đã được
 * conversationEngine tổng hợp từ toàn bộ hội thoại.
 * @param {string} searchQuery - câu truy vấn tổng hợp (không phải chỉ tin nhắn cuối)
 * @param {{maxPrice: number|null, region: string|null, days: number|null}} intent
 * @returns {Promise<{tours: Array, contextText: string, matchedChunks: Array}>}
 */
async function getRagContext(searchQuery, intent) {
  // Bước 1: sinh vector embedding cho searchQuery đã tổng hợp cả hội thoại
  const promptVector = await embedText(searchQuery);

  // Bước 2: truy vấn ChromaDB (semantic search + lọc cứng theo ý định)
  const collection = await getTourCollection();
  const where = buildWhereFilter(intent);

  const chromaResult = await collection.query({
    queryEmbeddings: [promptVector],
    nResults: TOP_K,
    where,
  });

  // Bước 3: gom nhóm theo tourId, loại trùng, giữ thứ tự liên quan
  const orderedTourIds = dedupeTourIdsInOrder(chromaResult);

  // Bước 4: lấy dữ liệu đầy đủ, chính xác từ MongoDB (không lấy giá từ vector)
  const toursFromDb = await Tour.find({
    _id: { $in: orderedTourIds },
    status: "published",
  }).lean();

  // Giữ đúng thứ tự liên quan trả về từ ChromaDB
  const toursById = new Map(toursFromDb.map((t) => [String(t._id), t]));
  const tours = orderedTourIds
    .map((id) => toursById.get(id))
    .filter(Boolean);

  // Bước 5: ghép contextText
  const contextText = tours.length
    ? buildContextText(tours)
    : "Không tìm thấy tour phù hợp với yêu cầu.";

  const matchedChunks = (chromaResult?.documents?.[0] || []).map((doc, i) => ({
    document: doc,
    metadata: chromaResult.metadatas[0][i],
    distance: chromaResult.distances?.[0]?.[i] ?? null,
  }));

  return { tours, contextText, matchedChunks };
}

module.exports = { getRagContext };
