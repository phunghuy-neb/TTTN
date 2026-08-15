const AI_CHAT_CONTRACT_VERSION = 1;

const ERROR_CODES = Object.freeze({
  AI_UNAVAILABLE: "AI_UNAVAILABLE",
  AI_RESPONSE_INVALID: "AI_RESPONSE_INVALID",
  AI_PROVIDER_UNAVAILABLE: "AI_PROVIDER_UNAVAILABLE",
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
  constructor(code, message, { status = 500, source = "ai_service", retryable = false } = {}) {
    super(message || code);
    this.name = "AiServiceError";
    this.code = Object.values(ERROR_CODES).includes(code) ? code : ERROR_CODES.INTERNAL_ERROR;
    this.status = status;
    this.source = source;
    this.retryable = Boolean(retryable);
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
  const rateLimited = Number(error?.status) === 429;
  return new AiServiceError(
    rateLimited ? ERROR_CODES.AI_PROVIDER_RATE_LIMITED : ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
    rateLimited ? "AI provider rate limited" : "AI provider unavailable",
    { status: 503, source: "gemini", retryable: true }
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
