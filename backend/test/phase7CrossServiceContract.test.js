import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_CHAT_CONTRACT_VERSION,
  AI_ERROR_CODES,
  AiResponseInvalidError,
  aiGatewayErrorFromResponse,
  validateAiChatResponse,
} from '../src/services/aiResponseContract.js'
import { sinhTraLoi, trustedAiPrincipal } from '../src/services/aiAdapter.js'
import { rateLimit } from '../src/middleware/security.js'
import { parseBookingRequest } from '../src/services/aiBookingReadService.js'
import { toChatDependencyError } from '../src/services/chatDependencyError.js'

const TOUR_ID = '64b000000000000000007001'

function validResponse(overrides = {}) {
  return {
    success: true,
    contractVersion: AI_CHAT_CONTRACT_VERSION,
    reply: 'Cau tra loi hop le.',
    decision: {
      action: 'ANSWER',
      operation: 'general_answer',
      reason: 'general_request',
      requiredMissing: [],
      optionalMissing: [],
      assumptions: [],
      clarification: null,
    },
    structuredContent: { type: 'grounded_answer', scope: 'assistant', tours: [] },
    constraintState: { _semanticState: { version: 2, slots: {} } },
    entityState: {},
    tours: [],
    referencedTourIds: [],
    referencedBookingIds: [],
    retrievalStatus: { status: 'healthy', degraded: false, reasons: [] },
    providerStatus: { status: 'healthy', code: null, fallbackUsed: false },
    outcome: { code: 'OK' },
    warnings: [],
    ...overrides,
  }
}

test('TEST 1: HTTP 200 with an empty reply is rejected before persistence', () => {
  assert.throws(
    () => validateAiChatResponse(validResponse({ reply: '' })),
    (error) => error instanceof AiResponseInvalidError && error.code === AI_ERROR_CODES.AI_RESPONSE_INVALID
  )
})

test('TEST 2: an unsupported action enum is rejected', () => {
  const payload = validResponse()
  payload.decision.action = 'RETRY_LATER'
  assert.throws(
    () => validateAiChatResponse(payload),
    (error) => error instanceof AiResponseInvalidError && /decision\.action/.test(error.detail)
  )
})

test('TEST 3: SEARCH without a structured tours field is rejected', () => {
  const payload = validResponse({
    decision: {
      action: 'SEARCH',
      operation: 'recommendation',
      reason: 'recommendation_actionable',
      requiredMissing: [],
      optionalMissing: [],
      assumptions: [],
      clarification: null,
    },
    structuredContent: { type: 'recommendation' },
  })
  assert.throws(
    () => validateAiChatResponse(payload),
    (error) => error instanceof AiResponseInvalidError && /structuredContent\.tours/.test(error.detail)
  )
})

test('unknown structured-content branches cannot pass as a valid ANSWER', () => {
  assert.throws(
    () => validateAiChatResponse(validResponse({ structuredContent: { type: 'provider_guess' } })),
    (error) => error instanceof AiResponseInvalidError && /structuredContent\.type/.test(error.detail)
  )
})

function invokeLimiter(limiter, { userId, forwardedIdentity = '' }) {
  return new Promise((resolve) => {
    const headers = {}
    const req = {
      ip: '10.0.0.1',
      user: { _id: userId },
      get(name) {
        return name.toLowerCase() === 'x-ai-principal-id' ? forwardedIdentity : undefined
      },
    }
    const res = {
      statusCode: 200,
      body: null,
      setHeader(name, value) { headers[name] = value },
      status(value) { this.statusCode = value; return this },
      json(value) { this.body = value; resolve({ passed: false, status: this.statusCode, body: value, headers }) },
    }
    limiter(req, res, () => resolve({ passed: true, status: 200, headers }))
  })
}

test('TEST 4 and 5: public rate limiting is user-scoped and ignores spoofed forwarded identity', async () => {
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 1,
    prefix: 'phase7-test',
    keyGenerator: (req) => `user:${req.user._id}`,
    code: 'RATE_LIMIT',
  })

  assert.equal((await invokeLimiter(limiter, { userId: 'user-a', forwardedIdentity: 'spoof-1' })).passed, true)
  const blocked = await invokeLimiter(limiter, { userId: 'user-a', forwardedIdentity: 'spoof-2' })
  assert.equal(blocked.status, 429)
  assert.equal(blocked.body.code, 'RATE_LIMIT')
  assert.equal((await invokeLimiter(limiter, { userId: 'user-b', forwardedIdentity: 'spoof-1' })).passed, true)
})

test('trusted outbound AI principals are stable per authenticated user and cannot be supplied by the client', async (t) => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.AI_SERVICE_URL
  const originalKey = process.env.AI_SERVICE_API_KEY
  t.after(() => {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.AI_SERVICE_URL
    else process.env.AI_SERVICE_URL = originalUrl
    if (originalKey === undefined) delete process.env.AI_SERVICE_API_KEY
    else process.env.AI_SERVICE_API_KEY = originalKey
  })

  process.env.AI_SERVICE_URL = 'http://ai.internal/api/ai'
  process.env.AI_SERVICE_API_KEY = 'phase7-secret'
  const captured = []
  globalThis.fetch = async (url, options) => {
    captured.push({ url, options })
    return { ok: true, status: 200, json: async () => validResponse() }
  }

  await sinhTraLoi({ userId: 'authenticated-user-a', message: 'hello' })
  await sinhTraLoi({ userId: 'authenticated-user-b', message: 'hello' })

  const first = captured[0].options.headers['x-ai-principal-id']
  const second = captured[1].options.headers['x-ai-principal-id']
  assert.equal(first, trustedAiPrincipal('authenticated-user-a', 'phase7-secret'))
  assert.equal(second, trustedAiPrincipal('authenticated-user-b', 'phase7-secret'))
  assert.notEqual(first, second)
  assert.equal(captured[0].options.headers['x-ai-contract-version'], String(AI_CHAT_CONTRACT_VERSION))
})

test('typed AI error envelopes retain provider and retrieval classifications', () => {
  const provider = aiGatewayErrorFromResponse(503, {
    error: { code: 'AI_PROVIDER_RATE_LIMITED', message: 'quota', source: 'gemini', retryable: true },
  })
  assert.equal(provider.code, AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED)
  assert.equal(provider.status, 503)
  assert.equal(provider.source, 'gemini')

  const retrieval = aiGatewayErrorFromResponse(503, {
    error: { code: 'RAG_DEGRADED', message: 'index unavailable', source: 'retrieval', retryable: true },
  })
  assert.equal(retrieval.code, AI_ERROR_CODES.RAG_DEGRADED)

  const malformed = aiGatewayErrorFromResponse(503, { error: 'provider down' })
  assert.equal(malformed.code, AI_ERROR_CODES.AI_RESPONSE_INVALID)
})

test('local DB and booking adapter failures use the shared typed taxonomy', () => {
  const databaseError = new Error('mongo unavailable')
  databaseError.name = 'MongooseServerSelectionError'
  const database = toChatDependencyError(databaseError, { source: 'preference_store' })
  assert.equal(database.code, AI_ERROR_CODES.DB_ERROR)
  assert.equal(database.status, 503)
  assert.equal(database.source, 'preference_store')

  const booking = toChatDependencyError(new Error('booking adapter failed'), {
    source: 'booking_adapter',
    fallbackCode: AI_ERROR_CODES.BOOKING_ERROR,
  })
  assert.equal(booking.code, AI_ERROR_CODES.BOOKING_ERROR)
  assert.equal(booking.status, 502)
})

test('TEST 8-10: booking policy reads, cancellation commands and mixed reads keep distinct routing', () => {
  const policy = parseBookingRequest('chinh sach huy the nao?')
  assert.equal(policy.active, false)
  assert.equal(policy.actionType, null)

  const cancel = parseBookingRequest('hay huy booking VV-ABC-123456')
  assert.equal(cancel.active, true)
  assert.equal(cancel.requestType, 'guidance_action')
  assert.equal(cancel.actionType, 'cancel')

  const mixed = parseBookingRequest('tour thu hai con cho khong va chinh sach huy the nao')
  assert.equal(mixed.active, false)
  assert.equal(mixed.actionType, null)
})

test('TEST 14: contract v1 and legacy-compatible payloads pass; explicit incompatible versions fail', () => {
  assert.equal(validateAiChatResponse(validResponse()).contractVersion, AI_CHAT_CONTRACT_VERSION)
  const legacy = validResponse()
  delete legacy.contractVersion
  assert.equal(validateAiChatResponse(legacy).contractVersion, 0)
  assert.throws(
    () => validateAiChatResponse(validResponse({ contractVersion: 99 })),
    (error) => error instanceof AiResponseInvalidError && /contractVersion/.test(error.detail)
  )

  const search = validResponse({
    decision: {
      action: 'SEARCH',
      operation: 'recommendation',
      reason: 'recommendation_actionable',
      requiredMissing: [],
      optionalMissing: [],
      assumptions: [],
      clarification: null,
    },
    structuredContent: { type: 'recommendation', tours: [{ tourId: TOUR_ID }] },
    tours: [{ _id: TOUR_ID, title: 'Tour A', price: 1 }],
    referencedTourIds: [TOUR_ID],
  })
  assert.equal(validateAiChatResponse(search).decision.action, 'SEARCH')
})
