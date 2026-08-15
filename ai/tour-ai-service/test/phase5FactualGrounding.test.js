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
