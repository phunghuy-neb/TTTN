const test = require("node:test");
const assert = require("node:assert/strict");

const gemini = require("../src/config/gemini");
const ragService = require("../src/services/ragService");
const { prepareActionTurn, decideAction } = require("../src/services/actionPolicyService");
const { mergeConstraintState } = require("../src/services/travelAdvisorService");

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

test("MEDIUM-02 explanatory 'tìm hiểu' suitability questions route to general ANSWER", async () => {
  for (const prompt of [
    "Hành trình Sa Pa có phù hợp với người muốn vừa ngắm cảnh vừa tìm hiểu văn hóa bản địa không?",
    "Hành trình Huế có hợp cho người muốn tìm hiểu lịch sử và kiến trúc địa phương không?",
  ]) {
    const result = await generateChatAnswer({ prompt, now: NOW });
    assert.equal(result.decision.action, "ANSWER", prompt);
    assert.equal(result.decision.operation, "general_answer", prompt);
    assert.equal(result.intent.mutationMode, "contextual", prompt);
  }
});

test("Stage 3C named-tour suitability wins over preference and tour-detail routing", () => {
  for (const prompt of [
    "Tôi thích di sản thiên nhiên, chèo kayak và muốn ngủ đêm trên vịnh. Tour Vịnh Hạ Long — Kỳ quan trên biển có phù hợp không? Hãy giải thích ngắn gọn dựa trên lịch trình hiện có.",
    "Tôi thích chụp ảnh và văn hóa. Tour Hội An có hợp với tôi không?",
    "Tôi thích nghỉ dưỡng. Tour Phú Quốc có phù hợp với tôi không?",
  ]) {
    const prepared = prepareActionTurn({ message: prompt, now: NOW });
    const value = decideAction({ prepared, preferenceCommandOnly: false });
    assert.equal(prepared.turn.evaluativeQuestion, true, prompt);
    assert.equal(prepared.intent.requestType, "general", prompt);
    assert.equal(value.action, "ANSWER", prompt);
    assert.equal(value.operation, "general_answer", prompt);
  }
});

test("short suitability follow-ups stay evaluative for the selected tour", () => {
  for (const prompt of [
    "tour này còn hợp ko",
    "cái này hợp k",
    "vẫn phù hợp không?",
    "cái này hợp người thích chụp ảnh với văn hóa không, nói 2 ý thôi",
    "tour đó hợp gia đình có trẻ nhỏ không?",
    "cái này phù hợp người ngại leo nhiều ko",
    "tour này hợp chụp ảnh ko, 1 câu",
    "tour này hợp tìm hiểu văn hóa không?",
  ]) {
    const prepared = prepareActionTurn({
      message: prompt,
      entityState: {
        selectedTourId: IDS[0],
        currentTourId: IDS[0],
        lastReferencedTourIds: [IDS[0]],
      },
      now: NOW,
    });
    const value = decideAction({ prepared, preferenceCommandOnly: false });

    assert.equal(prepared.turn.evaluativeQuestion, true, prompt);
    assert.equal(prepared.intent.requestType, "general", prompt);
    assert.equal(value.action, "ANSWER", prompt);
    assert.equal(value.operation, "general_answer", prompt);
  }
});

test("Stage 3C search and semantic-update speech acts still outrank a preference statement", () => {
  for (const prompt of [
    "Tôi thích núi, tìm giúp tôi vài tour.",
    "Tôi thích chụp ảnh, gợi ý vài tour đi.",
    "Ưu tiên nghỉ dưỡng và cho tôi danh sách tour.",
    "đưa vài lựa chọn xem",
  ]) {
    const search = prepareActionTurn({ message: prompt, now: NOW });
    const searchDecision = decideAction({ prepared: search, preferenceCommandOnly: false });
    assert.equal(search.turn.explicitSearch, true, prompt);
    assert.equal(searchDecision.action, "SEARCH", prompt);
    assert.equal(searchDecision.operation, "recommendation", prompt);
  }

  const update = prepareActionTurn({ message: "Tôi thích biển, à đổi thành 3 người.", now: NOW });
  const updateDecision = decideAction({ prepared: update, preferenceCommandOnly: false });
  assert.equal(update.turn.explicitUpdate, true);
  assert.equal(update.constraintState.travelers, 3);
  assert.equal(updateDecision.action, "SEARCH");
  assert.equal(updateDecision.operation, "recommendation");
});

test("MEDIUM-02 explicit tour searches containing 'tìm' remain SEARCH", async () => {
  for (const prompt of [
    "tìm tour Sa Pa phù hợp với người thích văn hóa",
    "gợi ý tour Sa Pa cho người thích văn hóa",
  ]) {
    const result = await generateChatAnswer({ prompt, now: NOW });
    assert.equal(result.decision.action, "SEARCH", prompt);
    assert.equal(result.decision.operation, "recommendation", prompt);
  }
});

test("MEDIUM-02 highlight paraphrases route to a read-only ANSWER instead of destination SEARCH", () => {
  for (const prompt of [
    "Hành trình Sa Pa có điểm gì đáng chú ý cho người mê săn mây?",
    "Tour Huế có điểm nào nổi bật về lịch sử?",
  ]) {
    const prepared = prepareActionTurn({ message: prompt, now: NOW });
    const decision = decideAction({
      prepared,
      resolvedTourIds: [IDS[2]],
      resolvedTours: [TOURS[2]],
    });
    assert.deepEqual(prepared.turn.requestedFacts, ["overview"], prompt);
    assert.equal(prepared.intent.mutationMode, "none", prompt);
    assert.equal(decision.action, "ANSWER", prompt);
    assert.equal(decision.operation, "tour_detail", prompt);
  }
});

test("ordinal overview question uses the active entity as deterministic tour detail", () => {
  const prepared = prepareActionTurn({
    message: "cái thứ 2 có gì nổi bật",
    entityState: {
      candidateLists: [{
        candidateListId: "active",
        createdTurnId: "turn-list",
        createdTurnSequence: 4,
        historyEpoch: 0,
        source: "recommendation",
        tourIds: [IDS[0], IDS[1]],
      }],
      activeCandidateListId: "active",
      lastSuggestedTourIds: [IDS[0], IDS[1]],
      lastReferencedTourIds: [IDS[0], IDS[1]],
    },
    now: NOW,
  });

  assert.equal(prepared.intent.requestType, "tour_detail");
  assert.deepEqual(prepared.intent.requestedFacts, ["overview"]);
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
  assert.equal(second.structuredContent.requestedFact, "cancellation_policy");
  assert.match(second.reply, /Chính sách hủy tour 2/);
  assert.deepEqual(second.referencedTourIds, [IDS[1]]);
  assert.equal(second.entityState.pendingClarification, null);
});

test("typed entity clarification resumes the original total-price fact", async () => {
  const constraintState = mergeConstraintState({}, {
    travelers: 4,
    dateRange: { start: "2026-08-17", end: "2026-08-23", label: "tuần sau" },
  });
  const first = await generateChatAnswer({
    prompt: "giá tổng?",
    constraintState,
    entityState: { lastSuggestedTourIds: [IDS[0], IDS[1]] },
    now: NOW,
  });
  assert.equal(first.decision.action, "CLARIFY");
  assert.equal(first.decision.clarification.slot, "entity.tour_selection");

  const second = await generateChatAnswer({
    prompt: "1",
    constraintState: first.constraintState,
    entityState: first.entityState,
    now: NOW,
  });

  assert.equal(second.decision.action, "ANSWER");
  assert.equal(second.structuredContent.tourId, IDS[0]);
  assert.equal(second.structuredContent.requestedFact, "price_total");
  assert.equal(second.structuredContent.totalPrice, 10_000_000);
  assert.match(second.reply, /4 người.*10\.000\.000đ/i);
});

test("typed entity clarification replaces an older selected tour without conflicting IDs", async () => {
  const entityState = {
    selectedTourId: IDS[0],
    currentTourId: IDS[0],
    lastReferencedTourIds: [IDS[0]],
    pendingAction: "tour_detail",
    pendingClarification: {
      slot: "entity.tour_selection",
      type: "entity_selection",
      allowedAnswerKinds: ["ordinal", "tour_name", "tour_id"],
      candidateTourIds: [IDS[1], IDS[2]],
      requestType: "tour_detail",
      resumeOperation: "tour_detail",
    },
  };

  const result = await generateChatAnswer({
    prompt: "1",
    entityState,
    now: NOW,
  });

  assert.equal(result.decision.action, "ANSWER");
  assert.deepEqual(result.referencedTourIds, [IDS[1]]);
  assert.equal(result.entityState.selectedTourId, IDS[1]);
  assert.equal(result.entityState.currentTourId, IDS[1]);
  assert.equal(result.entityState.previousSelectedTourId, IDS[0]);
  assert.equal(result.entityState.pendingClarification, null);
});

test("repeated constraint-only follow-up after a tour fact resumes recommendation", async () => {
  const list = await generateChatAnswer({
    prompt: "gợi ý tour 3 ngày không bơi",
    now: NOW,
  });
  const selected = await generateChatAnswer({
    prompt: "tour thứ 1",
    constraintState: list.constraintState,
    entityState: list.entityState,
    now: NOW,
  });
  assert.equal(selected.decision.action, "ANSWER");
  assert.equal(selected.decision.operation, "tour_detail");

  const repeated = await generateChatAnswer({
    prompt: "không bơi",
    constraintState: selected.constraintState,
    entityState: selected.entityState,
    now: NOW,
  });

  assert.equal(repeated.decision.action, "SEARCH");
  assert.equal(repeated.decision.operation, "recommendation");
  assert.equal(repeated.structuredContent.type, "recommendation");
  assert.deepEqual(repeated.constraintState.exclusions, ["bơi"]);
});

async function availabilityDatePending() {
  const first = await generateChatAnswer({
    prompt: "gợi ý tour Hội An cho 2 người",
    now: NOW,
  });
  const second = await generateChatAnswer({
    prompt: "tour đầu tiên còn đủ chỗ không?",
    constraintState: first.constraintState,
    entityState: first.entityState,
    now: NOW,
  });
  assert.equal(second.decision.action, "CLARIFY");
  assert.equal(second.entityState.pendingClarification.slot, "trip.date");
  return second;
}

async function selectedTourAfterPriceQuestion() {
  const list = await generateChatAnswer({
    prompt: "gợi ý tour đi đâu cũng được 3 ngày",
    now: NOW,
  });
  const selected = await generateChatAnswer({
    prompt: "tour thứ 1",
    constraintState: list.constraintState,
    entityState: list.entityState,
    now: NOW,
  });
  const priced = await generateChatAnswer({
    prompt: "tour đó giá bao nhiêu",
    constraintState: selected.constraintState,
    entityState: selected.entityState,
    now: NOW,
  });
  assert.deepEqual(priced.referencedTourIds, [IDS[0]]);
  assert.equal(priced.entityState.selectedTourId, IDS[0]);
  return priced;
}

test("MEDIUM-03 short availability party follow-ups retain the selected tour", async () => {
  for (const prompt of ["còn đủ 5 người không", "đủ cho 4 khách không"]) {
    const previous = await selectedTourAfterPriceQuestion();
    const result = await generateChatAnswer({
      prompt,
      constraintState: previous.constraintState,
      entityState: previous.entityState,
      now: NOW,
    });
    assert.equal(result.decision.action, "ANSWER", prompt);
    assert.equal(result.decision.operation, "mixed_tour_facts", prompt);
    assert.deepEqual(result.referencedTourIds, [IDS[0]], prompt);
    assert.deepEqual(result.structuredContent.requestedFacts, ["availability"], prompt);
    assert.equal(result.structuredContent.tourId, IDS[0], prompt);
    assert.equal(result.structuredContent.facts[0].departures[0].partySize, prompt.includes("5") ? 5 : 4, prompt);
  }
});

test("MEDIUM-03 availability wording without a selected entity remains a recommendation update", async () => {
  const result = await generateChatAnswer({ prompt: "còn đủ 5 người không", now: NOW });
  assert.equal(result.decision.action, "SEARCH");
  assert.equal(result.decision.operation, "recommendation");
  assert.equal(result.constraintState.travelers, 5);
});

test("short availability follow-up without a party noun uses the selected tour and known party size", async () => {
  const selected = await selectedTourAfterPriceQuestion();
  const constraintState = mergeConstraintState(selected.constraintState, {
    travelers: 4,
    adults: 4,
    children: 0,
    childAges: [],
    dateRange: { start: "2026-08-17", end: "2026-08-23", label: "tuần sau" },
    _constraintMeta: {
      modes: { travelers: "hard", dateRange: "hard" },
      currentFields: ["travelers", "dateRange"],
      removedFields: [],
      transientConstraints: null,
      queryScope: null,
    },
  });
  const result = await generateChatAnswer({
    prompt: "còn đủ ko",
    constraintState,
    entityState: selected.entityState,
    now: NOW,
  });

  assert.equal(result.decision.action, "ANSWER");
  assert.equal(result.decision.operation, "availability");
  assert.deepEqual(result.referencedTourIds, [IDS[0]]);
  assert.equal(result.structuredContent.type, "availability");
  assert.equal(result.structuredContent.departures[0].partySize, 4);
});

test("bare total-price follow-up uses the selected tour and known party size", async () => {
  const selected = await selectedTourAfterPriceQuestion();
  const constraintState = mergeConstraintState(selected.constraintState, {
    travelers: 4,
    adults: 4,
    children: 0,
    childAges: [],
    dateRange: { start: "2026-08-17", end: "2026-08-23", label: "tuần sau" },
    _constraintMeta: {
      modes: { travelers: "hard", dateRange: "hard" },
      currentFields: ["travelers", "dateRange"],
      removedFields: [],
      transientConstraints: null,
      queryScope: null,
    },
  });
  const result = await generateChatAnswer({
    prompt: "tổng?",
    constraintState,
    entityState: selected.entityState,
    now: NOW,
  });

  assert.equal(result.decision.action, "ANSWER");
  assert.equal(result.decision.operation, "tour_detail");
  assert.deepEqual(result.referencedTourIds, [IDS[0]]);
  assert.equal(result.structuredContent.requestedFact, "price_total");
  assert.equal(result.structuredContent.partySize, 4);
  assert.equal(result.structuredContent.totalPrice, 10_000_000);
});

test("day-specific itinerary follow-ups keep the selected tour after a factual answer", async () => {
  const selected = await selectedTourAfterPriceQuestion();

  for (const prompt of [
    "ngày 2 làm gì",
    "ngày 2 thì sao",
    "ngày 2 có hoạt động gì",
    "tóm tắt ngày 1, ngày 2 và ngày 3",
  ]) {
    const result = await generateChatAnswer({
      prompt,
      constraintState: selected.constraintState,
      entityState: selected.entityState,
      now: NOW,
    });

    assert.equal(result.decision.action, "ANSWER", prompt);
    assert.equal(result.decision.operation, "tour_detail", prompt);
    assert.deepEqual(result.referencedTourIds, [IDS[0]], prompt);
    assert.equal(result.entityState.selectedTourId, IDS[0], prompt);
  }
});

test("HIGH-02 exact and variant nearest-departure answers resolve the pending date", async () => {
  for (const prompt of ["ngày gần nhất giá bao nhiêu?", "đợt sớm nhất giá bao nhiêu?"]) {
    const pending = await availabilityDatePending();
    const result = await generateChatAnswer({
      prompt,
      constraintState: pending.constraintState,
      entityState: pending.entityState,
      now: NOW,
    });
    assert.equal(result.decision.action, "ANSWER", prompt);
    assert.equal(result.decision.operation, "availability", prompt);
    assert.equal(result.entityState.pendingClarification, null, prompt);
    assert.deepEqual(result.referencedTourIds, [IDS[0]], prompt);
    assert.equal(result.structuredContent.type, "availability", prompt);
    assert.equal(result.structuredContent.departures.length, 1, prompt);
    assert.equal(result.structuredContent.departures[0].departureId, "64b000000000000000000201", prompt);
    assert.equal(result.structuredContent.departures[0].price, 2_500_000, prompt);
  }
});

test("HIGH-02 nearest-departure follow-up works directly for the selected tour without pending clarification", async () => {
  const pending = await availabilityDatePending();
  const result = await generateChatAnswer({
    prompt: "ngày gần nhất thì sao?",
    constraintState: pending.constraintState,
    entityState: {
      ...pending.entityState,
      pendingAction: null,
      pendingClarification: null,
      lastRequestType: "availability",
      selectedTourId: IDS[0],
      currentTourId: IDS[0],
      lastReferencedTourIds: [IDS[0]],
    },
    now: NOW,
  });

  assert.equal(result.decision.action, "ANSWER");
  assert.equal(result.decision.operation, "availability");
  assert.deepEqual(result.referencedTourIds, [IDS[0]]);
  assert.equal(result.structuredContent.type, "availability");
  assert.equal(result.structuredContent.departures.length, 1);
  assert.equal(result.structuredContent.departures[0].departureId, "64b000000000000000000201");
});

test("HIGH-02 unrelated nearest-place wording does not resolve the pending date as a departure", async () => {
  const pending = await availabilityDatePending();
  const result = await generateChatAnswer({
    prompt: "khách sạn gần nhất thế nào?",
    constraintState: pending.constraintState,
    entityState: pending.entityState,
    now: NOW,
  });
  assert.equal(result.decision.action, "ANSWER");
  assert.equal(result.decision.operation, "tour_detail");
  assert.equal(result.entityState.pendingClarification, null);
  assert.deepEqual(result.referencedTourIds, [IDS[0]]);
  assert.equal(result.structuredContent.requestedFact, "accommodation");
});

test("HIGH-02 cancellation interrupts an unrelated availability clarification", async () => {
  for (const prompt of [
    "chính sách hủy thế nào?",
    "nếu hủy tour thì sao?",
    "hủy tour mất phí bao nhiêu?",
    "phí hủy bao nhiêu?",
  ]) {
    const pending = await availabilityDatePending();
    const result = await generateChatAnswer({
      prompt,
      constraintState: pending.constraintState,
      entityState: pending.entityState,
      now: NOW,
    });
    assert.equal(result.decision.action, "ANSWER", prompt);
    assert.equal(result.decision.operation, "tour_detail", prompt);
    assert.equal(result.entityState.pendingClarification, null, prompt);
    assert.deepEqual(result.referencedTourIds, [IDS[0]], prompt);
    assert.equal(result.structuredContent.requestedFact, "cancellation_policy", prompt);
  }
});

test("HIGH-02 a new regional recommendation clears pending availability and stale destination", async () => {
  const pending = await availabilityDatePending();
  const result = await generateChatAnswer({
    prompt: "gợi ý tour miền Bắc",
    constraintState: pending.constraintState,
    entityState: pending.entityState,
    now: NOW,
  });
  assert.equal(result.decision.action, "SEARCH");
  assert.equal(result.entityState.pendingClarification, null);
  assert.equal(result.constraintState.region, "Miền Bắc");
  assert.equal(result.constraintState.destination, undefined);
  assert.equal(result.constraintState._semanticState.slots.destination.status, "removed");
  assert.deepEqual(result.constraintState._semanticState.slots.destination.values, []);
});

test("empty entity clarification does not lock a later semantic relaxation", async () => {
  const noResults = await generateChatAnswer({ prompt: "gợi ý tour 9 ngày", now: NOW });
  assert.equal(noResults.decision.action, "SEARCH");
  assert.equal(noResults.tours.length, 0);

  const missingOrdinal = await generateChatAnswer({
    prompt: "cái thứ 2 có gì nổi bật",
    constraintState: noResults.constraintState,
    entityState: noResults.entityState,
    now: NOW,
  });
  assert.equal(missingOrdinal.decision.action, "CLARIFY");
  assert.equal(missingOrdinal.decision.clarification.slot, "entity.tour_selection");
  assert.deepEqual(missingOrdinal.decision.clarification.candidateTourIds, []);

  const relaxed = await generateChatAnswer({
    prompt: "thôi bỏ giới hạn thời gian",
    constraintState: missingOrdinal.constraintState,
    entityState: missingOrdinal.entityState,
    now: NOW,
  });
  assert.equal(relaxed.decision.action, "SEARCH");
  assert.equal(relaxed.decision.operation, "recommendation");
  assert.equal(relaxed.constraintState._semanticState.slots.duration.status, "removed");
  assert.equal(relaxed.entityState.pendingClarification, null);
  assert.ok(relaxed.tours.length > 0);
});

test("persisted empty entity clarification is cleared before processing a new intent", async () => {
  const noResults = await generateChatAnswer({ prompt: "gợi ý tour 9 ngày", now: NOW });
  const result = await generateChatAnswer({
    prompt: "thôi bỏ giới hạn thời gian",
    constraintState: noResults.constraintState,
    entityState: {
      ...noResults.entityState,
      pendingAction: "tour_detail",
      pendingClarification: {
        slot: "entity.tour_selection",
        type: "entity_selection",
        allowedAnswerKinds: ["ordinal", "tour_name", "tour_id"],
        candidateTourIds: [],
        requestType: "tour_detail",
        resumeOperation: "tour_detail",
      },
    },
    now: NOW,
  });

  assert.equal(result.decision.action, "SEARCH");
  assert.equal(result.decision.operation, "recommendation");
  assert.equal(result.entityState.pendingClarification, null);
  assert.equal(result.constraintState._semanticState.slots.duration.status, "removed");
  assert.ok(result.tours.length > 0);
});

test("semantic relaxation and alternative search interrupt a non-empty entity clarification", async () => {
  for (const prompt of ["thôi biển cũng được", "cho danh sách khác"]) {
    const list = await generateChatAnswer({ prompt: "gợi ý tour đi đâu cũng được không biển", now: NOW });
    assert.equal(list.decision.action, "SEARCH", prompt);
    assert.ok(list.tours.length > 1, prompt);
    const pending = await generateChatAnswer({
      prompt: "tổng?",
      constraintState: list.constraintState,
      entityState: list.entityState,
      now: NOW,
    });
    assert.equal(pending.decision.action, "CLARIFY", prompt);
    assert.equal(pending.decision.clarification.slot, "entity.tour_selection", prompt);
    assert.ok(pending.decision.clarification.candidateTourIds.length > 1, prompt);

    const result = await generateChatAnswer({
      prompt,
      constraintState: pending.constraintState,
      entityState: pending.entityState,
      now: NOW,
    });
    assert.equal(result.decision.action, "SEARCH", prompt);
    assert.equal(result.entityState.pendingClarification, null, prompt);
    if (prompt.includes("biển")) {
      assert.deepEqual(result.constraintState.interests, [], prompt);
      assert.deepEqual(result.constraintState.exclusions, [], prompt);
      assert.deepEqual(result.constraintState._semanticState.slots.interests.values, [], prompt);
      assert.deepEqual(result.constraintState._semanticState.slots.interests.excludedValues, [], prompt);
    }
  }
});

test("HIGH-02 only a real answer or a strong new intent escapes the pending date", async () => {
  const pendingForVague = await availabilityDatePending();
  const vague = await generateChatAnswer({
    prompt: "để tôi xem đã",
    constraintState: pendingForVague.constraintState,
    entityState: pendingForVague.entityState,
    now: NOW,
  });
  assert.equal(vague.decision.action, "CLARIFY");
  assert.equal(vague.decision.reason, "pending_clarification_unresolved");
  assert.equal(vague.entityState.pendingClarification.slot, "trip.date");

  const pendingForDate = await availabilityDatePending();
  const explicitDate = await generateChatAnswer({
    prompt: "ngày mai",
    constraintState: pendingForDate.constraintState,
    entityState: pendingForDate.entityState,
    now: NOW,
  });
  assert.equal(explicitDate.decision.action, "ANSWER");
  assert.equal(explicitDate.decision.operation, "availability");
  assert.equal(explicitDate.entityState.pendingClarification, null);
  assert.equal(explicitDate.constraintState._semanticState.slots.date.status, "known");
  assert.equal(explicitDate.constraintState.dateRange.start, "2026-08-15");
});

test("HIGH-02 explicit date rebinds a candidate-only pending tour", async () => {
  const pending = await availabilityDatePending();
  const candidateOnlyEntityState = {
    pendingAction: pending.entityState.pendingAction,
    pendingClarification: structuredClone(pending.entityState.pendingClarification),
  };
  const result = await generateChatAnswer({
    prompt: "ngày mai",
    constraintState: pending.constraintState,
    entityState: candidateOnlyEntityState,
    now: NOW,
  });
  assert.equal(result.decision.action, "ANSWER");
  assert.equal(result.decision.operation, "availability");
  assert.equal(result.entityState.pendingClarification, null);
  assert.deepEqual(result.referencedTourIds, [IDS[0]]);
  assert.equal(result.structuredContent.type, "availability");
  assert.equal(result.constraintState.dateRange.start, "2026-08-15");
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

test("duration removal mutates semantic state and resumes SEARCH", async () => {
  const first = await generateChatAnswer({ prompt: "muốn đi khoảng 3 ngày", now: NOW });
  const second = await generateChatAnswer({
    prompt: "thôi thời gian không quan trọng nữa",
    constraintState: first.constraintState,
    entityState: first.entityState,
    now: NOW,
  });
  assert.equal(second.decision.action, "SEARCH");
  assert.equal(second.constraintState._semanticState.slots.duration.status, "removed");
  assert.equal(second.constraintState.days, undefined);
  assert.ok(second.constraintState._constraintMeta.removedFields.includes("days"));
});

test("HIGH-03 exact duration-limit removal stays deterministic with no provider fallback", async () => {
  const first = await generateChatAnswer({ prompt: "gợi ý tour đi đâu cũng được, muốn đi khoảng 3 ngày", now: NOW });
  const second = await generateChatAnswer({
    prompt: "thôi bỏ giới hạn thời gian",
    constraintState: first.constraintState,
    entityState: first.entityState,
    now: NOW,
  });
  assert.equal(second.decision.action, "SEARCH");
  assert.equal(second.decision.operation, "recommendation");
  assert.equal(second.constraintState._semanticState.slots.duration.status, "removed");
  assert.equal(second.constraintState.days, undefined);
  assert.equal(second.constraintState.approximateDays, undefined);
  assert.ok(second.constraintState._constraintMeta.removedFields.includes("days"));
  assert.equal(second.providerStatus.status, "skipped");
  assert.equal(second.providerStatus.fallbackUsed, false);
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
