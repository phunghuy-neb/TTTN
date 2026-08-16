const test = require("node:test");
const assert = require("node:assert/strict");

const {
  effectivePartySize,
  buildTourFactualContext,
  buildGroundingContract,
} = require("../src/services/factualGroundingService");
const {
  filterAndRankHydratedTours,
  buildContextText,
  buildMongoFallbackQuery,
} = require("../src/services/ragService");
const {
  buildRecommendationItems,
  buildRecommendationReply,
  buildComparison,
  buildAvailabilityReply,
} = require("../src/services/travelAdvisorService");
const { validateGeneratedReply } = require("../src/services/chatService");

const IDS = {
  a: "64b000000000000000005001",
  b: "64b000000000000000005002",
};
const NOW = new Date("2026-08-14T00:00:00.000Z");
const DATE_X = "2026-09-10";
const DATE_Y = "2026-09-20";

function departure(id, dateIso, price, availableSlots) {
  return {
    _id: id,
    date: new Date(`${dateIso}T05:00:00.000Z`),
    price,
    availableSlots,
    totalSlots: 20,
  };
}

function tour(overrides = {}) {
  return {
    _id: IDS.a,
    name: "Tour A",
    location: "Nha Trang",
    region: "Miền Trung",
    status: "published",
    isActive: true,
    days: 3,
    basePrice: 2_000_000,
    avgRating: 4.5,
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    departures: [],
    ...overrides,
  };
}

function onDate(date, extra = {}) {
  return {
    dateRange: { start: date, end: date, label: date },
    travelers: 2,
    ...extra,
  };
}

test("TEST 1: a price from Tour B cannot validate a claim about Tour A", () => {
  const tours = [
    tour({ basePrice: 2_000_000 }),
    tour({ _id: IDS.b, name: "Tour B", basePrice: 5_000_000 }),
  ];
  const grounding = buildGroundingContract(tours, {}, { now: NOW });
  assert.deepEqual(
    validateGeneratedReply("Tour A giá 5 triệu.", tours, { grounding }),
    { valid: false, reason: "unsupported_price" }
  );
});

test("TEST 2: a duration from Tour B cannot validate a claim about Tour A", () => {
  const tours = [tour({ days: 3 }), tour({ _id: IDS.b, name: "Tour B", days: 5 })];
  const grounding = buildGroundingContract(tours, {}, { now: NOW });
  assert.deepEqual(
    validateGeneratedReply("Tour A kéo dài 5 ngày.", tours, { grounding }),
    { valid: false, reason: "unsupported_duration" }
  );
});

test("TEST 3: one remaining slot is unavailable for a party of two", () => {
  const constraints = onDate(DATE_X);
  const value = tour({
    departures: [departure("dep-x", DATE_X, 3_000_000, 1)],
  });
  const facts = buildTourFactualContext(value, constraints, { now: NOW });
  assert.equal(effectivePartySize(constraints), 2);
  assert.equal(effectivePartySize({ _semanticState: { slots: { travelers: { total: 2 } } } }), 2);
  assert.equal(facts.availability.remainingSlots, 1);
  assert.equal(facts.availability.availableForParty, false);
  assert.equal(facts.availability.shortfall, 1);
  assert.match(buildAvailabilityReply({ name: "Tour A" }, constraints.dateRange, facts.departures, 2), /còn 1 chỗ nhưng không đủ cho 2 người/i);
  const grounding = buildGroundingContract([value], constraints, { now: NOW });
  assert.equal(validateGeneratedReply("Tour A còn 1 chỗ nhưng không đủ chỗ cho 2 người.", [value], { grounding }).valid, true);
  assert.deepEqual(
    validateGeneratedReply("Tour A đủ chỗ cho 2 người.", [value], { grounding }),
    { valid: false, reason: "incorrect_party_availability" }
  );
});

test("TEST 4: remaining slots equal to party size is available", () => {
  const value = tour({
    departures: [departure("dep-x", DATE_X, 3_000_000, 2)],
  });
  const constraints = onDate(DATE_X);
  const facts = buildTourFactualContext(value, constraints, { now: NOW });
  assert.equal(facts.availability.availableForParty, true);
  assert.equal(facts.availability.shortfall, 0);
  const grounding = buildGroundingContract([value], constraints, { now: NOW });
  assert.equal(validateGeneratedReply("Tour A đủ chỗ cho 2 người.", [value], { grounding }).valid, true);
});

test("TEST 5: date-specific filtering, ranking, explanation and display use departure price", () => {
  const constraints = onDate(DATE_X, { maxPrice: 3_500_000 });
  const a = tour({
    basePrice: 2_920_000,
    departures: [departure("dep-a-x", DATE_X, 3_270_000, 5)],
  });
  const b = tour({
    _id: IDS.b,
    name: "Tour B",
    basePrice: 2_000_000,
    departures: [departure("dep-b-x", DATE_X, 3_400_000, 5)],
  });
  const ranked = filterAndRankHydratedTours([b, a], constraints, { requestType: "recommendation", now: NOW });
  assert.equal(String(ranked[0]._id), IDS.a);
  const grounding = buildGroundingContract(ranked, constraints, { now: NOW });
  const items = buildRecommendationItems(ranked, constraints, NOW, {}, grounding);
  assert.equal(items[0].price, 3_270_000);
  assert.equal(items[0].priceBasis.type, "departure");
  assert.match(items[0].currentConstraintReasons.join(" "), /3\.270\.000/);
  assert.match(buildRecommendationReply(items), /3\.270\.000.*10\/9\/2026/i);
  const context = buildContextText(ranked, { constraints, grounding, now: NOW });
  assert.match(context, /type=departure.*amount=3270000/);
  assert.doesNotMatch(context, /FACTUAL PRICE BASIS FOR THIS REQUEST: type=base/);
  assert.equal(buildMongoFallbackQuery(constraints).basePrice, undefined);
  assert.deepEqual(buildMongoFallbackQuery({ maxPrice: 3_500_000 }).basePrice, { $lte: 3_500_000 });
});

test("TEST 6: changing date rehydrates price and availability from the new departure", () => {
  const value = tour({ departures: [
    departure("dep-x", DATE_X, 3_270_000, 2),
    departure("dep-y", DATE_Y, 4_100_000, 9),
  ] });
  const x = buildTourFactualContext(value, onDate(DATE_X), { now: NOW });
  const y = buildTourFactualContext(value, onDate(DATE_Y), { now: NOW });
  assert.equal(x.priceBasis.amount, 3_270_000);
  assert.equal(x.availability.remainingSlots, 2);
  assert.equal(y.priceBasis.amount, 4_100_000);
  assert.equal(y.availability.remainingSlots, 9);
  assert.notEqual(x.fingerprint, y.fingerprint);
});

test("TEST 7: changing party size recalculates availability", () => {
  const value = tour({ departures: [departure("dep-x", DATE_X, 3_000_000, 3)] });
  const partyTwo = buildTourFactualContext(value, onDate(DATE_X, { travelers: 2 }), { now: NOW });
  const partyFour = buildTourFactualContext(value, onDate(DATE_X, { travelers: 4 }), { now: NOW });
  assert.equal(partyTwo.availability.availableForParty, true);
  assert.equal(partyFour.availability.availableForParty, false);
  assert.equal(partyFour.availability.shortfall, 1);
  assert.notEqual(partyTwo.fingerprint, partyFour.fingerprint);
});

test("TEST 8: departure Y slots cannot support a claim for requested departure X", () => {
  const value = tour({ departures: [
    departure("dep-x", DATE_X, 3_000_000, 1),
    departure("dep-y", DATE_Y, 3_000_000, 10),
  ] });
  const constraints = onDate(DATE_X, { travelers: 1 });
  const grounding = buildGroundingContract([value], constraints, { now: NOW });
  assert.deepEqual(
    validateGeneratedReply("Tour A còn 10 chỗ.", [value], { grounding, constraints }),
    { valid: false, reason: "unsupported_availability" }
  );
});

test("TEST 9: cheaper-than claims require the real entity-bound calculation", () => {
  const tours = [tour({ basePrice: 2_000_000 }), tour({ _id: IDS.b, name: "Tour B", basePrice: 2_500_000 })];
  const grounding = buildGroundingContract(tours, {}, { now: NOW });
  assert.equal(validateGeneratedReply("Tour A rẻ hơn Tour B.", tours, { grounding }).valid, true);
  assert.deepEqual(
    validateGeneratedReply("Tour B rẻ hơn Tour A.", tours, { grounding }),
    { valid: false, reason: "incorrect_price_comparison" }
  );
});

test("TEST 10: savings claims require the exact price delta", () => {
  const tours = [tour({ basePrice: 2_000_000 }), tour({ _id: IDS.b, name: "Tour B", basePrice: 2_500_000 })];
  const grounding = buildGroundingContract(tours, {}, { now: NOW });
  assert.equal(validateGeneratedReply("Tour A tiết kiệm 500k so với Tour B.", tours, { grounding }).valid, true);
  assert.deepEqual(
    validateGeneratedReply("Tour A tiết kiệm 400k so với Tour B.", tours, { grounding }),
    { valid: false, reason: "incorrect_savings_claim" }
  );
  const comparison = buildComparison(tours, {}, { grounding, now: NOW });
  assert.equal(comparison.recommendation.basis, "lower_price");
  assert.equal(comparison.recommendation.savings, 500_000);
});

test("TEST 11: better-fit claims require differentiating scoring evidence", () => {
  const tours = [tour(), tour({ _id: IDS.b, name: "Tour B" })];
  const noEvidence = buildGroundingContract(tours, {}, { now: NOW });
  assert.deepEqual(
    validateGeneratedReply("Tour A phù hợp hơn Tour B.", tours, { grounding: noEvidence }),
    { valid: false, reason: "unsupported_fit_superiority" }
  );
  const withEvidence = buildGroundingContract(tours, {}, {
    now: NOW,
    scoringEvidenceByTour: new Map([[IDS.a, ["budget"]], [IDS.b, []]]),
  });
  assert.equal(validateGeneratedReply("Tour A phù hợp hơn Tour B.", tours, { grounding: withEvidence }).valid, true);
  const comparison = buildComparison(tours, {}, { grounding: noEvidence, now: NOW });
  assert.equal(comparison.recommendation, null);
});

test("TEST 12: a value on another tour cannot validate this tour's availability", () => {
  const constraints = onDate(DATE_X, { travelers: 1 });
  const tours = [
    tour({ departures: [departure("dep-a", DATE_X, 2_000_000, 1)] }),
    tour({ _id: IDS.b, name: "Tour B", departures: [departure("dep-b", DATE_X, 5_000_000, 5)] }),
  ];
  const grounding = buildGroundingContract(tours, constraints, { now: NOW });
  assert.deepEqual(
    validateGeneratedReply("Tour A còn 5 chỗ.", tours, { grounding, constraints }),
    { valid: false, reason: "unsupported_availability" }
  );
});

test("TEST 13: recommendation artifacts expose one shared factual basis", () => {
  const constraints = onDate(DATE_X, { travelers: 2, maxPrice: 3_500_000 });
  const value = tour({
    basePrice: 2_920_000,
    departures: [departure("dep-x", DATE_X, 3_270_000, 2)],
  });
  const grounding = buildGroundingContract([value], constraints, { now: NOW });
  const [item] = buildRecommendationItems([value], constraints, NOW, {}, grounding);
  assert.equal(item.price, item.priceBasis.amount);
  assert.equal(item.departure.departureId, item.priceBasis.departureId);
  assert.equal(item.availability.departureId, item.priceBasis.departureId);
  assert.equal(item.availability.availableForParty, true);
  assert.match(item.currentConstraintReasons.join(" "), /3\.270\.000/);
});

test("TEST 14: unsupported date price/availability claims fail while unknown wording is allowed", () => {
  const value = tour({ departures: [departure("dep-y", DATE_Y, 4_000_000, 8)] });
  const constraints = onDate(DATE_X);
  const grounding = buildGroundingContract([value], constraints, { now: NOW });
  assert.equal(grounding.tours[0].priceBasis.type, "unknown");
  assert.deepEqual(
    validateGeneratedReply("Tour A giá 4 triệu và còn 8 chỗ.", [value], { grounding, constraints }),
    { valid: false, reason: "unsupported_price" }
  );
  assert.equal(validateGeneratedReply("Tour A chưa có dữ liệu giá hoặc chỗ cho ngày này.", [value], { grounding, constraints }).valid, true);
});

test("MEDIUM-05 operational choices require explicit flexibility evidence", () => {
  const haLong = tour({
    name: "Vịnh Hạ Long — Kỳ quan trên biển",
    location: "Hạ Long",
    summary: "Du thuyền qua đảo đá vôi, chèo kayak và ngủ đêm trên vịnh.",
    description: "Chiều tham quan hang Sửng Sốt, chèo kayak tại hang Luồn và tắm biển ở đảo Ti Tốp.",
    itinerary: [{
      title: "Hang Sửng Sốt — Hang Luồn — Đảo Ti Tốp",
      description: "Tham quan hang Sửng Sốt, chèo kayak tại hang Luồn, tắm biển ở đảo Ti Tốp rồi dùng tiệc tối trên du thuyền.",
    }],
  });
  const grounding = buildGroundingContract([haLong], {}, { now: NOW });

  for (const claim of [
    "Bạn hoàn toàn có thể lựa chọn nghỉ ngơi trên du thuyền hoặc tham gia các hoạt động nhẹ nhàng.",
    "Du khách có thể bỏ qua các điểm tham quan và ở lại du thuyền nếu muốn.",
  ]) {
    assert.deepEqual(
      validateGeneratedReply(claim, [haLong], { grounding }),
      { valid: false, reason: "unsupported_operational_choice" },
      claim,
    );
  }

  assert.equal(
    validateGeneratedReply("Bạn có thể chèo kayak tại hang Luồn.", [haLong], { grounding }).valid,
    true,
  );

  const flexible = tour({
    name: "Tour nghỉ dưỡng linh hoạt",
    summary: "Buổi chiều là thời gian tự do; du khách có thể lựa chọn nghỉ ngơi tại resort hoặc tham gia chèo kayak.",
  });
  assert.equal(
    validateGeneratedReply(
      "Du khách có thể lựa chọn nghỉ ngơi tại resort hoặc tham gia chèo kayak.",
      [flexible],
      { grounding: buildGroundingContract([flexible], {}, { now: NOW }) },
    ).valid,
    true,
  );
});

test("MEDIUM-05 booking existence claims require booking evidence", () => {
  for (const claim of [
    "Hệ thống chưa có dữ liệu về mã đặt chỗ ABC123.",
    "Mình không tìm thấy booking mang mã XYZ789 trong hệ thống.",
  ]) {
    assert.deepEqual(
      validateGeneratedReply(claim, []),
      { valid: false, reason: "booking_claim_without_evidence" },
      claim,
    );
  }

  assert.equal(
    validateGeneratedReply("Mình chưa có dữ liệu booking để kết luận mã ABC123 có tồn tại hay không.", []).valid,
    true,
  );
});

test("MEDIUM-05 unsupported flat-terrain wording is rewritten but explicit terrain evidence is preserved", () => {
  const ninhBinh = tour({
    name: "Ninh Bình — Tràng An non nước hữu tình",
    itinerary: [{ title: "Tràng An", description: "Ngồi thuyền nan tham quan quần thể danh thắng Tràng An." }],
  });
  const rewritten = validateGeneratedReply(
    "Các hoạt động khác chủ yếu là di chuyển bằng thuyền hoặc đi bộ bằng phẳng.",
    [ninhBinh],
  );
  assert.equal(rewritten.valid, true);
  assert.equal(rewritten.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(rewritten.rewrittenReply, /bằng phẳng/i);

  const accessible = tour({ summary: "Lối đi tham quan bằng phẳng và phù hợp cho xe lăn." });
  assert.deepEqual(
    validateGeneratedReply("Lối đi tham quan bằng phẳng.", [accessible]),
    { valid: true, reason: null },
  );
});

test("descriptive grounding rewrites an unsupported atmosphere claim from the live Da Lat response", () => {
  const daLat = tour({
    name: "Đà Lạt — Thành phố ngàn hoa mộng mơ",
    itinerary: [{
      title: "Thác Datanla — Chợ đêm",
      description: "Tối dạo chợ đêm Đà Lạt, thưởng thức bánh tráng nướng và sữa đậu nành nóng.",
    }],
  });

  const validation = validateGeneratedReply(
    "Bạn có thể chụp ảnh không khí nhộn nhịp tại chợ đêm Đà Lạt vào buổi tối.",
    [daLat],
  );

  assert.deepEqual(
    validation,
    { valid: false, reason: "empty_rewrite_after_unsupported_descriptive_claims" },
  );
});

test("descriptive grounding rewrites an unsupported activity-purpose claim from the live Da Lat response", () => {
  const daLat = tour({
    name: "Đà Lạt — Thành phố ngàn hoa mộng mơ",
    itinerary: [{
      title: "Trang trại rau — Tiễn khách",
      description: "Ghé trang trại rau công nghệ cao và vườn dâu, mua đặc sản mứt, atisô làm quà.",
    }],
  });

  const validation = validateGeneratedReply(
    "Ghé thăm trang trại rau công nghệ cao và vườn dâu để tìm hiểu quy trình canh tác và mua đặc sản làm quà.",
    [daLat],
  );

  assert.equal(validation.valid, true);
  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(validation.rewrittenReply, /tìm hiểu quy trình canh tác/i);
  assert.match(validation.rewrittenReply, /trang trại rau công nghệ cao/i);
  assert.match(validation.rewrittenReply, /mua đặc sản làm quà/i);
});

test("descriptive grounding covers atmosphere paraphrases without relying on a fixed adjective blacklist", () => {
  const marketTour = tour({
    name: "Tour chợ đêm",
    itinerary: [{ description: "Buổi tối dạo chợ đêm và thưởng thức món địa phương." }],
  });

  for (const claim of [
    "Khung cảnh tấp nập quanh chợ đêm tạo nhiều góc chụp ảnh.",
    "Bầu không khí rộn ràng ở khu chợ là điểm nhấn buổi tối.",
  ]) {
    const validation = validateGeneratedReply(claim, [marketTour]);
    assert.deepEqual(
      validation,
      { valid: false, reason: "empty_rewrite_after_unsupported_descriptive_claims" },
      claim,
    );
  }
});

test("descriptive grounding covers inferred learning, process, and lifestyle purposes", () => {
  const farmTour = tour({
    name: "Tour nông trại",
    itinerary: [{ description: "Tham quan trang trại rau và vườn dâu." }],
  });

  for (const claim of [
    "Ghé nông trại để học cách trồng rau.",
    "Tham quan trang trại để khám phá quy trình sản xuất.",
  ]) {
    const validation = validateGeneratedReply(claim, [farmTour]);
    assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten", claim);
    assert.ok(validation.rewrittenClaims.some(({ type }) => type === "activity_purpose"), claim);
  }

  assert.deepEqual(
    validateGeneratedReply("Bạn sẽ trải nghiệm đời sống nông dân tại trang trại.", [farmTour]),
    { valid: false, reason: "empty_rewrite_after_unsupported_descriptive_claims" },
  );
});

test("descriptive grounding preserves atmosphere and activity-purpose claims stated by evidence", () => {
  const supported = tour({
    name: "Tour trải nghiệm nông trại",
    itinerary: [{
      description: "Dạo chợ đêm trong không khí nhộn nhịp. Ghé trang trại để tìm hiểu quy trình canh tác.",
    }],
  });

  assert.deepEqual(
    validateGeneratedReply("Chợ đêm có không khí nhộn nhịp.", [supported]),
    { valid: true, reason: null },
  );
  assert.deepEqual(
    validateGeneratedReply("Bạn sẽ tìm hiểu quy trình canh tác tại trang trại.", [supported]),
    { valid: true, reason: null },
  );
});

test("descriptive grounding preserves harmless phrasing of activities present in evidence", () => {
  const daLat = tour({
    name: "Đà Lạt — Thành phố ngàn hoa mộng mơ",
    itinerary: [{ description: "Ghé trang trại rau, tham quan vườn dâu và dạo chợ đêm." }],
  });
  const reply = "Bạn có thể ghé trang trại rau, tham quan vườn dâu và dạo chợ đêm.";

  assert.deepEqual(validateGeneratedReply(reply, [daLat]), { valid: true, reason: null });
});

test("descriptive grounding rewrites coordinated unsupported activities from the second live Da Lat response", () => {
  const daLat = tour({
    name: "Đà Lạt — Thành phố ngàn hoa mộng mơ",
    itinerary: [{
      title: "Ga Đà Lạt — Trang trại rau — Tiễn khách",
      description: "Sáng thăm ga Đà Lạt cổ kính, chụp ảnh kiến trúc Pháp. Ghé trang trại rau công nghệ cao và vườn dâu, mua đặc sản mứt, atisô làm quà.",
    }],
  });

  const validation = validateGeneratedReply(
    "Ghé thăm trang trại rau công nghệ cao và vườn dâu để tìm hiểu thực tế, chụp hình và mua đặc sản mứt, atisô làm quà trước khi kết thúc hành trình.",
    [daLat],
  );

  assert.equal(validation.valid, true);
  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(validation.rewrittenReply, /tìm hiểu thực tế|chụp hình/i);
  assert.match(validation.rewrittenReply, /mua đặc sản mứt, atisô làm quà/i);
  assert.equal(
    validation.rewrittenClaims.filter(({ type }) => type === "activity_purpose").length,
    2,
  );
});

test("activity grounding cannot borrow photography evidence from another itinerary sentence", () => {
  const daLat = tour({
    name: "Đà Lạt — Thành phố ngàn hoa mộng mơ",
    itinerary: [{
      description: "Chụp ảnh kiến trúc Pháp tại ga Đà Lạt. Ghé trang trại rau và vườn dâu, mua đặc sản làm quà.",
    }],
  });

  const validation = validateGeneratedReply(
    "Ghé trang trại rau và vườn dâu để chụp hình và mua đặc sản làm quà.",
    [daLat],
  );

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(validation.rewrittenReply, /chụp hình/i);
  assert.match(validation.rewrittenReply, /mua đặc sản làm quà/i);
});

test("coordinated purpose activities require evidence instead of a phrase blacklist", () => {
  const craftTour = tour({
    name: "Tour làng gốm",
    itinerary: [{ description: "Ghé xưởng gốm Bát Tràng và xem khu trưng bày." }],
  });

  const validation = validateGeneratedReply(
    "Ghé xưởng gốm Bát Tràng nhằm tự tay làm sản phẩm, nghe nghệ nhân kể chuyện và chụp ảnh lưu niệm.",
    [craftTour],
  );

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(validation.rewrittenReply, /tự tay làm|nghe nghệ nhân|chụp ảnh lưu niệm/i);
  assert.match(validation.rewrittenReply, /Ghé xưởng gốm Bát Tràng/i);
});

test("direct experiential activities require local evidence", () => {
  const farmTour = tour({
    name: "Tour nông trại",
    itinerary: [{ description: "Tham quan trang trại rau và vườn dâu." }],
  });

  for (const claim of [
    "Bạn sẽ tìm hiểu thực tế tại trang trại.",
    "Du khách được chụp hình tại vườn dâu.",
    "Bạn có thể trò chuyện với nông dân tại trang trại.",
  ]) {
    assert.deepEqual(
      validateGeneratedReply(claim, [farmTour]),
      { valid: false, reason: "empty_rewrite_after_unsupported_descriptive_claims" },
      claim,
    );
  }
});

test("coordinated purpose activities are preserved when local evidence states them", () => {
  const supported = tour({
    name: "Tour nông trại có hướng dẫn",
    itinerary: [{
      description: "Ghé trang trại để tìm hiểu thực tế, chụp ảnh tại vườn dâu và mua đặc sản làm quà.",
    }],
  });

  assert.deepEqual(
    validateGeneratedReply(
      "Ghé trang trại để tìm hiểu thực tế, chụp hình tại vườn dâu và mua đặc sản làm quà.",
      [supported],
    ),
    { valid: true, reason: null },
  );
});

test("activity grounding neutralizes an unsupported purpose relation between supported activities", () => {
  const caveTour = tour({
    name: "Tour hang Tối",
    itinerary: [{ description: "Bơi vào hang Tối và tắm bùn khoáng tự nhiên." }],
  });
  const validation = validateGeneratedReply(
    "Bơi vào hang Tối để tắm bùn khoáng tự nhiên.",
    [caveTour],
  );

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(validation.rewrittenReply, /để tắm bùn/i);
  assert.match(validation.rewrittenReply, /Bơi vào hang Tối, tắm bùn khoáng tự nhiên/i);
});

test("Markdown-labelled activity claims cannot bypass grounding in the live Hue reply", () => {
  const hue = tour({
    name: "Huế — Dấu ấn cố đô vàng son",
    summary: "Thăm Đại Nội, lăng tẩm triều Nguyễn, nghe ca Huế trên sông Hương và thưởng thức ẩm thực cung đình.",
    description: "Lăng Tự Đức thơ mộng giữa rừng thông. Thuyền rồng đưa khách nghe ca Huế và thả hoa đăng cầu an.",
    itinerary: [
      {
        title: "Đại Nội — Chùa Thiên Mụ — Ca Huế trên sông Hương",
        description: "Tham quan Đại Nội, sau đó ghé chùa Thiên Mụ ngắm hoàng hôn bên sông. Tối lên thuyền rồng nghe ca Huế và thả hoa đăng.",
      },
      {
        title: "Lăng Khải Định — Lăng Tự Đức — Tiễn khách",
        description: "Thăm lăng Khải Định với nghệ thuật khảm sành sứ độc đáo và lăng Tự Đức giữa rừng thông tĩnh lặng. Dùng cơm cung đình rồi mua đặc sản mè xửng, nón lá làm quà.",
      },
    ],
  });

  const validation = validateGeneratedReply(
    [
      "**Về chụp ảnh kiến trúc và di tích:**",
      "* **Chùa Thiên Mụ:** Ngắm cảnh và chụp hình lúc hoàng hôn bên sông Hương.",
      "* **Lăng Tự Đức:** Nằm giữa rừng thông tĩnh lặng, mang vẻ đẹp thơ mộng.",
      "**Về trải nghiệm văn hóa:**",
      "* **Mua sắm đặc sản:** Tìm hiểu và mua các đặc sản địa phương như mè xửng, nón lá làm quà.",
    ].join("\n"),
    [hue],
  );

  assert.equal(validation.valid, true);
  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(validation.rewrittenReply, /chụp hình|Tìm hiểu/i);
  assert.match(validation.rewrittenReply, /Lăng Tự Đức/i);
});

test("a coordinated photo activity after supported viewing still requires local evidence", () => {
  const hue = tour({
    name: "Huế — Dấu ấn cố đô vàng son",
    itinerary: [{
      title: "Chùa Thiên Mụ",
      description: "Ghé chùa Thiên Mụ ngắm hoàng hôn bên sông Hương.",
    }],
  });

  const validation = validateGeneratedReply(
    "Chùa Thiên Mụ: Ngắm hoàng hôn bên sông Hương và chụp hình lưu niệm.",
    [hue],
  );

  assert.equal(validation.valid, true);
  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.match(validation.rewrittenReply, /Ngắm hoàng hôn bên sông Hương/i);
  assert.doesNotMatch(validation.rewrittenReply, /chụp hình/i);
});

test("Markdown-labelled activity claims are preserved when local evidence supports them", () => {
  const supported = tour({
    name: "Tour văn hóa có hoạt động ảnh",
    itinerary: [{
      description: "Tại chùa, ngắm cảnh và chụp ảnh lúc hoàng hôn bên sông. Tìm hiểu và mua đặc sản địa phương làm quà.",
    }],
  });
  const reply = [
    "* **Chùa:** Ngắm cảnh và chụp hình lúc hoàng hôn bên sông.",
    "* **Mua sắm đặc sản:** Tìm hiểu và mua đặc sản địa phương làm quà.",
  ].join("\n");

  assert.deepEqual(validateGeneratedReply(reply, [supported]), { valid: true, reason: null });
});

test("Markdown-labelled coordinated Hue activities preserve supported listen and release claims", () => {
  const hue = tour({
    name: "Huế — Dấu ấn cố đô vàng son",
    description: "Buổi tối, thuyền rồng đưa bạn xuôi sông Hương nghe ca Huế và thả hoa đăng cầu an.",
    itinerary: [{
      title: "Ca Huế trên sông Hương",
      description: "Tối lên thuyền rồng nghe ca Huế và thả hoa đăng.",
    }],
  });

  assert.deepEqual(
    validateGeneratedReply(
      "* **Ca Huế trên sông Hương:** Nghe ca Huế và thả hoa đăng cầu an từ thuyền rồng vào buổi tối.",
      [hue],
    ),
    { valid: true, reason: null },
  );
});

test("direct activity grounding audits a photo claim after a modal lead-in", () => {
  const daLat = tour({
    name: "Đà Lạt — Thành phố ngàn hoa mộng mơ",
    itinerary: [{ description: "Ghé thác Datanla trải nghiệm máng trượt." }],
  });

  const validation = validateGeneratedReply(
    "Bạn có cơ hội chụp ảnh tại thác Datanla.",
    [daLat],
  );

  assert.deepEqual(
    validation,
    { valid: false, reason: "empty_rewrite_after_unsupported_descriptive_claims" },
  );
});

test("direct activity grounding audits a photo claim after a temporal lead-in", () => {
  const daLat = tour({
    name: "Đà Lạt — Thành phố ngàn hoa mộng mơ",
    itinerary: [{ description: "Tối dạo chợ đêm Đà Lạt." }],
  });

  const validation = validateGeneratedReply(
    "Buổi tối, bạn có thể chụp ảnh và dạo chơi tại chợ đêm Đà Lạt.",
    [daLat],
  );

  assert.deepEqual(
    validation,
    { valid: false, reason: "empty_rewrite_after_unsupported_descriptive_claims" },
  );
});

test("direct activity grounding audits a later coordinated photo claim", () => {
  const daLat = tour({
    name: "Đà Lạt — Thành phố ngàn hoa mộng mơ",
    itinerary: [{
      description: "Chiều check-in vườn hoa thành phố, đồi cỏ hồng và Quảng trường Lâm Viên. Tối tự do khám phá quán cà phê view thung lũng.",
    }],
  });

  const validation = validateGeneratedReply(
    "Check-in vườn hoa thành phố, đồi cỏ hồng, Quảng trường Lâm Viên và tự do chụp ảnh tại quán cà phê view thung lũng.",
    [daLat],
  );

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.match(validation.rewrittenReply, /Check-in vườn hoa thành phố/i);
  assert.doesNotMatch(validation.rewrittenReply, /tự do chụp ảnh/i);
});

test("direct activity grounding rewrites every unsupported photo claim in the exact Round 3 Da Lat DOM", () => {
  const daLat = tour({
    name: "Đà Lạt — Thành phố ngàn hoa mộng mơ",
    location: "Lâm Đồng",
    region: "Miền Nam",
    summary: "Vi vu đồi chè Cầu Đất, check-in vườn hoa và săn bình minh sương giăng trên cao nguyên se lạnh.",
    description: "Đà Lạt nằm trên cao nguyên Lâm Viên ở độ cao 1.500m, khí hậu mát mẻ quanh năm và ngập tràn sắc hoa. Bạn sẽ săn bình minh trên đồi chè Cầu Đất khi sương còn phủ kín thung lũng, rồi thưởng thức cà phê Arabica ngay tại nông trại. Hành trình đi qua thác Datanla, hồ Tuyền Lâm, Thiền viện Trúc Lâm và những vườn hoa cẩm tú cầu rực rỡ. Tối đến, chợ đêm Đà Lạt với sữa đậu nành nóng và bánh tráng nướng là điểm hẹn quen thuộc của du khách.",
    itinerary: [
      {
        title: "Sân bay Liên Khương — Thác Datanla — Chợ đêm",
        description: "Đón khách tại sân bay Liên Khương, trên đường về thành phố ghé thác Datanla trải nghiệm máng trượt. Nhận phòng khách sạn trung tâm, chiều tham quan Thiền viện Trúc Lâm và hồ Tuyền Lâm bằng cáp treo. Tối dạo chợ đêm Đà Lạt, thưởng thức bánh tráng nướng và sữa đậu nành nóng.",
      },
      {
        title: "Săn mây đồi chè Cầu Đất — Vườn hoa thành phố",
        description: "Khởi hành từ sáng sớm lên đồi chè Cầu Đất săn bình minh và biển mây, tham quan nông trại cà phê Arabica. Chiều check-in vườn hoa thành phố, đồi cỏ hồng và Quảng trường Lâm Viên. Tối tự do khám phá quán cà phê view thung lũng.",
      },
      {
        title: "Ga Đà Lạt — Trang trại rau — Tiễn khách",
        description: "Sáng thăm ga Đà Lạt cổ kính và nhà thờ Con Gà, chụp ảnh kiến trúc Pháp còn nguyên vẹn. Ghé trang trại rau công nghệ cao và vườn dâu, mua đặc sản mứt, atisô làm quà.",
      },
    ],
  });
  const reply = [
    "Chào bạn, dưới đây là các trải nghiệm săn bình minh, chụp ảnh và khám phá nông trại trong tour **Đà Lạt — Thành phố ngàn hoa mộng mơ (3 ngày)** được phân bổ chi tiết theo từng ngày trong lịch trình:",
    "",
    "* **Ngày 1: Nhận phòng, di chuyển và chụp ảnh kiến trúc, cảnh quan**",
    " * **Chụp ảnh & Trải nghiệm:** Bạn có cơ hội chụp ảnh tại thác Datanla (trải nghiệm máng trượt), ngắm cảnh và chụp hình khi di chuyển bằng cáp treo tham quan Thiền viện Trúc Lâm và hồ Tuyền Lâm. Buổi tối, bạn có thể chụp ảnh và dạo chơi tại chợ đêm Đà Lạt.",
    "",
    "* **Ngày 2: Săn bình minh, khám phá nông trại cà phê và check-in các điểm hoa, cỏ**",
    " * **Săn bình minh:** Khởi hành từ sáng sớm lên đồi chè Cầu Đất.",
    " * **Khám phá nông trại:** Tham quan nông trại cà phê Arabica (thưởng thức cà phê ngay tại đây).",
    " * **Chụp ảnh:** Check-in vườn hoa thành phố, đồi cỏ hồng, Quảng trường Lâm Viên và tự do chụp ảnh tại quán cà phê view thung lũng vào buổi tối.",
    "",
    "* **Ngày 3: Chụp ảnh kiến trúc cổ",
    " * **Chụp ảnh:** Chụp ảnh kiến trúc Pháp còn nguyên vẹn tại ga Đà Lạt cổ kính và nhà thờ Con Gà.",
    " * **Khám phá nông trại:** Ghé thăm trang trại rau công nghệ cao và vườn dâu và mua đặc sản làm quà.",
  ].join("\n");

  const validation = validateGeneratedReply(reply, [daLat]);

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(validation.rewrittenReply, /chụp ảnh kiến trúc, cảnh quan/i);
  assert.doesNotMatch(validation.rewrittenReply, /chụp ảnh tại thác Datanla/i);
  assert.doesNotMatch(validation.rewrittenReply, /ngắm cảnh|chụp hình khi di chuyển bằng cáp treo/i);
  assert.doesNotMatch(validation.rewrittenReply, /chụp ảnh và dạo chơi tại chợ đêm/i);
  assert.doesNotMatch(validation.rewrittenReply, /tự do chụp ảnh tại quán cà phê/i);
  assert.doesNotMatch(validation.rewrittenReply, /Bạn có cơ hội\.\.|\* \*\*Ngày 1:[^\n]*(?<!\*\*)$/imu);
  assert.match(validation.rewrittenReply, /săn bình minh/i);
  assert.match(
    validation.rewrittenReply,
    /Ngày 2: Săn bình minh, khám phá nông trại cà phê và check-in các điểm hoa, cỏ/i,
  );
  assert.match(validation.rewrittenReply, /Check-in vườn hoa thành phố/i);
  assert.match(validation.rewrittenReply, /Chụp ảnh kiến trúc Pháp còn nguyên vẹn tại ga Đà Lạt/i);
});

test("direct activity grounding preserves modal, temporal, and coordinated photo claims stated by local evidence", () => {
  const supported = tour({
    name: "Tour ảnh Đà Lạt",
    itinerary: [{
      description: "Chụp ảnh tại thác Datanla. Buổi tối chụp ảnh và dạo chơi tại chợ đêm. Check-in vườn hoa rồi tự do chụp ảnh tại quán cà phê view thung lũng.",
    }],
  });

  for (const reply of [
    "Bạn có cơ hội chụp ảnh tại thác Datanla.",
    "Buổi tối, bạn có thể chụp ảnh và dạo chơi tại chợ đêm.",
    "Check-in vườn hoa rồi tự do chụp ảnh tại quán cà phê view thung lũng.",
  ]) {
    assert.deepEqual(validateGeneratedReply(reply, [supported]), { valid: true, reason: null }, reply);
  }
});

test("direct activity grounding rewrites unsupported leisure-verb substitution from the live Phong Nha reply", () => {
  const phongNha = tour({
    name: "Phong Nha — Vương quốc hang động",
    itinerary: [
      { description: "Sáng thư giãn tại khu sinh thái suối Nước Moọc với làn nước xanh trong giữa rừng nguyên sinh." },
      { description: "Ghé biển Nhật Lệ chụp ảnh." },
    ],
  });
  const validation = validateGeneratedReply(
    "**Thư giãn hòa mình vào thiên nhiên:** Vui chơi tại khu sinh thái suối Nước Moọc giữa rừng nguyên sinh và ghé chụp ảnh tại biển Nhật Lệ.",
    [phongNha],
  );

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(validation.rewrittenReply, /vui chơi/i);
  assert.match(validation.rewrittenReply, /chụp ảnh tại biển Nhật Lệ/i);
});

test("direct activity grounding preserves a leisure activity stated by local evidence", () => {
  const leisureTour = tour({
    name: "Tour sinh thái",
    itinerary: [{ description: "Vui chơi tại khu sinh thái và chụp ảnh bên hồ." }],
  });

  assert.equal(
    validateGeneratedReply("Vui chơi tại khu sinh thái và chụp ảnh bên hồ.", [leisureTour]).valid,
    true,
  );
});

test("unsupported factual-purpose labels are removed while supported body claims remain", () => {
  const supportedBody = tour({
    name: "Tour cao nguyên",
    itinerary: [{
      description: "Ghé thác Datanla, tham quan bằng cáp treo và buổi tối dạo chợ đêm.",
    }],
  });
  const reply = [
    "Ngày 1: Khởi đầu với hoạt động",
    "Chụp ảnh: Bạn sẽ ghé thác Datanla. Tiếp đó, hành trình đưa bạn đi cáp treo. Buổi tối dạo chợ đêm.",
  ].join("\n");

  const validation = validateGeneratedReply(reply, [supportedBody]);

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(validation.rewrittenReply, /Chụp ảnh:/i);
  assert.match(validation.rewrittenReply, /ghé thác Datanla/i);
  assert.match(validation.rewrittenReply, /đi cáp treo/i);
  assert.match(validation.rewrittenReply, /dạo chợ đêm/i);
});

test("activity rewrites drop orphaned generic scaffolds instead of leaving broken sentences", () => {
  const daLat = tour({
    name: "Tour cao nguyên",
    itinerary: [{ description: "Ghé thác Datanla và tham quan bằng cáp treo." }],
  });
  const reply = "Bạn sẽ ghé thác Datanla. Ngoài ra, lịch trình có hoạt động tìm hiểu.";

  const validation = validateGeneratedReply(reply, [daLat]);

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.equal(validation.rewrittenReply, "Bạn sẽ ghé thác Datanla.");
});

test("a rewritten unsupported label remains visible to the composer when its body is supported", () => {
  const photoTour = tour({
    name: "Tour ảnh kiến trúc",
    itinerary: [{ description: "Chụp ảnh tại ga Đà Lạt." }],
  });
  const reply = "Chụp ảnh và trải nghiệm: Chụp ảnh tại ga Đà Lạt.";

  const validation = validateGeneratedReply(reply, [photoTour]);

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.equal(validation.rewrittenReply, "Chụp ảnh tại ga Đà Lạt.");
  assert.deepEqual(validation.rewrittenClaims.map(({ type }) => type), ["activity_label"]);
});

test("validator rejects a descriptive rewrite that leaves empty sections or dangling activity fragments", () => {
  const itineraryTour = tour({
    name: "Tour cao nguyên",
    itinerary: [
      { description: "Ghé thác Datanla." },
      { description: "Săn bình minh tại đồi chè Cầu Đất." },
    ],
  });
  const reply = [
    "* **Ngày 1:**",
    " * **Chụp ảnh:** Chụp ảnh tại thác Datanla.",
    "* **Ngày 2:**",
    " * **Săn bình minh:** Săn bình minh tại đồi chè Cầu Đất.",
  ].join("\n");

  assert.deepEqual(validateGeneratedReply(reply, [itineraryTour]), {
    valid: false,
    reason: "malformed_rewrite_after_unsupported_descriptive_claims",
  });
});

test("response quality guard rejects dangling fragments without rejecting complete nearby phrasing", () => {
  const completeTour = tour({
    name: "Tour nông trại",
    summary: "Phù hợp cho người yêu thích nghệ thuật và dành cho những người đam mê văn hóa bản địa.",
    itinerary: [{
      description: "Ghé thác Datanla. Tham quan nông trại cà phê Arabica và mua đặc sản. Chiều check-in tại vườn hoa. Buổi tối dạo chơi tại chợ đêm.",
    }],
  });

  for (const reply of [
    "* **Ngày 1:**\n\n* **Ngày 2:** Ghé thác Datanla.",
    "* **Khám phá nông trại:** Tham quan.",
    "Ghé nông trại cà phê Arabica, nơi bạn có thể.",
    "Chiều tiếp tục check-in.",
    "Buổi tối có hoạt động dạo chơi.",
    "Bạn có thể ghi lại khoảnh khắc khi.",
    "Tour Đà Lạt 3 ngày này rất phù hợp cho những ai yêu thích.",
    "Tour này phù hợp cho người yêu thích.",
    "Hành trình này dành cho những người đam mê.",
    "Tour này có kết hợp.",
    "Tour này có bao gồm.",
    "Ghé thác Datanla bên cạnh các hoạt động.",
  ]) {
    assert.deepEqual(validateGeneratedReply(reply, [completeTour]), {
      valid: false,
      reason: "malformed_generated_reply",
    }, reply);
  }

  assert.deepEqual(validateGeneratedReply("* **Ngày 1:**\nGhé thác Datanla.", [completeTour]), {
    valid: true,
    reason: "generated_reply_formatting_normalized",
    rewrittenReply: "* **Ngày 1:** Ghé thác Datanla.",
    rewrittenClaims: [],
  });

  for (const reply of [
    "* **Khám phá nông trại:** Tham quan nông trại cà phê Arabica.",
    "Ghé nông trại cà phê Arabica, nơi bạn có thể mua đặc sản.",
    "Tour này phù hợp cho người yêu thích nghệ thuật.",
    "Hành trình này dành cho những người đam mê văn hóa bản địa.",
  ]) {
    assert.deepEqual(validateGeneratedReply(reply, [completeTour]), {
      valid: true,
      reason: null,
    }, reply);
  }
});

test("response quality guard rejects a generic activity fragment after a discourse label", () => {
  const architectureTour = tour({
    name: "Tour phố cổ",
    itinerary: [{ description: "Tham quan phố cổ Hội An và các ngôi nhà kiến trúc cổ." }],
  });

  assert.deepEqual(validateGeneratedReply(
    "Về kiến trúc: Bạn sẽ được tham quan.",
    [architectureTour],
  ), {
    valid: false,
    reason: "malformed_generated_reply",
  });

  assert.deepEqual(validateGeneratedReply(
    "Về kiến trúc: Bạn sẽ được tham quan phố cổ Hội An.",
    [architectureTour],
  ), {
    valid: true,
    reason: null,
  });
});

test("validator removes a redundant example tail created by descriptive rewrite", () => {
  const saPa = tour({
    name: "Sa Pa — Săn mây trên đỉnh Fansipan",
    location: "Lào Cai",
    itinerary: [{
      description: "Đi bộ khám phá bản Cát Cát và trekking nhẹ qua thung lũng Mường Hoa.",
    }],
  });
  const reply = [
    "Lịch trình tour Sa Pa 3 ngày bao gồm các hoạt động di chuyển và đi bộ như: đi bộ.",
    "Dữ liệu không có đánh giá cụ thể về mức độ mệt ngoài các hoạt động đi bộ và trekking nhẹ kể trên.",
  ].join("\n\n");

  assert.deepEqual(validateGeneratedReply(reply, [saPa]), {
    valid: true,
    reason: "generated_reply_formatting_normalized",
    rewrittenReply: [
      "Lịch trình tour Sa Pa 3 ngày bao gồm các hoạt động di chuyển và đi bộ.",
      "Dữ liệu không có đánh giá cụ thể về mức độ mệt ngoài các hoạt động đi bộ và trekking nhẹ kể trên.",
    ].join("\n\n"),
    rewrittenClaims: [],
  });
});

test("coordinated activity rewrite removes an orphaned or-connector with its unsupported branch", () => {
  const supported = tour({
    name: "Tour thác",
    itinerary: [{
      description: "Trải nghiệm máng trượt tại thác Datanla và tham quan bằng cáp treo.",
    }],
  });
  const reply = "Trải nghiệm máng trượt tại thác Datanla, hoặc chụp ảnh khi đi cáp treo.";

  const validation = validateGeneratedReply(reply, [supported]);

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.equal(validation.rewrittenReply, "Trải nghiệm máng trượt tại thác Datanla.");
});

test("a locally supported activity keeps a parenthetical detail grounded elsewhere in the same tour", () => {
  const sunriseTour = tour({
    name: "Tour săn mây",
    description: "Săn bình minh trên đồi chè khi sương còn phủ kín thung lũng.",
    itinerary: [{ description: "Khởi hành sớm để săn bình minh và biển mây." }],
  });
  const reply = "Khởi hành sớm để săn bình minh và biển mây (khi sương còn phủ kín thung lũng).";

  assert.deepEqual(validateGeneratedReply(reply, [sunriseTour]), {
    valid: true,
    reason: null,
  });

  const unsupportedDetail = validateGeneratedReply(
    "Khởi hành sớm để săn bình minh và biển mây (khi trời đầy nắng).",
    [sunriseTour],
  );
  assert.equal(unsupportedDetail.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(unsupportedDetail.rewrittenReply, /đầy nắng/i);
});

test("audience suitability conclusions require explicit tour evidence", () => {
  const familyTour = tour({
    name: "Tour Đà Lạt",
    itinerary: [{
      description: "Đi cáp treo, tham quan vườn hoa, ga Đà Lạt và vườn dâu.",
    }],
  });
  const unsupported = validateGeneratedReply(
    "Tour có các hoạt động như đi cáp treo, tham quan vườn hoa, ga Đà Lạt và vườn dâu phù hợp với trẻ nhỏ.",
    [familyTour],
  );

  assert.equal(unsupported.reason, "unsupported_descriptive_claims_rewritten");
  assert.equal(
    unsupported.rewrittenReply,
    "Tour có các hoạt động như đi cáp treo, tham quan vườn hoa, ga Đà Lạt và vườn dâu.",
  );
  assert.ok(unsupported.rewrittenClaims.some((claim) => claim.type === "audience_suitability"));

  const explicitlySupported = tour({
    name: "Tour gia đình",
    summary: "Lịch trình phù hợp với trẻ nhỏ.",
  });
  assert.deepEqual(
    validateGeneratedReply("Lịch trình phù hợp với trẻ nhỏ.", [explicitlySupported]),
    { valid: true, reason: null },
  );
});

test("removing an unsupported label capitalizes the supported sentence that remains", () => {
  const activityTour = tour({
    name: "Tour thác",
    itinerary: [{ description: "Trải nghiệm máng trượt tại thác Datanla." }],
  });
  const validation = validateGeneratedReply(
    "Chụp ảnh: trải nghiệm máng trượt tại thác Datanla.",
    [activityTour],
  );

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.equal(validation.rewrittenReply, "Trải nghiệm máng trượt tại thác Datanla.");
});

test("removing a leading unsupported activity cleans punctuation and capitalizes the supported clause", () => {
  const cultureTour = tour({
    name: "Tour văn hóa",
    description: "Buổi tối nghe ca Huế và thả hoa đăng cầu an.",
    itinerary: [{ description: "Nghe ca Huế và thả hoa đăng." }],
  });
  const validation = validateGeneratedReply(
    "Trải nghiệm đi thuyền rồng xuôi sông Hương, nghe ca Huế và thả hoa đăng cầu an vào buổi tối.",
    [cultureTour],
  );

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.equal(validation.rewrittenReply, "Nghe ca Huế và thả hoa đăng cầu an vào buổi tối.");
});

test("validator removes an empty numbered item left by grounding rewrite and renumbers supported items", () => {
  const caveTour = tour({
    name: "Tour hang động",
    description: "Động Thiên Đường dài 31km với vòm thạch nhũ cao vút.",
    itinerary: [{ description: "Tham quan động Thiên Đường và ngắm vòm thạch nhũ." }],
  });
  const reply = [
    "Tour có 2 điểm nổi bật:",
    "1. **Khám phá động Phong Nha:** Trải nghiệm đi thuyền ngược dòng sông Son vào động, chiêm ngưỡng dòng sông ngầm.",
    "2. **Khám phá động Thiên Đường:** Chiêm ngưỡng hang động dài 31km với vòm thạch nhũ cao vút.",
  ].join("\n");

  const validation = validateGeneratedReply(reply, [caveTour]);

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.doesNotMatch(validation.rewrittenReply, /^\s*1\.\s*$/mu);
  assert.doesNotMatch(validation.rewrittenReply, /^\s*2\./mu);
  assert.match(validation.rewrittenReply, /^1\. \*\*Khám phá động Thiên Đường:\*\*/mu);
});

test("raw assistant formatting keeps each day heading on the same line as its first content", () => {
  const itineraryTour = tour({
    name: "Tour hai ngày",
    itinerary: [
      { description: "Ghé thác Datanla." },
      { description: "Săn bình minh tại đồi chè Cầu Đất." },
    ],
  });
  const reply = [
    "* **Ngày 1:**",
    "Ghé thác Datanla.",
    "* **Ngày 2:**",
    "Săn bình minh tại đồi chè Cầu Đất.",
  ].join("\n");

  assert.deepEqual(validateGeneratedReply(reply, [itineraryTour]), {
    valid: true,
    reason: "generated_reply_formatting_normalized",
    rewrittenReply: [
      "* **Ngày 1:** Ghé thác Datanla.",
      "* **Ngày 2:** Săn bình minh tại đồi chè Cầu Đất.",
    ].join("\n"),
    rewrittenClaims: [],
  });
});

test("raw assistant formatting separates an itinerary place from a following activity clause", () => {
  const caveTour = tour({
    name: "Tour hang động",
    itinerary: [{
      title: "Động Thiên Đường — Sông Chày, hang Tối",
      description: "Tham quan động Thiên Đường, đi bộ trên cầu gỗ ngắm vòm thạch nhũ.",
    }],
  });
  const validation = validateGeneratedReply(
    "- Tham quan động Thiên Đường đi bộ trên cầu gỗ ngắm vòm thạch nhũ.",
    [caveTour],
  );

  assert.equal(validation.reason, "generated_reply_formatting_normalized");
  assert.equal(
    validation.rewrittenReply,
    "- Tham quan động Thiên Đường, đi bộ trên cầu gỗ ngắm vòm thạch nhũ.",
  );
});

test("removing unsupported bold list labels preserves bullets without orphaning Markdown markers", () => {
  const ninhBinh = tour({
    name: "Ninh Bình — Tràng An non nước hữu tình",
    location: "Ninh Bình",
    description: "Bạn sẽ ngồi thuyền nan xuôi dòng Tràng An, chui qua chín hang xuyên thủy và ghé phim trường Kong: Skull Island.",
    itinerary: [
      {
        description: "Thăm đền vua Đinh Tiên Hoàng và vua Lê Đại Hành. Tối dùng cơm với đặc sản cơm cháy, dê núi.",
      },
      {
        description: "Leo 500 bậc đá lên hang Múa.",
      },
    ],
  });
  const reply = [
    "Trong tour Ninh Bình, những điểm đáng trải nghiệm nhất gồm:",
    "",
    "* **Khám phá Tràng An:** Ngồi thuyền nan xuôi dòng, đi xuyên qua 9 hang động và ghé phim trường Kong: Skull Island.",
    "* **Thăm Cố đô Hoa Lư:** Tham quan đền vua Đinh Tiên Hoàng và vua Lê Đại Hành.",
    "* **Chinh phục Hang Múa:** Leo 500 bậc đá lên đỉnh.",
    "",
    "* **Thưởng thức ẩm thực:** Dùng bữa với các món đặc sản địa phương như cơm cháy và dê núi.",
  ].join("\n");

  const validation = validateGeneratedReply(reply, [ninhBinh]);

  assert.equal(validation.reason, "unsupported_descriptive_claims_rewritten");
  assert.equal(validation.rewrittenReply, [
    "Trong tour Ninh Bình, những điểm đáng trải nghiệm nhất gồm:",
    "",
    "* **Khám phá Tràng An:** Ngồi thuyền nan xuôi dòng, đi xuyên qua 9 hang động và ghé phim trường Kong: Skull Island.",
    "* **Thăm Cố đô Hoa Lư:** Tham quan đền vua Đinh Tiên Hoàng và vua Lê Đại Hành.",
    "* **Chinh phục Hang Múa:** Leo 500 bậc đá lên đỉnh.",
    "",
    "* Dùng bữa với các món đặc sản địa phương như cơm cháy và dê núi.",
  ].join("\n"));
  assert.doesNotMatch(validation.rewrittenReply, /^\s*\*\*\s+/mu);
});
