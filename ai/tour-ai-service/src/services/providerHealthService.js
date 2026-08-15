let runtime = {
  status: null,
  code: null,
  lastSuccessAt: null,
  lastFailureAt: null,
};

function recordProviderSuccess(now = new Date()) {
  runtime = {
    status: "healthy",
    code: null,
    lastSuccessAt: now.toISOString(),
    lastFailureAt: runtime.lastFailureAt,
  };
}

function recordProviderFailure(code, now = new Date()) {
  runtime = {
    status: "degraded",
    code: String(code || "AI_PROVIDER_UNAVAILABLE"),
    lastSuccessAt: runtime.lastSuccessAt,
    lastFailureAt: now.toISOString(),
  };
}

function providerCapabilitySnapshot() {
  if (!process.env.GEMINI_API_KEY) {
    return {
      status: "not_configured",
      code: null,
      chatModel: process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash",
      embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
      lastSuccessAt: null,
      lastFailureAt: runtime.lastFailureAt,
    };
  }
  return {
    status: runtime.status || "configured",
    code: runtime.code,
    chatModel: process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash",
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
    lastSuccessAt: runtime.lastSuccessAt,
    lastFailureAt: runtime.lastFailureAt,
  };
}

function resetProviderHealth() {
  runtime = { status: null, code: null, lastSuccessAt: null, lastFailureAt: null };
}

module.exports = {
  recordProviderSuccess,
  recordProviderFailure,
  providerCapabilitySnapshot,
  resetProviderHealth,
};
