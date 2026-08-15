const test = require("node:test");
const assert = require("node:assert/strict");

const gemini = require("../src/config/gemini");
const ragService = require("../src/services/ragService");

const ORIGINAL_GENERATE = gemini.generateChatReply;
const ORIGINAL_RAG = ragService.getRagContext;
const ORIGINAL_FIND = ragService.findMentionedTours;

const IDS = [
  "64b000000000000000000101",
  "64b000000000000000000102",
  "64b000000000000000000103",
];
const NOW = new Date("2026-08-14T00:00:00.000Z");

function tour(id, index) {
  return {
    _id: id,
    name: [`Tour Nha Trang`, `Tour Đà Lạt`, `Tour Huế`][index],
    location: [`Nha Trang`, `Đà Lạt`, `Huế`][index],
    region: index === 2 ? "Miền Trung" : index === 1 ? "Tây Nguyên" : "Miền Trung",
    days: index + 3,
    basePrice: 2_500_000 + index * 300_000,
    images: [],
    highlights: ["Trải nghiệm địa phương"],
    tags: index === 0 ? ["biển"] : ["văn hóa"],
    cancellationPolicy: `Chính sách hủy tour ${index + 1}`,
    departures: [{
      _id: `64b00000000000000000020${index + 1}`,
      date: new Date("2026-08-21T01:00:00.000Z"),
      price: 2_500_000 + index * 300_000,
      availableSlots: 5 - index,
      totalSlots: 10,
    }],
    inclusions: [],
    exclusions: [],
    itinerary: [],
  };
}

const TOURS = IDS.map(tour);

gemini.generateChatReply = async () => {
  throw new Error("Phase 3 deterministic branches must not call Gemini");
};
ragService.findMentionedTours = async () => [];
ragService.getRagContext = async (prompt, options = {}) => {
  if (String(prompt).includes("9 ngày")) {
    return { tours: [], contextText: "", matchedChunks: [], zeroResult: {} };
  }
  const direct = (options.directTourIds || []).map(String);
  const tours = direct.length ? TOURS.filter((item) => direct.includes(String(item._id))) : TOURS;
  return { tours, contextText: "phase-3-fixture", matchedChunks: [], zeroResult: {} };
};
delete require.cache[require.resolve("../src/services/chatService")];
const { generateChatAnswer } = require("../src/services/chatService");

test.after(() => {
  gemini.generateChatReply = ORIGINAL_GENERATE;
  ragService.getRagContext = ORIGINAL_RAG;
  ragService.findMentionedTours = ORIGINAL_FIND;
  delete require.cache[require.resolve("../src/services/chatService")];
});

test("TEST 1: rich open-destination request is immediately searchable", async () => {
  const result = await generateChatAnswer({
    prompt: "2 người 4 triệu thứ 6 tuần sau chưa biết đi đâu",
    now: NOW,
  });
  assert.equal(result.decision.action, "SEARCH");
  assert.equal(result.structuredContent.type, "recommendation");
  assert.notEqual(result.structuredContent.type, "clarification");
  assert.equal(result.constraintState._semanticState.slots.destination.status, "intentionally_open");
});

test("TEST 2: duration-only recommendation is searchable", async () => {
  const result = await generateChatAnswer({ prompt: "gợi ý tour 3 ngày", now: NOW });
  assert.equal(result.decision.action, "SEARCH");
  assert.equal(result.constraintState.days, 3);
});

test("TEST 3: optional details cannot make a request less actionable", async () => {
  const simple = await generateChatAnswer({ prompt: "gợi ý tour 3 ngày", now: NOW });
  const rich = await generateChatAnswer({
    prompt: "gợi ý tour 3 ngày cho 2 người, đi đâu cũng được, ưu tiên văn hóa",
    now: NOW,
  });
  assert.equal(simple.decision.action, "SEARCH");
  assert.equal(rich.decision.action, "SEARCH");
  assert.ok(rich.decision.optionalMissing.length <= simple.decision.optionalMissing.length);
});

test("TEST 4 and 12: typed budget clarification resolves once and clears pending state", async () => {
  const first = await generateChatAnswer({ prompt: "gợi ý tour 4 triệu", now: NOW });
  assert.equal(first.decision.action, "CLARIFY");
  assert.equal(first.decision.clarification.slot, "budget.scope");
  assert.equal(first.entityState.pendingClarification.slot, "budget.scope");

  const second = await generateChatAnswer({
    prompt: "tổng cho cả đoàn",
    constraintState: first.constraintState,
    entityState: first.entityState,
    now: NOW,
  });
  assert.equal(second.decision.action, "SEARCH");
  assert.equal(second.constraintState.budgetScope, "total");
  assert.equal(second.entityState.pendingClarification, null);
});

test("TEST 5: bare ordinal resolves a typed entity clarification", async () => {
  const first = await generateChatAnswer({
    prompt: "tour nào có chính sách hủy?",
    entityState: { lastSuggestedTourIds: IDS },
    now: NOW,
  });
  assert.equal(first.decision.action, "CLARIFY");
  assert.equal(first.decision.clarification.slot, "entity.tour_selection");

  const second = await generateChatAnswer({
    prompt: "2",
    constraintState: first.constraintState,
    entityState: first.entityState,
    now: NOW,
  });
  assert.equal(second.decision.action, "ANSWER");
  assert.equal(second.structuredContent.tourId, IDS[1]);
  assert.deepEqual(second.referencedTourIds, [IDS[1]]);
  assert.equal(second.entityState.pendingClarification, null);
});

test("TEST 6: duration fact question answers without mutating search duration", async () => {
  const result = await generateChatAnswer({
    prompt: "tour này 3 ngày à?",
    constraintState: { days: 5 },
    entityState: { lastReferencedTourIds: [IDS[0]] },
    now: NOW,
  });
  assert.equal(result.decision.action, "ANSWER");
  assert.equal(result.intent.mutationMode, "none");
  assert.equal(result.constraintState.days, 5);
  assert.equal(result.structuredContent.requestedFact, "duration");
});

test("TEST 7: explicit duration command mutates state and searches", async () => {
  const result = await generateChatAnswer({
    prompt: "đổi thành 3 ngày",
    constraintState: { days: 5 },
    now: NOW,
  });
  assert.equal(result.decision.action, "SEARCH");
  assert.equal(result.intent.mutationMode, "update");
  assert.equal(result.constraintState.days, 3);

  const alternative = await generateChatAnswer({ prompt: "còn tour 3 ngày thì sao?", now: NOW });
  assert.equal(alternative.decision.action, "SEARCH");
  assert.equal(alternative.constraintState.days, 3);
});

test("TEST 8: saved preference cannot suppress a materially required clarification", async () => {
  const result = await generateChatAnswer({
    prompt: "gợi ý tour 4 triệu",
    preferenceContext: { profile: { interests: ["biển"] } },
    now: NOW,
  });
  assert.equal(result.decision.action, "CLARIFY");
  assert.equal(result.decision.clarification.slot, "budget.scope");
});

test("TEST 9 and 11: optional missing fields never independently clarify", async () => {
  const result = await generateChatAnswer({ prompt: "gợi ý tour 3 ngày", now: NOW });
  assert.equal(result.decision.action, "SEARCH");
  assert.ok(result.decision.optionalMissing.includes("destination"));
  assert.deepEqual(result.decision.requiredMissing, []);
  assert.equal(result.decision.clarification, null);
});

test("TEST 10: SEARCH branch cannot return a clarification question", async () => {
  const result = await generateChatAnswer({ prompt: "gợi ý tour 9 ngày", now: NOW });
  assert.equal(result.decision.action, "SEARCH");
  assert.equal(result.structuredContent.type, "recommendation");
  assert.doesNotMatch(result.reply, /\?\s*$/);
  assert.notEqual(result.structuredContent.type, "clarification");
});

test("TEST 13: intentionally-open destination proceeds without destination clarification", async () => {
  const result = await generateChatAnswer({ prompt: "đi đâu cũng được", now: NOW });
  assert.equal(result.decision.action, "SEARCH");
  assert.equal(result.constraintState._semanticState.slots.destination.status, "intentionally_open");
  assert.doesNotMatch(result.reply, /muốn đi đâu/i);
});

test("TEST 14: mixed availability and cancellation-policy request retains both facts", async () => {
  const result = await generateChatAnswer({
    prompt: "tour thứ hai còn chỗ không và chính sách hủy thế nào",
    entityState: { lastSuggestedTourIds: IDS },
    now: NOW,
  });
  assert.equal(result.decision.action, "ANSWER");
  assert.equal(result.decision.operation, "mixed_tour_facts");
  assert.equal(result.structuredContent.type, "mixed_tour_facts");
  assert.deepEqual(result.structuredContent.requestedFacts, ["availability", "cancellation_policy"]);
  assert.deepEqual(result.structuredContent.facts.map((item) => item.kind), ["availability", "cancellation_policy"]);
});

test("mixed price and duration facts are both retained", async () => {
  const result = await generateChatAnswer({
    prompt: "tour này giá bao nhiêu và mấy ngày?",
    entityState: { lastReferencedTourIds: [IDS[0]] },
    now: NOW,
  });
  assert.equal(result.decision.operation, "mixed_tour_facts");
  assert.deepEqual(result.structuredContent.facts.map((item) => item.kind), ["price", "duration"]);
  assert.match(result.reply, /2\.500\.000đ/);
  assert.match(result.reply, /3 ngày/);
});
