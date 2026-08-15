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

test("day-only continuation dùng tháng/năm của ngày trước", () => {
  const parsed = parseDateConstraint(
    "22 thì sao?",
    { start: "2026-09-20", end: "2026-09-20", label: "20/9/2026" },
    new Date("2026-08-13T00:00:00Z")
  );
  assert.deepEqual(parsed, { start: "2026-09-22", end: "2026-09-22", label: "22/9/2026" });
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
    tour({ _id: IDS.first, name: "Tour A", basePrice: 5_500_000 }),
    tour({ _id: IDS.second, name: "Tour B", basePrice: 5_900_000 }),
  ], { maxPrice: 6_000_000, days: 4 });
  assert.equal(comparison.type, "comparison");
  assert.deepEqual(comparison.tours.map((item) => item.tourId), [IDS.first, IDS.second]);
  assert.equal(comparison.tours[0].price, 5_500_000);
  assert.ok(comparison.recommendation.tourId);
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

test("departure detail giữ sold-out 0 slots trong structured source", () => {
  const result = buildTourDetail(tour({
    departures: [{ _id: "64b000000000000000000099", date: new Date("2026-09-25T01:00:00.000Z"), availableSlots: 0, totalSlots: 20, price: 5_700_000 }],
  }), "Tour này khởi hành khi nào?", new Date("2026-08-13T00:00:00Z"));
  assert.equal(result.structuredContent.departures[0].availableSlots, 0);
  assert.match(result.reply, /hết chỗ \(0 chỗ\)/i);
});
