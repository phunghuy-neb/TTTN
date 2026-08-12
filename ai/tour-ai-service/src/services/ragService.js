const Tour = require("../models/Tour");
const { getTourCollection } = require("../config/chroma");
const { embedText } = require("../config/gemini");
const { extractIntent } = require("./intentService");

/**
 * Luồng RAG hoàn chỉnh (Tuần 3), gồm 6 bước:
 *  1. Trích xuất ý định từ prompt (intentService)
 *  2. Sinh vector embedding cho prompt gốc
 *  3. Truy vấn ChromaDB: semantic search kết hợp lọc cứng theo ý định
 *  4. Gom nhóm chunk kết quả theo tourId, loại trùng, giữ thứ tự liên quan
 *  5. Lấy dữ liệu đầy đủ, chính xác của các tour đó từ MongoDB
 *     (không lấy giá/thông tin từ vector, tránh sai lệch)
 *  6. Ghép thành contextText — chuỗi văn bản sẵn sàng đưa vào prompt Generation
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
        .filter((d) => new Date(d.date) > new Date() && d.availableSlots > 0)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
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
        t.description ? `Mô tả: ${t.description}` : null,
        departuresText ? `Các đợt khởi hành gần nhất: ${departuresText}` : null,
        Array.isArray(t.itinerary) && t.itinerary.length
          ? `Lịch trình: ${t.itinerary.slice(0, 8).map((d) => `Ngày ${d.dayNumber}: ${d.title}${d.description ? ` — ${d.description}` : ""}${d.meals?.length ? ` (bữa: ${d.meals.join(", ")})` : ""}`).join("; ")}`
          : null,
        t.inclusions ? `Bao gồm: ${t.inclusions}` : null,
        t.exclusions ? `Không bao gồm: ${t.exclusions}` : null,
        t.cancellationPolicy ? `Chính sách hủy: ${t.cancellationPolicy}` : null,
        Array.isArray(t.reviews) && t.reviews.length
          ? `Đánh giá gần đây: ${t.reviews.slice(-3).map((r) => `${r.rating}/5 — ${r.comment || ""}`).join("; ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

/**
 * Thực hiện đầy đủ luồng RAG cho một prompt người dùng.
 * @param {string} prompt
 * @returns {Promise<{intent: object, tours: Array, contextText: string, matchedChunks: Array}>}
 */
async function getRagContext(prompt, tourContext = null) {
  // Bước 1: trích xuất ý định
  const intent = await extractIntent(prompt);

  // Bước 2: sinh vector embedding cho prompt gốc
  const promptVector = await embedText(prompt);

  // Bước 3: truy vấn ChromaDB (semantic search + lọc cứng theo ý định)
  const collection = await getTourCollection();
  const where = buildWhereFilter(intent);

  const chromaResult = await collection.query({
    queryEmbeddings: [promptVector],
    nResults: TOP_K,
    where,
  });

  // Bước 4: gom nhóm theo tourId, loại trùng, giữ thứ tự liên quan
  const orderedTourIds = dedupeTourIdsInOrder(chromaResult);
  const contextId = tourContext?._id && /^[0-9a-fA-F]{24}$/.test(String(tourContext._id))
    ? String(tourContext._id)
    : null;
  if (contextId) {
    const index = orderedTourIds.indexOf(contextId);
    if (index >= 0) orderedTourIds.splice(index, 1);
    orderedTourIds.unshift(contextId);
  }

  // Bước 5: lấy dữ liệu đầy đủ, chính xác từ MongoDB (không lấy giá từ vector)
  const toursFromDb = await Tour.find({
    _id: { $in: orderedTourIds },
    status: "published",
    isActive: { $ne: false },
  }).lean();

  // Giữ đúng thứ tự liên quan trả về từ ChromaDB
  const toursById = new Map(toursFromDb.map((t) => [String(t._id), t]));
  const tours = orderedTourIds
    .map((id) => toursById.get(id))
    .filter(Boolean)
    .filter((tour) => String(tour._id) === contextId || (tour.departures || []).some((d) => new Date(d.date) > new Date() && d.availableSlots > 0));

  // Bước 6: ghép contextText
  const contextText = tours.length
    ? buildContextText(tours)
    : "Không tìm thấy tour phù hợp với yêu cầu.";

  const matchedChunks = (chromaResult?.documents?.[0] || []).map((doc, i) => ({
    document: doc,
    metadata: chromaResult.metadatas[0][i],
    distance: chromaResult.distances?.[0]?.[i] ?? null,
  }));

  return { intent, tours, contextText, matchedChunks };
}

module.exports = { getRagContext };
