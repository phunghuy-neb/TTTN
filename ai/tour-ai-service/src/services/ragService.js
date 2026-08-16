const Tour = require("../models/Tour");
const { getTourCollection } = require("../config/chroma");
const { embedText } = require("../config/gemini");
const { extractIntent } = require("./intentService");
const {
  semanticInterestMatch,
  interestHints,
  tourEvidenceText,
  collectTourConstraintEvidence,
} = require("./retrievalEvidenceService");
const {
  normalizeText,
  uniqueIds,
  constraintMode,
  getEffectiveConstraintState,
  SEMANTIC_STATE_KEY,
} = require("./travelAdvisorService");
const {
  buildTourFactualContext,
  buildGroundingContract,
  groundingForTour,
  budgetMatchEvidence,
  priceMeetsConstraints,
  effectivePartySize,
} = require("./factualGroundingService");

const TOP_K = 30;
const MONGO_RECALL_LIMIT = Math.max(100, Number(process.env.RAG_MONGO_RECALL_LIMIT) || 500);

function matchesPreferenceTerm(haystack, value) {
  return semanticInterestMatch(haystack, value);
}

function dedupeTourIdsInOrder(chromaResult) {
  const metadata = chromaResult?.metadatas?.[0] || [];
  return uniqueIds(metadata.map((item) => item?.tourId));
}

function isPublishedActive(tour) {
  return tour?.status === "published" && tour?.isActive !== false;
}

function tourSearchText(tour) {
  return tourEvidenceText(tour);
}

function factualFitEvidence(tour, constraints = {}, evidence = collectTourConstraintEvidence(tour, constraints), grounding = null) {
  const factual = grounding || buildTourFactualContext(tour, constraints);
  const values = [];
  if (evidence.destination.some((item) => item.matched)) values.push("destination");
  if (constraints.region && normalizeText(tour.region) === normalizeText(constraints.region)) values.push("region");
  if (tourMatchesDuration(tour, constraints) && (constraints.days || currentDurationSlot(constraints))) values.push("duration");
  const semanticBudget = constraints?.[SEMANTIC_STATE_KEY]?.slots?.budget;
  if ((semanticBudget?.status === "known" || constraints.minPrice != null || constraints.maxPrice != null) && priceMeetsConstraints(factual.priceBasis.amount, constraints)) values.push("budget");
  if (constraints.dateRange?.start && factual.availability?.availableForParty) values.push("date_and_party_availability");
  for (const item of evidence.interests.filter((entry) => entry.matched)) values.push(`interest:${normalizeText(item.value)}`);
  return [...new Set(values)];
}

function currentDurationSlot(constraints = {}) {
  const slot = constraints?.[SEMANTIC_STATE_KEY]?.slots?.duration;
  return slot?.status === "known" ? slot : null;
}

function currentBudgetSlot(constraints = {}) {
  const slot = constraints?.[SEMANTIC_STATE_KEY]?.slots?.budget;
  return slot?.status === "known" ? slot : null;
}

function budgetIsHardConstraint(constraints = {}) {
  const slot = currentBudgetSlot(constraints);
  if (slot) return slot.operator !== "approximate";
  return constraints.minPrice != null || constraints.maxPrice != null ||
    constraints.totalBudget != null || constraints.exactPrice != null;
}

function currentFieldWeight(constraints = {}, field) {
  return constraints?._constraintMeta?.currentFields?.includes(field) ? 3 : 1;
}

function approximateBudgetScore(price, constraints = {}) {
  const amount = Number(price);
  const slot = currentBudgetSlot(constraints);
  const target = Number(slot?.target);
  if (slot?.operator !== "approximate" || !Number.isFinite(amount) || !Number.isFinite(target) || target <= 0) {
    return null;
  }
  const partySize = effectivePartySize(constraints);
  const scopes = slot.scope === "unspecified" ? ["total", "per_person"] : [slot.scope];
  const deviation = Math.min(...scopes.map((scope) => {
    const interpreted = scope === "total" ? amount * partySize : amount;
    return Math.abs(interpreted - target) / target;
  }));
  // Approximate budgets are ranking goals, not silent hard cut-offs.
  return Math.max(-8, 5 - deviation * 20);
}

function tourMatchesDuration(tour, constraints = {}) {
  const slot = currentDurationSlot(constraints);
  const days = Number(tour.days);
  if (!slot) {
    return !Number.isFinite(Number(constraints.days)) || days === Number(constraints.days);
  }
  if (slot.operator === "exact") return days === slot.targetDays;
  if (slot.operator === "min") return days >= slot.minDays;
  if (slot.operator === "max") return days <= slot.maxDays;
  if (slot.operator === "range") return days >= slot.minDays && days <= slot.maxDays;
  if (slot.operator === "approximate") return Math.abs(days - slot.targetDays) <= 1;
  return true;
}

function durationMatchScore(tour, constraints = {}) {
  const slot = currentDurationSlot(constraints);
  if (!slot) return constraints.days && Number(tour.days) === Number(constraints.days) ? 7 : 0;
  if (!tourMatchesDuration(tour, constraints)) return 0;
  if (slot.operator === "exact") return 7;
  if (slot.operator === "approximate") return Math.max(3, 7 - Math.abs(Number(tour.days) - Number(slot.targetDays)) * 3);
  return 5;
}

function applyDurationQuery(query, constraints = {}) {
  const slot = currentDurationSlot(constraints);
  if (!slot) {
    if (Number.isFinite(Number(constraints.days))) query.days = Number(constraints.days);
    return;
  }
  if (slot.operator === "exact") query.days = slot.targetDays;
  else if (slot.operator === "min") query.days = { $gte: slot.minDays };
  else if (slot.operator === "max") query.days = { $lte: slot.maxDays };
  else if (slot.operator === "range") query.days = { $gte: slot.minDays, $lte: slot.maxDays };
  else if (slot.operator === "approximate") query.days = { $gte: Math.max(1, slot.targetDays - 1), $lte: slot.targetDays + 1 };
}

function tourMatchesConstraints(tour, constraints = {}, options = {}) {
  if (!isPublishedActive(tour)) return false;
  const requestType = options.requestType || "recommendation";
  if (["comparison", "tour_detail", "availability"].includes(requestType)) return true;

  const evidence = options.evidence || collectTourConstraintEvidence(tour, constraints);
  const grounding = options.grounding || buildTourFactualContext(tour, constraints, { now: options.now });
  if (constraints.region && normalizeText(tour.region) !== normalizeText(constraints.region)) return false;
  if (evidence.destination.length && !evidence.destination.some((item) => item.matched)) return false;
  if (evidence.exclusions.some((item) => item.matched)) return false;
  if (!constraints.dateRange?.start && budgetIsHardConstraint(constraints) && !priceMeetsConstraints(grounding.priceBasis.amount, constraints)) return false;
  if (!tourMatchesDuration(tour, constraints)) return false;

  if (constraints.interests?.length && constraintMode(constraints, "interests", "hard") === "hard") {
    if (!evidence.interests.some((item) => item.matched)) return false;
  }

  if (constraints.dateRange?.start) {
    const hardValidDepartures = grounding.departures.filter((departure) =>
      departure.availableForParty && (!budgetIsHardConstraint(constraints) || priceMeetsConstraints(departure.price, constraints))
    );
    if (!hardValidDepartures.length) return false;
  }
  return true;
}

function scoreTour(tour, constraints = {}, candidateOrder = new Map(), evidence = collectTourConstraintEvidence(tour, constraints), grounding = null) {
  const factual = grounding || buildTourFactualContext(tour, constraints);
  let score = 0;
  if (evidence.destination.some((item) => item.matched)) score += 12;
  if (constraints.region && normalizeText(tour.region) === normalizeText(constraints.region)) score += 7;
  const durationSlot = currentDurationSlot(constraints);
  const durationWeight = durationSlot?.operator === "approximate"
    ? currentFieldWeight(constraints, "days")
    : 1;
  score += durationMatchScore(tour, constraints) * durationWeight;
  const budgetEvidence = budgetMatchEvidence(factual.priceBasis.amount, constraints);
  const semanticBudget = constraints?.[SEMANTIC_STATE_KEY]?.slots?.budget;
  const approximateScore = approximateBudgetScore(factual.priceBasis.amount, constraints);
  if (approximateScore !== null) {
    score += approximateScore * currentFieldWeight(constraints, "budget");
  } else if (budgetEvidence.matched && semanticBudget?.status === "known") score += 5;
  else if (constraints.maxPrice && factual.priceBasis.amount !== null && factual.priceBasis.amount <= Number(constraints.maxPrice)) {
    score += 5 + Math.min(1, Math.max(0, (Number(constraints.maxPrice) - factual.priceBasis.amount) / Number(constraints.maxPrice)));
  } else if (budgetEvidence.matched && constraints.minPrice != null) score += 5;
  if (constraints.dateRange && factual.availability?.availableForParty) score += 8;
  score += evidence.interests.filter((item) => item.matched).length * 10;
  const chromaOrder = candidateOrder.get(String(tour._id));
  if (chromaOrder !== undefined) score += Math.max(0, 1 - chromaOrder / 100);
  score += Number(tour.avgRating || 0) / 10;
  return score;
}

function preferenceScore(tour, preferences = {}, constraints = {}, grounding = null) {
  const factual = grounding || buildTourFactualContext(tour, constraints);
  const price = factual.priceBasis.amount;
  let score = 0;
  const haystack = tourSearchText(tour);
  const primaryHaystack = tourEvidenceText(tour, { destinationOnly: true });
  const currentAreas = new Set([
    constraints.destination,
    constraints.region,
    ...(constraints.interests || []),
  ].filter(Boolean).map(normalizeText));
  const currentExclusions = new Set((constraints.exclusions || []).map(normalizeText));
  const allowed = (values = []) => (values || []).filter((value) => !currentExclusions.has(normalizeText(value)));
  const matches = (values = [], source = haystack) => allowed(values).filter((value) => matchesPreferenceTerm(source, value));
  const unmatchedByCurrent = (values = [], source = haystack) => matches(values, source)
    .filter((value) => !currentAreas.has(normalizeText(value)));

  const hasCurrentArea = currentAreas.size > 0;
  const hasCurrentStyle = Boolean(constraints.pace || (constraints.interests || []).some((value) => ["nghi duong", "kham pha", "mao hiem"].includes(normalizeText(value))));
  if (!hasCurrentArea) score += unmatchedByCurrent(preferences.preferredDestinations || [], primaryHaystack).length * 4;
  if (!hasCurrentArea && (preferences.preferredRegions || []).some((value) => normalizeText(value) === normalizeText(tour.region))) score += 3;
  if (!hasCurrentStyle) score += unmatchedByCurrent(preferences.travelStyles || []).length * 3;
  if (!hasCurrentArea) score += unmatchedByCurrent(preferences.interests || []).length * 3;
  if (!hasCurrentStyle) score += (preferences.travelStyles || []).filter((value) => matchesPreferenceTerm(primaryHaystack, value)).length;
  if (!hasCurrentArea) score += allowed(preferences.interests || []).filter((value) => matchesPreferenceTerm(primaryHaystack, value)).length;
  if (constraints.accommodationRequired !== false) score += unmatchedByCurrent(preferences.accommodationPreferences || []).length * 2;

  if (!hasCurrentArea && matches(preferences.dislikedDestinations || []).length) score -= 5;
  if (!hasCurrentArea && (preferences.dislikedRegions || []).some((value) => normalizeText(value) === normalizeText(tour.region))) score -= 4;
  if (!hasCurrentStyle) score -= unmatchedByCurrent(preferences.dislikedTravelStyles || []).length * 3;
  if (!hasCurrentArea) score -= matches(preferences.dislikedInterests || []).length * 3;
  score -= matches(preferences.dislikedAccommodationPreferences || []).length * 2;

  const budget = preferences.budgetPreference || {};
  if (!constraints.maxPrice && !constraints.minPrice) {
    if (price !== null && budget.min && budget.max && price >= budget.min && price <= budget.max) score += 3;
    else if (price !== null && budget.max && price <= budget.max) score += 2;
    else if (price !== null && budget.target && Math.abs(price - budget.target) <= Math.max(500000, budget.target * 0.2)) score += 2;
  }
  const duration = preferences.durationPreference || {};
  const durationStatus = constraints?.[SEMANTIC_STATE_KEY]?.slots?.duration?.status;
  if (!constraints.days && durationStatus !== "removed") {
    if (duration.minDays && duration.maxDays && tour.days >= duration.minDays && tour.days <= duration.maxDays) score += 3;
    else if (duration.targetDays && tour.days === duration.targetDays) score += 3;
  }
  const paceTerms = {
    relaxed: ["nghi duong", "thu gian", "tu do", "resort", "lich trinh nhe"],
    balanced: ["can bang", "vua phai"],
    active: ["trekking", "leo nui", "mao hiem", "phieu luu", "kham pha"],
  };
  if (!constraints.pace && (paceTerms[preferences.pace] || []).some((term) => haystack.includes(term))) score += 2;
  if (constraints.pace && (paceTerms[constraints.pace] || []).some((term) => haystack.includes(term))) score += 5;
  return score;
}

function filterAndRankHydratedTours(tours, constraints = {}, options = {}) {
  const orderedIds = uniqueIds(options.orderedIds || []);
  const candidateOrder = new Map(orderedIds.map((id, index) => [id, index]));
  const requestType = options.requestType || "recommendation";
  const directIds = new Set(uniqueIds(options.directTourIds || []));
  const valid = tours
    .map((tour) => ({
      tour,
      evidence: collectTourConstraintEvidence(tour, constraints),
      grounding: buildTourFactualContext(tour, constraints, { now: options.now }),
    }))
    .filter(({ tour, evidence, grounding }) => tourMatchesConstraints(tour, constraints, {
      requestType,
      evidence,
      grounding,
      now: options.now,
    }));

  if (["comparison", "tour_detail", "availability"].includes(requestType)) {
    const byId = new Map(valid.map(({ tour }) => [String(tour._id), tour]));
    const explicitIds = uniqueIds(options.directTourIds || []);
    const resultIds = explicitIds.length ? explicitIds : uniqueIds([...directIds, ...orderedIds]);
    return resultIds.map((id) => byId.get(id)).filter(Boolean);
  }

  const currentSoftInterests = constraints?._constraintMeta?.currentFields?.includes("interests") &&
    constraintMode(constraints, "interests", "hard") === "soft"
    ? constraints.interests || []
    : [];
  const softMatches = currentSoftInterests.length
    ? valid.filter(({ evidence }) => evidence.interests.some((item) => item.matched))
    : [];
  const rankedPool = softMatches.length ? softMatches : valid;

  return rankedPool
    .map(({ tour, evidence, grounding }) => ({
      tour,
      evidence,
      grounding,
      score: scoreTour(tour, constraints, candidateOrder, evidence, grounding) +
        preferenceScore(tour, options.preferences || {}, constraints, grounding),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftOrder = candidateOrder.get(String(left.tour._id)) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = candidateOrder.get(String(right.tour._id)) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.tour._id).localeCompare(String(right.tour._id));
    })
    .map((item) => item.tour)
    .slice(0, options.limit || 3);
}

function withoutConstraintFields(constraints = {}, fields = []) {
  const next = { ...constraints };
  for (const field of fields) {
    if (field === "budget") {
      delete next.budgetScope;
      delete next.totalBudget;
      delete next.minTotalBudget;
      delete next.maxTotalBudget;
      delete next.targetBudget;
      delete next.minPrice;
      delete next.maxPrice;
      delete next.exactPrice;
      delete next.approximatePrice;
      if (next[SEMANTIC_STATE_KEY]) {
        next[SEMANTIC_STATE_KEY] = structuredClone(next[SEMANTIC_STATE_KEY]);
        next[SEMANTIC_STATE_KEY].slots.budget = {
          status: "removed",
          operator: null,
          scope: "unspecified",
          min: null,
          max: null,
          target: null,
        };
      }
    } else if (field === "travelers") {
      delete next.travelers;
    } else if (field === "days") {
      delete next.days;
      delete next.minDays;
      delete next.maxDays;
      delete next.approximateDays;
      if (next[SEMANTIC_STATE_KEY]) {
        next[SEMANTIC_STATE_KEY] = structuredClone(next[SEMANTIC_STATE_KEY]);
        next[SEMANTIC_STATE_KEY].slots.duration = {
          status: "removed",
          operator: null,
          minDays: null,
          maxDays: null,
          targetDays: null,
          required: false,
        };
      }
    } else {
      delete next[field];
    }
  }
  return next;
}

function activeHardConstraintFields(constraints = {}) {
  const fields = [];
  if (budgetIsHardConstraint(constraints)) fields.push("budget");
  if (constraints.dateRange?.start) fields.push("dateRange");
  if (constraints.days != null || currentDurationSlot(constraints)) fields.push("days");
  if (constraints.travelers != null && constraints.dateRange?.start) fields.push("travelers");
  if (constraints.destination && constraintMode(constraints, "destination", "hard") === "hard") fields.push("destination");
  if (constraints.region && constraintMode(constraints, "region", "hard") === "hard") fields.push("region");
  if (constraints.interests?.length && constraintMode(constraints, "interests", "hard") === "hard") fields.push("interests");
  if (constraints.exclusions?.length) fields.push("exclusions");
  return [...new Set(fields)];
}

function combinations(values, size, start = 0, prefix = [], result = []) {
  if (prefix.length === size) {
    result.push(prefix);
    return result;
  }
  for (let index = start; index < values.length; index += 1) {
    combinations(values, size, index + 1, [...prefix, values[index]], result);
  }
  return result;
}

function diagnoseZeroResult(tours, constraints = {}, options = {}) {
  if (options.inventoryComplete === false) {
    return {
      cause: "internal_retrieval_degraded",
      blockingFields: [],
      relaxedTourIds: [],
      retrievalStatus: options.retrievalStatus || null,
    };
  }
  const fields = activeHardConstraintFields(constraints);
  for (let size = 1; size <= fields.length; size += 1) {
    for (const relaxedFields of combinations(fields, size)) {
      const matches = filterAndRankHydratedTours(tours, withoutConstraintFields(constraints, relaxedFields), {
        ...options,
        limit: 3,
      });
      if (matches.length) {
        return {
          cause: "user_constraints",
          blockingFields: relaxedFields,
          relaxedTourIds: matches.map((tour) => String(tour._id)),
        };
      }
    }
  }
  return { cause: fields.length ? "inventory_no_match" : "inventory_empty", blockingFields: fields, relaxedTourIds: [] };
}

function sanitizeTour(tour) {
  return {
    ...tour,
    inclusions: Array.isArray(tour.inclusions) ? tour.inclusions.filter(Boolean) : (tour.inclusions ? [tour.inclusions] : []),
    exclusions: Array.isArray(tour.exclusions) ? tour.exclusions.filter(Boolean) : (tour.exclusions ? [tour.exclusions] : []),
    highlights: Array.isArray(tour.highlights) ? tour.highlights.filter(Boolean) : [],
    reviews: (tour.reviews || []).filter((review) => review.isVisible !== false),
  };
}

function buildContextText(tours, options = {}) {
  const constraints = options.constraints || { dateRange: options.dateRange || null };
  const grounding = options.grounding || buildGroundingContract(tours, constraints, { now: options.now });
  return tours.map((tour, index) => {
    const facts = groundingForTour(grounding, tour) || buildTourFactualContext(tour, constraints, { now: options.now });
    const departuresText = facts.departures.slice(0, 4).map((departure) => [
      `[Departure ${departure.departureId}]`,
      `date=${departure.dateIso}`,
      `price=${departure.price}`,
      `remainingSlots=${departure.remainingSlots}`,
      `partySize=${facts.partySize}`,
      `availableForParty=${departure.availableForParty}`,
    ].join(" ")).join("; ");
    const priceBasisText = facts.priceBasis.type === "departure"
      ? `type=departure departureId=${facts.priceBasis.departureId} date=${facts.priceBasis.dateIso} amount=${facts.priceBasis.amount}`
      : facts.priceBasis.type === "base"
        ? `type=base amount=${facts.priceBasis.amount} (no requested departure date)`
        : "type=unknown amount=unknown (no matching departure for requested date)";
    const availabilityText = facts.availability
      ? `departureId=${facts.availability.departureId} date=${facts.availability.dateIso} remainingSlots=${facts.availability.remainingSlots} partySize=${facts.partySize} availableForParty=${facts.availability.availableForParty}`
      : "unknown (no selected departure)";
    return [
      `[Tour ${index + 1} | ID ${tour._id}] ${tour.name} - ${tour.location}, ${tour.region}`,
      `DurationDays: ${tour.days}`,
      `FACTUAL PRICE BASIS FOR THIS REQUEST: ${priceBasisText}`,
      `FACTUAL AVAILABILITY FOR THIS REQUEST: ${availabilityText}`,
      departuresText ? `ENTITY-BOUND DEPARTURES: ${departuresText}` : "ENTITY-BOUND DEPARTURES: none",
      tour.promotionLabel ? `Public promotion: ${tour.promotionLabel}` : null,
      tour.summary ? `Summary: ${tour.summary}` : null,
      tour.description ? `Description: ${tour.description}` : null,
      tour.highlights?.length ? `Highlights: ${tour.highlights.join("; ")}` : null,
      tour.itinerary?.length
        ? `Itinerary: ${tour.itinerary.slice(0, 8).map((day) => `Day ${day.dayNumber}: ${day.title}${day.description ? ` - ${day.description}` : ""}${day.meals?.length ? ` (meals: ${day.meals.join(", ")})` : ""}${day.accommodation ? ` (accommodation: ${day.accommodation})` : ""}`).join("; ")}`
        : null,
      tour.inclusions?.length ? `Inclusions: ${tour.inclusions.join("; ")}` : null,
      tour.exclusions?.length ? `Exclusions: ${tour.exclusions.join("; ")}` : null,
      tour.cancellationPolicy ? `Cancellation policy: ${tour.cancellationPolicy}` : null,
      tour.reviews?.length
        ? `Recent public reviews: ${tour.reviews.slice(-3).map((review) => `${review.rating}/5 - ${review.comment || ""}`).join("; ")}`
        : null,
      `FactualFingerprint: ${facts.fingerprint}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

async function discoverCandidateIds(prompt) {
  if (!String(prompt || "").trim()) {
    return {
      ids: [],
      chromaResult: null,
      status: { status: "skipped", degraded: false, reasons: [], documentCount: null },
    };
  }
  const [embedding, chroma] = await Promise.allSettled([embedText(prompt), getTourCollection()]);
  if (embedding.status === "rejected" || chroma.status === "rejected") {
    const component = chroma.status === "rejected" ? "chroma_discovery" : "embedding_provider";
    const error = chroma.status === "rejected" ? chroma.reason : embedding.reason;
    console.warn("[ai.retrieval.fallback]", {
      component,
      errorCode: error?.code || null,
      errorName: error?.name || "Error",
      providerStatus: Number(error?.status) || null,
    });
    return {
      ids: [],
      chromaResult: null,
      status: {
        status: "degraded",
        degraded: true,
        reasons: [component === "chroma_discovery" ? "CHROMA_UNAVAILABLE" : "EMBEDDING_UNAVAILABLE"],
        documentCount: null,
      },
    };
  }

  const [query, count] = await Promise.allSettled([
    chroma.value.query({ queryEmbeddings: [embedding.value], nResults: TOP_K }),
    typeof chroma.value.count === "function" ? chroma.value.count() : Promise.resolve(null),
  ]);
  if (query.status === "rejected" || count.status === "rejected") {
    const error = query.status === "rejected" ? query.reason : count.reason;
    console.warn("[ai.retrieval.fallback]", {
      component: "chroma_discovery",
      errorCode: error?.code || null,
      errorName: error?.name || "Error",
      providerStatus: Number(error?.status) || null,
    });
    return {
      ids: [],
      chromaResult: null,
      status: { status: "degraded", degraded: true, reasons: ["CHROMA_UNAVAILABLE"], documentCount: null },
    };
  }

  const documentCount = count.value == null ? null : Number(count.value) || 0;
  const reasons = documentCount === 0 ? ["INDEX_EMPTY"] : [];
  return {
    ids: dedupeTourIdsInOrder(query.value),
    chromaResult: query.value,
    status: {
      status: reasons.length ? "degraded" : "healthy",
      degraded: Boolean(reasons.length),
      reasons,
      documentCount,
    },
  };
}

function preferenceSearchText(preferences = {}, constraints = {}) {
  const hasCurrentArea = Boolean(constraints.destination || constraints.region || constraints.interests?.length);
  const expand = (values = []) => values.flatMap((value) => {
    const hints = interestHints(value);
    return [value, ...hints.slice(0, 8)];
  });
  return [
    ...(!hasCurrentArea ? (preferences.preferredDestinations || []) : []),
    ...(!hasCurrentArea ? (preferences.preferredRegions || []) : []),
    ...expand(preferences.travelStyles),
    ...(!hasCurrentArea ? expand(preferences.interests) : []),
    ...(preferences.accommodationPreferences || []),
  ].filter(Boolean).join(" ");
}

async function findMentionedTours(prompt, limit = 3) {
  const normalized = normalizeText(prompt);
  const stopWords = new Set([
    "tour", "nay", "do", "kia", "thu", "cai", "dau", "tien", "mot", "hai", "ba", "vua", "noi", "luc", "the", "nao", "khong", "co", "voi", "hon", "sao",
    "khach", "san", "luu", "tru", "bao", "gom", "lich", "trinh", "ngay", "gia", "con", "cho", "may", "bay", "so", "sanh", "phu", "hop", "thi", "hay",
  ]);
  const promptTokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const words = promptTokens.filter((word) => word.length >= 2 && !stopWords.has(word));
  if (!words.length) return [];
  const alphaWords = words.filter((word) => /[a-z]/.test(word));
  // Numeric-only continuations such as "27 thi sao?" are dates/ordinals, not tour names.
  // Let the structured resolver reuse the current conversation tour instead of matching
  // an unrelated tour whose slug happens to contain that number.
  if (!alphaWords.length) return [];
  const regex = new RegExp(alphaWords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
  const candidates = await Tour.find({
    status: "published",
    isActive: { $ne: false },
    $or: [{ searchText: regex }, { slug: regex }],
  }).select('_id name location slug searchText').limit(40).lean();

  const containsSequence = (container, sequence) => {
    if (!sequence.length || sequence.length > container.length) return false;
    for (let start = 0; start <= container.length - sequence.length; start += 1) {
      if (sequence.every((token, index) => container[start + index] === token)) return true;
    }
    return false;
  };

  const promptMentionsAlias = (alias) => {
    const aliasTokens = normalizeText(alias).split(/[^a-z0-9]+/).filter(Boolean);
    if (!aliasTokens.length) return false;
    if (containsSequence(promptTokens, aliasTokens)) return true;
    if (aliasTokens.length === 1) {
      return aliasTokens[0].length >= 3 && !stopWords.has(aliasTokens[0]) && promptTokens.includes(aliasTokens[0]);
    }
    const maxWindow = Math.min(4, promptTokens.length, aliasTokens.length);
    for (let size = maxWindow; size >= 2; size -= 1) {
      for (let start = 0; start <= promptTokens.length - size; start += 1) {
        const sequence = promptTokens.slice(start, start + size);
        if (sequence.some((token) => stopWords.has(token))) continue;
        if (containsSequence(aliasTokens, sequence)) return true;
      }
    }
    return false;
  };

  return candidates
    .filter((tour) => {
      const leadingTitle = String(tour.name || "").split(/\s+(?:—|–|-|:)\s+/u)[0];
      return [leadingTitle, tour.location, tour.name]
        .filter(Boolean)
        .some(promptMentionsAlias);
    })
    .sort((left, right) => normalizeText(right.name).length - normalizeText(left.name).length)
    .slice(0, limit);
}

function buildMongoFallbackQuery(constraints = {}, excludedIds = []) {
  const query = {
    status: "published",
    isActive: { $ne: false },
    ...(excludedIds.length ? { _id: { $nin: excludedIds } } : {}),
  };
  if (constraints.region) query.region = constraints.region;
  // With a requested date, departure price is authoritative. Keep Mongo recall broad
  // and apply date/price/party constraints together after hydration.
  const semanticBudget = constraints?.[SEMANTIC_STATE_KEY]?.slots?.budget;
  const budgetNeedsBroadRecall = semanticBudget?.status === "known" &&
    (semanticBudget.scope === "unspecified" || semanticBudget.operator === "approximate");
  if (!constraints.dateRange?.start && !budgetNeedsBroadRecall) {
    if (constraints.minPrice != null && Number.isFinite(Number(constraints.minPrice))) query.basePrice = { ...(query.basePrice || {}), $gte: Number(constraints.minPrice) };
    if (constraints.maxPrice != null && Number.isFinite(Number(constraints.maxPrice))) query.basePrice = { ...(query.basePrice || {}), $lte: Number(constraints.maxPrice) };
  }
  applyDurationQuery(query, constraints);
  return query;
}

async function mongoFallbackTours(constraints, excludedIds = [], limit = MONGO_RECALL_LIMIT) {
  const query = buildMongoFallbackQuery(constraints, excludedIds);
  return (await Tour.find(query).sort({ _id: 1 }).limit(limit).lean()).map(sanitizeTour);
}

function dedupeTours(tours = []) {
  const seen = new Set();
  return tours.filter((tour) => {
    const id = String(tour?._id || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizeOptions(options) {
  if (options && (options._id || options.name) && !options.tourContext) return { tourContext: options };
  return options && typeof options === "object" ? options : {};
}

async function getRagContext(prompt, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const intent = options.intent || await extractIntent(prompt, options.constraintState || {}, options.entityState || {}, options.now || new Date());
  const constraints = getEffectiveConstraintState(options.constraintState || intent.constraintState || {});
  const requestType = options.requestType || intent.requestType || "recommendation";
  const directTourIds = uniqueIds([
    ...(options.directTourIds || []),
    options.tourContext?._id,
    options.pageContext?.tourId,
  ]);
  const excludedTourIds = uniqueIds(options.excludeTourIds || []);
  const excludedTourIdSet = new Set(excludedTourIds);

  let discovered = {
    ids: [],
    chromaResult: null,
    status: { status: "skipped", degraded: false, reasons: [], documentCount: null },
  };
  if (!options.skipChroma) {
    const currentInterestText = requestType === "recommendation"
      ? (constraints.interests || []).flatMap((value) => [value, ...interestHints(value).slice(0, 8)]).join(" ")
      : "";
    const preferenceText = requestType === "recommendation"
      ? preferenceSearchText(options.preferenceContext?.profile || {}, constraints)
      : "";
    discovered = await discoverCandidateIds([prompt, currentInterestText, preferenceText].filter(Boolean).join(" "));
  }
  const directTourIdSet = new Set(directTourIds);
  const candidateIds = uniqueIds([...directTourIds, ...discovered.ids])
    .filter((id) => directTourIdSet.has(id) || !excludedTourIdSet.has(id));
  let mongoHealthy = true;
  let candidateTours = [];
  try {
    if (candidateIds.length) {
      candidateTours = (await Tour.find({
        _id: { $in: candidateIds },
        status: "published",
        isActive: { $ne: false },
      }).lean()).map(sanitizeTour);
    }
  } catch (error) {
    mongoHealthy = false;
    console.warn("[ai.retrieval.fallback]", {
      component: "mongo_hydration",
      errorCode: error?.code || null,
      errorName: error?.name || "Error",
    });
  }

  let fallbackTours = [];
  if (requestType === "recommendation") {
    try {
      fallbackTours = await mongoFallbackTours(constraints, excludedTourIds, MONGO_RECALL_LIMIT);
    } catch (error) {
      mongoHealthy = false;
      console.warn("[ai.retrieval.fallback]", {
        component: "mongo_recall",
        errorCode: error?.code || null,
        errorName: error?.name || "Error",
      });
    }
  }

  const retrievalReasons = [...discovered.status.reasons, ...(!mongoHealthy ? ["MONGO_UNAVAILABLE"] : [])];
  const retrievalStatus = {
    status: retrievalReasons.length ? "degraded" : "healthy",
    degraded: Boolean(retrievalReasons.length),
    mode: options.skipChroma ? "mongo_only" : (discovered.status.degraded ? "mongo_fallback" : "hybrid"),
    reasons: [...new Set(retrievalReasons)],
    fallbackUsed: requestType === "recommendation",
    inventoryComplete: requestType === "recommendation" && mongoHealthy,
    components: {
      mongo: mongoHealthy ? "healthy" : "unavailable",
      chroma: options.skipChroma ? "skipped" : discovered.status.status,
      indexDocuments: discovered.status.documentCount,
    },
  };

  const hydratedPool = dedupeTours([...candidateTours, ...fallbackTours])
    .filter((tour) => directTourIdSet.has(String(tour._id)) || !excludedTourIdSet.has(String(tour._id)));
  let tours = filterAndRankHydratedTours(hydratedPool, constraints, {
    requestType,
    directTourIds,
    orderedIds: candidateIds,
    limit: requestType === "recommendation" ? 3 : 6,
    preferences: options.preferenceContext?.profile || {},
    now: options.now,
  });
  let zeroResult = null;
  if (requestType === "recommendation" && !tours.length) {
    let broadTours = [];
    let inventoryComplete = mongoHealthy;
    try {
      broadTours = await mongoFallbackTours({}, [], MONGO_RECALL_LIMIT);
    } catch {
      inventoryComplete = false;
    }
    if (options.alternativeResults && excludedTourIds.length) {
      const previousMatches = filterAndRankHydratedTours(broadTours, constraints, {
        requestType,
        orderedIds: uniqueIds([...candidateIds, ...broadTours.map((tour) => String(tour._id))]),
        preferences: options.preferenceContext?.profile || {},
        limit: Math.max(excludedTourIds.length, 3),
        now: options.now,
      });
      const onlySeenCandidatesRemain = previousMatches.length > 0
        && previousMatches.every((tour) => excludedTourIdSet.has(String(tour._id)));
      if (onlySeenCandidatesRemain) {
        zeroResult = { cause: "alternative_exhausted", blockingFields: [], relaxedTourIds: [] };
      }
    }
    if (!zeroResult) {
      zeroResult = diagnoseZeroResult(broadTours, constraints, {
        requestType,
        orderedIds: uniqueIds([...candidateIds, ...broadTours.map((tour) => String(tour._id))]),
        preferences: options.preferenceContext?.profile || {},
        retrievalStatus,
        inventoryComplete,
      });
    }
  }
  const scoringEvidenceByTour = new Map(tours.map((tour) => {
    const evidence = collectTourConstraintEvidence(tour, constraints);
    const factual = buildTourFactualContext(tour, constraints, { now: options.now });
    return [String(tour._id), factualFitEvidence(tour, constraints, evidence, factual)];
  }));
  const factualGrounding = buildGroundingContract(tours, constraints, {
    now: options.now,
    scoringEvidenceByTour,
  });
  const contextText = tours.length
    ? buildContextText(tours, { constraints, grounding: factualGrounding, now: options.now })
    : zeroResult?.cause === "internal_retrieval_degraded"
      ? "Hệ thống truy xuất tour đang suy giảm và chưa thể xác nhận kết quả."
      : "Không tìm thấy tour phù hợp với yêu cầu.";
  const matchedChunks = (discovered.chromaResult?.documents?.[0] || []).map((document, index) => ({
    document,
    metadata: discovered.chromaResult.metadatas?.[0]?.[index] || null,
    distance: discovered.chromaResult.distances?.[0]?.[index] ?? null,
  }));
  const candidateOrder = new Map(candidateIds.map((id, index) => [id, index]));
  const ranking = tours.map((tour, index) => {
    const evidence = collectTourConstraintEvidence(tour, constraints);
    const grounding = groundingForTour(factualGrounding, tour);
    const hardScore = scoreTour(tour, constraints, candidateOrder, evidence, grounding);
    const softScore = preferenceScore(tour, options.preferenceContext?.profile || {}, constraints, grounding);
    return {
      rank: index + 1,
      tourId: String(tour._id),
      score: hardScore + softScore,
      hardScore,
      softScore,
      evidence: {
        destination: evidence.destination,
        interests: evidence.interests,
        exclusions: evidence.exclusions,
        factualFingerprint: grounding?.fingerprint || null,
        priceBasis: grounding?.priceBasis || null,
        selectedDepartureId: grounding?.selectedDeparture?.departureId || null,
      },
    };
  });
  const trace = {
    filters: constraints,
    mode: retrievalStatus.mode,
    status: retrievalStatus.status,
    reasons: retrievalStatus.reasons,
    candidateIds: {
      direct: directTourIds,
      excluded: excludedTourIds,
      discovered: discovered.ids,
      hydrated: hydratedPool.map((tour) => String(tour._id)),
      selected: tours.map((tour) => String(tour._id)),
    },
    ranking,
    grounding: (factualGrounding.tours || []).map((item) => ({
      tourId: item.tourId,
      fingerprint: item.fingerprint,
      priceBasis: item.priceBasis,
      selectedDepartureId: item.selectedDeparture?.departureId || null,
      partySize: item.partySize,
      availableForParty: item.availability?.availableForParty ?? null,
    })),
    zeroResult: zeroResult ? { cause: zeroResult.cause, blockingFields: zeroResult.blockingFields || [] } : null,
  };
  return { intent, tours, contextText, matchedChunks, zeroResult, retrievalStatus, factualGrounding, trace };
}

module.exports = {
  getRagContext,
  findMentionedTours,
  dedupeTourIdsInOrder,
  tourMatchesConstraints,
  filterAndRankHydratedTours,
  sanitizeTour,
  buildContextText,
  diagnoseZeroResult,
  discoverCandidateIds,
  mongoFallbackTours,
  buildMongoFallbackQuery,
  scoreTour,
  preferenceScore,
  factualFitEvidence,
};
