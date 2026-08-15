const Tour = require("../models/Tour");
const { getTourCollection } = require("../config/chroma");
const { chunkTour } = require("../utils/tourChunking");
const { providerCapabilitySnapshot } = require("./providerHealthService");

function queryLean(query) {
  return query && typeof query.lean === "function" ? query.lean() : query;
}

function publicCapabilitySnapshot(snapshot) {
  const { reconciliation, ...safe } = snapshot;
  return {
    ...safe,
    reconciliation: reconciliation ? {
      needed: reconciliation.needed,
      repairable: reconciliation.repairable,
      missingTours: reconciliation.missingTourIds.length,
      missingDocuments: reconciliation.missingDocumentIds.length,
      staleDocuments: reconciliation.staleDocumentIds.length,
      unsyncedTours: reconciliation.unsyncedTourIds.length,
    } : null,
  };
}

async function inspectIndexIntegrity({
  TourModel = Tour,
  getCollection = getTourCollection,
  chunker = chunkTour,
} = {}) {
  const checkedAt = new Date().toISOString();
  const mongoResult = await Promise.resolve()
    .then(() => queryLean(TourModel.find({ status: "published", isActive: { $ne: false } })))
    .then((tours) => ({ ok: true, tours: tours || [] }))
    .catch((error) => ({ ok: false, error, tours: [] }));

  let chromaResult;
  try {
    const collection = await getCollection();
    const [count, documents] = await Promise.all([
      collection.count(),
      collection.get({ include: ["metadatas"] }),
    ]);
    chromaResult = { ok: true, count: Number(count) || 0, documents: documents || { ids: [], metadatas: [] } };
  } catch (error) {
    chromaResult = { ok: false, error, count: null, documents: { ids: [], metadatas: [] } };
  }

  const tours = mongoResult.tours;
  const activeTourIds = tours.map((tour) => String(tour._id));
  const syncedTourIds = tours.filter((tour) => tour.vectorSync?.isSynced === true).map((tour) => String(tour._id));
  const unsyncedTourIds = tours.filter((tour) => tour.vectorSync?.isSynced !== true).map((tour) => String(tour._id));
  const expectedByTour = new Map(tours.map((tour) => [
    String(tour._id),
    chunker(tour).map((chunk) => String(chunk.id)),
  ]));
  const expectedDocumentIds = [...expectedByTour.values()].flat();
  const actualDocumentIds = (chromaResult.documents.ids || []).map(String);
  const actualDocumentSet = new Set(actualDocumentIds);
  const expectedDocumentSet = new Set(expectedDocumentIds);
  const missingDocumentIds = expectedDocumentIds.filter((id) => !actualDocumentSet.has(id));
  const staleDocumentIds = actualDocumentIds.filter((id) => !expectedDocumentSet.has(id));
  const missingTourIds = activeTourIds.filter((tourId) =>
    (expectedByTour.get(tourId) || []).some((documentId) => !actualDocumentSet.has(documentId))
  );
  const falseSyncedTourIds = syncedTourIds.filter((tourId) => missingTourIds.includes(tourId));
  const indexedTourIds = activeTourIds.filter((tourId) => {
    const expected = expectedByTour.get(tourId) || [];
    return expected.length > 0 && expected.every((id) => actualDocumentSet.has(id));
  });

  const reasons = [];
  if (!mongoResult.ok) reasons.push("MONGO_UNREACHABLE");
  if (!chromaResult.ok) reasons.push("CHROMA_UNREACHABLE");
  if (mongoResult.ok && chromaResult.ok && tours.length > 0 && chromaResult.count === 0) reasons.push("INDEX_EMPTY");
  if (mongoResult.ok && chromaResult.ok && missingTourIds.length) reasons.push("INDEX_MISSING_TOURS");
  if (falseSyncedTourIds.length) reasons.push("MONGO_CHROMA_SPLIT_BRAIN");
  if (unsyncedTourIds.length) reasons.push("MONGO_UNSYNCED_TOURS");
  if (staleDocumentIds.length) reasons.push("INDEX_STALE_DOCUMENTS");

  const indexObservable = mongoResult.ok && chromaResult.ok;
  const indexStatus = !indexObservable ? "unknown" : reasons.length ? "degraded" : "healthy";
  const provider = providerCapabilitySnapshot();
  const providerDegraded = ["degraded", "not_configured"].includes(provider.status);
  const fallbackActive = providerDegraded || !chromaResult.ok || indexStatus !== "healthy";
  const status = !mongoResult.ok || !chromaResult.ok || indexStatus !== "healthy" || providerDegraded
    ? "degraded"
    : "healthy";
  return {
    status,
    checkedAt,
    capabilities: {
      process: { status: "healthy" },
      mongo: {
        status: mongoResult.ok ? "healthy" : "unreachable",
        publishedActiveTours: mongoResult.ok ? tours.length : null,
        vectorSyncedTours: mongoResult.ok ? syncedTourIds.length : null,
        errorCode: mongoResult.ok ? null : mongoResult.error?.code || mongoResult.error?.name || "MONGO_ERROR",
      },
      chroma: {
        status: chromaResult.ok ? "reachable" : "unreachable",
        documents: chromaResult.ok ? chromaResult.count : null,
        errorCode: chromaResult.ok ? null : chromaResult.error?.code || chromaResult.error?.name || "CHROMA_ERROR",
      },
      index: {
        status: indexStatus,
        indexedTours: indexObservable ? indexedTourIds.length : null,
        expectedDocuments: mongoResult.ok ? expectedDocumentIds.length : null,
        actualDocuments: chromaResult.ok ? chromaResult.count : null,
        reasons,
      },
      provider,
      fallback: {
        status: "available",
        active: fallbackActive,
        reasons: [
          ...(providerDegraded ? [provider.status === "not_configured" ? "PROVIDER_NOT_CONFIGURED" : "PROVIDER_DEGRADED"] : []),
          ...(!chromaResult.ok || indexStatus !== "healthy" ? ["RAG_FALLBACK_ACTIVE"] : []),
        ],
      },
    },
    reconciliation: {
      needed: indexObservable && Boolean(missingTourIds.length || unsyncedTourIds.length || staleDocumentIds.length),
      repairable: mongoResult.ok && chromaResult.ok,
      activeTourIds,
      syncedTourIds,
      unsyncedTourIds,
      indexedTourIds,
      missingTourIds,
      falseSyncedTourIds,
      missingDocumentIds,
      staleDocumentIds,
    },
  };
}

module.exports = { inspectIndexIntegrity, publicCapabilitySnapshot };
