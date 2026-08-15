const SEMANTIC_STATE_KEY = "_semanticState";
const SEMANTIC_STATE_VERSION = 2;

const SLOT_STATUSES = new Set([
  "unknown",
  "known",
  "intentionally_open",
  "removed",
  "relaxed",
  "ambiguous",
]);

const BUDGET_OPERATORS = new Set(["exact", "min", "max", "range", "approximate"]);
const DURATION_OPERATORS = new Set(["exact", "min", "max", "range", "approximate", "optional"]);
const BUDGET_SCOPES = new Set(["total", "per_person", "unspecified"]);

const CONTROLLED_FIELDS = new Set([
  "destination", "destinations", "origin", "exclusions",
  "budgetScope", "totalBudget", "minTotalBudget", "maxTotalBudget", "targetBudget",
  "minPrice", "maxPrice", "exactPrice", "approximatePrice",
  "days", "minDays", "maxDays", "approximateDays", "optionalDurationDays", "durationRequired",
  "travelers", "adults", "children", "childAges",
  "dateRange", "excludedDatePatterns", "interests",
]);

const PASSTHROUGH_FIELDS = new Set([
  "region",
  "pace",
  "accommodationRequired",
  "_constraintMeta",
]);

const LEGACY_ALLOWED_FIELDS = new Set([
  ...CONTROLLED_FIELDS,
  ...PASSTHROUGH_FIELDS,
  SEMANTIC_STATE_KEY,
]);

const SLOT_FIELDS = {
  destination: new Set(["status", "origin", "values", "excludedValues"]),
  budget: new Set(["status", "operator", "scope", "min", "max", "target"]),
  duration: new Set(["status", "operator", "minDays", "maxDays", "targetDays", "required"]),
  travelers: new Set(["status", "adults", "children", "childAges", "total", "removedComponents"]),
  date: new Set(["status", "start", "end", "label", "excludedPatterns"]),
  interests: new Set(["status", "values", "excludedValues"]),
};

class SemanticStateValidationError extends Error {
  constructor(message, code = "SEMANTIC_STATE_INVALID") {
    super(message);
    this.name = "SemanticStateValidationError";
    this.code = code;
    this.status = 400;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const raw of values || []) {
    const value = String(raw || "").trim();
    const key = value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function defaultSlots() {
  return {
    destination: {
      status: "unknown",
      origin: null,
      values: [],
      excludedValues: [],
    },
    budget: {
      status: "unknown",
      operator: null,
      scope: "unspecified",
      min: null,
      max: null,
      target: null,
    },
    duration: {
      status: "unknown",
      operator: null,
      minDays: null,
      maxDays: null,
      targetDays: null,
      required: null,
    },
    travelers: {
      status: "unknown",
      adults: null,
      children: null,
      childAges: [],
      total: null,
      removedComponents: [],
    },
    date: {
      status: "unknown",
      start: null,
      end: null,
      label: null,
      excludedPatterns: [],
    },
    interests: {
      status: "unknown",
      values: [],
      excludedValues: [],
    },
  };
}

function createSemanticStateV2(overrides = {}) {
  return {
    version: SEMANTIC_STATE_VERSION,
    slots: { ...defaultSlots(), ...(clone(overrides.slots) || {}) },
    lastSpans: clone(overrides.lastSpans) || [],
    migration: clone(overrides.migration) || { source: "native_v2", status: "native", unsupportedFields: [] },
  };
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeSlot(slotName, rawSlot = {}) {
  const base = defaultSlots()[slotName];
  if (!base) throw new SemanticStateValidationError(`Unknown semantic slot: ${slotName}`);
  const unknownFields = Object.keys(rawSlot || {}).filter((field) => !SLOT_FIELDS[slotName].has(field));
  if (unknownFields.length) {
    throw new SemanticStateValidationError(`Unknown fields for ${slotName}: ${unknownFields.join(", ")}`);
  }
  const slot = { ...base, ...clone(rawSlot) };
  if (!SLOT_STATUSES.has(slot.status)) {
    throw new SemanticStateValidationError(`Invalid status for ${slotName}: ${slot.status}`);
  }

  if (slotName === "destination") {
    slot.origin = slot.origin ? String(slot.origin).trim() : null;
    slot.values = uniqueStrings(slot.values);
    slot.excludedValues = uniqueStrings(slot.excludedValues);
    if (["intentionally_open", "removed", "unknown"].includes(slot.status) && slot.values.length) {
      throw new SemanticStateValidationError(`${slot.status} destination cannot contain positive values`);
    }
  }

  if (slotName === "budget") {
    slot.scope = BUDGET_SCOPES.has(slot.scope) ? slot.scope : "unspecified";
    slot.min = numberOrNull(slot.min);
    slot.max = numberOrNull(slot.max);
    slot.target = numberOrNull(slot.target);
    if (slot.operator !== null && !BUDGET_OPERATORS.has(slot.operator)) {
      throw new SemanticStateValidationError(`Invalid budget operator: ${slot.operator}`);
    }
    for (const value of [slot.min, slot.max, slot.target]) {
      if (value !== null && value <= 0) throw new SemanticStateValidationError("Budget values must be greater than zero");
    }
    if (slot.min !== null && slot.max !== null && slot.min > slot.max) {
      throw new SemanticStateValidationError("Budget min cannot exceed max");
    }
    if (slot.status === "known" && !slot.operator) {
      throw new SemanticStateValidationError("Known budget requires an operator");
    }
    if (slot.status === "known") {
      if (["exact", "approximate"].includes(slot.operator) && slot.target === null) {
        throw new SemanticStateValidationError(`${slot.operator} budget requires a target`);
      }
      if (slot.operator === "min" && slot.min === null) {
        throw new SemanticStateValidationError("Minimum budget requires min");
      }
      if (slot.operator === "max" && slot.max === null) {
        throw new SemanticStateValidationError("Maximum budget requires max");
      }
      if (slot.operator === "range" && (slot.min === null || slot.max === null)) {
        throw new SemanticStateValidationError("Budget range requires min and max");
      }
      if (["exact", "approximate"].includes(slot.operator) && (slot.min !== null || slot.max !== null)) {
        throw new SemanticStateValidationError(`${slot.operator} budget cannot also contain min/max`);
      }
      if (slot.operator === "min" && (slot.max !== null || slot.target !== null)) {
        throw new SemanticStateValidationError("Minimum budget contains incompatible fields");
      }
      if (slot.operator === "max" && (slot.min !== null || slot.target !== null)) {
        throw new SemanticStateValidationError("Maximum budget contains incompatible fields");
      }
      if (slot.operator === "range" && slot.target !== null) {
        throw new SemanticStateValidationError("Budget range cannot also contain target");
      }
    }
  }

  if (slotName === "duration") {
    slot.minDays = integerOrNull(slot.minDays);
    slot.maxDays = integerOrNull(slot.maxDays);
    slot.targetDays = integerOrNull(slot.targetDays);
    slot.required = slot.required === null ? null : Boolean(slot.required);
    if (slot.operator !== null && !DURATION_OPERATORS.has(slot.operator)) {
      throw new SemanticStateValidationError(`Invalid duration operator: ${slot.operator}`);
    }
    for (const value of [slot.minDays, slot.maxDays, slot.targetDays]) {
      if (value !== null && (value < 1 || value > 60)) {
        throw new SemanticStateValidationError("Duration must be between 1 and 60 days");
      }
    }
    if (slot.minDays !== null && slot.maxDays !== null && slot.minDays > slot.maxDays) {
      throw new SemanticStateValidationError("Duration min cannot exceed max");
    }
    if (slot.status === "known" && !slot.operator) {
      throw new SemanticStateValidationError("Known duration requires an operator");
    }
    if (slot.status === "known") {
      if (["exact", "approximate"].includes(slot.operator) && slot.targetDays === null) {
        throw new SemanticStateValidationError(`${slot.operator} duration requires a target`);
      }
      if (slot.operator === "min" && slot.minDays === null) {
        throw new SemanticStateValidationError("Minimum duration requires minDays");
      }
      if (slot.operator === "max" && slot.maxDays === null) {
        throw new SemanticStateValidationError("Maximum duration requires maxDays");
      }
      if (slot.operator === "range" && (slot.minDays === null || slot.maxDays === null)) {
        throw new SemanticStateValidationError("Duration range requires minDays and maxDays");
      }
      if (["exact", "approximate"].includes(slot.operator) && (slot.minDays !== null || slot.maxDays !== null)) {
        throw new SemanticStateValidationError(`${slot.operator} duration cannot also contain min/max`);
      }
      if (slot.operator === "min" && (slot.maxDays !== null || slot.targetDays !== null)) {
        throw new SemanticStateValidationError("Minimum duration contains incompatible fields");
      }
      if (slot.operator === "max" && (slot.minDays !== null || slot.targetDays !== null)) {
        throw new SemanticStateValidationError("Maximum duration contains incompatible fields");
      }
      if (slot.operator === "range" && slot.targetDays !== null) {
        throw new SemanticStateValidationError("Duration range cannot also contain targetDays");
      }
    }
  }

  if (slotName === "travelers") {
    slot.adults = integerOrNull(slot.adults);
    slot.children = integerOrNull(slot.children);
    slot.total = integerOrNull(slot.total);
    slot.childAges = (slot.childAges || []).map(integerOrNull);
    slot.removedComponents = uniqueStrings(slot.removedComponents);
    for (const value of [slot.adults, slot.children]) {
      if (value !== null && value < 0) throw new SemanticStateValidationError("Traveler components cannot be negative");
    }
    if (slot.total !== null && slot.total <= 0) {
      throw new SemanticStateValidationError("Total travelers must be greater than zero");
    }
    if (slot.childAges.some((age) => age === null || age < 0 || age > 17)) {
      throw new SemanticStateValidationError("Child ages must be integers from 0 to 17");
    }
    if (slot.children === 0 && slot.childAges.length) {
      throw new SemanticStateValidationError("Child ages must be empty when children is zero");
    }
    if (slot.children !== null && slot.childAges.length > slot.children) {
      throw new SemanticStateValidationError("Child ages cannot outnumber children");
    }
    if (slot.adults !== null && slot.children !== null) {
      const derivedTotal = slot.adults + slot.children;
      if (derivedTotal <= 0 && slot.status === "known") {
        throw new SemanticStateValidationError("Known traveler composition cannot be empty");
      }
      if (slot.total === null) slot.total = derivedTotal;
      else if (slot.total !== derivedTotal) {
        throw new SemanticStateValidationError("Traveler total is incompatible with adults and children");
      }
    }
  }

  if (slotName === "date") {
    slot.start = slot.start || null;
    slot.end = slot.end || slot.start || null;
    slot.label = slot.label ? String(slot.label) : null;
    slot.excludedPatterns = uniqueStrings(slot.excludedPatterns);
    if (slot.start && !validIsoDate(slot.start)) throw new SemanticStateValidationError("Invalid date start");
    if (slot.end && !validIsoDate(slot.end)) throw new SemanticStateValidationError("Invalid date end");
    if (slot.start && slot.end && slot.start > slot.end) {
      throw new SemanticStateValidationError("Date start cannot be after end");
    }
  }

  if (slotName === "interests") {
    slot.values = uniqueStrings(slot.values);
    slot.excludedValues = uniqueStrings(slot.excludedValues);
    if (["unknown", "removed"].includes(slot.status) && slot.values.length) {
      throw new SemanticStateValidationError(`${slot.status} interests cannot contain positive values`);
    }
  }
  return slot;
}

function validateSemanticStateV2(value) {
  if (!value || typeof value !== "object") {
    throw new SemanticStateValidationError("Semantic state must be an object");
  }
  if (Number(value.version) !== SEMANTIC_STATE_VERSION) {
    throw new SemanticStateValidationError(
      `Unsupported semantic state version: ${value.version}`,
      "UNSUPPORTED_SEMANTIC_STATE_VERSION"
    );
  }
  const slots = defaultSlots();
  const unknownSlots = Object.keys(value.slots || {}).filter((slotName) => !Object.prototype.hasOwnProperty.call(slots, slotName));
  if (unknownSlots.length) {
    throw new SemanticStateValidationError(`Unknown semantic slots: ${unknownSlots.join(", ")}`);
  }
  for (const slotName of Object.keys(slots)) {
    slots[slotName] = normalizeSlot(slotName, value.slots?.[slotName] || slots[slotName]);
  }
  const result = {
    version: SEMANTIC_STATE_VERSION,
    slots,
    lastSpans: (value.lastSpans || []).map((span) => ({
      owner: String(span.owner || "unknown"),
      start: Number(span.start),
      end: Number(span.end),
      text: String(span.text || ""),
    })).filter((span) => Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start),
    migration: {
      source: String(value.migration?.source || "native_v2"),
      status: String(value.migration?.status || "native"),
      unsupportedFields: uniqueStrings(value.migration?.unsupportedFields || []),
    },
  };
  return result;
}

function migrateLegacyConstraintState(state = {}) {
  if (state?.[SEMANTIC_STATE_KEY]) return validateSemanticStateV2(state[SEMANTIC_STATE_KEY]);
  const slots = defaultSlots();
  const unsupportedFields = Object.keys(state || {}).filter((field) => !LEGACY_ALLOWED_FIELDS.has(field));

  const destinations = uniqueStrings([...(state.destinations || []), state.destination]);
  const destinationExclusions = uniqueStrings((state.exclusions || []).filter((value) =>
    ["phu quoc", "nha trang", "da nang", "da lat", "ha long", "sa pa", "sapa", "hoi an", "hue", "quang binh", "ninh binh", "binh hung", "mien tay"]
      .includes(String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d"))
  ));
  slots.destination = normalizeSlot("destination", {
    status: destinations.length ? "known" : "unknown",
    origin: state.origin || null,
    values: destinations,
    excludedValues: destinationExclusions,
  });

  const minTotal = numberOrNull(state.minTotalBudget);
  const maxTotal = numberOrNull(state.maxTotalBudget);
  const min = numberOrNull(state.minPrice);
  const max = numberOrNull(state.maxPrice);
  const exact = numberOrNull(state.exactPrice);
  const approximate = numberOrNull(state.approximatePrice);
  const total = numberOrNull(state.totalBudget);
  const target = numberOrNull(state.targetBudget);
  if ([minTotal, maxTotal, min, max, exact, approximate, total, target].some((value) => value !== null)) {
    let operator = "max";
    let semanticMin = min;
    let semanticMax = max;
    let semanticTarget = exact;
    const scope = [minTotal, maxTotal, total, target].some((value) => value !== null)
      ? "total"
      : (state.budgetScope || "unspecified");
    if (scope === "total") {
      semanticMin = minTotal;
      semanticMax = maxTotal ?? total;
      semanticTarget = target;
    }
    if (approximate !== null) {
      operator = "approximate";
      semanticTarget = approximate;
      semanticMin = null;
      semanticMax = null;
    } else if (exact !== null || (semanticTarget !== null && semanticMin === null && (semanticMax === null || semanticMax === semanticTarget)) || (semanticMin !== null && semanticMax !== null && semanticMin === semanticMax)) {
      operator = "exact";
      semanticTarget = exact ?? semanticTarget ?? semanticMin;
      semanticMin = null;
      semanticMax = null;
    } else if (semanticMin !== null && semanticMax !== null) operator = "range";
    else if (semanticMin !== null) operator = "min";
    slots.budget = normalizeSlot("budget", {
      status: "known",
      operator,
      scope,
      min: semanticMin,
      max: semanticMax,
      target: semanticTarget,
    });
  } else if (BUDGET_SCOPES.has(state.budgetScope)) {
    slots.budget = normalizeSlot("budget", {
      status: "ambiguous",
      operator: null,
      scope: state.budgetScope,
      min: null,
      max: null,
      target: null,
    });
  }

  const days = integerOrNull(state.days);
  const minDays = integerOrNull(state.minDays);
  const maxDays = integerOrNull(state.maxDays);
  const approximateDays = integerOrNull(state.approximateDays);
  const optionalDurationDays = integerOrNull(state.optionalDurationDays);
  if ([days, minDays, maxDays, approximateDays, optionalDurationDays].some((value) => value !== null) || state.durationRequired === false) {
    const optional = state.durationRequired === false || optionalDurationDays !== null;
    const operator = optional
      ? "optional"
      : approximateDays !== null
        ? "approximate"
        : minDays !== null && maxDays !== null
          ? "range"
          : minDays !== null
            ? "min"
            : maxDays !== null
              ? "max"
              : "exact";
    slots.duration = normalizeSlot("duration", {
      status: optional ? "relaxed" : "known",
      operator,
      minDays,
      maxDays,
      targetDays: optionalDurationDays ?? approximateDays ?? (operator === "exact" ? days : null),
      required: !optional,
    });
  }

  const travelers = integerOrNull(state.travelers);
  const adults = integerOrNull(state.adults);
  const children = integerOrNull(state.children);
  const childAges = Array.isArray(state.childAges) ? state.childAges : [];
  if (travelers !== null || adults !== null || children !== null || childAges.length) {
    const inferredChildren = children !== null ? children : childAges.length || 0;
    const ambiguousLegacy = travelers !== null && adults === null && childAges.length > 0;
    slots.travelers = normalizeSlot("travelers", {
      status: ambiguousLegacy ? "ambiguous" : "known",
      adults: adults !== null ? adults : (ambiguousLegacy ? null : travelers),
      children: inferredChildren,
      childAges,
      total: travelers !== null ? travelers : (adults !== null ? adults + inferredChildren : null),
    });
  }

  if (state.dateRange?.start || state.excludedDatePatterns?.length) {
    slots.date = normalizeSlot("date", {
      status: "known",
      start: state.dateRange?.start || null,
      end: state.dateRange?.end || state.dateRange?.start || null,
      label: state.dateRange?.label || null,
      excludedPatterns: state.excludedDatePatterns || [],
    });
  }

  const interestExclusions = uniqueStrings((state.exclusions || []).filter((value) => !destinationExclusions.includes(value)));
  slots.interests = normalizeSlot("interests", {
    status: state.interests?.length ? "known" : (interestExclusions.length ? "removed" : "unknown"),
    values: state.interests || [],
    excludedValues: interestExclusions,
  });

  return validateSemanticStateV2(createSemanticStateV2({
    slots,
    migration: {
      source: "legacy_v1",
      status: unsupportedFields.length ? "unsupported" : "migrated",
      unsupportedFields,
    },
  }));
}

function mergeSemanticState(previousState = {}, semanticDelta = null) {
  const previousKeys = Object.keys(previousState || {}).filter((field) => field !== "_constraintMeta");
  const previousWasEmpty = !previousState?.[SEMANTIC_STATE_KEY] && previousKeys.length === 0;
  const previous = previousWasEmpty
    ? createSemanticStateV2()
    : migrateLegacyConstraintState(previousState);
  if (!semanticDelta) return previous;
  const delta = semanticDelta.version === SEMANTIC_STATE_VERSION
    ? semanticDelta
    : semanticDelta[SEMANTIC_STATE_KEY];
  if (!delta) return previous;
  if (Number(delta.version) !== SEMANTIC_STATE_VERSION) {
    throw new SemanticStateValidationError(
      `Unsupported semantic delta version: ${delta.version}`,
      "UNSUPPORTED_SEMANTIC_STATE_VERSION"
    );
  }
  const next = clone(previous);
  for (const [slotName, slot] of Object.entries(delta.slots || {})) {
    next.slots[slotName] = normalizeSlot(slotName, slot);
  }
  next.lastSpans = clone(delta.lastSpans) || [];
  if (previousWasEmpty && delta.migration) next.migration = clone(delta.migration);
  return validateSemanticStateV2(next);
}

function projectSemanticState(baseState = {}, semanticState) {
  const semantic = validateSemanticStateV2(semanticState);
  const result = {};
  for (const [field, value] of Object.entries(baseState || {})) {
    if (PASSTHROUGH_FIELDS.has(field) && value !== undefined && value !== null && value !== "") result[field] = clone(value);
  }

  const destination = semantic.slots.destination;
  if (destination.status === "known" && destination.values.length) {
    result.destination = destination.values[0];
    if (destination.values.length > 1) result.destinations = destination.values;
  }
  if (destination.origin) result.origin = destination.origin;

  const budget = semantic.slots.budget;
  if (budget.status === "known") {
    result.budgetScope = budget.scope;
    if (budget.scope === "total") {
      if (budget.min !== null) result.minTotalBudget = budget.min;
      if (budget.max !== null) result.maxTotalBudget = budget.max;
      if (budget.target !== null) {
        result.totalBudget = budget.target;
        result.targetBudget = budget.target;
      } else if (budget.operator === "max" && budget.max !== null) {
        result.totalBudget = budget.max;
      }
    } else if (budget.operator === "exact" && budget.target !== null) {
      result.minPrice = budget.target;
      result.maxPrice = budget.target;
      result.exactPrice = budget.target;
    } else if (budget.operator === "min") {
      result.minPrice = budget.min;
    } else if (budget.operator === "max") {
      result.maxPrice = budget.max;
    } else if (budget.operator === "range") {
      result.minPrice = budget.min;
      result.maxPrice = budget.max;
    } else if (budget.operator === "approximate" && budget.target !== null) {
      result.approximatePrice = budget.target;
      result.minPrice = Math.max(1, Math.floor(budget.target * 0.8));
      result.maxPrice = Math.ceil(budget.target * 1.2);
    }
  }

  const duration = semantic.slots.duration;
  if (duration.status === "known") {
    result.durationRequired = duration.required !== false;
    if (duration.operator === "exact") result.days = duration.targetDays;
    else if (duration.operator === "min") result.minDays = duration.minDays;
    else if (duration.operator === "max") {
      result.days = duration.maxDays;
      result.maxDays = duration.maxDays;
    }
    else if (duration.operator === "range") {
      result.minDays = duration.minDays;
      result.maxDays = duration.maxDays;
    } else if (duration.operator === "approximate") {
      result.days = duration.targetDays;
      result.approximateDays = duration.targetDays;
      result.minDays = Math.max(1, duration.targetDays - 1);
      result.maxDays = duration.targetDays + 1;
    }
  } else if (duration.status === "relaxed") {
    result.durationRequired = false;
    if (duration.targetDays !== null) result.optionalDurationDays = duration.targetDays;
  }

  const travelers = semantic.slots.travelers;
  if (["known", "ambiguous"].includes(travelers.status)) {
    if (travelers.status === "known" && travelers.total !== null) result.travelers = travelers.total;
    if (travelers.adults !== null) result.adults = travelers.adults;
    if (travelers.children !== null) result.children = travelers.children;
    result.childAges = travelers.childAges;
  }

  const date = semantic.slots.date;
  if (date.status === "known" && date.start) {
    result.dateRange = { start: date.start, end: date.end || date.start, label: date.label || date.start };
  }
  if (date.excludedPatterns.length) result.excludedDatePatterns = date.excludedPatterns;

  const interests = semantic.slots.interests;
  result.interests = interests.status === "known" ? interests.values : [];
  result.exclusions = uniqueStrings([
    ...destination.excludedValues,
    ...interests.excludedValues,
  ]);

  const partySize = result.travelers;
  if (budget.status === "known" && budget.scope === "total" && Number(partySize) > 0) {
    if (budget.min !== null) result.minPrice = Math.ceil(budget.min / partySize);
    if (budget.max !== null) result.maxPrice = Math.floor(budget.max / partySize);
    if (budget.target !== null) {
      const perPersonTarget = Math.floor(budget.target / partySize);
      if (budget.operator === "exact") {
        result.exactPrice = perPersonTarget;
        result.minPrice = perPersonTarget;
        result.maxPrice = perPersonTarget;
      } else if (budget.operator === "approximate") {
        result.approximatePrice = perPersonTarget;
        result.minPrice = Math.max(1, Math.floor(perPersonTarget * 0.8));
        result.maxPrice = Math.ceil(perPersonTarget * 1.2);
      }
    }
  }

  result[SEMANTIC_STATE_KEY] = semantic;
  return result;
}

function createSpanRegistry(text) {
  const claims = [];
  return {
    claim(owner, start, end, metadata = {}) {
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return false;
      if (claims.some((span) => start < span.end && end > span.start)) return false;
      claims.push({ owner, start, end, text: text.slice(start, end), ...metadata });
      return true;
    },
    overlaps(start, end) {
      return claims.some((span) => start < span.end && end > span.start);
    },
    mask() {
      const chars = [...text];
      for (const span of claims) {
        for (let index = span.start; index < span.end; index += 1) chars[index] = " ";
      }
      return chars.join("");
    },
    list() {
      return claims.slice().sort((left, right) => left.start - right.start);
    },
  };
}

module.exports = {
  SEMANTIC_STATE_KEY,
  SEMANTIC_STATE_VERSION,
  SLOT_STATUSES,
  SemanticStateValidationError,
  createSemanticStateV2,
  validateSemanticStateV2,
  migrateLegacyConstraintState,
  mergeSemanticState,
  projectSemanticState,
  createSpanRegistry,
};
