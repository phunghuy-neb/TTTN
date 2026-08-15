const crypto = require("crypto");
const {
  AI_CHAT_CONTRACT_VERSION,
  ERROR_CODES,
  AiServiceError,
  errorEnvelope,
} = require("../services/aiContractService");

const USER_SCOPED_PATHS = new Set(["/chat", "/chat/stream", "/context"]);
const PRINCIPAL = /^[0-9a-f]{64}$/;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function createInternalAiGateway({
  apiKey = process.env.AI_INTERNAL_API_KEY,
  max = Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 60,
  windowMs = 60_000,
  now = () => Date.now(),
} = {}) {
  const hits = new Map();
  let lastCleanupAt = 0;

  function sendError(res, error) {
    return res.status(error.status).json(errorEnvelope(error));
  }

  function middleware(req, res, next) {
    const current = now();
    if (current - lastCleanupAt >= windowMs) {
      for (const [key, item] of hits) if (item.resetAt <= current) hits.delete(key);
      lastCleanupAt = current;
    }

    if (!safeEqual(apiKey, req.get("x-internal-api-key"))) {
      return sendError(res, new AiServiceError(ERROR_CODES.INVALID_INPUT, "Invalid internal credentials", {
        status: 401,
        source: "internal_auth",
        retryable: false,
      }));
    }

    const requestedVersion = req.get("x-ai-contract-version");
    if (requestedVersion && Number(requestedVersion) !== AI_CHAT_CONTRACT_VERSION) {
      return sendError(res, new AiServiceError(ERROR_CODES.INVALID_INPUT, "Unsupported contract version", {
        status: 400,
        source: "ai_contract",
        retryable: false,
      }));
    }

    const principal = String(req.get("x-ai-principal-id") || "").trim().toLowerCase();
    if (USER_SCOPED_PATHS.has(req.path) && !PRINCIPAL.test(principal)) {
      return sendError(res, new AiServiceError(ERROR_CODES.INVALID_INPUT, "Trusted principal required", {
        status: 400,
        source: "internal_auth",
        retryable: false,
      }));
    }

    const identity = PRINCIPAL.test(principal) ? `user:${principal}` : `system:${req.ip || "unknown"}`;
    let item = hits.get(identity);
    if (!item || item.resetAt <= current) item = { count: 0, resetAt: current + windowMs };
    item.count += 1;
    hits.set(identity, item);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - item.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(item.resetAt / 1000)));
    if (item.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((item.resetAt - current) / 1000)));
      return sendError(res, new AiServiceError(ERROR_CODES.RATE_LIMIT, "AI request rate limited", {
        status: 429,
        source: "ai_gateway",
        retryable: true,
      }));
    }
    req.aiPrincipal = identity;
    next();
  }

  middleware.inspect = () => new Map(hits);
  return middleware;
}

module.exports = { createInternalAiGateway, safeEqual };
