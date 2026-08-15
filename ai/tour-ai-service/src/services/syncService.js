const Tour = require("../models/Tour");
const { chunkTour } = require("../utils/tourChunking");
const { embedBatch } = require("../config/gemini");
const { getTourCollection } = require("../config/chroma");
const { inspectIndexIntegrity } = require("./indexIntegrityService");

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
async function syncTourVectors({
  force = false,
  tourIds = null,
  dependencies = {},
} = {}) {
  const TourModel = dependencies.TourModel || Tour;
  const getCollection = dependencies.getCollection || getTourCollection;
  const embed = dependencies.embedBatch || embedBatch;
  const chunker = dependencies.chunkTour || chunkTour;
  const query = {
    status: "published",
    isActive: { $ne: false },
    ...(tourIds?.length ? { _id: { $in: tourIds } } : {}),
  };

  const allTours = await TourModel.find(query).lean();
  const collection = await getCollection();
  const existing = await collection.get({ include: ["metadatas"] });
  const existingIds = new Set((existing?.ids || []).map(String));
  const tours = force || tourIds?.length
    ? allTours
    : allTours.filter((tour) => {
      if (tour.vectorSync?.isSynced !== true) return true;
      return chunker(tour).some((chunk) => !existingIds.has(String(chunk.id)));
    });

  const result = {
    total: tours.length,
    inspected: allTours.length,
    success: 0,
    failed: 0,
    details: [],
  };

  for (const tour of tours) {
    try {
      const chunks = chunker(tour);
      if (!chunks.length) {
        result.details.push({ tourId: String(tour._id), status: "skipped", reason: "no chunks" });
        continue;
      }

      const vectors = await embed(chunks.map((c) => c.text));

      await collection.upsert({
        ids: chunks.map((c) => c.id),
        embeddings: vectors,
        documents: chunks.map((c) => c.text),
        metadatas: chunks.map((c) => c.metadata),
      });

      await TourModel.updateOne(
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

async function reconcileTourIndex({ repair = true, dependencies = {} } = {}) {
  const inspectionDependencies = {
    TourModel: dependencies.TourModel || Tour,
    getCollection: dependencies.getCollection || getTourCollection,
    chunker: dependencies.chunkTour || chunkTour,
  };
  const before = await inspectIndexIntegrity(inspectionDependencies);
  let recovery = null;
  if (repair && before.reconciliation.repairable && before.reconciliation.needed) {
    const repairIds = [...new Set([
      ...before.reconciliation.missingTourIds,
      ...before.reconciliation.unsyncedTourIds,
    ])];
    recovery = repairIds.length
      ? await syncTourVectors({ tourIds: repairIds, dependencies })
      : { total: 0, inspected: 0, success: 0, failed: 0, details: [] };
  }
  const after = recovery ? await inspectIndexIntegrity(inspectionDependencies) : before;
  return { before, recovery, after };
}

module.exports = { syncTourVectors, reconcileTourIndex };
