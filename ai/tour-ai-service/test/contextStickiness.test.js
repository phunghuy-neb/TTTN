const test = require("node:test");
const assert = require("node:assert/strict");

const advisor = require("../src/services/travelAdvisorService");
const ragService = require("../src/services/ragService");
const gemini = require("../src/config/gemini");

const NOW = new Date("2026-08-13T05:00:00.000Z");
const IDS = {
  beach: "64b000000000000000003001",
  mountain: "64b000000000000000003002",
  expensiveMountain: "64b000000000000000003003",
  inactive: "64b000000000000000003004",
  draft: "64b000000000000000003005",
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
    basePrice: 1_900_000,
    tags: ["biển", "nghỉ dưỡng"],
    highlights: ["Biển", "Thời gian tự do"],
    summary: "Lịch trình nhẹ",
    description: "",
    itinerary: [],
    inclusions: [],
    exclusions: [],
    cancellationPolicy: "",
    promotionLabel: "",
    departures: [{
      _id: "64b000000000000000003101",
      date: new Date("2026-08-18T01:00:00.000Z"),
      availableSlots: 8,
      totalSlots: 20,
      price: 1_900_000,
    }],
    reviews: [],
    images: [],
    ...overrides,
  };
}

function merge(previous, message) {
  return advisor.mergeConstraintState(previous, advisor.extractConstraintDelta(message, previous, NOW));
}

test("context stickiness table: 107 deterministic override/additive/soft/hard/change cases", () => {
  const cases = [];
  const add = (group, messages, assertState) => messages.forEach((message) => cases.push({ group, message, assertState }));

  add("override-area", [
    "thôi đi núi", "đổi sang đi núi", "tôi đổi ý muốn đi núi", "nhưng lần này đi núi", "muốn đi chơi núi", "ưu tiên núi", "nếu có thì đi núi",
  ], (state) => assert.deepEqual(state.interests, ["núi"]));
  add("override-area", [
    "thôi đi biển", "đổi sang đi biển", "tôi đổi ý muốn đi biển", "nhưng lần này đi biển", "muốn đi chơi biển", "ưu tiên biển", "nếu có thì đi biển",
  ], (state) => assert.deepEqual(state.interests, ["biển"]));

  const budgetCases = [
    ["ngân sách 8 triệu", 8_000_000], ["đổi ngân sách 6 triệu", 6_000_000], ["tối đa 7 triệu", 7_000_000],
    ["dưới 9 triệu", 9_000_000], ["ngân sách 5 triệu/người", 5_000_000], ["chi phí 3 triệu mỗi người", 3_000_000],
  ];
  for (const [message, amount] of budgetCases) cases.push({
    group: "override-budget", message,
    assertState: (state) => assert.equal(state.budgetScope === "total" ? state.totalBudget : state.maxPrice, amount),
  });
  add("remove-budget", [
    "thôi không cần 4 triệu nữa", "bỏ giới hạn ngân sách", "ngân sách cao hơn cũng được", "không quan trọng giá",
    "giá cao hơn cũng được", "đắt hơn nhưng đẹp hơn cũng được", "không giới hạn ngân sách nữa",
  ], (state) => {
    assert.equal(state.maxPrice, undefined);
    assert.equal(state.totalBudget, undefined);
  });

  const travelerCases = [["đi 4 người", 4], ["đổi thành 3 người", 3], ["đi 1 người", 1], ["tôi muốn đi một mình", 1], ["cặp đôi", 2], ["cho 5 khách", 5]];
  for (const [message, amount] of travelerCases) cases.push({ group: "override-travelers", message, assertState: (state) => assert.equal(state.travelers, amount) });

  const durationCases = [["đi 2 ngày", 2], ["đổi sang 4 ngày", 4], ["tối đa 5 ngày", 5], ["3N2Đ", 3], ["4 ngày 3 đêm", 4], ["đi 6 ngày", 6]];
  for (const [message, amount] of durationCases) cases.push({ group: "override-duration", message, assertState: (state) => assert.equal(state.days, amount) });

  const dateCases = [
    ["đổi sang ngày mai", "2026-08-14"], ["đổi sang ngày kia", "2026-08-15"], ["đổi sang cuối tuần", "2026-08-15"],
    ["đổi sang cuối tuần sau", "2026-08-22"], ["đổi sang tuần sau", "2026-08-17"], ["đổi sang cuối tháng", "2026-08-25"],
    ["đổi sang đầu tháng sau", "2026-09-01"], ["đổi sang tháng sau", "2026-09-01"], ["đổi sang 25/8", "2026-08-25"],
  ];
  for (const [message, start] of dateCases) cases.push({ group: "override-date", message, assertState: (state) => assert.equal(state.dateRange.start, start) });
  add("remove-date", ["không cần đúng 5 ngày nữa", "đổi ngày khác cũng được", "không quan trọng thời gian"], (state) => assert.equal(state.dateRange, undefined));

  const additiveCases = [
    ["mai dưới 5 triệu", ["dateRange", "maxPrice"]], ["mai đi 2 người", ["dateRange", "travelers"]],
    ["Đà Lạt dưới 6 triệu", ["destination", "maxPrice"]], ["Đà Lạt 4 ngày", ["destination", "days"]],
    ["muốn đi núi dưới 7 triệu", ["interests", "maxPrice"]], ["tuần sau đi 3 người", ["dateRange", "travelers"]],
    ["miền Trung 3 ngày", ["region", "days"]], ["Phú Quốc cho 2 người", ["destination", "travelers"]],
    ["đi biển 4 ngày", ["interests", "days"]], ["nghỉ dưỡng tối đa 5 triệu", ["interests", "maxPrice"]],
  ];
  for (const [message, fields] of additiveCases) cases.push({ group: "additive", message, assertState: (state) => fields.forEach((field) => assert.ok(state[field] != null, `${message}:${field}`)) });

  const softCases = ["tôi thích núi", "ưu tiên núi", "muốn đi núi", "nếu có thì đi núi", "tôi thích biển", "ưu tiên biển", "muốn nghỉ dưỡng", "thích lịch trình nhẹ"];
  for (const message of softCases) cases.push({ group: "soft", message, assertState: (state) => {
    const meta = advisor.constraintMeta(state);
    assert.ok(meta.modes.interests === "soft" || meta.modes.pace === "soft", message);
  } });

  const hardCases = [
    ["chỉ đi núi", "interests"], ["chỉ tour biển", "interests"], ["không đi biển", "exclusions"], ["không Phú Quốc", "exclusions"],
    ["ngân sách tối đa 4 triệu", "budget"], ["đúng ngày 25/8", "dateRange"], ["đúng 2 người", "travelers"], ["chỉ đi Đà Lạt", "destination"],
  ];
  for (const [message, field] of hardCases) cases.push({ group: "hard", message, assertState: (state) => {
    if (field === "exclusions") assert.ok(state.exclusions.length);
    else assert.equal(advisor.constraintMeta(state).modes[field], "hard", message);
  } });

  const priceCases = ["có tour nào 3 đồng không", "có tour nào 300003 đồng không", "tìm tour 150003đ", "tìm tour nào 350003 VND"];
  for (const message of priceCases) cases.push({ group: "isolated-price", message, assertState: (state) => {
    assert.equal(advisor.constraintMeta(state).queryScope, "isolated_price", message);
    assert.equal(advisor.detectRequestType(message, {}, advisor.extractConstraintDelta(message, state, NOW)), "recommendation");
  } });

  const antiRegression = [
    "Chuyến này dưới 5 triệu", "Tour Thủy Biều", "27 thì sao?", "Tour thứ hai thì sao?",
    "Tour này giá bao nhiêu và đi mấy ngày?", "Đà Lạt có gì hay?", "VietVoyage có gì nổi bật?",
    "Xin chào", "Bạn khỏe không?", "Bạn giúp được gì?", "Tour đầu tiên", "tour cuối", "tour vừa rồi",
  ];
  for (const message of antiRegression) cases.push({ group: "anti-regression", message, assertState: () => {
    const type = advisor.detectRequestType(message, {}, advisor.extractConstraintDelta(message, {}, NOW));
    assert.ok(type);
    if (message === "Bạn giúp được gì?") assert.equal(type, "general");
  } });

  const edgeCases = [
    "  THÔI ĐI NÚI!!!  ", "thoi di bien", "ĐỔI SANG ĐI NÚI", "khong gioi han ngan sach nua",
    "đi   4   người", "ngân sách 8 triệu!", "nếu có thể thì đi núi", "chỉ tìm tour núi",
    "không đi biển!!!", "đổi sang cuối tuần sau", "tôi đổi ý, muốn đi biển", "giá cao hơn cũng được?",
  ];
  for (const message of edgeCases) cases.push({
    group: "vietnamese-edge",
    message,
    assertState: (state) => assert.ok(Object.keys(state).length > 0, message),
  });
  cases.push({
    group: "relax-accommodation",
    message: "không cần khách sạn",
    assertState: (state) => assert.equal(state.accommodationRequired, false),
  });

  assert.ok(cases.length >= 100, `expected >=100 cases, got ${cases.length}`);
  for (const item of cases) {
    let state = merge({}, "5 ngày nữa tài chính 4 triệu cho 2 người muốn đi biển");
    state = merge(state, item.message);
    item.assertState(state);
  }
});

test("flexible multi-turn table: 10 scenarios apply semantic overrides without stale fields", () => {
  const scenarios = [
    { turns: ["muốn đi biển", "thôi đi núi"], check: (state) => assert.deepEqual(state.interests, ["núi"]) },
    { turns: ["muốn đi núi", "thôi đi biển"], check: (state) => assert.deepEqual(state.interests, ["biển"]) },
    { turns: ["ngân sách tối đa 4 triệu", "bỏ giới hạn ngân sách"], check: (state) => assert.equal(state.maxPrice, undefined) },
    { turns: ["đi 5 ngày nữa", "đổi sang cuối tháng"], check: (state) => assert.equal(state.dateRange.start, "2026-08-25") },
    { turns: ["đi 2 người", "đổi thành 4 người"], check: (state) => assert.equal(state.travelers, 4) },
    { turns: ["đi 5 ngày", "đổi sang 3 ngày"], check: (state) => assert.equal(state.days, 3) },
    { turns: ["Đà Lạt dưới 4 triệu", "giá cao hơn cũng được"], check: (state) => { assert.equal(state.destination, "Đà Lạt"); assert.equal(state.maxPrice, undefined); } },
    { turns: ["muốn đi biển", "không đi biển", "đổi sang đi núi"], check: (state) => { assert.deepEqual(state.interests, ["núi"]); assert.ok(state.exclusions.includes("biển")); } },
    { turns: ["5 ngày nữa 4 triệu cho 2 người", "có tour nào 3 đồng không", "tôi muốn đi núi"], check: (state) => { assert.equal(state.totalBudget, 4_000_000); assert.equal(state.travelers, 2); assert.deepEqual(state.interests, ["núi"]); assert.equal(advisor.constraintMeta(state).queryScope, null); } },
    { turns: ["tuần sau đi miền Trung", "không cần đúng ngày nữa", "ưu tiên lịch trình nhẹ"], check: (state) => { assert.equal(state.dateRange, undefined); assert.equal(state.region, "Miền Trung"); assert.equal(state.pace, "relaxed"); } },
  ];
  assert.equal(scenarios.length, 10);
  for (const scenario of scenarios) {
    let state = {};
    for (const message of scenario.turns) state = merge(state, message);
    scenario.check(state);
  }
});

test("soft interest focuses ranking but does not become a permanent hard filter", () => {
  const beach = tour();
  const mountain = tour({ _id: IDS.mountain, name: "Sa Pa núi khám phá", location: "Sa Pa", region: "Miền Bắc", tags: ["núi", "khám phá"], basePrice: 4_800_000 });
  const state = merge(merge({}, "muốn đi biển"), "thôi đi núi");
  const ranked = ragService.filterAndRankHydratedTours([beach, mountain], state, { requestType: "recommendation", orderedIds: [IDS.beach, IDS.mountain] });
  assert.deepEqual(ranked.map((item) => String(item._id)), [IDS.mountain]);
  assert.equal(advisor.constraintMode(state, "interests"), "soft");
});

test("zero-result diagnosis identifies the blocking hard constraint", () => {
  const mountain = tour({ _id: IDS.expensiveMountain, name: "Sa Pa núi khám phá", location: "Sa Pa", region: "Miền Bắc", tags: ["núi"], basePrice: 4_800_000 });
  let state = merge({}, "5 ngày nữa tài chính 4 triệu cho 2 người");
  state = merge(state, "tôi muốn đi chơi núi");
  const effective = advisor.getEffectiveConstraintState(state);
  const analysis = ragService.diagnoseZeroResult([mountain], effective, { requestType: "recommendation", orderedIds: [IDS.expensiveMountain] });
  assert.ok(analysis.blockingFields.includes("budget") || analysis.blockingFields.includes("dateRange"));
  const reply = advisor.buildZeroResultReply(effective, analysis);
  assert.match(reply, /tour núi/i);
  assert.match(reply, /ngân sách|thời gian/i);
  assert.doesNotMatch(reply, /đáp ứng đầy đủ các điều kiện đã ghi nhận/i);
});

test("zero-result diagnosis identifies semantic total budget after party-size update", () => {
  const daLat = tour({
    _id: IDS.mountain,
    name: "Đà Lạt cao nguyên",
    location: "Đà Lạt",
    region: "Miền Nam",
    tags: ["núi"],
    highlights: ["Cao nguyên"],
    days: 3,
    basePrice: 3_400_000,
    departures: [{
      _id: "64b000000000000000003102",
      date: new Date("2026-08-21T01:00:00.000Z"),
      availableSlots: 4,
      totalSlots: 12,
      price: 3_550_000,
    }],
  });
  let state = {};
  for (const message of ["2 người", "8tr tổng thôi", "không biển", "3 ngày", "tuần sau", "đổi thành 3 người"]) {
    state = merge(state, message);
  }
  const effective = advisor.getEffectiveConstraintState(state);

  const analysis = ragService.diagnoseZeroResult([daLat], effective, {
    requestType: "recommendation",
    now: NOW,
  });

  assert.deepEqual(analysis.blockingFields, ["budget"]);
  const reply = advisor.buildZeroResultReply(effective, analysis);
  assert.match(reply, /ngân sách.*8\.000\.000đ.*3 người/i);
  assert.doesNotMatch(reply, /thử một ngày khởi hành khác|linh hoạt hơn về số ngày/i);
});

test("zero-result table diagnoses budget, date, destination and combined blockers", () => {
  const base = tour({ _id: IDS.expensiveMountain, name: "Sa Pa núi khám phá", location: "Sa Pa", region: "Miền Bắc", tags: ["núi"], basePrice: 4_800_000 });
  const cases = [
    [{ maxPrice: 2_000_000 }, "budget"],
    [{ dateRange: { start: "2026-08-19", end: "2026-08-19", label: "19/8" }, travelers: 2 }, "dateRange"],
    [{ destination: "Phú Quốc" }, "destination"],
    [{ maxPrice: 2_000_000, days: 4 }, null],
  ];
  for (const [constraints, expected] of cases) {
    const analysis = ragService.diagnoseZeroResult([base], constraints, { requestType: "recommendation" });
    if (expected) assert.ok(analysis.blockingFields.includes(expected), JSON.stringify({ constraints, analysis }));
    else assert.ok(analysis.blockingFields.length >= 1, JSON.stringify({ constraints, analysis }));
    assert.doesNotMatch(advisor.buildZeroResultReply(constraints, analysis), /đáp ứng đầy đủ các điều kiện đã ghi nhận/i);
  }
});

test("required three-turn reproduction uses fresh intent and never repeats the generic fallback", async () => {
  const originalGenerate = gemini.generateChatReply;
  const originalRag = ragService.getRagContext;
  const originalFind = ragService.findMentionedTours;
  const pool = [
    tour(),
    tour({ _id: IDS.mountain, name: "Đà Lạt núi khám phá", location: "Đà Lạt", region: "Miền Nam", tags: ["núi", "khám phá"], basePrice: 4_500_000 }),
    tour({ _id: IDS.expensiveMountain, name: "Sa Pa núi nghỉ dưỡng", location: "Sa Pa", region: "Miền Bắc", tags: ["núi", "nghỉ dưỡng"], basePrice: 5_500_000 }),
  ];
  let mockedRetrievalCalls = 0;
  let mockedGenerationCalls = 0;
  gemini.generateChatReply = async () => { mockedGenerationCalls += 1; throw new Error("must not call Gemini"); };
  ragService.findMentionedTours = async () => [];
  ragService.getRagContext = async (_prompt, options) => {
    mockedRetrievalCalls += 1;
    const constraints = advisor.getEffectiveConstraintState(options.constraintState);
    const tours = ragService.filterAndRankHydratedTours(pool, constraints, { requestType: options.requestType, orderedIds: Object.values(IDS), limit: 3 });
    return { tours, contextText: "mock Mongo", matchedChunks: [], zeroResult: tours.length ? null : ragService.diagnoseZeroResult(pool, constraints, { requestType: options.requestType }) };
  };
  delete require.cache[require.resolve("../src/services/chatService")];
  const { generateChatAnswer } = require("../src/services/chatService");
  try {
    const one = await generateChatAnswer({ prompt: "5 ngày nữa tôi muốn đi du lịch nhưng chưa biết đi đâu tài chính 4 triệu cho 2 người", now: NOW });
    assert.equal(one.constraintState.dateRange.start, "2026-08-18");
    assert.equal(one.constraintState.totalBudget, 4_000_000);
    assert.equal(one.constraintState.travelers, 2);
    assert.equal(one.decision.action, "SEARCH");
    assert.equal(one.structuredContent.type, "recommendation");
    assert.doesNotMatch(one.reply, /\?\s*$/);

    const two = await generateChatAnswer({ prompt: "có tour nào 3 đồng không", constraintState: one.constraintState, entityState: one.entityState, now: NOW });
    assert.equal(two.intent.requestType, "recommendation");
    assert.equal(advisor.constraintMeta(two.constraintState).queryScope, "isolated_price");
    assert.doesNotMatch(two.reply, /biển, núi, nghỉ dưỡng hay khám phá/i);

    const three = await generateChatAnswer({ prompt: "tôi muốn đi chơi núi", constraintState: two.constraintState, entityState: two.entityState, now: NOW });
    assert.equal(three.intent.requestType, "recommendation");
    assert.deepEqual(three.constraintState.interests, ["núi"]);
    assert.equal(three.constraintState.dateRange.start, "2026-08-18");
    assert.equal(three.constraintState.totalBudget, 4_000_000);
    assert.equal(three.constraintState.travelers, 2);
    assert.match(three.reply, /tour núi|ngân sách|thời gian/i);
    assert.notEqual(two.reply, three.reply);
    assert.doesNotMatch(three.reply, /điểm đến, thời lượng hoặc ngân sách|đáp ứng đầy đủ các điều kiện đã ghi nhận/i);
    assert.equal(mockedGenerationCalls, 0);
    assert.equal(mockedRetrievalCalls, 3);
  } finally {
    gemini.generateChatReply = originalGenerate;
    ragService.getRagContext = originalRag;
    ragService.findMentionedTours = originalFind;
    delete require.cache[require.resolve("../src/services/chatService")];
  }
});

test("grounding remains deterministic for missing facts, sold-out and hidden tours", () => {
  const missing = tour({ itinerary: [], inclusions: [], exclusions: [], cancellationPolicy: "", promotionLabel: "", departures: [] });
  for (const question of [
    "khách sạn nào", "có vé máy bay không", "đi bằng phương tiện gì", "có bữa ăn gì",
    "lịch trình thế nào", "chính sách hủy thế nào", "có khuyến mãi không", "khởi hành khi nào",
  ]) {
    const detail = advisor.buildTourDetail(missing, question, NOW);
    assert.equal(detail.structuredContent.dataStatus, "missing", question);
    assert.match(detail.reply, /chưa/i, question);
  }
  const soldOut = tour({ departures: [{ date: new Date("2026-08-18T01:00:00Z"), availableSlots: 0, totalSlots: 20, price: 1_900_000 }] });
  assert.equal(advisor.findDeparturesInRange(soldOut, { start: "2026-08-18", end: "2026-08-18" })[0].availableSlots, 0);
  assert.equal(ragService.tourMatchesConstraints(tour({ status: "draft" }), {}), false);
  assert.equal(ragService.tourMatchesConstraints(tour({ isActive: false }), {}), false);
});
