const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractConstraintDelta,
  mergeConstraintState,
  parseDateConstraint,
  parseBudgetConstraint,
  shouldClarifyRecommendation,
  buildClarificationReply,
  findDeparturesInRange,
  collectEntityMemory,
  resolveEntityIds,
  buildComparison,
  buildComparisonReply,
  buildZeroResultReply,
  buildTourDetail,
  detectRequestType,
} = require("../src/services/travelAdvisorService");
const {
  tourMatchesConstraints,
  filterAndRankHydratedTours,
  sanitizeTour,
} = require("../src/services/ragService");

const IDS = {
  first: "64b000000000000000000001",
  second: "64b000000000000000000002",
  current: "64b000000000000000000003",
};

function tour(overrides = {}) {
  return {
    _id: IDS.first,
    name: "Miền Tây sông nước",
    location: "Cần Thơ",
    region: "Miền Nam",
    status: "published",
    isActive: true,
    days: 4,
    basePrice: 5_500_000,
    tags: ["văn hóa"],
    highlights: ["Chợ nổi Cái Răng"],
    itinerary: [],
    departures: [],
    reviews: [],
    ...overrides,
  };
}

test("yêu cầu miền Tây rộng cần hỏi thêm tối đa hai ý quan trọng", () => {
  const state = mergeConstraintState({}, extractConstraintDelta("Tìm tour miền Tây"));
  assert.equal(state.region, "Miền Nam");
  assert.deepEqual(state.interests, ["Miền Tây"]);
  assert.equal(shouldClarifyRecommendation(state), true);
  const reply = buildClarificationReply(state);
  assert.match(reply, /mấy ngày/i);
  assert.match(reply, /ngân sách/i);
});

test("constraint state tích lũy duration, budget và exclusion qua nhiều turn", () => {
  let state = mergeConstraintState({}, extractConstraintDelta("Tìm tour miền Tây"));
  state = mergeConstraintState(state, extractConstraintDelta("4 ngày, dưới 6 triệu", state));
  state = mergeConstraintState(state, extractConstraintDelta("Không Phú Quốc", state));
  assert.equal(state.days, 4);
  assert.equal(state.maxPrice, 6_000_000);
  assert.deepEqual(state.exclusions, ["Phú Quốc"]);
  assert.equal(shouldClarifyRecommendation(state), false);
});

test("zero-result explanation does not repeat the current budget as both focus and blocker", () => {
  const constraints = mergeConstraintState({}, extractConstraintDelta("3 người, tổng 12tr"));
  const reply = buildZeroResultReply(
    constraints,
    { cause: "user_constraints", blockingFields: ["budget"] },
    { operation: "recommendation_alternative" },
  );

  assert.doesNotMatch(reply, /ngân sách[^.]+đồng thời đáp ứng ngân sách/i);
  assert.equal((reply.match(/12\.000\.000đ/g) || []).length, 1);
});

test("activity exclusion can be set and explicitly removed in later turns", () => {
  let state = mergeConstraintState({}, extractConstraintDelta("không muốn bơi nhé"));
  assert.deepEqual(state.exclusions, ["bơi"]);
  assert.deepEqual(state._semanticState.slots.interests.excludedValues, ["bơi"]);

  state = mergeConstraintState(state, extractConstraintDelta("thôi bỏ điều kiện không bơi đi", state));
  assert.deepEqual(state.exclusions, []);
  assert.deepEqual(state._semanticState.slots.interests.excludedValues, []);
  assert.equal(state._semanticState.slots.interests.status, "removed");
});

test("activity exclusions are not misclassified as destinations and filter itinerary evidence", () => {
  for (const [message, expected] of [
    ["không muốn đi thuyền", "thuyền"],
    ["ko di thuyen nha", "thuyền"],
    ["không muốn đi bơi", "bơi"],
    ["không muốn đi kayak", "kayak"],
  ]) {
    const state = mergeConstraintState({}, extractConstraintDelta(message));
    assert.ok(state.exclusions.includes(expected), `${message}:legacy exclusion`);
    assert.ok(state._semanticState.slots.interests.excludedValues.includes(expected), `${message}:activity slot`);
    assert.doesNotMatch(
      state._semanticState.slots.destination.excludedValues.join(" "),
      new RegExp(expected, "i"),
      `${message}:destination slot`,
    );
  }

  const state = mergeConstraintState({}, extractConstraintDelta("không muốn đi thuyền"));
  const boatTour = tour({
    name: "Phong Nha — Vương quốc hang động",
    itinerary: [{ description: "Chiều đi thuyền ngược dòng sông Son vào động Phong Nha." }],
  });
  const landTour = tour({
    _id: IDS.second,
    name: "Huế — Dấu ấn cố đô",
    itinerary: [{ description: "Tham quan Đại Nội và chùa Thiên Mụ bằng xe." }],
  });

  assert.equal(tourMatchesConstraints(boatTour, state), false);
  assert.equal(tourMatchesConstraints(landTour, state), true);

  const staleState = structuredClone(state);
  staleState._semanticState.slots.destination = {
    status: "removed",
    origin: null,
    values: [],
    excludedValues: ["thuyền"],
  };
  staleState._semanticState.slots.interests = {
    status: "unknown",
    values: [],
    excludedValues: [],
  };

  const restated = mergeConstraintState(
    staleState,
    extractConstraintDelta("không muốn đi thuyền", staleState),
  );
  assert.deepEqual(restated._semanticState.slots.destination.excludedValues, []);
  assert.deepEqual(restated._semanticState.slots.interests.excludedValues, ["thuyền"]);

  const relaxed = mergeConstraintState(
    restated,
    extractConstraintDelta("thôi đi thuyền cũng được", restated),
  );
  assert.deepEqual(relaxed.interests, []);
  assert.deepEqual(relaxed.exclusions, []);
  assert.deepEqual(relaxed._semanticState.slots.destination.excludedValues, []);
  assert.deepEqual(relaxed._semanticState.slots.interests.values, []);
  assert.deepEqual(relaxed._semanticState.slots.interests.excludedValues, []);
});

test("high-climbing wording becomes a removable activity exclusion and filters climbing evidence", () => {
  for (const message of [
    "ko thích leo nhiều nữa",
    "không muốn leo nhiều bậc",
    "đừng gợi ý tour phải leo nhiều",
  ]) {
    const state = mergeConstraintState({}, extractConstraintDelta(message));
    assert.ok(state.exclusions.includes("leo nhiều"), `${message}:legacy exclusion`);
    assert.ok(
      state._semanticState.slots.interests.excludedValues.includes("leo nhiều"),
      `${message}:activity slot`,
    );

    const climbingTour = tour({
      name: "Tour leo bậc",
      itinerary: [{ description: "Trekking nhẹ qua thung lũng rồi leo 500 bậc đá lên đỉnh." }],
    });
    const easyTour = tour({
      _id: IDS.second,
      name: "Tour phố cổ",
      itinerary: [{ description: "Tham quan phố cổ bằng xe và đi bộ quãng ngắn." }],
    });
    assert.equal(tourMatchesConstraints(climbingTour, state), false, message);
    assert.equal(tourMatchesConstraints(easyTour, state), true, message);
  }

  let state = mergeConstraintState({}, extractConstraintDelta("không muốn leo nhiều bậc"));
  state = mergeConstraintState(state, extractConstraintDelta("bỏ điều kiện không leo nhiều đi", state));
  assert.deepEqual(state.exclusions, []);
  assert.deepEqual(state._semanticState.slots.interests.excludedValues, []);
});

test("day-only continuation dùng tháng/năm của ngày trước", () => {
  const parsed = parseDateConstraint(
    "22 thì sao?",
    { start: "2026-09-20", end: "2026-09-20", label: "20/9/2026" },
    new Date("2026-08-13T00:00:00Z")
  );
  assert.deepEqual(parsed, { start: "2026-09-22", end: "2026-09-22", label: "22/9/2026" });
});

test("bare numeric không tự ghi đè ngày cũ khi không có date cue", () => {
  const previous = { start: "2026-09-20", end: "2026-09-20", label: "20/9/2026" };

  assert.equal(parseDateConstraint("1", previous, new Date("2026-08-13T00:00:00Z")), null);

  const state = mergeConstraintState({}, extractConstraintDelta("tuần sau", {}, new Date("2026-08-13T00:00:00Z")));
  const delta = extractConstraintDelta("1", state, new Date("2026-08-13T00:00:00Z"));
  assert.equal(delta.dateRange, undefined);
});

test("relative date dùng Asia/Ho_Chi_Minh và không bị hiểu nhầm thành duration", () => {
  const now = new Date("2026-08-13T05:00:00.000Z");
  const expected = new Map([
    ["hôm nay", ["2026-08-13", "2026-08-13"]],
    ["mai", ["2026-08-14", "2026-08-14"]],
    ["ngày mai", ["2026-08-14", "2026-08-14"]],
    ["ngày kia", ["2026-08-15", "2026-08-15"]],
    ["3 ngày nữa", ["2026-08-16", "2026-08-16"]],
    ["5 ngày nữa", ["2026-08-18", "2026-08-18"]],
    ["thứ 7 này", ["2026-08-15", "2026-08-15"]],
    ["cuối tuần này", ["2026-08-15", "2026-08-16"]],
    ["cuối tuần sau", ["2026-08-22", "2026-08-23"]],
    ["tuần sau", ["2026-08-17", "2026-08-23"]],
    ["đầu tháng sau", ["2026-09-01", "2026-09-07"]],
    ["tháng sau", ["2026-09-01", "2026-09-30"]],
    ["25/8", ["2026-08-25", "2026-08-25"]],
  ]);
  for (const [message, [start, end]] of expected) {
    const parsed = parseDateConstraint(message, null, now);
    assert.equal(parsed.start, start, message);
    assert.equal(parsed.end, end, message);
  }
  assert.equal(extractConstraintDelta("5 ngày nữa", {}, now).days, undefined);
  assert.equal(parseDateConstraint("Hôm nay bạn khỏe không?", null, now), null);
});

test("total budget được giữ structured và quy đổi theo số khách để lọc giá tour mỗi người", () => {
  assert.deepEqual(parseBudgetConstraint("tài chính 4 triệu cho 2 người"), {
    budgetScope: "total",
    totalBudget: 4_000_000,
    minPrice: null,
    maxPrice: null,
  });
  const state = mergeConstraintState({}, extractConstraintDelta(
    "5 ngày nữa tôi muốn đi du lịch nhưng chưa biết đi đâu, tài chính 4 triệu cho 2 người",
    {},
    new Date("2026-08-13T05:00:00.000Z")
  ));
  assert.equal(state.dateRange.start, "2026-08-18");
  assert.equal(state.totalBudget, 4_000_000);
  assert.equal(state.budgetScope, "total");
  assert.equal(state.travelers, 2);
  assert.equal(state.maxPrice, 2_000_000);
  assert.equal(state.days, undefined);
  const reply = buildClarificationReply(state);
  assert.match(reply, /biển|núi|nghỉ dưỡng|khám phá/i);
  assert.doesNotMatch(reply, /thời gian|ngân sách|bao nhiêu người/i);
});

test("ordinal entity resolve dựa trên structured suggested IDs", () => {
  const entityState = collectEntityMemory([
    { role: "assistant", suggestedTourIds: [IDS.first, IDS.second] },
  ]);
  const resolved = resolveEntityIds({
    message: "Tour thứ hai có khách sạn không?",
    requestType: "tour_detail",
    entityState,
  });
  assert.deepEqual(resolved.ids, [IDS.second]);
  assert.equal(resolved.source, "ordinal");
});

test("tour này ưu tiên current tour của page", () => {
  const resolved = resolveEntityIds({
    message: "Tour này thế nào?",
    requestType: "tour_detail",
    pageContext: { pageType: "TOUR_DETAIL", tourId: IDS.current },
    entityState: { lastSuggestedTourIds: [IDS.first, IDS.second] },
  });
  assert.deepEqual(resolved.ids, [IDS.current]);
  assert.equal(resolved.source, "page");
});

test("entity mơ hồ với nhiều suggested tour thì yêu cầu làm rõ", () => {
  const resolved = resolveEntityIds({
    message: "Tour đó có khách sạn không?",
    requestType: "tour_detail",
    entityState: { lastSuggestedTourIds: [IDS.first, IDS.second] },
  });
  assert.equal(resolved.needsClarification, true);
  assert.deepEqual(resolved.ambiguousIds, [IDS.first, IDS.second]);
});

test("departure đúng ngày vẫn được giữ khi availableSlots bằng 0", () => {
  const soldOut = tour({
    departures: [{ date: new Date("2026-09-21T17:00:00.000Z"), availableSlots: 0, totalSlots: 20, price: 5_800_000 }],
  });
  const dateRange = { start: "2026-09-22", end: "2026-09-22" };
  assert.equal(findDeparturesInRange(soldOut, dateRange).length, 1);
  assert.equal(findDeparturesInRange(soldOut, dateRange, { requireAvailability: true }).length, 0);
});

test("Mongo current price/days là final filter, không phụ thuộc vector metadata cũ", () => {
  const staleVectorOrder = [IDS.first, IDS.second];
  const currentDbTours = [
    tour({ _id: IDS.first, basePrice: 7_500_000, days: 5 }),
    tour({ _id: IDS.second, basePrice: 5_800_000, days: 4 }),
  ];
  const result = filterAndRankHydratedTours(currentDbTours, { maxPrice: 6_000_000, days: 4 }, {
    requestType: "recommendation",
    orderedIds: staleVectorOrder,
  });
  assert.deepEqual(result.map((item) => String(item._id)), [IDS.second]);
});

test("recommendation áp dụng region, destination, exclusion, days và ngân sách từ Mongo hiện tại", () => {
  const result = filterAndRankHydratedTours([
    tour({ _id: IDS.first, name: "Tour Nha Trang 4N3Đ", location: "Nha Trang", region: "Miền Trung" }),
    tour({ _id: IDS.second, name: "Tour Phú Quốc 4N3Đ", location: "Phú Quốc", region: "Miền Nam" }),
    tour({ _id: IDS.current, name: "Tour Cần Thơ 4N3Đ", location: "Cần Thơ", region: "Miền Nam" }),
  ], {
    region: "Miền Nam",
    days: 4,
    maxPrice: 6_000_000,
    exclusions: ["Phú Quốc"],
  }, { requestType: "recommendation", orderedIds: [IDS.first, IDS.second, IDS.current] });
  assert.deepEqual(result.map((item) => String(item._id)), [IDS.current]);
});

test("inactive/unpublished tour không thể vào kết quả final", () => {
  assert.equal(tourMatchesConstraints(tour({ status: "draft" }), {}), false);
  assert.equal(tourMatchesConstraints(tour({ isActive: false }), {}), false);
});

test("hidden reviews bị loại khỏi AI context", () => {
  const result = sanitizeTour(tour({
    reviews: [
      { rating: 5, comment: "Công khai", isVisible: true },
      { rating: 1, comment: "Đã ẩn", isVisible: false },
    ],
  }));
  assert.deepEqual(result.reviews.map((review) => review.comment), ["Công khai"]);
});

test("comparison trả structured IDs và dữ liệu hiện tại", () => {
  const comparison = buildComparison([
    tour({ _id: IDS.first, name: "Tour A", basePrice: 5_500_000, highlights: [] }),
    tour({ _id: IDS.second, name: "Tour B", basePrice: 5_900_000, highlights: [] }),
  ], { maxPrice: 6_000_000, days: 4 });
  assert.equal(comparison.type, "comparison");
  assert.deepEqual(comparison.tours.map((item) => item.tourId), [IDS.first, IDS.second]);
  assert.equal(comparison.tours[0].price, 5_500_000);
  assert.ok(comparison.recommendation.tourId);

  const reply = buildComparisonReply(comparison);
  assert.doesNotMatch(reply, /Trade-off|factual basis|\bevidence\b/i);
  assert.match(reply, /Điểm cần cân nhắc:/);
  assert.match(reply, /trên cùng cơ sở dữ liệu/);
});

test("explicit tour hiện tại ưu tiên hơn ordinal/history trong cùng message", () => {
  const resolved = resolveEntityIds({
    message: "Tour Nha Trang này với tour thứ hai thì sao?",
    requestType: "tour_detail",
    pageContext: { pageType: "TOUR_DETAIL", tourId: IDS.current },
    entityState: { lastSuggestedTourIds: [IDS.first, IDS.second] },
    mentionedTourIds: [IDS.current],
  });
  assert.deepEqual(resolved.ids, [IDS.current]);
  assert.equal(resolved.source, "explicit");
});

test("business fact intents được route deterministic thay vì general generation", () => {
  assert.equal(detectRequestType("Tour này đi bằng phương tiện gì?"), "tour_detail");
  assert.equal(detectRequestType("Chính sách hủy tour này thế nào?"), "tour_detail");
  assert.equal(detectRequestType("Tour này giá bao nhiêu?"), "tour_detail");
  assert.equal(detectRequestType("Tour này giá bao nhiêu và đi mấy ngày?"), "tour_detail");
  assert.equal(detectRequestType("Tour này khởi hành khi nào?"), "tour_detail");
});

test("hotel/flight/transport/policy thiếu dữ liệu trả missing rõ ràng, không tự điền", () => {
  const missingFactsTour = tour({ inclusions: [], exclusions: [], cancellationPolicy: "", summary: "", description: "" });
  for (const [question, fact] of [
    ["Tour này khách sạn nào?", "accommodation"],
    ["Tour này có vé máy bay không?", "flight"],
    ["Tour này đi bằng phương tiện gì?", "transport"],
    ["Chính sách hủy tour này thế nào?", "cancellation_policy"],
  ]) {
    const result = buildTourDetail(missingFactsTour, question, new Date("2026-08-13T00:00:00Z"));
    assert.equal(result.structuredContent.requestedFact, fact);
    assert.equal(result.structuredContent.dataStatus, "missing");
    assert.match(result.reply, /chưa (?:nêu rõ|xác nhận|có)/i);
  }
});

test("câu hỏi ghép giá và thời lượng trả đủ cả hai fact hiện tại", () => {
  const result = buildTourDetail(tour({ basePrice: 4_321_000, days: 4 }), "Tour này giá bao nhiêu và đi mấy ngày?");
  assert.equal(result.structuredContent.requestedFact, "price_duration");
  assert.equal(result.structuredContent.price, 4_321_000);
  assert.equal(result.structuredContent.duration, 4);
  assert.match(result.reply, /4\.321\.000.*4 ngày/i);
});

test("câu hỏi giá tổng nhân đúng giá factual với số người hiện tại", () => {
  const result = buildTourDetail(
    tour({
      basePrice: 3_400_000,
      days: 3,
      departures: [{
        _id: "64b000000000000000000098",
        date: new Date("2026-08-21T01:00:00.000Z"),
        availableSlots: 4,
        totalSlots: 10,
        price: 3_550_000,
      }],
    }),
    "giá tổng cho 2 người?",
    new Date("2026-08-13T00:00:00Z"),
    {
      travelers: 2,
      dateRange: { start: "2026-08-17", end: "2026-08-23", label: "tuần sau" },
    },
  );

  assert.equal(result.structuredContent.requestedFact, "price_total");
  assert.equal(result.structuredContent.partySize, 2);
  assert.equal(result.structuredContent.totalPrice, 7_100_000);
  assert.match(result.reply, /tổng giá.*2 người.*7\.100\.000đ/i);
  assert.match(result.reply, /khởi hành ngày .* cho 2 người/i);
  assert.doesNotMatch(result.reply, /cho đợt .* cho 2 người/i);
});

test("câu hỏi ngày cụ thể trả đúng itinerary day thay vì overview giá và chỗ", () => {
  const result = buildTourDetail(
    tour({
      name: "Phong Nha — Vương quốc hang động",
      days: 3,
      itinerary: [
        { dayNumber: 1, title: "Động Phong Nha", description: "Đi thuyền trên sông Son vào động Phong Nha." },
        { dayNumber: 2, title: "Động Thiên Đường — Hang Tối", description: "Đi bộ trên cầu gỗ tại động Thiên Đường, sau đó trải nghiệm zipline và bơi vào hang Tối." },
        { dayNumber: 3, title: "Suối Nước Moọc", description: "Thư giãn tại khu sinh thái suối Nước Moọc." },
      ],
    }),
    "ngày 2 làm gì",
    new Date("2026-08-13T00:00:00Z"),
    {
      travelers: 3,
      dateRange: { start: "2026-08-17", end: "2026-08-23", label: "tuần sau" },
    },
  );

  assert.equal(result.structuredContent.requestedFact, "itinerary_day");
  assert.equal(result.structuredContent.requestedDay, 2);
  assert.match(result.reply, /^Ngày 2: Động Thiên Đường — Hang Tối — Đi bộ trên cầu gỗ/);
  assert.doesNotMatch(result.reply, /giá|chỗ/i);
});

test("câu hỏi nhiều ngày trả đủ từng ngày và giữ mỗi nhãn Ngày N cùng dòng", () => {
  const result = buildTourDetail(
    tour({
      name: "Sa Pa — Săn mây trên đỉnh Fansipan",
      days: 3,
      itinerary: [
        { dayNumber: 1, title: "Bản Cát Cát", description: "Đi bộ khám phá bản và ngắm thác Tiên Sa." },
        { dayNumber: 2, title: "Fansipan", description: "Đi cáp treo lên đỉnh Fansipan." },
        { dayNumber: 3, title: "Hàm Rồng", description: "Tham quan núi Hàm Rồng trước khi về Hà Nội." },
      ],
    }),
    "ngày 1 làm gì, ngày 2 thì sao?",
    new Date("2026-08-13T00:00:00Z"),
  );

  assert.equal(result.structuredContent.requestedFact, "itinerary_days");
  assert.equal(result.structuredContent.requestedDay, null);
  assert.deepEqual(result.structuredContent.requestedDays, [1, 2]);
  assert.match(result.reply, /^Ngày 1: Bản Cát Cát — Đi bộ khám phá bản và ngắm thác Tiên Sa\.\nNgày 2: Fansipan — Đi cáp treo lên đỉnh Fansipan\.$/);
  assert.doesNotMatch(result.reply, /Ngày [12]:\s*\n/);
});

test("mỗi ngày một dòng is formatting, not a request for day one", () => {
  const result = buildTourDetail(
    tour({
      name: "Đà Lạt — Thành phố ngàn hoa mộng mơ",
      days: 3,
      itinerary: [
        { dayNumber: 1, title: "Thác Datanla", description: "Tham quan thác và chợ đêm." },
        { dayNumber: 2, title: "Đồi chè Cầu Đất", description: "Săn mây và tham quan vườn hoa." },
        { dayNumber: 3, title: "Ga Đà Lạt", description: "Chụp ảnh kiến trúc trước khi về." },
      ],
    }),
    "tóm tắt lịch trình tour Đà Lạt từng ngày, mỗi ngày 1 dòng nha",
    new Date("2026-08-13T00:00:00Z"),
  );

  assert.equal(result.structuredContent.requestedFact, "itinerary");
  assert.deepEqual(result.structuredContent.requestedDays, []);
  assert.match(result.reply, /Ngày 1: Thác Datanla/);
  assert.match(result.reply, /Ngày 2: Đồi chè Cầu Đất/);
  assert.match(result.reply, /Ngày 3: Ga Đà Lạt/);
  assert.doesNotMatch(result.reply, /Ngày [123]:\s*\n/);
});

test("yêu cầu tóm tắt itinerary trả mỗi Ngày N ngắn gọn thay vì dump mô tả dài", () => {
  const result = buildTourDetail(
    tour({
      itinerary: [
        { dayNumber: 1, title: "Bản Cát Cát", description: "Đi bộ khám phá bản và ngắm thác Tiên Sa." },
        { dayNumber: 2, title: "Fansipan", description: "Đi cáp treo lên đỉnh Fansipan rồi tham quan quần thể tâm linh." },
      ],
    }),
    "tóm tắt ngày 1 và ngày 2, nói gọn thôi",
    new Date("2026-08-13T00:00:00Z"),
  );

  assert.equal(result.reply, "Ngày 1: Bản Cát Cát\nNgày 2: Fansipan");
  assert.doesNotMatch(result.reply, /Đi bộ|cáp treo|tham quan/);
});

test("departure detail giữ sold-out 0 slots trong structured source", () => {
  const result = buildTourDetail(tour({
    departures: [{ _id: "64b000000000000000000099", date: new Date("2026-09-25T01:00:00.000Z"), availableSlots: 0, totalSlots: 20, price: 5_700_000 }],
  }), "Tour này khởi hành khi nào?", new Date("2026-08-13T00:00:00Z"));
  assert.equal(result.structuredContent.departures[0].availableSlots, 0);
  assert.match(result.reply, /hết chỗ \(0 chỗ\)/i);
});
