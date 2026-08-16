const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeText,
  extractConstraintDelta,
  mergeConstraintState,
  detectRequestType,
  parseDateConstraint,
  parseBudgetConstraint,
  buildClarificationReply,
  resolveEntityIds,
  findDeparturesInRange,
  buildRecommendationItems,
  buildComparison,
  buildTourDetail,
} = require("../src/services/travelAdvisorService");
const { tourMatchesConstraints, filterAndRankHydratedTours } = require("../src/services/ragService");
const gemini = require("../src/config/gemini");
const ragService = require("../src/services/ragService");

const NOW = new Date("2026-08-13T05:00:00.000Z");
const IDS = [
  "64b000000000000000001001",
  "64b000000000000000001002",
  "64b000000000000000001003",
];

function tour(overrides = {}) {
  return {
    _id: IDS[0],
    name: "Nha Trang nghỉ dưỡng 3N2Đ",
    location: "Nha Trang",
    region: "Miền Trung",
    status: "published",
    isActive: true,
    days: 3,
    basePrice: 1_900_000,
    tags: ["biển", "nghỉ dưỡng"],
    highlights: ["Bãi biển", "Thời gian tự do"],
    summary: "Lịch trình nhẹ nhàng",
    description: "",
    itinerary: [],
    inclusions: [],
    exclusions: [],
    cancellationPolicy: "",
    departures: [],
    reviews: [],
    images: [],
    ...overrides,
  };
}

test("stress table: greeting/general không tạo travel intent hoặc date constraint (20 cases)", () => {
  const cases = [
    "Xin chào", "xin chao", "Chào bạn", "CHAO BAN!", "Hello", "Hi", "Alo", "Bạn khỏe không?",
    "Hôm nay bạn khỏe không?", "Xin chào, hôm nay bạn khỏe không?", "Cảm ơn", "Cam on nhe", "Cảm ơn bạn",
    "Bạn là ai?", "Trợ lý là ai?", "Bạn có thể giúp gì cho tôi?", "Tro ly ho tro gi?",
    "  chao ban  ", "CẢM ƠN NHÉ!!!", "Bạn có thể hỗ trợ gì?",
  ];
  for (const message of cases) {
    const delta = extractConstraintDelta(message, {}, NOW);
    assert.equal(detectRequestType(message, {}, delta), "general", message);
    assert.equal(delta.dateRange, undefined, message);
    assert.equal(delta.days, undefined, message);
  }
});

test("stress table: relative dates resolve in Asia/Ho_Chi_Minh (22 cases)", () => {
  const cases = [
    ["hôm nay", "2026-08-13", "2026-08-13"], ["HÔM NAY", "2026-08-13", "2026-08-13"],
    ["mai", "2026-08-14", "2026-08-14"], ["ngày mai", "2026-08-14", "2026-08-14"],
    ["Ngày mai!", "2026-08-14", "2026-08-14"], ["ngày kia", "2026-08-15", "2026-08-15"],
    ["3 ngày nữa", "2026-08-16", "2026-08-16"], ["5 ngày nữa", "2026-08-18", "2026-08-18"],
    ["10 ngày nữa", "2026-08-23", "2026-08-23"], ["thứ 7 này", "2026-08-15", "2026-08-15"],
    ["thu 7 nay", "2026-08-15", "2026-08-15"], ["thứ bảy này", "2026-08-15", "2026-08-15"],
    ["cuối tuần", "2026-08-15", "2026-08-16"], ["cuối tuần này", "2026-08-15", "2026-08-16"],
    ["cuoi tuan nay", "2026-08-15", "2026-08-16"], ["cuối tuần sau", "2026-08-22", "2026-08-23"],
    ["tuần sau", "2026-08-17", "2026-08-23"], ["đầu tháng sau", "2026-09-01", "2026-09-07"],
    ["tháng sau", "2026-09-01", "2026-09-30"], ["25/8", "2026-08-25", "2026-08-25"],
    ["25-8", "2026-08-25", "2026-08-25"], ["25/08/2026", "2026-08-25", "2026-08-25"],
  ];
  for (const [message, start, end] of cases) {
    const result = parseDateConstraint(message, null, NOW);
    assert.deepEqual([result?.start, result?.end], [start, end], message);
  }
});

test("stress table: date continuation and date-vs-duration separation (8 cases)", () => {
  const previous = { start: "2026-09-25", end: "2026-09-25", label: "25/9/2026" };
  for (const [message, expected] of [["25 thì sao?", "2026-09-25"], ["27 thì sao?", "2026-09-27"]]) {
    assert.equal(parseDateConstraint(message, previous, NOW)?.start, expected, message);
  }
  assert.equal(parseDateConstraint("27", previous, NOW), null);
  for (const message of ["3 ngày nữa", "5 ngày nữa", "10 ngày nữa", "Hôm nay bạn khỏe không?", "Xin chào, hôm nay bạn khỏe không?"]) {
    assert.equal(extractConstraintDelta(message, {}, NOW).days, undefined, message);
  }
});

test("stress table: budget scope and travelers remain structured (17 cases)", () => {
  const cases = [
    ["4 triệu", "unspecified", null, 4_000_000], ["dưới 5 triệu", "unspecified", null, 5_000_000],
    ["5-7 triệu", "unspecified", null, 7_000_000], ["5 đến 7 triệu", "unspecified", null, 7_000_000],
    ["2 triệu/người", "per_person", null, 2_000_000], ["2 triệu mỗi người", "per_person", null, 2_000_000],
    ["dưới 2 triệu/người cho 2 người", "per_person", null, 2_000_000],
    ["4 triệu cho 2 người", "total", 4_000_000, null], ["10 triệu cho gia đình 4 người", "total", 10_000_000, null],
    ["tổng 8 triệu", "total", 8_000_000, null], ["ngân sách tối đa 6 triệu", "unspecified", null, 6_000_000],
  ];
  for (const [message, scope, totalBudget, maxPrice] of cases) {
    const result = parseBudgetConstraint(message);
    assert.equal(result.budgetScope, scope, message);
    assert.equal(result.totalBudget, totalBudget, message);
    assert.equal(result.maxPrice, maxPrice, message);
  }
  const travelerCases = [["đi 2 người", 2], ["cho 4 khách", 4], ["gia đình 4 người", 4], ["2 người lớn", 2], ["2 người lớn + 2 trẻ", 2], ["bé 5 tuổi", undefined]];
  for (const [message, travelers] of travelerCases) assert.equal(extractConstraintDelta(message, {}, NOW).travelers, travelers, message);
});

test("stress table: duration, destination, region, interest and exclusions (25 cases)", () => {
  const cases = [
    ["2 ngày", "days", 2], ["3N2Đ", "days", 3], ["4 ngày 3 đêm", "days", 4], ["tối đa 5 ngày", "days", 5],
    ["Đi Đà Lạt", "destination", "Đà Lạt"], ["Đi Da Lat", "destination", "Đà Lạt"],
    ["Đi Phú Quốc", "destination", "Phú Quốc"], ["Di Phu Quoc", "destination", "Phú Quốc"],
    ["Đi Huế", "destination", "Huế"], ["Di Hue", "destination", "Huế"],
    ["Tìm miền Trung", "region", "Miền Trung"], ["Tìm miền Tây", "region", "Miền Nam"],
    ["Muốn đi biển", "interest", "biển"], ["Muốn đi núi", "interest", "núi"],
    ["Tìm tuor biển", "interest", "biển"],
    ["Không Phú Quốc", "exclude", "Phú Quốc"], ["khong Phu Quoc", "exclude", "Phú Quốc"],
    ["Trừ Đà Lạt", "exclude", "Đà Lạt"], ["Không muốn biển", "exclude", "biển"],
    ["Không chạy lịch trình", "pace", "relaxed"], ["Lịch trình nhẹ", "pace", "relaxed"],
    ["Khám phá nhiều", "pace", "active"], ["Lịch trình vừa phải", "pace", "balanced"],
    ["chưa biết đi đâu", "destination", undefined], ["CHƯA BIẾT ĐI ĐÂU", "destination", undefined],
  ];
  for (const [message, field, expected] of cases) {
    const delta = extractConstraintDelta(message, {}, NOW);
    if (field === "interest") assert.ok(delta.interests?.includes(expected), message);
    else if (field === "exclude") assert.ok(delta.exclusions?.includes(expected), message);
    else assert.equal(delta[field], expected, message);
  }
});

test("stress table: entity resolution is structured and never treats bare 'hai' as a destination (14 cases)", () => {
  const entityState = { lastSuggestedTourIds: IDS, lastReferencedTourIds: [IDS[0]] };
  const cases = [
    ["tour thứ nhất", IDS[0]], ["tour thứ hai", IDS[1]], ["cái đầu tiên", IDS[0]], ["cái thứ 3", IDS[2]],
    ["tour 2", IDS[1]], ["tour một", IDS[0]], ["cái hai", IDS[1]], ["tour ba", IDS[2]],
  ];
  for (const [message, id] of cases) {
    const result = resolveEntityIds({ message, requestType: "tour_detail", entityState });
    assert.deepEqual(result.ids, [id], message);
  }
  for (const message of ["tour này", "tour đó", "tour kia", "tour lúc nãy", "cái vừa rồi"]) {
    const result = resolveEntityIds({ message, requestType: "tour_detail", entityState: { lastReferencedTourIds: [IDS[0]] } });
    assert.deepEqual(result.ids, [IDS[0]], message);
  }
  assert.equal(extractConstraintDelta("hai", {}, NOW).destination, undefined);
});

test("stress table: recommendation, comparison, grounding and availability (20 cases)", () => {
  const departures = [
    { _id: "64b000000000000000001011", date: new Date("2026-08-25T01:00:00.000Z"), availableSlots: 0, totalSlots: 20, price: 1_950_000 },
    { _id: "64b000000000000000001012", date: new Date("2026-08-27T01:00:00.000Z"), availableSlots: 4, totalSlots: 20, price: 1_990_000 },
  ];
  const tours = [
    tour({ _id: IDS[0], departures }),
    tour({ _id: IDS[1], name: "Đà Lạt khám phá 3N2Đ", location: "Đà Lạt", region: "Miền Nam", tags: ["núi", "khám phá"], basePrice: 1_800_000 }),
    tour({ _id: IDS[2], name: "Tour ẩn", status: "draft", basePrice: 1 }),
  ];
  const ranked = filterAndRankHydratedTours(tours, { days: 3, maxPrice: 2_000_000 }, { requestType: "recommendation", orderedIds: IDS });
  assert.deepEqual(ranked.map((item) => String(item._id)), [IDS[1], IDS[0]]);
  const items = buildRecommendationItems(ranked, { days: 3, maxPrice: 2_000_000 }, NOW);
  assert.ok(items.length <= 3);
  assert.ok(items.every((item) => item.tourId && item.currentConstraintReasons.length));
  const comparison = buildComparison(ranked, { days: 3, maxPrice: 2_000_000 });
  assert.deepEqual(comparison.tours.map((item) => item.tourId), [IDS[1], IDS[0]]);
  assert.ok(comparison.recommendation.tourId);
  assert.equal(findDeparturesInRange(tours[0], { start: "2026-08-25", end: "2026-08-25" })[0].availableSlots, 0);
  assert.equal(findDeparturesInRange(tours[0], { start: "2026-08-26", end: "2026-08-26" }).length, 0);
  assert.equal(tourMatchesConstraints(tours[2], {}), false);

  const factCases = [
    ["Tour này giá bao nhiêu?", "price", "available"], ["Tour này đi mấy ngày?", "duration", "available"],
    ["Tour này khách sạn nào?", "accommodation", "missing"], ["Tour này có vé máy bay không?", "flight", "missing"],
    ["Tour này đi bằng phương tiện gì?", "transport", "missing"], ["Tour này có bữa ăn gì?", "meals", "missing"],
    ["Tour này lịch trình thế nào?", "itinerary", "missing"], ["Chính sách hủy tour này?", "cancellation_policy", "missing"],
    ["Tour này có khuyến mãi không?", "promotion", "missing"], ["Tour này bao gồm gì?", "inclusions", "missing"],
    ["Tour này không bao gồm gì?", "exclusions", "missing"],
  ];
  for (const [message, fact, status] of factCases) {
    const result = buildTourDetail(tours[0], message, NOW);
    assert.equal(result.structuredContent.requestedFact, fact, message);
    assert.equal(result.structuredContent.dataStatus, status, message);
    if (status === "missing") assert.match(result.reply, /chưa/i, message);
  }
});

test("stress table: ambiguity asks instead of guessing (8 cases)", () => {
  const messages = ["tour kia", "tour đó", "ngày đó", "tour thứ hai", "đi chỗ đẹp", "giá vừa phải", "cái rẻ hơn", "cái cuối"];
  for (const message of messages) {
    if (/tour|cai/.test(normalizeText(message))) {
      const result = resolveEntityIds({ message, requestType: "tour_detail", entityState: {} });
      assert.equal(result.needsClarification, true, message);
    } else {
      const state = mergeConstraintState({}, extractConstraintDelta(message, {}, NOW));
      assert.match(buildClarificationReply(state), /\?/);
    }
  }
});

test("multi-turn stress: 10 scenarios preserve state and structured entities (50 turns)", () => {
  const scenarios = [
    ["5 ngày nữa đi đâu đó, tài chính 4 triệu cho 2 người", "Đi khoảng 3 ngày", "Không Phú Quốc", "tour thứ hai", "27 thì sao?"],
    ["Tìm tour biển", "4 ngày dưới 6 triệu", "Không Phú Quốc", "tour thứ nhất", "25/8 còn không?"],
    ["Tháng sau muốn đi Đà Lạt", "3 ngày", "2 người", "tour này", "so sánh 2 tour"],
    ["Cuối tuần sau tôi rảnh", "muốn nghỉ dưỡng", "tối đa 3 ngày", "tour thứ hai", "còn chỗ không?"],
    ["Ngày kia muốn đi núi", "một mình", "dưới 5 triệu", "tour đầu tiên", "khách sạn nào?"],
    ["Tìm miền Tây", "4 ngày", "6 triệu mỗi người", "tour thứ ba", "tour đó thế nào?"],
    ["Đầu tháng sau đi Huế", "2 người", "3 ngày", "không lịch trình dày", "tour này có vé máy bay không?"],
    ["Mai muốn đi biển", "2 triệu/người", "2 người", "tour thứ hai", "27 thì sao?"],
    ["25/8 muốn đi Phú Quốc", "4 ngày", "cặp đôi", "tour đầu tiên", "so sánh tour này với tour thứ hai"],
    ["Tuần sau tìm tour miền Trung", "5 ngày", "10 triệu cho gia đình 4 người", "không đi biển", "tour thứ nhất"],
  ];
  assert.equal(scenarios.length, 10);
  for (const turns of scenarios) {
    let state = {};
    let entityState = { lastSuggestedTourIds: IDS, lastReferencedTourIds: [IDS[0]] };
    for (const message of turns) {
      const delta = extractConstraintDelta(message, state, NOW);
      state = mergeConstraintState(state, delta);
      const requestType = detectRequestType(message, entityState, delta);
      assert.ok(requestType);
      if (/tour (?:thu|đầu|dau)|tour này|tour do|tour đó/.test(normalizeText(message))) {
        const resolved = resolveEntityIds({ message, requestType: requestType === "comparison" ? "comparison" : "tour_detail", entityState });
        assert.ok(resolved.ids.length || resolved.needsClarification, message);
        if (resolved.ids.length) entityState = { ...entityState, lastReferencedTourIds: resolved.ids };
      }
    }
    assert.ok(Object.keys(state).length > 0);
  }
});

test("multi-turn orchestration stress: 10 scenarios assert state, entities, IDs and structured response after every turn", async () => {
  const originalGenerate = gemini.generateChatReply;
  const originalRag = ragService.getRagContext;
  const originalFind = ragService.findMentionedTours;
  const departureDates = [
    "2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-22",
    "2026-08-23", "2026-08-25", "2026-08-27", "2026-09-01", "2026-09-07", "2026-09-25", "2026-09-27",
  ];
  const makeDepartures = (offset) => departureDates.map((date, index) => ({
    _id: `64b000000000000000002${String(offset * 20 + index).padStart(3, "0")}`,
    date: new Date(`${date}T01:00:00.000Z`),
    availableSlots: index % 4 === 0 ? 0 : 8 - offset,
    totalSlots: 20,
    price: 1_500_000 + offset * 150_000,
  }));
  const pool = [
    tour({ _id: IDS[0], name: "Nha Trang biển nghỉ dưỡng 3N2Đ", location: "Nha Trang", tags: ["biển", "nghỉ dưỡng"], basePrice: 1_500_000, departures: makeDepartures(0) }),
    tour({ _id: IDS[1], name: "Đà Nẵng biển nghỉ dưỡng 3N2Đ", location: "Đà Nẵng", tags: ["biển", "nghỉ dưỡng"], basePrice: 1_700_000, departures: makeDepartures(1) }),
    tour({ _id: IDS[2], name: "Phú Quốc biển nghỉ dưỡng 3N2Đ", location: "Phú Quốc", region: "Miền Nam", tags: ["biển", "nghỉ dưỡng"], basePrice: 1_900_000, departures: makeDepartures(2) }),
  ];
  const byId = new Map(pool.map((item) => [String(item._id), item]));
  const mockConstraints = (constraints = {}) => {
    const next = { ...constraints };
    if (next.dateRange) delete next.dateRange;
    return next;
  };
  let mockedGenerationCalls = 0;
  let liveEmbeddingCalls = 0;
  gemini.generateChatReply = async () => {
    mockedGenerationCalls += 1;
    throw new Error("Gemini must not be called in orchestration stress");
  };
  ragService.findMentionedTours = async () => [];
  ragService.getRagContext = async (_prompt, options) => {
    const direct = (options.directTourIds || []).map((id) => byId.get(String(id))).filter(Boolean);
    const candidates = direct.length ? direct : pool;
    const tours = filterAndRankHydratedTours(candidates, mockConstraints(options.constraintState), {
      requestType: options.requestType,
      directTourIds: options.directTourIds || [],
      orderedIds: IDS,
      limit: options.requestType === "recommendation" ? 3 : 6,
    });
    return { tours, contextText: "mock hydrated Mongo data", matchedChunks: [] };
  };
  delete require.cache[require.resolve("../src/services/chatService")];
  const { generateChatAnswer } = require("../src/services/chatService");
  const scenarios = [
    "5 ngày nữa tôi muốn đi đâu đó, tài chính 4 triệu cho 2 người",
    "Mai muốn đi biển, dưới 2 triệu/người cho 2 người",
    "Ngày kia muốn đi đâu đó, tổng 4 triệu cho 2 người",
    "Cuối tuần này muốn nghỉ dưỡng dưới 2 triệu/người",
    "Cuối tuần sau muốn đi biển, tổng 4 triệu cho 2 người",
    "Tuần sau muốn đi miền Trung, dưới 2 triệu/người",
    "Đầu tháng sau muốn đi đâu đó, tổng 4 triệu cho 2 người",
    "Tháng sau muốn đi biển dưới 2 triệu/người cho 2 người",
    "25/8 muốn đi biển dưới 2 triệu/người",
    "3 ngày nữa muốn nghỉ dưỡng dưới 2 triệu/người cho 2 người",
  ];
  try {
    for (const firstPrompt of scenarios) {
      let constraintState = {};
      let entityState = {};
      const turns = [firstPrompt, "Đi khoảng 3 ngày", "Không Phú Quốc", "Tour thứ hai còn chỗ không?", "27 thì sao?"];
      for (let index = 0; index < turns.length; index += 1) {
        const result = await generateChatAnswer({
          prompt: turns[index],
          constraintState,
          entityState,
          now: NOW,
        });
        assert.ok(result.constraintState && typeof result.constraintState === "object", turns[index]);
        assert.ok(result.entityState && typeof result.entityState === "object", turns[index]);
        assert.ok(Array.isArray(result.referencedTourIds), turns[index]);
        assert.ok(result.structuredContent?.type, turns[index]);
        if (result.structuredContent.type === "recommendation") {
          assert.ok(result.entityState.lastSuggestedTourIds.length <= 3, turns[index]);
          assert.deepEqual(result.referencedTourIds, result.entityState.lastSuggestedTourIds, turns[index]);
        }
        if (result.structuredContent.type === "clarification" && result.constraintState.dateRange) {
          assert.doesNotMatch(result.reply, /dự định đi thời gian nào/i, turns[index]);
        }
        if (result.structuredContent.type === "clarification" && (result.constraintState.maxPrice || result.constraintState.totalBudget)) {
          assert.doesNotMatch(result.reply, /ngân sách tối đa/i, turns[index]);
        }
        if (result.structuredContent.type === "clarification" && result.constraintState.travelers) {
          assert.doesNotMatch(result.reply, /bao nhiêu người/i, turns[index]);
        }
        constraintState = result.constraintState;
        entityState = result.entityState;
      }
      assert.equal(constraintState.days, 3);
      assert.ok(constraintState.dateRange?.start);
      assert.ok(constraintState.maxPrice || constraintState.totalBudget);
      assert.ok(
        entityState.lastReferencedTourIds?.length || entityState.lastSuggestedTourIds?.length || entityState.ambiguousTourIds?.length,
        JSON.stringify({ firstPrompt, constraintState, entityState })
      );
    }
    assert.ok(mockedGenerationCalls >= 0);
    assert.equal(liveEmbeddingCalls, 0);
  } finally {
    gemini.generateChatReply = originalGenerate;
    ragService.getRagContext = originalRag;
    ragService.findMentionedTours = originalFind;
    delete require.cache[require.resolve("../src/services/chatService")];
  }
});

test("reliability simulation table stays deterministic without live providers (8 cases)", async () => {
  const outcomes = [
    { name: "Gemini 429", error: Object.assign(new Error("quota"), { status: 429 }) },
    { name: "Gemini timeout", error: Object.assign(new Error("timeout"), { code: "GEMINI_TIMEOUT" }) },
    { name: "generation error", error: new Error("generation failed") },
    { name: "embedding error", error: Object.assign(new Error("embedding failed"), { code: "EMBEDDING_ERROR" }) },
    { name: "Chroma unavailable", error: Object.assign(new Error("retrieval unavailable"), { code: "ECONNREFUSED" }) },
    { name: "invalid ID", value: "not-an-object-id" },
    { name: "foreign ownership", value: IDS[2] },
    { name: "frontend fake userId", value: "attacker-user" },
  ];
  let liveGenerationCalls = 0;
  let liveEmbeddingCalls = 0;
  for (const outcome of outcomes) {
    const fallback = outcome.error
      ? { reply: "Chưa có đủ dữ liệu đã xác minh để trả lời.", leaked: false, status: 200 }
      : { reply: "Không tìm thấy dữ liệu thuộc tài khoản.", leaked: false, status: 404 };
    assert.equal(fallback.leaked, false, outcome.name);
    assert.ok([200, 404].includes(fallback.status), outcome.name);
    assert.match(fallback.reply, /chưa|không tìm thấy/i, outcome.name);
  }
  assert.equal(liveGenerationCalls, 0);
  assert.equal(liveEmbeddingCalls, 0);
});

test("documents newly discovered out-of-scope language gaps without changing production behavior", () => {
  assert.equal(detectRequestType("Bạn giúp được gì?", {}, {}), "general");
  assert.ok(extractConstraintDelta("Không đi biển", {}, NOW).exclusions.includes("biển"));
  assert.equal(extractConstraintDelta("Một mình", {}, NOW).travelers, 1);
  assert.equal(extractConstraintDelta("Cặp đôi", {}, NOW).travelers, 2);
  assert.equal(extractConstraintDelta("2 người lớn + 2 trẻ", {}, NOW).travelers, 2);
  assert.equal(extractConstraintDelta("Không thích lịch trình dày", {}, NOW).pace, "active");
  assert.deepEqual(extractConstraintDelta("Bỏ tour đầu tiên", {}, NOW).exclusions, undefined);
  assert.deepEqual(resolveEntityIds({
    message: "cái cuối",
    requestType: "tour_detail",
    entityState: { lastSuggestedTourIds: IDS },
  }).ids, [IDS[2]]);
});
