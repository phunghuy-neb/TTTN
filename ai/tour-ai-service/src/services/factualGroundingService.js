const TIME_ZONE = "Asia/Ho_Chi_Minh";

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function tourIdOf(tour) {
  return String(tour?._id || tour?.tourId || "");
}

function departureIdOf(departure, index = 0) {
  return String(departure?._id || departure?.departureId || `departure-${index}`);
}

function localIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function effectivePartySize(constraints = {}) {
  const semanticTravelers = constraints?._semanticState?.slots?.travelers;
  const candidates = [
    constraints.travelers,
    semanticTravelers?.total,
    Number.isFinite(Number(constraints.adults)) || Number.isFinite(Number(constraints.children))
      ? Number(constraints.adults || 0) + Number(constraints.children || 0)
      : null,
    Number.isFinite(Number(semanticTravelers?.adults)) || Number.isFinite(Number(semanticTravelers?.children))
      ? Number(semanticTravelers?.adults || 0) + Number(semanticTravelers?.children || 0)
      : null,
  ];
  const explicit = candidates.map(finiteNumber).find((value) => value !== null && value > 0);
  return Math.max(1, Math.trunc(explicit || 1));
}

function budgetValueMatches(value, budget) {
  const amount = finiteNumber(value);
  if (amount === null || budget?.status !== "known") return false;
  if (budget.operator === "exact") return amount === finiteNumber(budget.target);
  if (budget.operator === "min") return amount >= finiteNumber(budget.min);
  if (budget.operator === "max") return amount <= finiteNumber(budget.max);
  if (budget.operator === "range") {
    const min = finiteNumber(budget.min);
    const max = finiteNumber(budget.max);
    return min !== null && max !== null && amount >= min && amount <= max;
  }
  if (budget.operator === "approximate") {
    const target = finiteNumber(budget.target);
    return target !== null && Math.abs(amount - target) <= Math.max(500_000, target * 0.2);
  }
  return true;
}

function budgetMatchEvidence(price, constraints = {}) {
  const amount = finiteNumber(price);
  if (amount === null) return { matched: false, interpretedScopes: [] };
  const budget = constraints?._semanticState?.slots?.budget;
  if (budget?.status === "known") {
    const partySize = effectivePartySize(constraints);
    const values = {
      per_person: amount,
      total: amount * partySize,
    };
    const scopes = budget.scope === "unspecified" ? ["total", "per_person"] : [budget.scope];
    const interpretedScopes = scopes.filter((scope) => budgetValueMatches(values[scope], budget));
    return { matched: interpretedScopes.length > 0, interpretedScopes };
  }
  const minPrice = finiteNumber(constraints.minPrice);
  const maxPrice = finiteNumber(constraints.maxPrice);
  const matched = !(minPrice !== null && amount < minPrice) && !(maxPrice !== null && amount > maxPrice);
  return { matched, interpretedScopes: matched ? ["legacy_per_person"] : [] };
}

function priceMeetsConstraints(price, constraints = {}) {
  return budgetMatchEvidence(price, constraints).matched;
}

function isWithinDateRange(date, dateRange) {
  if (!dateRange?.start) return true;
  const iso = localIsoDate(date);
  if (!iso) return false;
  return iso >= dateRange.start && iso <= (dateRange.end || dateRange.start);
}

function compareDepartureFacts(left, right) {
  return String(left.dateIso || "").localeCompare(String(right.dateIso || "")) ||
    (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER) ||
    left.departureId.localeCompare(right.departureId);
}

function departureFact(departure, partySize, index = 0) {
  const remainingSlots = Math.max(0, finiteNumber(departure?.availableSlots) || 0);
  const availableForParty = remainingSlots >= partySize;
  return {
    departureId: departureIdOf(departure, index),
    date: departure?.date || null,
    dateIso: localIsoDate(departure?.date),
    price: finiteNumber(departure?.price),
    remainingSlots,
    totalSlots: Math.max(0, finiteNumber(departure?.totalSlots) || 0),
    partySize,
    availableForParty,
    unavailableForParty: !availableForParty,
    shortfall: Math.max(0, partySize - remainingSlots),
  };
}

function relevantDepartureFacts(tour, constraints = {}, { now = new Date() } = {}) {
  const partySize = effectivePartySize(constraints);
  const hasDateConstraint = Boolean(constraints.dateRange?.start);
  return (tour?.departures || [])
    .map((departure, index) => departureFact(departure, partySize, index))
    .filter((departure) => departure.dateIso && (
      hasDateConstraint
        ? isWithinDateRange(departure.date, constraints.dateRange)
        : new Date(departure.date) >= now
    ))
    .sort(compareDepartureFacts);
}

function selectDepartureBasis(tour, constraints = {}, options = {}) {
  if (!constraints.dateRange?.start) return null;
  const departures = relevantDepartureFacts(tour, constraints, options);
  const hardValid = departures.filter((departure) =>
    departure.availableForParty && priceMeetsConstraints(departure.price, constraints)
  );
  return hardValid[0] || departures.find((departure) => departure.availableForParty) || departures[0] || null;
}

function buildTourFactualContext(tour, constraints = {}, options = {}) {
  const tourId = tourIdOf(tour);
  const partySize = effectivePartySize(constraints);
  const departures = relevantDepartureFacts(tour, constraints, options);
  const selectedDeparture = selectDepartureBasis(tour, constraints, options);
  const hasDateConstraint = Boolean(constraints.dateRange?.start);
  const priceBasis = hasDateConstraint
    ? {
      type: selectedDeparture ? "departure" : "unknown",
      amount: selectedDeparture?.price ?? null,
      departureId: selectedDeparture?.departureId || null,
      date: selectedDeparture?.date || null,
      dateIso: selectedDeparture?.dateIso || null,
    }
    : {
      type: "base",
      amount: finiteNumber(tour?.basePrice),
      departureId: null,
      date: null,
      dateIso: null,
    };
  const availability = selectedDeparture
    ? {
      departureId: selectedDeparture.departureId,
      date: selectedDeparture.date,
      dateIso: selectedDeparture.dateIso,
      partySize,
      remainingSlots: selectedDeparture.remainingSlots,
      availableForParty: selectedDeparture.availableForParty,
      unavailableForParty: selectedDeparture.unavailableForParty,
      shortfall: selectedDeparture.shortfall,
    }
    : null;
  const scoringEvidence = Array.isArray(options.scoringEvidence) ? [...options.scoringEvidence] : [];
  const fingerprint = [
    tourId,
    constraints.dateRange?.start || "no-date",
    constraints.dateRange?.end || constraints.dateRange?.start || "no-date",
    partySize,
    priceBasis.departureId || "base",
    priceBasis.amount ?? "unknown",
    availability?.remainingSlots ?? "unknown",
  ].join("|");
  return {
    tourId,
    name: tour?.name || "",
    durationDays: finiteNumber(tour?.days),
    partySize,
    dateRange: constraints.dateRange || null,
    priceBasis,
    availability,
    selectedDeparture,
    departures,
    scoringEvidence,
    fitEvidenceScore: scoringEvidence.length,
    fingerprint,
  };
}

function evidenceFor(options, tourId) {
  const source = options.scoringEvidenceByTour;
  if (source instanceof Map) return source.get(tourId) || [];
  return source?.[tourId] || [];
}

function buildGroundingContract(tours = [], constraints = {}, options = {}) {
  const contexts = tours.map((tour) => {
    const tourId = tourIdOf(tour);
    return buildTourFactualContext(tour, constraints, {
      ...options,
      scoringEvidence: evidenceFor(options, tourId),
    });
  });
  return {
    version: 1,
    partySize: effectivePartySize(constraints),
    dateRange: constraints.dateRange || null,
    tours: contexts,
    byTourId: Object.fromEntries(contexts.map((context) => [context.tourId, context])),
  };
}

function groundingForTour(contract, tourOrId) {
  const tourId = typeof tourOrId === "object" ? tourIdOf(tourOrId) : String(tourOrId || "");
  return contract?.byTourId?.[tourId] || contract?.tours?.find((item) => item.tourId === tourId) || null;
}

module.exports = {
  TIME_ZONE,
  effectivePartySize,
  budgetMatchEvidence,
  priceMeetsConstraints,
  localIsoDate,
  isWithinDateRange,
  relevantDepartureFacts,
  selectDepartureBasis,
  buildTourFactualContext,
  buildGroundingContract,
  groundingForTour,
};
