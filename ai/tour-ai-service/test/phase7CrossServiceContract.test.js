const test = require('node:test');
const assert = require('node:assert/strict');

const gemini = require('../src/config/gemini');
const ragService = require('../src/services/ragService');
const { buildGroundingContract } = require('../src/services/factualGroundingService');
const { createInternalAiGateway } = require('../src/middleware/internalAiGateway');
const {
  AI_CHAT_CONTRACT_VERSION,
  ERROR_CODES,
  AiServiceError,
  successEnvelope,
} = require('../src/services/aiContractService');

const ORIGINAL_GENERATE = gemini.generateChatReply;
const ORIGINAL_RAG = ragService.getRagContext;
const ORIGINAL_FIND = ragService.findMentionedTours;
const NOW = new Date('2026-08-14T00:00:00.000Z');
const IDS = [
  '64b000000000000000007101',
  '64b000000000000000007102',
  '64b000000000000000007103',
];

function tour(id, index) {
  return {
    _id: id,
    name: `Tour ${String.fromCharCode(65 + index)}`,
    location: ['Nha Trang', 'Da Lat', 'Hue'][index],
    region: 'Viet Nam',
    status: 'published',
    isActive: true,
    days: 3,
    basePrice: 2_000_000 + index * 500_000,
    images: [],
    highlights: [`Evidence ${index + 1}`],
    tags: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    departures: [{
      _id: `64b00000000000000000720${index + 1}`,
      date: new Date('2026-09-10T05:00:00.000Z'),
      price: 3_000_000 + index * 500_000,
      availableSlots: 5 + index,
      totalSlots: 20,
    }],
  };
}

const TOURS = IDS.map(tour);
let providerMode = 'success';
let providerCalls = 0;
let ragMode = 'healthy';

gemini.generateChatReply = async () => {
  providerCalls += 1;
  if (providerMode === 'rate_limited') {
    const error = new Error('quota');
    error.status = 429;
    throw error;
  }
  if (providerMode === 'unavailable') {
    const error = new Error('provider down');
    error.status = 503;
    throw error;
  }
  return 'Thong tin duoc tra loi tu du lieu tour da xac minh.';
};

ragService.findMentionedTours = async () => [];
ragService.getRagContext = async (prompt, options = {}) => {
  const constraints = options.constraintState || {};
  const tours = ragMode === 'no_safe_fallback'
    ? [{ ...TOURS[0], name: '' }]
    : TOURS;
  const degraded = ragMode === 'degraded';
  return {
    tours,
    contextText: 'phase-7-grounded-context',
    matchedChunks: [],
    zeroResult: null,
    retrievalStatus: {
      status: degraded ? 'degraded' : 'healthy',
      degraded,
      mode: degraded ? 'mongo_fallback' : 'hybrid',
      reasons: degraded ? ['CHROMA_UNAVAILABLE'] : [],
      fallbackUsed: degraded,
      inventoryComplete: true,
    },
    factualGrounding: buildGroundingContract(tours, constraints, { now: NOW }),
  };
};

delete require.cache[require.resolve('../src/services/chatService')];
const {
  generateChatAnswer,
  providerFallbackReply,
} = require('../src/services/chatService');

test.after(() => {
  gemini.generateChatReply = ORIGINAL_GENERATE;
  ragService.getRagContext = ORIGINAL_RAG;
  ragService.findMentionedTours = ORIGINAL_FIND;
  delete require.cache[require.resolve('../src/services/chatService')];
});

function mockResponse(resolve) {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) {
      this.body = value;
      resolve({ passed: false, status: this.statusCode, body: value, headers: this.headers });
    },
  };
}

function invokeGateway(gateway, {
  apiKey = 'phase7-secret',
  principal = 'a'.repeat(64),
  path = '/chat',
  ip = '10.0.0.1',
  contractVersion = String(AI_CHAT_CONTRACT_VERSION),
} = {}) {
  return new Promise((resolve) => {
    const values = {
      'x-internal-api-key': apiKey,
      'x-ai-principal-id': principal,
      'x-ai-contract-version': contractVersion,
    };
    const req = { path, ip, get: (name) => values[String(name).toLowerCase()] };
    gateway(req, mockResponse(resolve), () => resolve({ passed: true, status: 200, principal: req.aiPrincipal }));
  });
}

test('TEST 4: gateway rate limiting isolates trusted user principals', async () => {
  const gateway = createInternalAiGateway({ apiKey: 'phase7-secret', max: 1, windowMs: 60_000 });
  const userA = 'a'.repeat(64);
  const userB = 'b'.repeat(64);
  assert.equal((await invokeGateway(gateway, { principal: userA })).passed, true);
  const blocked = await invokeGateway(gateway, { principal: userA });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, ERROR_CODES.RATE_LIMIT);
  assert.equal((await invokeGateway(gateway, { principal: userB })).passed, true);
});

test('TEST 5: spoofed principal is never trusted without valid internal credentials', async () => {
  const gateway = createInternalAiGateway({ apiKey: 'phase7-secret', max: 1 });
  const rejected = await invokeGateway(gateway, {
    apiKey: 'client-controlled-key',
    principal: 'f'.repeat(64),
  });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.error.code, ERROR_CODES.INVALID_INPUT);
  assert.equal(gateway.inspect().size, 0);
});

test('TEST 6: SEARCH candidate identity is provider-independent, including a simulated 429', async () => {
  ragMode = 'healthy';
  providerCalls = 0;
  providerMode = 'success';
  const success = await generateChatAnswer({ prompt: 'goi y tour 3 ngay', now: NOW });
  providerMode = 'rate_limited';
  const rateLimited = await generateChatAnswer({ prompt: 'goi y tour 3 ngay', now: NOW });

  assert.equal(success.decision.action, 'SEARCH');
  assert.equal(rateLimited.decision.action, 'SEARCH');
  assert.deepEqual(success.referencedTourIds, IDS);
  assert.deepEqual(rateLimited.referencedTourIds, IDS);
  assert.equal(success.structuredContent.type, 'recommendation');
  assert.equal(rateLimited.structuredContent.type, 'recommendation');
  assert.equal(providerCalls, 0, 'SEARCH uses the authoritative grounded renderer, not Gemini');
})

test('TEST 6 and 7: provider 429 fallback preserves all grounded candidates without invented availability', async () => {
  ragMode = 'healthy';
  providerMode = 'success';
  const success = await generateChatAnswer({ prompt: 'tour co gi?', now: NOW });
  providerMode = 'rate_limited';
  const fallback = await generateChatAnswer({ prompt: 'tour co gi?', now: NOW });

  assert.equal(success.decision.action, 'ANSWER');
  assert.equal(fallback.decision.action, 'ANSWER');
  assert.deepEqual(fallback.referencedTourIds, success.referencedTourIds);
  assert.deepEqual(fallback.referencedTourIds, IDS);
  assert.equal(fallback.providerStatus.code, ERROR_CODES.AI_PROVIDER_RATE_LIMITED);
  assert.equal(fallback.providerStatus.fallbackUsed, true);
  for (const item of TOURS) assert.match(fallback.reply, new RegExp(item.name));
  assert.doesNotMatch(fallback.reply, /con \d+ cho/i, 'no departure was selected, so availability must remain absent');

  const direct = providerFallbackReply({
    prompt: 'tour co gi?',
    tours: TOURS,
    hasVerifiedTourContext: true,
    grounding: buildGroundingContract(TOURS, {}, { now: NOW }),
  });
  for (const item of TOURS) assert.match(direct, new RegExp(item.name));
})

test('TEST 11: degraded RAG with usable Mongo candidates succeeds with explicit degraded metadata', async () => {
  ragMode = 'degraded';
  providerMode = 'unavailable';
  const result = await generateChatAnswer({ prompt: 'goi y tour 3 ngay', now: NOW });
  assert.equal(result.decision.action, 'SEARCH');
  assert.equal(result.outcome.code, 'OK');
  assert.ok(result.warnings.includes(ERROR_CODES.RAG_DEGRADED));
  assert.equal(result.retrievalStatus.status, 'degraded');
  assert.equal(result.providerStatus.status, 'skipped');
  assert.equal(result.structuredContent.tours.length, 3);
})

test('TEST 12: provider failure without a safe grounded fallback remains a typed provider error', async () => {
  ragMode = 'no_safe_fallback';
  providerMode = 'unavailable';
  await assert.rejects(
    generateChatAnswer({ prompt: 'tour co gi?', now: NOW }),
    (error) => error instanceof AiServiceError
      && error.code === ERROR_CODES.AI_PROVIDER_UNAVAILABLE
      && error.source === 'gemini'
  );
})

test('TEST 14: AI success envelopes publish contract v1 without changing payload semantics', () => {
  const envelope = successEnvelope({ reply: 'ok', outcome: { code: 'NO_RESULTS' }, warnings: ['RAG_DEGRADED'] });
  assert.equal(envelope.success, true);
  assert.equal(envelope.contractVersion, AI_CHAT_CONTRACT_VERSION);
  assert.deepEqual(envelope.outcome, { code: 'NO_RESULTS' });
  assert.deepEqual(envelope.warnings, ['RAG_DEGRADED']);
})
