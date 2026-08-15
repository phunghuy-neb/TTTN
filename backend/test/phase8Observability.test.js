import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  AI_CHAT_CONTRACT_VERSION,
  AiResponseInvalidError,
  validateAiChatResponse,
} from '../src/services/aiResponseContract.js'
import { sinhTraLoi, trustedAiPrincipal } from '../src/services/aiAdapter.js'
import {
  buildPendingTurnTrace,
  buildTraceContext,
  failedTurnTrace,
  normalizeRequestId,
  safeTraceValue,
} from '../src/services/chatTurnTraceService.js'

const TRACE_CONTEXT = {
  requestId: 'request-phase8-1',
  clientMessageId: 'logical-phase8-1',
  logicalTurnId: 'logical-phase8-1',
  conversationId: '64b000000000000000008001',
  historyEpoch: 2,
  turnSequence: 7,
  userIdentityHash: 'a'.repeat(64),
}

function observability() {
  return {
    schemaVersion: 1,
    traceContext: TRACE_CONTEXT,
    semantic: { previousState: {}, extractedDelta: {}, mergedState: {} },
    action: { decision: { action: 'ANSWER', reason: 'general_request' }, pendingClarification: null },
    retrieval: { mode: 'not_required', filters: {}, candidateIds: {}, ranking: [], grounding: [] },
    provider: { status: 'skipped', code: null, fallbackUsed: false },
    validation: { status: 'not_required', reason: null },
    finalResponse: { action: 'ANSWER', replyPresent: true, replyLength: 2, replyHash: 'b'.repeat(64) },
  }
}

function validResponse() {
  return {
    success: true,
    contractVersion: AI_CHAT_CONTRACT_VERSION,
    reply: 'ok',
    decision: {
      action: 'ANSWER', operation: 'general_answer', reason: 'general_request',
      requiredMissing: [], optionalMissing: [], assumptions: [], clarification: null,
    },
    structuredContent: { type: 'grounded_answer', scope: 'assistant', tours: [] },
    constraintState: { _semanticState: { version: 2, slots: {} } },
    entityState: {},
    tours: [],
    referencedTourIds: [],
    referencedBookingIds: [],
    retrievalStatus: { status: 'healthy', degraded: false, reasons: [] },
    providerStatus: { status: 'skipped', code: null, fallbackUsed: false },
    outcome: { code: 'OK' },
    warnings: [],
    observability: observability(),
  }
}

test('logical-turn trace contains stable identities and redacts prompt/history/secrets', () => {
  const context = buildTraceContext({
    requestId: 'request-phase8-1',
    logicalTurnId: 'logical-phase8-1',
    conversationId: '64b000000000000000008001',
    historyEpoch: 2,
    turnSequence: 7,
    userId: '64b000000000000000008099',
  })
  const trace = buildPendingTurnTrace(context)
  const safe = safeTraceValue({
    ...trace,
    prompt: 'private prompt',
    history: [{ content: 'private history' }],
    token: 'secret',
    semantic: { lastSpans: [{ text: 'private span' }], slots: { budget: { max: 5_000_000 } } },
  })

  assert.equal(normalizeRequestId('request-phase8-1'), 'request-phase8-1')
  assert.equal(safe.prompt, undefined)
  assert.equal(safe.history, undefined)
  assert.equal(safe.token, undefined)
  assert.equal(safe.semantic.lastSpans, undefined)
  assert.equal(safe.semantic.slots.budget.max, 5_000_000)
  assert.equal(trace.traceContext.turnSequence, 7)
  assert.equal(trace.traceContext.userIdentityHash.length, 64)
})

test('trace redaction preserves lifecycle identity without exposing messages or credentials', () => {
  const trace = safeTraceValue({
    requestId: 'request-phase9-1',
    clientMessageId: 'client-phase9-1',
    logicalTurnId: 'logical-phase9-1',
    historyEpoch: 4,
    message: 'private prompt',
    rawPageContext: { pageType: 'TOUR_DETAIL' },
    accessToken: 'private token',
  })

  assert.equal(trace.requestId, 'request-phase9-1')
  assert.equal(trace.clientMessageId, 'client-phase9-1')
  assert.equal(trace.logicalTurnId, 'logical-phase9-1')
  assert.equal(trace.historyEpoch, 4)
  assert.equal('message' in trace, false)
  assert.equal('rawPageContext' in trace, false)
  assert.equal('accessToken' in trace, false)
})

test('backend validates the additive observability schema before persistence', () => {
  assert.equal(validateAiChatResponse(validResponse()).observability.schemaVersion, 1)
  const invalid = validResponse()
  delete invalid.observability.retrieval
  assert.throws(
    () => validateAiChatResponse(invalid),
    (error) => error instanceof AiResponseInvalidError && /observability\.retrieval/.test(error.detail)
  )
})

test('AI adapter forwards trace context and returns only validated observability', async (t) => {
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
  process.env.AI_SERVICE_API_KEY = 'phase8-secret'
  let body
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body)
    return { ok: true, status: 200, json: async () => validResponse() }
  }

  const result = await sinhTraLoi({ userId: 'user-phase8', message: 'hello', traceContext: TRACE_CONTEXT })
  assert.deepEqual(body.traceContext, TRACE_CONTEXT)
  assert.equal(result.observability.schemaVersion, 1)
  const principal = trustedAiPrincipal('user-phase8', 'phase8-secret')
  assert.equal(
    createHash('sha256').update(`user:${principal}`).digest('hex').length,
    64
  )
})

test('failed turns retain typed validation and persistence status without raw error text', () => {
  const error = Object.assign(new Error('private provider detail'), {
    code: 'AI_RESPONSE_INVALID', source: 'ai_contract',
  })
  const trace = failedTurnTrace({ traceContext: TRACE_CONTEXT, error })
  assert.equal(trace.validation.status, 'rejected')
  assert.equal(trace.persistence.status, 'failed_turn_pending')
  assert.equal(trace.finalResponse.code, 'AI_RESPONSE_INVALID')
  assert.equal(JSON.stringify(trace).includes('private provider detail'), false)
})
