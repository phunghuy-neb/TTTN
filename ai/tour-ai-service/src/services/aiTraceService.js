const crypto = require("crypto");

const TRACE_SCHEMA_VERSION = 1;
const TRACE_ID = /^[a-zA-Z0-9._:-]{1,128}$/;
const OMIT_KEY = /(?:prompt|message|content|history|userName|email|phone|token|secret|credential|apiKey|bookingContext|preferenceContext|raw|sourceText|lastSpans)/i;

function traceId(value) {
  const normalized = String(value || "").trim();
  return TRACE_ID.test(normalized) ? normalized : null;
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function safeTraceValue(value, depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 512);
  if (depth >= 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeTraceValue(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 128);

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (OMIT_KEY.test(key)) continue;
    result[key] = safeTraceValue(item, depth + 1);
  }
  return result;
}

function normalizeAiTraceContext(value = {}, trustedPrincipal = "") {
  return {
    requestId: traceId(value.requestId),
    clientMessageId: traceId(value.clientMessageId || value.logicalTurnId),
    logicalTurnId: traceId(value.logicalTurnId || value.clientMessageId),
    conversationId: traceId(value.conversationId),
    historyEpoch: Number.isInteger(Number(value.historyEpoch)) ? Number(value.historyEpoch) : null,
    turnSequence: Number.isInteger(Number(value.turnSequence)) ? Number(value.turnSequence) : null,
    userIdentityHash: trustedPrincipal ? hashValue(trustedPrincipal) : null,
  };
}

function responseSummary(result = {}) {
  const reply = String(result.reply || "");
  const candidateIds = [
    ...(result.referencedTourIds || []),
    ...(result.tours || []).map((tour) => tour?._id || tour?.tourId),
  ].filter(Boolean).map(String);
  return {
    action: result.decision?.action || null,
    outcome: result.outcome?.code || "OK",
    candidateIds: [...new Set(candidateIds)],
    replyPresent: Boolean(reply.trim()),
    replyLength: reply.length,
    replyHash: reply ? hashValue(reply) : null,
  };
}

function skippedProviderTrace() {
  return {
    status: "skipped",
    code: null,
    providerAttempted: false,
    providerSucceeded: false,
    attemptCount: 0,
    maxAttempts: 0,
    retryCount: 0,
    retryDelaysMs: [],
    failureClass: null,
    fallbackUsed: false,
    finalComposer: "deterministic_renderer",
    provenanceClass: "DETERMINISTIC_CONFIRMED",
  };
}

function buildAiObservability({
  traceContext,
  previousSemanticState,
  pageDelta,
  extractedDelta,
  mergedSemanticState,
  decision,
  pendingClarification,
  ragTrace,
  providerStatus,
  validationResult,
  result,
}) {
  return safeTraceValue({
    schemaVersion: TRACE_SCHEMA_VERSION,
    traceContext,
    semantic: {
      previousState: previousSemanticState || {},
      pageDelta: pageDelta || {},
      extractedDelta: extractedDelta || {},
      mergedState: mergedSemanticState || {},
    },
    action: {
      decision: decision || null,
      pendingClarification: pendingClarification || null,
    },
    retrieval: ragTrace || { mode: "not_required", filters: {}, candidateIds: {}, ranking: [], grounding: [] },
    provider: providerStatus || skippedProviderTrace(),
    validation: validationResult || { status: "not_required", reason: null },
    finalResponse: responseSummary(result),
  });
}

module.exports = {
  TRACE_SCHEMA_VERSION,
  buildAiObservability,
  normalizeAiTraceContext,
  safeTraceValue,
};
