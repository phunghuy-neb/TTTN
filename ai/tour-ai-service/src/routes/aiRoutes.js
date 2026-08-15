const express = require("express");
const { getRagContext } = require("../services/ragService");
const { generateChatAnswer, streamChatAnswer } = require("../services/chatService");
const { syncTourVectors, reconcileTourIndex } = require("../services/syncService");
const { inspectIndexIntegrity, publicCapabilitySnapshot } = require("../services/indexIntegrityService");
const { normalizeAiTraceContext } = require("../services/aiTraceService");
const {
  AI_CHAT_CONTRACT_VERSION,
  ERROR_CODES,
  AiServiceError,
  successEnvelope,
  errorEnvelope,
  normalizeAiError,
} = require("../services/aiContractService");

const router = express.Router();

function chatInput(body = {}, req = null) {
  return {
    contractVersion: body.contractVersion,
    prompt: body.prompt,
    userName: body.userName || "",
    tourContext: body.tourContext || null,
    pageContext: body.pageContext || {},
    constraintState: body.constraintState || {},
    entityState: body.entityState || {},
    history: Array.isArray(body.history) ? body.history : [],
    bookingContext: body.bookingContext && typeof body.bookingContext === "object" ? body.bookingContext : null,
    preferenceContext: body.preferenceContext && typeof body.preferenceContext === "object" ? body.preferenceContext : null,
    traceContext: normalizeAiTraceContext(body.traceContext, req?.aiPrincipal || ""),
  };
}

function invalidInput(message) {
  return new AiServiceError(ERROR_CODES.INVALID_INPUT, message, {
    status: 400,
    source: "ai_contract",
    retryable: false,
  });
}

function validateInput(input) {
  if (input.contractVersion != null && Number(input.contractVersion) !== AI_CHAT_CONTRACT_VERSION) {
    throw invalidInput(`Unsupported contract version: ${input.contractVersion}`);
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim()) throw invalidInput("prompt is required");
  return input;
}

function sendError(res, error) {
  const normalized = normalizeAiError(error);
  return res.status(normalized.status).json(errorEnvelope(normalized));
}

router.post("/context", async (req, res) => {
  try {
    const input = validateInput(chatInput(req.body, req));
    res.json(await getRagContext(input.prompt, input));
  } catch (error) {
    console.error("[ai.context.request.error]", { errorCode: error?.code || null, errorName: error?.name || "Error" });
    sendError(res, error);
  }
});

router.post("/chat", async (req, res) => {
  try {
    const input = validateInput(chatInput(req.body, req));
    res.json(successEnvelope(await generateChatAnswer(input)));
  } catch (error) {
    console.error("[ai.chat.request.error]", {
      errorCode: error?.code || null,
      errorName: error?.name || "Error",
    });
    sendError(res, error);
  }
});

router.post("/chat/stream", async (req, res) => {
  let input;
  try {
    input = validateInput(chatInput(req.body, req));
  } catch (error) {
    return sendError(res, error);
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await streamChatAnswer(input, (value) => send("chunk", { text: value }));
    send("done", successEnvelope(result));
  } catch (error) {
    console.error("[ai.chat.stream.error]", { errorCode: error?.code || null, errorName: error?.name || "Error" });
    send("error", errorEnvelope(error));
  } finally {
    res.end();
  }
});

router.post("/sync-vectors", async (req, res) => {
  try {
    const sync = await syncTourVectors({ force: Boolean(req.body?.force) });
    const integrity = publicCapabilitySnapshot(await inspectIndexIntegrity());
    res.json({ ...sync, integrity });
  } catch (error) {
    console.error("[ai.sync-vectors.error]", error);
    sendError(res, error);
  }
});

router.post("/reconcile-index", async (req, res) => {
  try {
    const result = await reconcileTourIndex({ repair: req.body?.repair !== false });
    res.json({
      before: publicCapabilitySnapshot(result.before),
      recovery: result.recovery,
      after: publicCapabilitySnapshot(result.after),
    });
  } catch (error) {
    console.error("[ai.reconcile-index.error]", error);
    sendError(res, error);
  }
});

router.get("/health", async (req, res) => {
  const snapshot = publicCapabilitySnapshot(await inspectIndexIntegrity());
  res.json({ ...snapshot, service: "tour-ai-service", contractVersion: AI_CHAT_CONTRACT_VERSION });
});

module.exports = router;
