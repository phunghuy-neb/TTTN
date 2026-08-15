const test = require("node:test");
const assert = require("node:assert/strict");

const Tour = require("../src/models/Tour");
const gemini = require("../src/config/gemini");
const chroma = require("../src/config/chroma");
const advisor = require("../src/services/travelAdvisorService");
const { inspectIndexIntegrity } = require("../src/services/indexIntegrityService");
const { reconcileTourIndex } = require("../src/services/syncService");
const { collectTourConstraintEvidence } = require("../src/services/retrievalEvidenceService");

const ORIGINAL_FIND = Tour.find;
const ORIGINAL_EMBED = gemini.embedText;
const ORIGINAL_COLLECTION = chroma.getTourCollection;

const IDS = {
  first: "64b000000000000000004009",
  second: "64b000000000000000004001",
  beach: "64b000000000000000004002",
  inland: "64b000000000000000004003",
  long: "64b000000000000000004004",
};

function tour(overrides = {}) {
  return {
    _id: IDS.beach,
    name: "Nha Trang biển nghỉ dưỡng",
    location: "Nha Trang",
    region: "Miền Trung",
    status: "published",
    isActive: true,
    days: 3,
    basePrice: 3_000_000,
    avgRating: 4.5,
    tags: ["biển"],
    highlights: ["Tắm biển"],
    summary: "Nghỉ dưỡng ven biển",
    description: "",
    itinerary: [],
    inclusions: [],
    exclusions: [],
    departures: [],
    reviews: [],
    vectorSync: { isSynced: true },
    ...overrides,
  };
}

function leanFind(resultForQuery) {
  return (query) => {
    const chain = {
      select() { return chain; },
      sort() { return chain; },
      limit() { return chain; },
      lean: async () => typeof resultForQuery === "function" ? resultForQuery(query) : resultForQuery,
    };
    return chain;
  };
}

function loadRagService({ find, embedText, getTourCollection }) {
  Tour.find = find;
  gemini.embedText = embedText;
  chroma.getTourCollection = getTourCollection;
  delete require.cache[require.resolve("../src/services/ragService")];
  return require("../src/services/ragService");
}

test.afterEach(() => {
  Tour.find = ORIGINAL_FIND;
  gemini.embedText = ORIGINAL_EMBED;
  chroma.getTourCollection = ORIGINAL_COLLECTION;
  delete require.cache[require.resolve("../src/services/ragService")];
});

test("TEST 1: Mongo synced tours with an empty Chroma index are degraded split-brain", async () => {
  const tours = [tour(), tour({ _id: IDS.inland, name: "Huế di sản", location: "Huế" })];
  const snapshot = await inspectIndexIntegrity({
    TourModel: { find: leanFind(tours) },
    getCollection: async () => ({
      count: async () => 0,
      get: async () => ({ ids: [], metadatas: [] }),
    }),
  });

  assert.equal(snapshot.status, "degraded");
  assert.equal(snapshot.capabilities.mongo.vectorSyncedTours, 2);
  assert.equal(snapshot.capabilities.chroma.documents, 0);
  assert.equal(snapshot.capabilities.index.status, "degraded");
  assert.ok(snapshot.capabilities.index.reasons.includes("INDEX_EMPTY"));
  assert.ok(snapshot.capabilities.index.reasons.includes("MONGO_CHROMA_SPLIT_BRAIN"));
  assert.equal(snapshot.reconciliation.missingTourIds.length, 2);
});

test("TEST 2: isolated reconciliation rebuilds missing vectors without deleting the collection", async () => {
  const tours = [tour()];
  const ids = [];
  const metadatas = [];
  let embeddingCalls = 0;
  let deleteCalls = 0;
  const collection = {
    count: async () => ids.length,
    get: async () => ({ ids: [...ids], metadatas: [...metadatas] }),
    upsert: async (payload) => {
      for (let index = 0; index < payload.ids.length; index += 1) {
        if (!ids.includes(payload.ids[index])) {
          ids.push(payload.ids[index]);
          metadatas.push(payload.metadatas[index]);
        }
      }
    },
    delete: async () => { deleteCalls += 1; },
  };
  const TourModel = {
    find: leanFind(tours),
    updateOne: async (_query, update) => {
      tours[0].vectorSync = { ...tours[0].vectorSync, ...update.$set };
    },
  };

  const result = await reconcileTourIndex({
    repair: true,
    dependencies: {
      TourModel,
      getCollection: async () => collection,
      embedBatch: async (texts) => {
        embeddingCalls += 1;
        return texts.map(() => [0.1, 0.2]);
      },
    },
  });

  assert.equal(result.before.capabilities.index.status, "degraded");
  assert.equal(result.recovery.success, 1);
  assert.equal(result.after.capabilities.index.status, "healthy");
  assert.equal(embeddingCalls, 1);
  assert.equal(deleteCalls, 0);
});

test("TEST 3: Chroma outage uses Mongo fallback and exposes degraded retrieval status", async () => {
  const fallback = tour();
  const rag = loadRagService({
    find: leanFind([fallback]),
    embedText: async () => [0.1, 0.2],
    getTourCollection: async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); },
  });

  const result = await rag.getRagContext("Tìm tour", { requestType: "recommendation" });
  assert.equal(result.tours.length, 1);
  assert.equal(result.retrievalStatus.status, "degraded");
  assert.equal(result.retrievalStatus.mode, "mongo_fallback");
  assert.ok(result.retrievalStatus.reasons.includes("CHROMA_UNAVAILABLE"));
});

test("TEST 4: a soft-preference miss falls back to all hard-valid candidates", () => {
  const rag = require("../src/services/ragService");
  const inland = tour({ _id: IDS.inland, name: "Huế di sản", location: "Huế", tags: ["văn hóa"], highlights: [] });
  const constraints = {
    interests: ["biển"],
    _constraintMeta: { modes: { interests: "soft" }, currentFields: ["interests"] },
  };
  const ranked = rag.filterAndRankHydratedTours([inland], constraints, { requestType: "recommendation" });
  assert.deepEqual(ranked.map((item) => String(item._id)), [IDS.inland]);
});

test("TEST 5: Chroma candidate index zero receives its ordering signal", () => {
  const rag = require("../src/services/ragService");
  const first = tour({ _id: IDS.first, name: "Tour A", location: "A", tags: [], highlights: [], avgRating: 0 });
  const second = tour({ _id: IDS.second, name: "Tour B", location: "B", tags: [], highlights: [], avgRating: 0 });
  const ranked = rag.filterAndRankHydratedTours([second, first], {}, {
    requestType: "recommendation",
    orderedIds: [IDS.first, IDS.second],
    limit: 2,
  });
  assert.equal(String(ranked[0]._id), IDS.first);
});

test("TEST 6: explicit destinations outside the legacy allowlist remain in semantic state", () => {
  for (const destination of ["Nhật Bản", "Singapore", "Hàn Quốc"]) {
    const message = `Tìm tour ${destination}`;
    const state = advisor.mergeConstraintState({}, advisor.extractConstraintDelta(message, {}, new Date("2026-08-14T00:00:00Z")));
    assert.equal(state.destination, destination, message);
    assert.equal(state[advisor.SEMANTIC_STATE_KEY].slots.destination.status, "known", message);
  }
  const ordinal = advisor.extractConstraintDelta("Tour thứ hai thì sao?", {}, new Date("2026-08-14T00:00:00Z"));
  assert.equal(ordinal.destination, undefined);
});

test("TEST 7: beach evidence does not confuse Biên Hòa or unrelated inland text", () => {
  const rag = require("../src/services/ragService");
  const pool = [
    tour(),
    tour({ _id: IDS.inland, name: "Biên Hòa độc đáo", location: "Biên Hòa", tags: ["độc đáo"], highlights: [], summary: "" }),
    tour({ _id: IDS.long, name: "Huế di sản", location: "Huế", tags: ["văn hóa"], highlights: [], summary: "" }),
  ];
  const ranked = rag.filterAndRankHydratedTours(pool, {
    interests: ["biển"],
    _constraintMeta: { modes: { interests: "hard" }, currentFields: ["interests"] },
  }, { requestType: "recommendation", limit: 10 });
  assert.deepEqual(ranked.map((item) => String(item._id)), [IDS.beach]);
});

test("TEST 8: Mongo recall keeps a profile-matching 10-day tour available for ranking", async () => {
  const short = tour({ _id: IDS.first, name: "Tour ngắn", days: 3, tags: [], highlights: [] });
  const long = tour({ _id: IDS.long, name: "Tour dài 10 ngày", days: 10, tags: [], highlights: [] });
  const rag = loadRagService({
    find: leanFind((query) => query?._id?.$in ? [short] : [short, long]),
    embedText: async () => [0.1, 0.2],
    getTourCollection: async () => ({
      count: async () => 1,
      query: async () => ({
        metadatas: [[{ tourId: IDS.first }]],
        documents: [["short"]],
        distances: [[0.1]],
      }),
    }),
  });

  const result = await rag.getRagContext("Tìm tour", {
    requestType: "recommendation",
    preferenceContext: { profile: { durationPreference: { targetDays: 10 } } },
  });
  assert.ok(result.tours.some((item) => String(item._id) === IDS.long));
  assert.equal(String(result.tours[0]._id), IDS.long);
});

test("TEST 9: internal retrieval failure is not diagnosed as a user constraint problem", () => {
  const rag = require("../src/services/ragService");
  const analysis = rag.diagnoseZeroResult([], { maxPrice: 4_000_000 }, {
    inventoryComplete: false,
    retrievalStatus: { status: "degraded", reasons: ["INDEX_EMPTY"] },
  });
  const reply = advisor.buildZeroResultReply({ maxPrice: 4_000_000 }, analysis);
  assert.equal(analysis.cause, "internal_retrieval_degraded");
  assert.deepEqual(analysis.blockingFields, []);
  assert.doesNotMatch(reply, /nới ngân sách|điều kiện không hợp lệ/i);
  assert.match(reply, /suy giảm|thử lại/i);
});

test("TEST 10: filtering and explanation consume the same semantic evidence", () => {
  const rag = require("../src/services/ragService");
  const beach = tour();
  const constraints = {
    interests: ["biển"],
    _constraintMeta: { modes: { interests: "hard" }, currentFields: ["interests"] },
  };
  const evidence = collectTourConstraintEvidence(beach, constraints);
  const matches = rag.tourMatchesConstraints(beach, constraints, { requestType: "recommendation", evidence });
  const [item] = advisor.buildRecommendationItems([beach], constraints, new Date("2026-08-14T00:00:00Z"));
  assert.equal(matches, true);
  assert.equal(evidence.interests[0].matched, true);
  assert.match(item.currentConstraintReasons.join(" "), /chủ đề biển/i);
});
