const test = require("node:test");
const assert = require("node:assert/strict");

const gemini = require("../src/config/gemini");
const ragService = require("../src/services/ragService");
const {
  SEMANTIC_STATE_KEY,
  getEffectiveConstraintState,
  normalizeText,
} = require("../src/services/travelAdvisorService");
const {
  buildGroundingContract,
} = require("../src/services/factualGroundingService");
const {
  collectTourConstraintEvidence,
  semanticInterestEvidence,
} = require("../src/services/retrievalEvidenceService");
const {
  prepareActionTurn,
} = require("../src/services/actionPolicyService");

const ORIGINAL_GENERATE = gemini.generateChatReply;
const ORIGINAL_RAG = ragService.getRagContext;
const ORIGINAL_FIND = ragService.findMentionedTours;
const NOW = new Date("2026-08-14T00:00:00.000Z");

const IDS = {
  hoiAn: "64b000000000000000009301",
  hue: "64b000000000000000009302",
  daLat: "64b000000000000000009303",
  ninhBinh: "64b000000000000000009304",
  bienHoa: "64b000000000000000009305",
};

function departure(id, price, slots = 8) {
  return {
    _id: id,
    date: new Date("2026-09-20T03:00:00.000Z"),
    price,
    availableSlots: slots,
    totalSlots: 12,
  };
}

const TOURS = [
  {
    _id: IDS.hoiAn,
    name: "Hội An - Phố cổ đèn lồng",
    location: "Hội An",
    region: "Miền Trung",
    days: 3,
    basePrice: 3_600_000,
    tags: ["văn hóa", "ẩm thực"],
    highlights: ["Phố cổ đèn lồng"],
    summary: "Dạo phố cổ và trải nghiệm ẩm thực địa phương.",
    itinerary: [{ title: "Biển An Bàng", description: "Tắm biển An Bàng và thư giãn." }],
    departures: [departure("64b000000000000000009311", 3_950_000, 10)],
  },
  {
    _id: IDS.hue,
    name: "Huế - Dấu ấn cố đô",
    location: "Huế",
    region: "Miền Trung",
    days: 3,
    basePrice: 3_300_000,
    tags: ["văn hóa"],
    highlights: ["Đại Nội"],
    summary: "Khám phá di sản cố đô.",
    itinerary: [],
    departures: [departure("64b000000000000000009312", 3_500_000)],
  },
  {
    _id: IDS.daLat,
    name: "Đà Lạt - Cao nguyên",
    location: "Đà Lạt",
    region: "Tây Nguyên",
    days: 3,
    basePrice: 3_400_000,
    tags: ["núi"],
    highlights: ["Săn mây"],
    summary: "Ngắm biển mây trên cao nguyên.",
    itinerary: [],
    departures: [departure("64b000000000000000009313", 3_650_000)],
  },
  {
    _id: IDS.ninhBinh,
    name: "Ninh Bình - Di sản đá vôi",
    location: "Ninh Bình",
    region: "Miền Bắc",
    days: 3,
    basePrice: 3_100_000,
    tags: ["khám phá"],
    highlights: ["Tràng An"],
    summary: "Hành trình độc đáo qua cảnh quan đá vôi.",
    itinerary: [],
    departures: [departure("64b000000000000000009314", 3_300_000)],
  },
  {
    _id: IDS.bienHoa,
    name: "Biên Hòa - Văn hóa địa phương",
    location: "Biên Hòa",
    region: "Miền Nam",
    days: 2,
    basePrice: 2_400_000,
    tags: ["văn hóa"],
    highlights: ["Làng nghề"],
    summary: "Tìm hiểu đời sống địa phương.",
    itinerary: [],
    departures: [departure("64b000000000000000009315", 2_600_000)],
  },
].map((tour) => ({
  status: "published",
  isActive: true,
  images: [],
  inclusions: [],
  exclusions: [],
  ...tour,
}));

let providerReply = "Hội An có phố cổ đèn lồng và nhiều trải nghiệm văn hóa phù hợp để chụp ảnh.";
let providerCalls = 0;

gemini.generateChatReply = async () => {
  providerCalls += 1;
  return providerReply;
};

ragService.findMentionedTours = async (prompt) => {
  const normalized = normalizeText(prompt);
  return TOURS.filter((tour) => normalized.includes(normalizeText(tour.location))).slice(0, 3);
};

ragService.getRagContext = async (prompt, options = {}) => {
  const constraints = getEffectiveConstraintState(options.constraintState || {});
  const requestType = options.requestType || options.intent?.requestType || "recommendation";
  const directIds = new Set((options.directTourIds || []).map(String));
  const pageTourId = options.pageContext?.tourId ? String(options.pageContext.tourId) : null;
  if (pageTourId) directIds.add(pageTourId);
  const excludedIds = new Set((options.excludeTourIds || []).map(String));
  const pool = TOURS.filter((tour) => directIds.size
    ? directIds.has(String(tour._id))
    : !excludedIds.has(String(tour._id)));
  const tours = ragService.filterAndRankHydratedTours(pool, constraints, {
    requestType,
    directTourIds: [...directIds],
    orderedIds: pool.map((tour) => String(tour._id)),
    limit: requestType === "recommendation" ? 3 : 6,
    now: NOW,
  });
  const factualGrounding = buildGroundingContract(tours, constraints, { now: NOW });
  return {
    tours,
    contextText: tours.map((tour) => [tour.name, tour.summary, ...tour.highlights, ...tour.itinerary.flatMap((day) => [day.title, day.description])].join(" ")).join("\n"),
    matchedChunks: [],
    zeroResult: tours.length ? null : { cause: "user_constraints", blockingFields: [] },
    retrievalStatus: { status: "healthy", degraded: false, mode: "fixture", reasons: [], fallbackUsed: false, inventoryComplete: true },
    factualGrounding,
    trace: {
      filters: constraints,
      mode: "fixture",
      status: "healthy",
      reasons: [],
      candidateIds: {
        direct: [...directIds],
        excluded: [...excludedIds],
        discovered: [],
        hydrated: pool.map((tour) => String(tour._id)),
        selected: tours.map((tour) => String(tour._id)),
      },
      ranking: tours.map((tour, index) => ({
        rank: index + 1,
        tourId: String(tour._id),
        evidence: collectTourConstraintEvidence(tour, constraints),
      })),
      grounding: factualGrounding.tours.map((item) => ({ tourId: item.tourId, fingerprint: item.fingerprint })),
      zeroResult: null,
    },
  };
};

delete require.cache[require.resolve("../src/services/chatService")];
const {
  generateChatAnswer,
  validateGeneratedReply,
  buildGenerationPrompt,
} = require("../src/services/chatService");

test.after(() => {
  gemini.generateChatReply = ORIGINAL_GENERATE;
  ragService.getRagContext = ORIGINAL_RAG;
  ragService.findMentionedTours = ORIGINAL_FIND;
  delete require.cache[require.resolve("../src/services/chatService")];
});

function createRuntime() {
  const state = { constraintState: {}, entityState: {}, history: [] };
  return {
    state,
    async post(message, pageContext = { pageType: "AI_ASSISTANT" }) {
      const result = await generateChatAnswer({
        prompt: message,
        pageContext,
        constraintState: state.constraintState,
        entityState: state.entityState,
        history: state.history,
        now: NOW,
      });
      state.constraintState = result.constraintState;
      state.entityState = result.entityState;
      state.history.push(
        { role: "user", content: message },
        { role: "assistant", content: result.reply, referencedTourIds: result.referencedTourIds },
      );
      return result;
    },
  };
}

function resultIds(result) {
  return (result.structuredContent?.tours || []).map((tour) => String(tour.tourId || tour._id));
}

test("BLOCKER 1: beach evidence is diacritic-aware without substring collisions", () => {
  assert.equal(semanticInterestEvidence("Tắm biển An Bàng", "biển").matched, true);
  assert.equal(semanticInterestEvidence("Tắm biển An Bàng", "bien").matched, true);
  assert.equal(semanticInterestEvidence("tam bien an bang", "biển").matched, true);
  assert.equal(semanticInterestEvidence("Biên Hòa và làng nghề", "biển").matched, false);
  assert.equal(semanticInterestEvidence("Hành trình độc đáo", "đảo").matched, false);
});

test("BLOCKER 1: retained hard exclusion survives traveler, duration, and alternative turns", async () => {
  const runtime = createRuntime();
  await runtime.post("gợi ý chuyến đi tầm 8 triệu cho hai người, điểm đến để mở");

  const excluded = await runtime.post("tôi không muốn đi biển");
  const excludedInterests = excluded.constraintState[SEMANTIC_STATE_KEY].slots.interests.excludedValues;
  assert.deepEqual(excludedInterests, ["biển"]);
  assert.ok(!resultIds(excluded).includes(IDS.hoiAn));

  const travelers = await runtime.post("chuyển sang ba khách nhé");
  assert.ok(!resultIds(travelers).includes(IDS.hoiAn));
  assert.deepEqual(travelers.constraintState[SEMANTIC_STATE_KEY].slots.interests.excludedValues, ["biển"]);

  const duration = await runtime.post("đi chừng ba hôm");
  assert.ok(!resultIds(duration).includes(IDS.hoiAn));
  assert.deepEqual(duration.constraintState[SEMANTIC_STATE_KEY].slots.interests.excludedValues, ["biển"]);

  const alternative = await runtime.post("đưa mình vài lựa chọn khác");
  assert.ok(!resultIds(alternative).includes(IDS.hoiAn));
  assert.deepEqual(alternative.constraintState[SEMANTIC_STATE_KEY].slots.interests.excludedValues, ["biển"]);
});

test("BLOCKER 1: no-diacritics exclusion reaches the same retrieval behavior", async () => {
  const runtime = createRuntime();
  await runtime.post("goi y chuyen di tam 8 trieu cho hai nguoi, di dau cung duoc");
  const result = await runtime.post("khong muon di bien");
  assert.deepEqual(result.constraintState[SEMANTIC_STATE_KEY].slots.interests.excludedValues, ["biển"]);
  assert.ok(!resultIds(result).includes(IDS.hoiAn));
});

test("BLOCKER 1: filtering and trace explanation consume the same exclusion evidence", () => {
  const constraints = {
    exclusions: ["biển"],
    _semanticState: {
      version: 2,
      slots: { interests: { status: "known", values: [], excludedValues: ["biển"] } },
    },
  };
  const hoiAn = TOURS.find((tour) => String(tour._id) === IDS.hoiAn);
  const evidence = collectTourConstraintEvidence(hoiAn, constraints);
  assert.equal(evidence.exclusions[0].matched, true);
  assert.equal(ragService.tourMatchesConstraints(hoiAn, constraints, { requestType: "recommendation", evidence }), false);
  assert.deepEqual(collectTourConstraintEvidence(hoiAn, constraints).exclusions, evidence.exclusions);
});

test("BLOCKER 2: evaluative destination questions answer while commands still search", () => {
  for (const message of [
    "Hội An có phù hợp cho người thích chụp ảnh không?",
    "Hội An có hợp với người mê chụp hình không?",
    "Hội An có gì đáng để trải nghiệm?",
  ]) {
    const prepared = prepareActionTurn({ message });
    assert.equal(prepared.intent.requestType, "general");
    assert.equal(prepared.intent.entityEvaluation, true);
    assert.deepEqual(prepared.extractedDelta, {});
  }

  const comparison = prepareActionTurn({ message: "nên đi Hội An hay Huế?" });
  assert.equal(comparison.intent.requestType, "comparison");
  assert.equal(comparison.intent.entityEvaluation, true);

  const explicitTourDetail = prepareActionTurn({ message: "Tour Hội An có gì hay?" });
  assert.equal(explicitTourDetail.intent.requestType, "tour_detail");
  assert.equal(explicitTourDetail.intent.entityEvaluation, true);

  const contextual = prepareActionTurn({
    message: "Còn Hội An thì sao?",
    entityState: { lastSuggestedTourIds: [IDS.hue] },
  });
  assert.equal(contextual.intent.requestType, "general");
  assert.equal(contextual.intent.entityEvaluation, true);

  for (const message of ["gợi ý tour Hội An", "tìm chuyến đi Hội An", "đổi điểm đến sang Hội An"]) {
    const prepared = prepareActionTurn({ message });
    assert.equal(prepared.intent.requestType, "recommendation");
    assert.notDeepEqual(prepared.extractedDelta, {});
  }
});

test("BLOCKER 2: old destination state and page context cannot hijack an entity evaluation", async () => {
  const runtime = createRuntime();
  await runtime.post("tìm tour Huế");
  providerReply = "Hội An có phố cổ đèn lồng, phù hợp để ghi lại kiến trúc và sinh hoạt địa phương.";
  const result = await runtime.post("Còn Hội An, nơi này có hợp để chụp ảnh không?");
  assert.equal(result.decision.action, "ANSWER");
  assert.equal(result.intent.entityEvaluation, true);
  assert.deepEqual(result.referencedTourIds, [IDS.hoiAn]);
  assert.equal(result.providerStatus.fallbackUsed, false);

  const pageResult = await generateChatAnswer({
    prompt: "Nơi này có gì đáng trải nghiệm?",
    pageContext: { pageType: "TOUR_DETAIL", tourId: IDS.hoiAn },
    now: NOW,
  });
  assert.equal(pageResult.decision.action, "ANSWER");
  assert.deepEqual(pageResult.referencedTourIds, [IDS.hoiAn]);
});

test("BLOCKER 3: validator rewrites unsupported quantity, weather, and modifiers per entity", () => {
  const hoiAn = TOURS.find((tour) => String(tour._id) === IDS.hoiAn);
  const validation = validateGeneratedReply(
    "Hội An có hàng nghìn chiếc đèn lồng tuyệt đẹp. Biển An Bàng lộng gió.",
    [hoiAn],
  );
  assert.equal(validation.valid, true);
  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.equal(validation.rewrittenClaims.length, 3);
  assert.match(validation.rewrittenReply, /Hội An có đèn lồng/i);
  assert.match(validation.rewrittenReply, /Biển An Bàng/i);
  assert.doesNotMatch(validation.rewrittenReply, /hàng nghìn|tuyệt đẹp|lộng gió/i);
});

test("BLOCKER 3: supported facts and natural paraphrases remain accepted", () => {
  const hoiAn = TOURS.find((tour) => String(tour._id) === IDS.hoiAn);
  assert.deepEqual(
    validateGeneratedReply("Hội An kéo dài 3 ngày, giá từ 3.600.000đ.", [hoiAn]),
    { valid: true, reason: null },
  );
  assert.deepEqual(
    validateGeneratedReply("Hội An phù hợp để dạo phố đèn lồng và tham quan Biển An Bàng.", [hoiAn]),
    { valid: true, reason: null },
  );
});

test("BLOCKER 3: Tour B evidence cannot validate Tour A descriptive claims", () => {
  const tourA = { ...TOURS[1], name: "Tour A", location: "Tour A", summary: "Di sản cố đô." };
  const tourB = { ...TOURS[0], name: "Tour B", location: "Tour B", summary: "Không gian lộng gió." };
  const validation = validateGeneratedReply("Tour A lộng gió.", [tourA, tourB]);
  assert.equal(validation.valid, true);
  assert.doesNotMatch(validation.rewrittenReply, /lộng gió/i);
  assert.equal(validation.rewrittenClaims[0].tourId, String(tourA._id));
});

test("BLOCKER 3: unsupported accommodation and transport still reject", () => {
  const hoiAn = TOURS.find((tour) => String(tour._id) === IDS.hoiAn);
  assert.deepEqual(
    validateGeneratedReply("Hội An lưu trú tại khách sạn 5 sao.", [hoiAn]),
    { valid: false, reason: "unsupported_accommodation" },
  );
  assert.deepEqual(
    validateGeneratedReply("Hội An di chuyển bằng xe limousine.", [hoiAn]),
    { valid: false, reason: "unsupported_transport" },
  );
});

test("BLOCKER 3 integration: rewritten Gemini answer remains provider-sourced with no fallback", async () => {
  providerCalls = 0;
  providerReply = "Hội An có hàng nghìn chiếc đèn lồng. Biển An Bàng lộng gió, rất phù hợp để chụp ảnh.";
  const result = await generateChatAnswer({
    prompt: "Hội An có hợp với người mê nhiếp ảnh không?",
    pageContext: { pageType: "AI_ASSISTANT" },
    now: NOW,
  });
  assert.equal(providerCalls, 1);
  assert.equal(result.decision.action, "ANSWER");
  assert.equal(result.providerStatus.status, "healthy");
  assert.equal(result.providerStatus.fallbackUsed, false);
  assert.equal(result.structuredContent.type, "grounded_answer");
  assert.equal(result.observability.validation.status, "rewritten");
  assert.doesNotMatch(result.reply, /hàng nghìn|lộng gió/i);
  assert.deepEqual(result.referencedTourIds, [IDS.hoiAn]);
});

test("generation prompt explicitly prohibits unsupported descriptive facts", () => {
  const prompt = buildGenerationPrompt({
    prompt: "Một câu hỏi đánh giá",
    contextText: "Dữ liệu tour",
    history: [],
    constraintState: {},
    decision: { action: "ANSWER" },
  });
  assert.match(prompt, /không thêm số lượng ước lệ/i);
  assert.match(prompt, /thời tiết\/khí hậu/i);
});
