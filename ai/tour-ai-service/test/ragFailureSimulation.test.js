const test = require("node:test");
const assert = require("node:assert/strict");

const Tour = require("../src/models/Tour");
const gemini = require("../src/config/gemini");
const chroma = require("../src/config/chroma");

const ORIGINAL_EMBED = gemini.embedText;
const ORIGINAL_COLLECTION = chroma.getTourCollection;
const ORIGINAL_FIND = Tour.find;

function loadRagService({ embedText, getTourCollection, find }) {
  gemini.embedText = embedText;
  chroma.getTourCollection = getTourCollection;
  Tour.find = find;
  delete require.cache[require.resolve("../src/services/ragService")];
  return require("../src/services/ragService");
}

test.afterEach(() => {
  gemini.embedText = ORIGINAL_EMBED;
  chroma.getTourCollection = ORIGINAL_COLLECTION;
  Tour.find = ORIGINAL_FIND;
  delete require.cache[require.resolve("../src/services/ragService")];
});

function mongoFallbackFind(tours = []) {
  return () => {
    const chain = {
      select() { return chain; },
      sort() { return chain; },
      limit() { return chain; },
      lean: async () => tours,
    };
    return chain;
  };
}

test("embedding failure is simulated and falls back to Mongo without live provider calls", async () => {
  let embeddingCalls = 0;
  let collectionCalls = 0;
  const { getRagContext } = loadRagService({
    embedText: async () => {
      embeddingCalls += 1;
      const error = new Error("simulated embedding failure");
      error.code = "EMBEDDING_ERROR";
      throw error;
    },
    getTourCollection: async () => {
      collectionCalls += 1;
      throw new Error("collection should not be needed after embedding failure");
    },
    find: mongoFallbackFind([]),
  });

  const result = await getRagContext("Tìm tour biển", {
    requestType: "recommendation",
    constraintState: { interests: ["biển"] },
  });
  assert.equal(embeddingCalls, 1);
  assert.ok(collectionCalls <= 1);
  assert.deepEqual(result.tours, []);
  assert.match(result.contextText, /không tìm thấy/i);
});

test("Chroma query failure is simulated and returns safe Mongo fallback", async () => {
  let embeddingCalls = 0;
  let queryCalls = 0;
  const { getRagContext } = loadRagService({
    embedText: async () => {
      embeddingCalls += 1;
      return [0.1, 0.2];
    },
    getTourCollection: async () => ({
      query: async () => {
        queryCalls += 1;
        throw Object.assign(new Error("simulated Chroma outage"), { code: "ECONNREFUSED" });
      },
    }),
    find: mongoFallbackFind([]),
  });

  const result = await getRagContext("Tìm tour núi", {
    requestType: "recommendation",
    constraintState: { interests: ["núi"] },
  });
  assert.equal(embeddingCalls, 1);
  assert.equal(queryCalls, 1);
  assert.deepEqual(result.tours, []);
  assert.match(result.contextText, /không tìm thấy/i);
});
