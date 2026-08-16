const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SEMANTIC_STATE_KEY,
  CONSTRAINT_META_KEY,
  extractConstraintDelta,
  getEffectiveConstraintState,
  mergeConstraintState,
  migrateLegacyConstraintState,
  validateSemanticStateV2,
} = require("../src/services/travelAdvisorService");
const {
  SemanticStateValidationError,
  createSemanticStateV2,
} = require("../src/services/semanticStateV2");
const { preferenceScore, tourMatchesConstraints } = require("../src/services/ragService");

const NOW = new Date("2026-08-13T05:00:00.000Z");

function applyTurn(previous, message) {
  return mergeConstraintState(previous, extractConstraintDelta(message, previous, NOW));
}

function semanticSlot(message, slotName, previous = {}) {
  return applyTurn(previous, message)[SEMANTIC_STATE_KEY].slots[slotName];
}

function publishedTour(days, overrides = {}) {
  return {
    _id: `64b00000000000000000000${days}`,
    name: `Tour ${days} ngày`,
    location: "Việt Nam",
    region: "Miền Trung",
    status: "published",
    isActive: true,
    days,
    basePrice: 3_000_000,
    tags: [],
    highlights: [],
    itinerary: [],
    departures: [],
    ...overrides,
  };
}

test("TEST 1: intentionally-open destination is distinct from missing", () => {
  const state = applyTurn({}, "không biết đi đâu");
  assert.equal(state.destination, undefined);
  assert.equal(state[SEMANTIC_STATE_KEY].slots.destination.status, "intentionally_open");
});

test("generic alternative-tour wording never becomes a literal destination", () => {
  const previous = applyTurn({}, "muốn đi Sa Pa 3 ngày");
  const state = applyTurn(previous, "có tour khác ko");

  assert.equal(state.destination, "Sa Pa");
  assert.equal(state.region, "Miền Bắc");
  assert.deepEqual(state[SEMANTIC_STATE_KEY].slots.destination.values, ["Sa Pa"]);
});

test("allowing another place opens the active destination constraint", () => {
  const previous = applyTurn({}, "muốn đi Sa Pa 3 ngày");
  const state = applyTurn(previous, "đi chỗ khác cũng được");

  assert.equal(state.destination, undefined);
  assert.equal(state.region, undefined);
  assert.deepEqual(state[SEMANTIC_STATE_KEY].slots.destination, {
    status: "intentionally_open",
    origin: null,
    values: [],
    excludedValues: [],
  });
});

test("TEST 2: same-message traveler correction keeps the final value", () => {
  const state = applyTurn({}, "2 người, à 3 người");
  assert.equal(state.travelers, 3);
  assert.deepEqual(state[SEMANTIC_STATE_KEY].slots.travelers, {
    status: "known",
    adults: 3,
    children: 0,
    childAges: [],
    total: 3,
    removedComponents: [],
  });
});

test("TEST 3: same-message budget correction keeps the final value", () => {
  const slot = semanticSlot("4 triệu, thôi 5 triệu", "budget");
  assert.equal(slot.operator, "max");
  assert.equal(slot.max, 5_000_000);
});

test("TEST 4: negated beach intent never becomes a positive interest", () => {
  const state = applyTurn({}, "không muốn đi biển");
  const slot = state[SEMANTIC_STATE_KEY].slots.interests;
  assert.deepEqual(slot.values, []);
  assert.deepEqual(slot.excludedValues, ["biển"]);
  assert.deepEqual(state.interests, []);
  assert.deepEqual(state.exclusions, ["biển"]);
});

test("HIGH-01: no-diacritic shorthand negation remains a hard beach exclusion", () => {
  const exclusionCases = [
    "ko di bien nha, goi y tour 3 hom",
    "ko biển nha",
    "ko thích biển, gợi ý tour ba hôm",
    "không muốn đi biển, gợi ý tour 3 ngày",
  ];
  for (const message of exclusionCases) {
    const state = applyTurn({}, message);
    const slot = state[SEMANTIC_STATE_KEY].slots.interests;
    assert.deepEqual(slot.values, [], `${message}:positive`);
    assert.deepEqual(slot.excludedValues, ["biển"], `${message}:excluded`);
    assert.deepEqual(state.interests, [], `${message}:legacy-positive`);
    assert.deepEqual(state.exclusions, ["biển"], `${message}:legacy-excluded`);
    assert.equal(
      tourMatchesConstraints(publishedTour(3, { tags: ["biển"] }), state),
      false,
      `${message}:beach-tour`
    );
    assert.equal(
      tourMatchesConstraints(publishedTour(3, { tags: ["văn hóa"] }), state),
      true,
      `${message}:non-beach-tour`
    );
  }

  const positive = applyTurn({}, "thích biển, gợi ý tour 3 hôm");
  assert.deepEqual(positive[SEMANTIC_STATE_KEY].slots.interests.values, ["biển"]);
  assert.deepEqual(positive[SEMANTIC_STATE_KEY].slots.interests.excludedValues, []);
});

test("standalone 'trừ' excludes a mapped activity instead of promoting it", () => {
  const previous = applyTurn({}, "3 người, tổng 8 triệu, 3 ngày");
  const state = applyTurn(previous, "chỗ nào cũng được trừ trekking");
  const slot = state[SEMANTIC_STATE_KEY].slots.interests;

  assert.deepEqual(slot.values, []);
  assert.deepEqual(slot.excludedValues, ["núi"]);
  assert.deepEqual(state.interests, []);
  assert.deepEqual(state.exclusions, ["núi"]);
});

test("natural reluctance excludes heavy climbing instead of promoting it", () => {
  const previous = applyTurn({}, "muốn đi Sa Pa 3 ngày cho 2 người");
  const cases = [
    "t ngại leo nhiều",
    "mình hơi ngại leo nhiều",
    "ngại phải leo nhiều",
  ];

  for (const message of cases) {
    const state = applyTurn(previous, message);
    const slot = state[SEMANTIC_STATE_KEY].slots.interests;

    assert.deepEqual(slot.values, [], `${message}:positive`);
    assert.deepEqual(slot.excludedValues, ["leo nhiều"], `${message}:excluded`);
    assert.deepEqual(state.interests, [], `${message}:legacy-positive`);
    assert.deepEqual(state.exclusions, ["leo nhiều"], `${message}:legacy-excluded`);
    assert.equal(state.destination, "Sa Pa", `${message}:destination`);
  }

  const positive = applyTurn(previous, "muốn leo nhiều");
  assert.deepEqual(positive[SEMANTIC_STATE_KEY].slots.interests.values, ["leo nhiều"]);
  assert.deepEqual(positive[SEMANTIC_STATE_KEY].slots.interests.excludedValues, []);
});

test("denied interest negation does not exclude the corrected interest", () => {
  const previous = applyTurn({}, "ngại leo nhiều");
  const corrected = applyTurn(previous, "không thích biển chứ ko phải không thích núi");
  const correctedSlot = corrected[SEMANTIC_STATE_KEY].slots.interests;

  assert.deepEqual(correctedSlot.values, []);
  assert.deepEqual(correctedSlot.excludedValues, ["leo nhiều", "biển"]);
  assert.deepEqual(corrected.exclusions, ["leo nhiều", "biển"]);

  const staleMountain = applyTurn({}, "không thích núi");
  const relaxed = applyTurn(staleMountain, "không phải không thích núi");
  assert.deepEqual(relaxed[SEMANTIC_STATE_KEY].slots.interests.excludedValues, []);
  assert.deepEqual(relaxed.exclusions, []);

  const actualNegation = applyTurn({}, "không thích núi");
  assert.deepEqual(actualNegation[SEMANTIC_STATE_KEY].slots.interests.excludedValues, ["núi"]);
});

test("TEST 5: destination exclusion is represented without a positive destination", () => {
  const state = applyTurn({}, "đừng gợi ý Đà Lạt");
  const slot = state[SEMANTIC_STATE_KEY].slots.destination;
  assert.equal(slot.status, "removed");
  assert.deepEqual(slot.values, []);
  assert.deepEqual(slot.excludedValues, ["Đà Lạt"]);
  assert.equal(state.destination, undefined);
});

test("TEST 6: budget range owns its span and cannot become a date", () => {
  const state = applyTurn({}, "3-4 triệu");
  const semantic = state[SEMANTIC_STATE_KEY];
  assert.deepEqual(
    { operator: semantic.slots.budget.operator, min: semantic.slots.budget.min, max: semantic.slots.budget.max },
    { operator: "range", min: 3_000_000, max: 4_000_000 }
  );
  assert.equal(state.dateRange, undefined);
  assert.equal(semantic.slots.date.status, "unknown");
  assert.deepEqual(semantic.lastSpans.map((span) => span.owner), ["budget"]);
});

test("TEST 7: minimum budget is not inverted into a maximum", () => {
  const state = applyTurn({}, "ít nhất 4 triệu");
  const slot = state[SEMANTIC_STATE_KEY].slots.budget;
  assert.deepEqual({ operator: slot.operator, min: slot.min, max: slot.max }, {
    operator: "min",
    min: 4_000_000,
    max: null,
  });
  assert.equal(state.minPrice, 4_000_000);
  assert.equal(state.maxPrice, undefined);
});

test("TEST 8: maximum duration remains a max constraint in RAG", () => {
  const state = applyTurn({}, "không quá 3 ngày");
  const slot = state[SEMANTIC_STATE_KEY].slots.duration;
  assert.deepEqual({ operator: slot.operator, maxDays: slot.maxDays }, { operator: "max", maxDays: 3 });
  assert.equal(tourMatchesConstraints(publishedTour(2), state), true);
  assert.equal(tourMatchesConstraints(publishedTour(3), state), true);
  assert.equal(tourMatchesConstraints(publishedTour(4), state), false);
});

test("TEST 9: optional duration is relaxed, not an exact hard constraint", () => {
  const state = applyTurn({}, "không nhất thiết phải 3 ngày");
  const slot = state[SEMANTIC_STATE_KEY].slots.duration;
  assert.deepEqual({ status: slot.status, operator: slot.operator, targetDays: slot.targetDays, required: slot.required }, {
    status: "relaxed",
    operator: "optional",
    targetDays: 3,
    required: false,
  });
  assert.equal(state.days, undefined);
  assert.equal(tourMatchesConstraints(publishedTour(7), state), true);
});

test("TEST 10: removing a child clears child count, ages and derived party total", () => {
  let state = applyTurn({}, "2 người + bé 5 tuổi");
  assert.deepEqual(state[SEMANTIC_STATE_KEY].slots.travelers, {
    status: "known",
    adults: 2,
    children: 1,
    childAges: [5],
    total: 3,
    removedComponents: [],
  });

  state = applyTurn(state, "à không có bé nữa");
  assert.deepEqual(state[SEMANTIC_STATE_KEY].slots.travelers, {
    status: "known",
    adults: 2,
    children: 0,
    childAges: [],
    total: 2,
    removedComponents: ["children", "childAges"],
  });
  assert.equal(state.travelers, 2);
  assert.deepEqual(state.childAges, []);
});

test("itinerary formatting language cannot overwrite traveler or budget state", () => {
  const initial = applyTurn({}, "2 người, tổng 9 triệu");

  for (const message of [
    "lịch trình từng ngày, mỗi ngày 1 dòng nha",
    "tóm tắt từng ngày, xuống dòng giúp mình",
    "nói 2 dòng thôi",
  ]) {
    const state = applyTurn(initial, message);
    assert.equal(state.travelers, 2, `${message}: travelers`);
    assert.equal(state.totalBudget, 9_000_000, `${message}: budget`);
    assert.equal(state[SEMANTIC_STATE_KEY].slots.travelers.total, 2, `${message}: semantic travelers`);
    assert.equal(state[SEMANTIC_STATE_KEY].slots.budget.max, 9_000_000, `${message}: semantic budget`);
  }
});

test("TEST 11: impossible or internally inconsistent states are rejected explicitly", async (t) => {
  const invalidSlots = [
    ["non-positive travelers", { travelers: { status: "known", adults: 0, children: 0, total: 0 } }],
    ["reversed budget range", { budget: { status: "known", operator: "range", min: 5_000_000, max: 4_000_000 } }],
    ["invalid date", { date: { status: "known", start: "2026-02-30", end: "2026-02-30" } }],
    ["stale child ages", { travelers: { status: "known", adults: 2, children: 0, childAges: [5], total: 2 } }],
    ["incompatible traveler total", { travelers: { status: "known", adults: 2, children: 1, childAges: [5], total: 2 } }],
  ];

  for (const [name, slots] of invalidSlots) {
    await t.test(name, () => {
      assert.throws(
        () => validateSemanticStateV2(createSemanticStateV2({ slots })),
        SemanticStateValidationError
      );
    });
  }
  assert.throws(
    () => validateSemanticStateV2(createSemanticStateV2({ slots: { budget: { status: "known", operator: "max", max: 4_000_000, staleField: true } } })),
    /Unknown fields for budget/
  );
});

test("TEST 12: legacy state migrates explicitly and unsupported data is not persisted", () => {
  const legacy = {
    destination: "Đà Lạt",
    maxPrice: 4_000_000,
    days: 3,
    travelers: 2,
    obsoleteConstraint: "must-not-survive",
  };
  const migrated = migrateLegacyConstraintState(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.migration.source, "legacy_v1");
  assert.equal(migrated.migration.status, "unsupported");
  assert.deepEqual(migrated.migration.unsupportedFields, ["obsoleteConstraint"]);

  const projected = mergeConstraintState(legacy, {});
  assert.equal(projected.obsoleteConstraint, undefined);
  assert.equal(projected[SEMANTIC_STATE_KEY].version, 2);
  assert.throws(
    () => migrateLegacyConstraintState({ [SEMANTIC_STATE_KEY]: { version: 99, slots: {} } }),
    (error) => error.code === "UNSUPPORTED_SEMANTIC_STATE_VERSION"
  );
});

test("status model represents ambiguous, removed and relaxed independently", () => {
  const ambiguous = applyTurn({}, "bé 5 tuổi");
  assert.equal(ambiguous[SEMANTIC_STATE_KEY].slots.travelers.status, "ambiguous");
  assert.equal(ambiguous.travelers, undefined);

  const removed = applyTurn(applyTurn({}, "Đà Lạt"), "bỏ điểm đến Đà Lạt");
  assert.equal(removed[SEMANTIC_STATE_KEY].slots.destination.status, "removed");

  const relaxed = applyTurn(applyTurn({}, "tối đa 4 triệu"), "ngân sách cao hơn cũng được");
  assert.equal(relaxed[SEMANTIC_STATE_KEY].slots.budget.status, "relaxed");
  assert.equal(relaxed.maxPrice, undefined);
});

test("numeric operators and budget scopes have explicit semantic metadata", () => {
  const cases = [
    ["đúng 4 triệu", { operator: "exact", scope: "unspecified", target: 4_000_000 }],
    ["ít nhất 4 triệu", { operator: "min", scope: "unspecified", min: 4_000_000 }],
    ["không quá 4 triệu", { operator: "max", scope: "unspecified", max: 4_000_000 }],
    ["3-4 triệu", { operator: "range", scope: "unspecified", min: 3_000_000, max: 4_000_000 }],
    ["khoảng 4 triệu", { operator: "approximate", scope: "unspecified", target: 4_000_000 }],
    ["4 triệu mỗi người", { operator: "max", scope: "per_person", max: 4_000_000 }],
    ["4 triệu cho cả hai", { operator: "max", scope: "total", max: 4_000_000 }],
  ];
  for (const [message, expected] of cases) {
    const slot = semanticSlot(message, "budget");
    for (const [field, value] of Object.entries(expected)) assert.equal(slot[field], value, `${message}:${field}`);
  }

  const exactTotal = applyTurn({}, "đúng 4 triệu cho cả hai, đi 2 người");
  assert.equal(exactTotal[SEMANTIC_STATE_KEY].slots.budget.scope, "total");
  assert.equal(exactTotal.minPrice, 2_000_000);
  assert.equal(exactTotal.maxPrice, 2_000_000);
});

test("duration operators are distinct and weekend negation is exclusion-only", () => {
  const cases = [
    ["đúng 3 ngày", { status: "known", operator: "exact", targetDays: 3 }],
    ["ít nhất 3 ngày", { status: "known", operator: "min", minDays: 3 }],
    ["không quá 3 ngày", { status: "known", operator: "max", maxDays: 3 }],
    ["khoảng 3 ngày", { status: "known", operator: "approximate", targetDays: 3 }],
  ];
  for (const [message, expected] of cases) {
    const slot = semanticSlot(message, "duration");
    for (const [field, value] of Object.entries(expected)) assert.equal(slot[field], value, `${message}:${field}`);
  }

  const weekend = applyTurn({}, "không đi cuối tuần");
  assert.equal(weekend.dateRange, undefined);
  assert.deepEqual(weekend[SEMANTIC_STATE_KEY].slots.date.excludedPatterns, ["weekend"]);
});

test("duration removal clears exact, approximate, min and max operators without stale retrieval fields", () => {
  const cases = [
    ["muốn đi khoảng 3 ngày", "thôi thời gian không quan trọng nữa"],
    ["tối đa 3 ngày", "không cần giới hạn số ngày nữa"],
    ["ít nhất 3 ngày", "mấy ngày cũng được"],
    ["đi 3 ngày", "bỏ yêu cầu 3 ngày đi"],
  ];
  for (const [setMessage, removeMessage] of cases) {
    const previous = applyTurn({}, setMessage);
    const delta = extractConstraintDelta(removeMessage, previous, NOW);
    const state = mergeConstraintState(previous, delta);
    const effective = getEffectiveConstraintState(state);
    assert.ok(delta[CONSTRAINT_META_KEY].removedFields.includes("days"), removeMessage);
    assert.equal(delta[SEMANTIC_STATE_KEY].slots.duration.status, "removed", removeMessage);
    assert.equal(state[SEMANTIC_STATE_KEY].slots.duration.status, "removed", removeMessage);
    for (const field of ["days", "minDays", "maxDays", "approximateDays", "optionalDurationDays"]) {
      assert.equal(state[field], undefined, `${removeMessage}:${field}`);
      assert.equal(effective[field], undefined, `${removeMessage}:effective:${field}`);
    }
    assert.equal(tourMatchesConstraints(publishedTour(2), effective), true, removeMessage);
    assert.equal(tourMatchesConstraints(publishedTour(6), effective), true, removeMessage);
  }
});

test("duration removal variants preserve other constraints and survive later turns", () => {
  const variants = [
    "thời gian không quan trọng",
    "không quan trọng mấy ngày",
    "đi bao lâu cũng được",
    "duration không quan trọng nữa",
  ];
  for (const message of variants) {
    let state = applyTurn({}, "2 người, 8 triệu cho cả hai, khoảng 3 ngày, không muốn đi biển");
    state = applyTurn(state, message);
    assert.equal(state[SEMANTIC_STATE_KEY].slots.duration.status, "removed", message);
    assert.equal(state.days, undefined, message);
    assert.equal(state.travelers, 2, message);
    assert.equal(state.totalBudget, 8_000_000, message);
    assert.ok(state.exclusions.includes("biển"), message);
    state = applyTurn(state, "vẫn đi 2 người");
    assert.equal(state[SEMANTIC_STATE_KEY].slots.duration.status, "removed", `${message}:historical`);
    assert.equal(state.days, undefined, `${message}:historical`);
  }
});

test("HIGH-03: removing the time limit clears duration without matching concrete limits", () => {
  const removalCases = [
    "thôi bỏ giới hạn thời gian",
    "bỏ giới hạn thời gian đi",
    "thôi thời gian không quan trọng nữa",
    "bỏ giới hạn ngày đi",
    "thôi không giới hạn ngày đi nữa",
    "không cần giới hạn ngày đi",
  ];
  for (const message of removalCases) {
    const previous = applyTurn({}, "muốn đi khoảng 3 ngày");
    const delta = extractConstraintDelta(message, previous, NOW);
    const state = mergeConstraintState(previous, delta);
    assert.ok(delta[CONSTRAINT_META_KEY], `${message}:meta`);
    assert.ok(delta[CONSTRAINT_META_KEY].removedFields.includes("days"), message);
    assert.equal(delta[SEMANTIC_STATE_KEY].slots.duration.status, "removed", message);
    assert.equal(state[SEMANTIC_STATE_KEY].slots.duration.status, "removed", message);
    assert.equal(state.days, undefined, message);
    assert.equal(state.approximateDays, undefined, message);
    assert.equal(tourMatchesConstraints(publishedTour(2), state), true, message);
    assert.equal(tourMatchesConstraints(publishedTour(6), state), true, message);
  }

  for (const message of ["giới hạn thời gian khoảng 3 ngày", "thời gian tối đa 3 ngày"]) {
    const state = applyTurn({}, message);
    assert.equal(state[SEMANTIC_STATE_KEY].slots.duration.status, "known", message);
    assert.notEqual(state.days, undefined, message);
  }
});

test("numeric-day removal follows the active duration slot without creating a departure date", () => {
  for (const message of ["không cần 5 ngày nữa", "không cần đúng 5 ngày nữa"]) {
    const previous = applyTurn({}, "đi 5 ngày");
    const state = applyTurn(previous, message);

    assert.equal(state[SEMANTIC_STATE_KEY].slots.duration.status, "removed", message);
    assert.equal(state.days, undefined, message);
    assert.equal(state[SEMANTIC_STATE_KEY].slots.date.status, "unknown", message);
    assert.equal(state.dateRange, undefined, message);
  }
});

test("date-only removal remains separate from duration removal", () => {
  const previous = applyTurn({}, "5 ngày nữa");
  const delta = extractConstraintDelta("không cần đúng 5 ngày nữa", previous, NOW);
  const state = mergeConstraintState(previous, delta);
  assert.equal(state[SEMANTIC_STATE_KEY].slots.date.status, "removed");
  assert.equal(state[SEMANTIC_STATE_KEY].slots.duration.status, "unknown");
  assert.ok(delta[CONSTRAINT_META_KEY].removedFields.includes("dateRange"));
  assert.ok(!delta[CONSTRAINT_META_KEY].removedFields.includes("days"));

  let datedTrip = applyTurn({}, "cuối tuần này");
  datedTrip = applyTurn(datedTrip, "khoảng 3 ngày");
  const naturalDelta = extractConstraintDelta("thôi bỏ điều kiện ngày", datedTrip, NOW);
  const naturalState = mergeConstraintState(datedTrip, naturalDelta);
  assert.equal(naturalState[SEMANTIC_STATE_KEY].slots.date.status, "removed");
  assert.equal(naturalState[SEMANTIC_STATE_KEY].slots.duration.status, "known");
  assert.ok(naturalDelta[CONSTRAINT_META_KEY].removedFields.includes("dateRange"));
  assert.ok(!naturalDelta[CONSTRAINT_META_KEY].removedFields.includes("days"));
});

test("duration can be set again after removal and removal does not trigger on concrete duration statements", () => {
  let state = applyTurn({}, "3 ngày");
  state = applyTurn(state, "thời gian không quan trọng");
  state = applyTurn(state, "vậy tối đa 5 ngày");
  assert.deepEqual(
    { status: state[SEMANTIC_STATE_KEY].slots.duration.status, operator: state[SEMANTIC_STATE_KEY].slots.duration.operator, maxDays: state.maxDays },
    { status: "known", operator: "max", maxDays: 5 }
  );

  const nonRemovalCases = [
    "thời gian khoảng 3 ngày",
    "3 ngày cũng được",
    "tối đa 3 ngày",
    "ít nhất 3 ngày",
    "không quá 3 ngày",
    "không muốn đi 3 ngày",
    "3 ngày không đủ",
  ];
  for (const message of nonRemovalCases) {
    const previous = applyTurn({}, "tối đa 5 ngày");
    const delta = extractConstraintDelta(message, previous, NOW);
    const next = mergeConstraintState(previous, delta);
    assert.notEqual(next[SEMANTIC_STATE_KEY].slots.duration.status, "removed", message);
    assert.ok(!delta[CONSTRAINT_META_KEY]?.removedFields?.includes("days"), message);
  }
});

test("explicit duration removal suppresses saved duration preference ranking", () => {
  let state = applyTurn({}, "3 ngày");
  state = applyTurn(state, "thời gian không quan trọng");
  assert.equal(preferenceScore(publishedTour(3), { durationPreference: { targetDays: 3 } }, state), 0);
});

test("same-message destination correction keeps only the final destination", () => {
  const slot = semanticSlot("Đà Lạt, thôi Nha Trang", "destination");
  assert.deepEqual(slot.values, ["Nha Trang"]);
});

test("METAMORPHIC: equivalent wording produces equivalent semantic slots", async (t) => {
  const groups = [
    {
      name: "open destination punctuation, filler and no diacritics",
      slot: "destination",
      messages: ["không biết đi đâu", "Dạ, không biết nên đi đâu ạ!", "khong biet di dau"],
      pick: (value) => ({ status: value.status, values: value.values }),
    },
    {
      name: "traveler word order and numeric wording",
      slot: "travelers",
      messages: ["3 người đi", "cho ba người", "Dạ, đi 3 người ạ.", "3 ng đi"],
      pick: (value) => ({ status: value.status, adults: value.adults, children: value.children, total: value.total }),
    },
    {
      name: "minimum budget variants",
      slot: "budget",
      messages: ["ít nhất 4 triệu", "tối thiểu bốn triệu", "toi thieu 4tr"],
      pick: (value) => ({ status: value.status, operator: value.operator, min: value.min, scope: value.scope }),
    },
    {
      name: "budget range numeric variants",
      slot: "budget",
      messages: ["3-4 triệu", "3 đến 4 triệu", "ba đến bốn triệu"],
      pick: (value) => ({ status: value.status, operator: value.operator, min: value.min, max: value.max }),
    },
    {
      name: "duration abbreviation",
      slot: "duration",
      messages: ["3 ngày 2 đêm", "3N2Đ", "đúng ba ngày"],
      pick: (value) => ({ status: value.status, operator: value.operator, targetDays: value.targetDays }),
    },
  ];

  for (const group of groups) {
    await t.test(group.name, () => {
      const expected = group.pick(semanticSlot(group.messages[0], group.slot));
      for (const message of group.messages.slice(1)) {
        assert.deepEqual(group.pick(semanticSlot(message, group.slot)), expected, message);
      }
    });
  }
});
