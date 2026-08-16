const AI_CHAT_CONTRACT_VERSION = 1;
const {
  PROVIDER_FAILURE_CLASSES,
  classifyProviderError,
} = require("./providerReliabilityService");

const ERROR_CODES = Object.freeze({
  AI_UNAVAILABLE: "AI_UNAVAILABLE",
  AI_RESPONSE_INVALID: "AI_RESPONSE_INVALID",
  AI_PROVIDER_UNAVAILABLE: "AI_PROVIDER_UNAVAILABLE",
  AI_PROVIDER_QUOTA_EXHAUSTED: "AI_PROVIDER_QUOTA_EXHAUSTED",
  AI_PROVIDER_RATE_LIMITED: "AI_PROVIDER_RATE_LIMITED",
  RAG_DEGRADED: "RAG_DEGRADED",
  NO_RESULTS: "NO_RESULTS",
  INVALID_INPUT: "INVALID_INPUT",
  BOOKING_ERROR: "BOOKING_ERROR",
  DB_ERROR: "DB_ERROR",
  RATE_LIMIT: "RATE_LIMIT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

class AiServiceError extends Error {
  constructor(code, message, {
    status = 500,
    source = "ai_service",
    retryable = false,
    providerMeta = null,
  } = {}) {
    super(message || code);
    this.name = "AiServiceError";
    this.code = Object.values(ERROR_CODES).includes(code) ? code : ERROR_CODES.INTERNAL_ERROR;
    this.status = status;
    this.source = source;
    this.retryable = Boolean(retryable);
    this.providerMeta = providerMeta && typeof providerMeta === "object" ? providerMeta : null;
  }
}

function successEnvelope(result = {}) {
  return {
    ...result,
    success: true,
    contractVersion: AI_CHAT_CONTRACT_VERSION,
    outcome: result.outcome || { code: "OK" },
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

function errorEnvelope(error) {
  const normalized = normalizeAiError(error);
  return {
    success: false,
    contractVersion: AI_CHAT_CONTRACT_VERSION,
    error: {
      code: normalized.code,
      message: normalized.message,
      source: normalized.source,
      retryable: normalized.retryable,
    },
  };
}

function providerError(error) {
  const classified = classifyProviderError(error);
  const providerMeta = error?.providerMeta && typeof error.providerMeta === "object"
    ? error.providerMeta
    : {
      providerAttempted: true,
      providerSucceeded: false,
      attemptCount: 1,
      maxAttempts: 1,
      retryCount: 0,
      retryDelaysMs: [],
      failureClass: classified.failureClass,
      retryable: classified.retryable,
      httpStatus: classified.httpStatus,
      providerErrorStatus: classified.providerStatus,
      retryAfterMs: classified.retryAfterMs,
      quotaMetric: classified.quotaMetric,
      quotaId: classified.quotaId,
      quotaLocation: classified.quotaLocation,
      quotaModel: classified.quotaModel,
      quotaValue: classified.quotaValue,
    };
  const failureClass = providerMeta.failureClass || classified.failureClass;
  const code = failureClass === PROVIDER_FAILURE_CLASSES.QUOTA_EXHAUSTED
    ? ERROR_CODES.AI_PROVIDER_QUOTA_EXHAUSTED
    : failureClass === PROVIDER_FAILURE_CLASSES.RATE_LIMIT_TEMPORARY
      ? ERROR_CODES.AI_PROVIDER_RATE_LIMITED
      : failureClass === PROVIDER_FAILURE_CLASSES.VALIDATOR_REJECTION
        ? ERROR_CODES.AI_RESPONSE_INVALID
        : ERROR_CODES.AI_PROVIDER_UNAVAILABLE;
  const status = code === ERROR_CODES.AI_RESPONSE_INVALID ? 502 : 503;
  const message = code === ERROR_CODES.AI_PROVIDER_QUOTA_EXHAUSTED
    ? "AI provider quota exhausted"
    : code === ERROR_CODES.AI_PROVIDER_RATE_LIMITED
      ? "AI provider rate limited"
      : code === ERROR_CODES.AI_RESPONSE_INVALID
        ? "AI provider response invalid"
        : "AI provider unavailable";
  return new AiServiceError(
    code,
    message,
    {
      status,
      source: "gemini",
      retryable: Boolean(providerMeta.retryable),
      providerMeta,
    }
  );
}

function normalizeAiError(error) {
  if (error instanceof AiServiceError) return error;
  if (error?.name === "SemanticStateValidationError" || Number(error?.status) === 400) {
    return new AiServiceError(ERROR_CODES.INVALID_INPUT, "Invalid AI input", {
      status: 400,
      source: "semantic_state",
      retryable: false,
    });
  }
  if (error?.name === "MongoServerError" || error?.name === "MongooseError") {
    return new AiServiceError(ERROR_CODES.DB_ERROR, "AI database unavailable", {
      status: 503,
      source: "mongo",
      retryable: true,
    });
  }
  return new AiServiceError(ERROR_CODES.INTERNAL_ERROR, "AI orchestration failed", {
    status: 500,
    source: "ai_service",
    retryable: false,
  });
}

module.exports = {
  AI_CHAT_CONTRACT_VERSION,
  ERROR_CODES,
  AiServiceError,
  successEnvelope,
  errorEnvelope,
  providerError,
  normalizeAiError,
};
