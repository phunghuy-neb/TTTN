const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SEMANTIC_STATE_KEY,
  extractConstraintDelta,
  mergeConstraintState,
  migrateLegacyConstraintState,
  validateSemanticStateV2,
} = require("../src/services/travelAdvisorService");
const {
  SemanticStateValidationError,
  createSemanticStateV2,
} = require("../src/services/semanticStateV2");
const { tourMatchesConstraints } = require("../src/services/ragService");

const NOW = new Date("2026-08-13T05:00:00.000Z");

function applyTurn(previous, message) {
  return mergeConstraintState(previous, extractConstraintDelta(message, previous, NOW));
}

function semanticSlot(message, slotName, previous = {}) {
  return applyTurn(previous, message)[SEMANTIC_STATE_KEY].slots[slotName];
}

function publishedTour(days) {
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
  };
}

test("TEST 1: intentionally-open destination is distinct from missing", () => {
  const state = applyTurn({}, "không biết đi đâu");
  assert.equal(state.destination, undefined);
  assert.equal(state[SEMANTIC_STATE_KEY].slots.destination.status, "intentionally_open");
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
      messages: ["3 người đi", "cho ba người", "Dạ, đi 3 người ạ."],
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
