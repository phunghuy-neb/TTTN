const Tour = require("../models/Tour");
const { chunkTour } = require("../utils/tourChunking");
const { embedBatch } = require("../config/gemini");
const { getTourCollection } = require("../config/chroma");

/**
 * Logic đồng bộ vector (Tuần 2), tách thành service dùng chung để:
 *  - Script CLI syncTourVectors.js gọi khi chạy `npm run sync:vectors`
 *  - Route POST /api/ai/sync-vectors gọi khi Admin bấm "Đồng bộ dữ liệu AI"
 *    trên Dashboard (theo đặc tả chức năng "Quản trị hệ thống AI - Vector Sync").
 *
 * Các bước:
 *  1. Lấy tour status=published và chưa đồng bộ (vectorSync.isSynced khác true).
 *  2. Tách mỗi tour thành các chunk (overview, itinerary, policy).
 *  3. Gọi Gemini Embedding API sinh vector cho toàn bộ chunk của một tour (batch).
 *  4. Upsert (id, vector, nội dung gốc, metadata) vào ChromaDB.
 *  5. Cập nhật lại tour.vectorSync trong MongoDB.
 */
async function syncTourVectors({ force = false } = {}) {
  const query = force
    ? { status: "published" }
    : { status: "published", "vectorSync.isSynced": { $ne: true } };

  const tours = await Tour.find(query).lean();
  const collection = await getTourCollection();

  const result = { total: tours.length, success: 0, failed: 0, details: [] };

  for (const tour of tours) {
    try {
      const chunks = chunkTour(tour);
      if (!chunks.length) {
        result.details.push({ tourId: String(tour._id), status: "skipped", reason: "no chunks" });
        continue;
      }

      const vectors = await embedBatch(chunks.map((c) => c.text));

      await collection.upsert({
        ids: chunks.map((c) => c.id),
        embeddings: vectors,
        documents: chunks.map((c) => c.text),
        metadatas: chunks.map((c) => c.metadata),
      });

      await Tour.updateOne(
        { _id: tour._id },
        {
          $set: {
            "vectorSync.isSynced": true,
            "vectorSync.lastSyncedAt": new Date(),
            "vectorSync.chromaId": `${tour._id}_overview`,
          },
        }
      );

      result.success += 1;
      result.details.push({
        tourId: String(tour._id),
        name: tour.name,
        status: "synced",
        chunks: chunks.length,
      });
    } catch (err) {
      result.failed += 1;
      result.details.push({ tourId: String(tour._id), status: "error", error: err.message });
    }
  }

  return result;
}

module.exports = { syncTourVectors };
