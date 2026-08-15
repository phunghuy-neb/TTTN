const {
  SEMANTIC_STATE_KEY,
  SEMANTIC_STATE_VERSION,
  CONSTRAINT_META_KEY,
  extractConstraintDelta,
  mergeConstraintState,
  detectRequestType,
  hasTourReferenceSignal,
  normalizeText,
  uniqueIds,
} = require("./travelAdvisorService");

const ACTIONS = Object.freeze({
  SEARCH: "SEARCH",
  ANSWER: "ANSWER",
  CLARIFY: "CLARIFY",
  ERROR: "ERROR",
});

function decision(action, operation, reason, overrides = {}) {
  return {
    action,
    operation,
    reason,
    requiredMissing: [],
    optionalMissing: [],
    assumptions: [],
    clarification: null,
    ...overrides,
  };
}

function clarification(slot, type, allowedAnswerKinds, extra = {}) {
  return { slot, type, allowedAnswerKinds, ...extra };
}

function requestedReadOnlyFacts(message) {
  const normalized = normalizeText(message);
  const facts = [];
  if (/\b(?:con cho|con ve|con du(?: cho)?|du cho|available|het cho|cho trong)\b/.test(normalized)) facts.push("availability");
  if (/\b(?:chinh sach huy|phi huy|dieu kien huy|huy (?:the nao|ra sao))\b/.test(normalized)) facts.push("cancellation_policy");
  if (/\b(?:bao nhieu ngay|may ngay|thoi luong|\d{1,2}\s*ngay\s*(?:a|ha|phai khong|dung khong))\b/.test(normalized)) facts.push("duration");
  if (/\b(?:gia bao nhieu|gia tour|bao nhieu tien|chi phi)\b/.test(normalized)) facts.push("price");
  if (/\b(?:co gi hay|co gi noi bat|tong quan)\b/.test(normalized)) facts.push("overview");
  if (/\b(?:khach san|luu tru|ve may bay|phuong tien|bao gom|khong bao gom|lich trinh|khuyen mai|bua an)\b/.test(normalized)) facts.push("tour_detail");
  return [...new Set(facts)];
}

function classifyTurn(message) {
  const normalized = normalizeText(message);
  const requestedFacts = requestedReadOnlyFacts(message);
  const alternativeResults = /\b(?:(?:danh sach|lua chon|phuong an)(?: nao)? khac|(?:them|dua|cho|tim)\b.{0,20}\b(?:tour|lua chon|phuong an) khac)\b/.test(normalized);
  const explicitSearch = alternativeResults || /\b(?:tim|goi y|de xuat|tu van)\b|\bcon tour\b.{0,24}\bthi sao\b/.test(normalized);
  const explicitUpdate = /\b(?:doi(?: tieu chi)? (?:thanh|sang)|sua (?:thanh|lai)|cap nhat|chuyen sang|lan nay|chuyen nay|chuyen di nay)\b/.test(normalized);
  const comparisonEvaluation = !explicitSearch && !explicitUpdate && /\b(?:nen|chon)\b.{1,80}\bhay\b.{1,80}(?:\?|$)/.test(normalized);
  const evaluativeQuestion = !explicitSearch && !explicitUpdate && Boolean(
    comparisonEvaluation
    || /\bco\s+(?:phu hop|hop|dang|gi\s+(?:hay|dang|noi bat|thu vi)|nhung gi|trai nghiem gi)\b/.test(normalized)
    || /\b(?:phu hop|hop)\s+(?:voi|cho)\b/.test(normalized)
    || /\b(?:co nen|nen)\s+(?:di|chon|tham quan|trai nghiem)\b/.test(normalized)
    || /\b(?:diem den|noi nay|cho nay)\b.{0,36}\b(?:the nao|ra sao)\b/.test(normalized)
  );
  const contextualEntityQuestion = !explicitSearch && !explicitUpdate && /\bcon\b.{1,60}\bthi sao\b/.test(normalized);
  const explicitNamedTourQuestion = /\btour\s+(?!(?:nay|do|kia|vua|thu|so|dau|cuoi|truoc|sau|luc|nao|gi|co|con|gia|may|bao|the|ra|duoc|phu|hop|hay|chinh|sach|lich|khach|ve|khong)\b)[a-z0-9]/.test(normalized);
  const referencesTour = /\b(?:tour|cai|hanh trinh|phuong an|lua chon)\s*(?:nay|do|kia|thu|so|\d|dau tien|mot|hai|ba)?\b/.test(normalized);
  const confirmation = /(?:\?|\ba\b|\bha\b|phai khong|dung khong|the nao|ra sao|con cho|con ve)/.test(normalized);
  const mixedReadOnly = requestedFacts.length > 1;
  const factQuery = requestedFacts.length > 0 && referencesTour && !explicitSearch && !explicitUpdate && (confirmation || mixedReadOnly);
  return {
    normalized,
    requestedFacts,
    mixedReadOnly,
    factQuery,
    explicitSearch,
    explicitUpdate,
    alternativeResults,
    evaluativeQuestion,
    comparisonEvaluation,
    contextualEntityQuestion,
    explicitNamedTourQuestion,
    mutationMode: factQuery ? "none" : explicitUpdate ? "update" : explicitSearch ? "search" : "contextual",
  };
}

function parseChoiceAnswer(message) {
  const normalized = normalizeText(message).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const numeric = normalized.match(/^(?:so|chon|cai|tour)?\s*(\d{1,2})$/);
  if (numeric) return Number(numeric[1]);
  const words = new Map([["mot", 1], ["hai", 2], ["ba", 3], ["bon", 4], ["nam", 5]]);
  return words.get(normalized.replace(/^(?:so|chon|cai|tour)\s+/, "")) || null;
}

function clearPendingClarification(entityState = {}) {
  const next = { ...entityState, pendingAction: null };
  delete next.pendingClarification;
  return next;
}

function budgetScopeAnswer(message) {
  const normalized = normalizeText(message);
  if (/\b(?:tong|ca doan|ca nhom|ca gia dinh|cho ca hai|cho tat ca)\b/.test(normalized)) return "total";
  if (/\b(?:moi nguoi|moi khach|tren nguoi|tinh theo nguoi|\/\s*nguoi)\b/.test(normalized)) return "per_person";
  return null;
}

function mergeBudgetScope(constraintState, scope) {
  const budget = constraintState?.[SEMANTIC_STATE_KEY]?.slots?.budget;
  if (!budget || !["known", "ambiguous"].includes(budget.status)) return null;
  return mergeConstraintState(constraintState, {
    [SEMANTIC_STATE_KEY]: {
      version: SEMANTIC_STATE_VERSION,
      slots: { budget: { ...budget, status: "known", scope } },
      lastSpans: [],
      migration: { source: "typed_clarification", status: "native", unsupportedFields: [] },
    },
    [CONSTRAINT_META_KEY]: {
      modes: { budget: "hard" },
      currentFields: ["budget"],
      removedFields: [],
      transientConstraints: null,
      queryScope: null,
    },
  });
}

function resolvePendingClarification({ message, constraintState = {}, entityState = {} }) {
  const pending = entityState?.pendingClarification;
  if (!pending?.slot) {
    return { resolved: false, attempted: false, constraintState, entityState, pending: null };
  }

  if (pending.slot === "budget.scope") {
    const scope = budgetScopeAnswer(message);
    const nextConstraintState = scope ? mergeBudgetScope(constraintState, scope) : null;
    if (scope && nextConstraintState) {
      return {
        resolved: true,
        attempted: true,
        constraintState: nextConstraintState,
        entityState: clearPendingClarification(entityState),
        pending,
        resumeRequestType: pending.requestType || "recommendation",
        resumeOperation: pending.resumeOperation || "recommendation",
        resolution: { slot: pending.slot, value: scope },
      };
    }
  }

  if (pending.slot === "entity.tour_selection") {
    const choice = parseChoiceAnswer(message);
    const candidateTourIds = uniqueIds(pending.candidateTourIds || []);
    const selectedId = choice ? candidateTourIds[choice - 1] : null;
    if (selectedId) {
      const nextEntityState = clearPendingClarification(entityState);
      nextEntityState.lastReferencedTourIds = [selectedId];
      nextEntityState.recentTourIds = uniqueIds([selectedId, ...(entityState.recentTourIds || [])]);
      delete nextEntityState.ambiguousTourIds;
      return {
        resolved: true,
        attempted: true,
        constraintState,
        entityState: nextEntityState,
        pending,
        resumeRequestType: pending.requestType || "tour_detail",
        resumeOperation: pending.resumeOperation || pending.requestType || "tour_detail",
        selectedTourIds: [selectedId],
        resolution: { slot: pending.slot, value: selectedId, choice },
      };
    }
  }

  return { resolved: false, attempted: true, constraintState, entityState, pending };
}

function semanticDateKnown(state) {
  return state?.[SEMANTIC_STATE_KEY]?.slots?.date?.status === "known" && Boolean(state?.dateRange?.start);
}

function semanticActionSnapshot(state = {}) {
  return JSON.stringify({
    slots: state?.[SEMANTIC_STATE_KEY]?.slots || {},
    projection: Object.fromEntries(Object.entries(state).filter(([key]) => ![SEMANTIC_STATE_KEY, CONSTRAINT_META_KEY].includes(key))),
  });
}

function prepareActionTurn({ message, constraintState = {}, entityState = {}, pageContext = {}, now = new Date() }) {
  const normalizedPreviousState = mergeConstraintState(constraintState, {});
  const pendingResolution = resolvePendingClarification({ message, constraintState, entityState });
  let preparedConstraintState = pendingResolution.constraintState;
  let preparedEntityState = pendingResolution.entityState;
  const turn = classifyTurn(message);
  const hasBoundEntity = Boolean(
    preparedEntityState.selectedTourId
    || preparedEntityState.currentTourId
    || pageContext?.tourId
    || preparedEntityState.lastSuggestedTourIds?.length
    || preparedEntityState.lastReferencedTourIds?.length
  );
  const entityEvaluation = turn.evaluativeQuestion || (turn.contextualEntityQuestion && hasBoundEntity);
  const tourReferenceSignal = hasTourReferenceSignal(message, preparedEntityState);
  const availabilityPartyQuery = turn.factQuery && turn.requestedFacts.includes("availability")
    && /\b(?:nguoi|khach|dua)\b/.test(turn.normalized);
  const suppressMutation = entityEvaluation || (turn.factQuery && !availabilityPartyQuery) || Boolean(pendingResolution.resolved)
    || (tourReferenceSignal && !turn.explicitUpdate && !turn.explicitSearch && !availabilityPartyQuery);
  const delta = suppressMutation ? {} : extractConstraintDelta(message, preparedConstraintState, now);
  if (Object.keys(delta).length) preparedConstraintState = mergeConstraintState(preparedConstraintState, delta);
  const stateMutated = Object.keys(delta).length > 0
    && semanticActionSnapshot(preparedConstraintState) !== semanticActionSnapshot(normalizedPreviousState);
  const changedFields = [...new Set(delta?.[CONSTRAINT_META_KEY]?.currentFields || [])];
  const normalizedMessage = normalizeText(message);
  const userConstraintEvidence = Boolean(
    delta?.[SEMANTIC_STATE_KEY]?.lastSpans?.length
    || (delta.dateRange && /\b(?:hom nay|ngay mai|ngay kia|tuan|thang|thu [2-7]|chu nhat|\d{1,2}[/-]\d{1,2})\b/.test(normalizedMessage))
    || (delta.region && /\b(?:mien bac|mien trung|mien nam)\b/.test(normalizedMessage))
  );

  let resolvedPending = pendingResolution;
  const pending = preparedEntityState?.pendingClarification;
  if (!pendingResolution.resolved && pending?.slot === "trip.date" && semanticDateKnown(preparedConstraintState)) {
    resolvedPending = {
      resolved: true,
      attempted: true,
      pending,
      constraintState: preparedConstraintState,
      entityState: clearPendingClarification(preparedEntityState),
      resumeRequestType: pending.requestType || "availability",
      resumeOperation: pending.resumeOperation || "availability",
      resolution: { slot: pending.slot, value: preparedConstraintState.dateRange },
    };
    preparedEntityState = resolvedPending.entityState;
  }

  let requestType = detectRequestType(message, preparedEntityState, delta);
  let requestedFacts = [...turn.requestedFacts];
  const selectedTourIds = uniqueIds([
    preparedEntityState.selectedTourId,
    preparedEntityState.currentTourId,
    ...(preparedEntityState.lastReferencedTourIds || []),
  ]);
  const contextualEntityRehydrate = stateMutated
    && selectedTourIds.length === 1
    && turn.explicitUpdate
    && !/\btieu chi\b/.test(normalizedMessage)
    && changedFields.some((field) => ["travelers", "dateRange"].includes(field))
    && /\b(?:neu|thi sao|con du|con cho|them mot|bot mot)\b/.test(normalizedMessage);
  if (resolvedPending.resolved && resolvedPending.resumeRequestType) requestType = resolvedPending.resumeRequestType;
  else if (entityEvaluation && turn.comparisonEvaluation) requestType = "comparison";
  else if (entityEvaluation && turn.explicitNamedTourQuestion) requestType = "tour_detail";
  else if (entityEvaluation) requestType = "general";
  else if (turn.alternativeResults) requestType = "recommendation";
  else if (turn.mixedReadOnly) requestType = "tour_detail";
  else if (turn.factQuery) requestType = turn.requestedFacts.length === 1 && turn.requestedFacts[0] === "availability"
    ? "availability"
    : "tour_detail";
  else if (contextualEntityRehydrate) {
    requestType = "tour_detail";
    requestedFacts = ["availability"];
  }
  else if (tourReferenceSignal && ["general", "recommendation"].includes(requestType) && !turn.explicitSearch && !turn.explicitUpdate) requestType = "tour_detail";
  else if (turn.explicitSearch || turn.explicitUpdate) requestType = "recommendation";
  else if (requestType === "general" && stateMutated && userConstraintEvidence) requestType = "recommendation";

  return {
    previousConstraintState: normalizedPreviousState,
    extractedDelta: delta,
    intent: {
      ...delta,
      requestType,
      constraintState: preparedConstraintState,
      mutationMode: turn.mutationMode,
      requestedFacts,
      alternativeResults: turn.alternativeResults,
      entityRehydrate: contextualEntityRehydrate,
      entityEvaluation,
    },
    constraintState: preparedConstraintState,
    entityState: preparedEntityState,
    pendingResolution: resolvedPending,
    turn: { ...turn, requestedFacts, entityEvaluation },
    stateMutated,
    changedFields,
    tourReferenceSignal,
  };
}

function optionalRecommendationSlots(constraintState = {}) {
  const slots = constraintState?.[SEMANTIC_STATE_KEY]?.slots || {};
  const optional = [];
  if (!["known", "intentionally_open", "removed"].includes(slots.destination?.status)) optional.push("destination");
  if (slots.duration?.status === "unknown") optional.push("duration");
  if (slots.budget?.status === "unknown") optional.push("budget");
  if (slots.travelers?.status === "unknown") optional.push("travelers");
  if (slots.date?.status === "unknown") optional.push("date");
  return optional;
}

function hasRecommendationAnchor(constraintState = {}) {
  const slots = constraintState?.[SEMANTIC_STATE_KEY]?.slots || {};
  return Boolean(
    ["known", "intentionally_open"].includes(slots.destination?.status) ||
    slots.duration?.status === "known" ||
    slots.travelers?.status === "known" ||
    slots.date?.status === "known" ||
    slots.interests?.values?.length ||
    constraintState.region
  );
}

function pendingClarificationDecision(prepared) {
  const pending = prepared.pendingResolution?.pending;
  if (!prepared.pendingResolution?.attempted || prepared.pendingResolution?.resolved || !pending) return null;
  return decision(ACTIONS.CLARIFY, pending.resumeOperation || pending.requestType || "clarification", "pending_clarification_unresolved", {
    requiredMissing: [pending.slot],
    clarification: { ...pending },
  });
}

function decideAction({
  prepared,
  bookingContext = null,
  preferenceCommandOnly = false,
  conversation = null,
  siteLevel = false,
  explicitGeneralTourLookup = false,
  mentionedTourIds = [],
  entityResolution = null,
  resolvedTourIds = [],
}) {
  const pendingDecision = pendingClarificationDecision(prepared);
  if (pendingDecision) return pendingDecision;

  if (bookingContext?.active && !(prepared.stateMutated && bookingContext?.evidence?.strength === "none")) {
    if (bookingContext.needsClarification) {
      const candidateBookingIds = (bookingContext.bookings || []).map((booking) => booking.bookingId).filter(Boolean);
      return decision(ACTIONS.CLARIFY, bookingContext.requestType || "booking_detail", bookingContext.reason || "booking_ambiguous", {
        requiredMissing: ["entity.booking_selection"],
        clarification: clarification("entity.booking_selection", "entity_selection", ["ordinal", "booking_code"], {
          candidateBookingIds,
          requestType: bookingContext.requestType || "booking_detail",
          resumeOperation: bookingContext.requestType || "booking_detail",
        }),
      });
    }
    return decision(ACTIONS.ANSWER, bookingContext.notFound ? "booking_not_found" : bookingContext.requestType, bookingContext.notFound ? "booking_not_found" : "booking_context_resolved");
  }

  if (preferenceCommandOnly) return decision(ACTIONS.ANSWER, "preference_update", "explicit_preference_command");
  if (siteLevel) return decision(ACTIONS.ANSWER, "site_answer", "site_level_question");
  if (conversation) return decision(ACTIONS.ANSWER, "conversation", "deterministic_conversation");

  const requestType = prepared.intent.requestType;
  if (explicitGeneralTourLookup && !mentionedTourIds.length) {
    return decision(ACTIONS.CLARIFY, "tour_lookup", "explicit_tour_not_found", {
      requiredMissing: ["entity.tour_name"],
      clarification: clarification("entity.tour_name", "free_text", ["tour_name", "destination"], {
        requestType: "tour_detail",
        resumeOperation: "tour_detail",
      }),
    });
  }

  if (requestType === "recommendation") {
    const budget = prepared.constraintState?.[SEMANTIC_STATE_KEY]?.slots?.budget;
    const budgetScopeRequired = budget?.status === "known" && budget.scope === "unspecified"
      && prepared.turn.explicitSearch
      && !hasRecommendationAnchor(prepared.constraintState);
    if (budgetScopeRequired) {
      return decision(ACTIONS.CLARIFY, "recommendation", "budget_scope_materially_ambiguous", {
        requiredMissing: ["budget.scope"],
        optionalMissing: optionalRecommendationSlots(prepared.constraintState),
        clarification: clarification("budget.scope", "choice", ["total", "per_person"], {
          requestType: "recommendation",
          resumeOperation: "recommendation",
        }),
      });
    }
    const assumptions = [];
    if (budget?.status === "known" && budget.scope === "unspecified") assumptions.push("budget.scope remains unspecified; retrieval accepts either total or per-person interpretation");
    if (prepared.constraintState?.[SEMANTIC_STATE_KEY]?.slots?.destination?.status === "intentionally_open") assumptions.push("destination intentionally open");
    return decision(ACTIONS.SEARCH, prepared.intent.alternativeResults ? "recommendation_alternative" : "recommendation", prepared.intent.alternativeResults ? "alternative_results_requested" : "recommendation_actionable", {
      optionalMissing: optionalRecommendationSlots(prepared.constraintState),
      assumptions,
    });
  }

  if (["tour_detail", "availability", "comparison"].includes(requestType)) {
    if (entityResolution?.needsClarification) {
      const candidateTourIds = uniqueIds(entityResolution.ambiguousIds || []);
      return decision(ACTIONS.CLARIFY, requestType, "tour_entity_ambiguous", {
        requiredMissing: ["entity.tour_selection"],
        clarification: clarification("entity.tour_selection", "entity_selection", ["ordinal", "tour_name", "tour_id"], {
          candidateTourIds,
          requestType,
          resumeOperation: prepared.turn.mixedReadOnly ? "mixed_tour_facts" : requestType,
        }),
      });
    }
    if (entityResolution?.ids?.length && resolvedTourIds.length !== entityResolution.ids.length) {
      return decision(ACTIONS.ERROR, requestType, "resolved_tour_unavailable");
    }
    if (requestType === "availability" && !prepared.constraintState.dateRange?.start && !prepared.turn.mixedReadOnly) {
      return decision(ACTIONS.CLARIFY, "availability", "availability_date_required", {
        requiredMissing: ["trip.date"],
        clarification: clarification("trip.date", "date_or_range", ["date", "date_range", "relative_date"], {
          requestType: "availability",
          resumeOperation: "availability",
          candidateTourIds: uniqueIds(resolvedTourIds),
        }),
      });
    }
    const mixedFacts = prepared.turn.mixedReadOnly || prepared.intent.entityRehydrate;
    return decision(ACTIONS.ANSWER, mixedFacts ? "mixed_tour_facts" : requestType, prepared.intent.entityRehydrate ? "entity_facts_rehydrated_after_constraint_update" : prepared.turn.mixedReadOnly ? "mixed_read_only_facts" : "tour_entity_resolved");
  }

  return decision(ACTIONS.ANSWER, "general_answer", "general_request");
}

function pendingClarificationFromDecision(value) {
  if (value?.action !== ACTIONS.CLARIFY || !value.clarification) return null;
  return {
    ...value.clarification,
    reason: value.reason,
    resumeOperation: value.clarification.resumeOperation || value.operation,
    requestType: value.clarification.requestType || value.operation,
  };
}

function clarificationReply(value, { candidateTours = [], candidateBookings = [], tour = null } = {}) {
  const slot = value?.clarification?.slot;
  if (slot === "budget.scope") return "Ngân sách bạn vừa nêu là tổng cho cả đoàn hay tính trên mỗi người?";
  if (slot === "trip.date") return `Bạn muốn mình kiểm tra${tour?.name ? ` tour **${tour.name}**` : ""} vào ngày hoặc khoảng thời gian nào?`;
  if (slot === "entity.tour_selection") {
    const lines = candidateTours.map((item, index) => `${index + 1}. ${item.name}`).join("\n");
    return lines ? `Mình chưa xác định chắc tour bạn đang nhắc tới. Bạn chọn giúp mình:\n${lines}` : "Mình chưa xác định được tour bạn đang nhắc tới. Bạn cho mình tên tour cụ thể nhé.";
  }
  if (slot === "entity.booking_selection") {
    const lines = candidateBookings.map((item, index) => `${index + 1}. ${item.bookingCode} — ${item.tourName}`).join("\n");
    return lines ? `Mình chưa xác định chắc booking bạn đang nhắc tới. Bạn chọn giúp mình:\n${lines}` : "Mình chưa xác định được booking bạn đang nhắc tới. Bạn cho mình mã booking cụ thể nhé.";
  }
  if (slot === "entity.tour_name") return "Mình chưa tìm thấy tour published/active theo tên vừa nêu. Bạn kiểm tra lại tên tour hoặc điểm đến giúp mình nhé.";
  return "Mình cần bạn làm rõ thêm một thông tin để tiếp tục.";
}

module.exports = {
  ACTIONS,
  classifyTurn,
  requestedReadOnlyFacts,
  resolvePendingClarification,
  prepareActionTurn,
  decideAction,
  pendingClarificationFromDecision,
  clarificationReply,
};
