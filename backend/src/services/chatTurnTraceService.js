import { createHash, createHmac, randomUUID } from 'node:crypto'

export const CHAT_TRACE_SCHEMA_VERSION = 1

const TRACE_ID = /^[a-zA-Z0-9._:-]{1,128}$/
const OMIT_EXACT_KEY = /^(?:prompt|prompts|message|messages|content|contents|history|username|email|phone|bookingcontext|preferencecontext|raw|sourcetext|lastspans)$/i
const OMIT_SECRET_SUFFIX = /(?:token|secret|credential|apikey)$/i

function shouldOmitTraceKey(key) {
  const normalized = String(key || '').replace(/[^a-z0-9]/gi, '')
  return OMIT_EXACT_KEY.test(normalized)
    || OMIT_SECRET_SUFFIX.test(normalized)
    || normalized.toLowerCase().startsWith('raw')
}

export function normalizeRequestId(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return randomUUID()
  if (!TRACE_ID.test(normalized)) {
    const error = new Error('requestId khong hop le.')
    error.status = 400
    error.code = 'VALIDATION_ERROR'
    throw error
  }
  return normalized
}

export function safeTraceValue(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, 512)
  if (depth >= 8) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeTraceValue(item, depth + 1))
  if (typeof value !== 'object') return String(value).slice(0, 128)

  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (shouldOmitTraceKey(key)) continue
    result[key] = safeTraceValue(item, depth + 1)
  }
  return result
}

export function traceUserIdentity(userId, secret = process.env.AI_SERVICE_API_KEY || '') {
  const principal = createHmac('sha256', String(secret)).update(String(userId || '')).digest('hex')
  return createHash('sha256').update(`user:${principal}`).digest('hex')
}

export function buildTraceContext({ requestId, logicalTurnId, conversationId, historyEpoch, turnSequence, userId }) {
  return {
    requestId,
    clientMessageId: logicalTurnId,
    logicalTurnId,
    conversationId: String(conversationId || ''),
    historyEpoch: Number(historyEpoch),
    turnSequence: Number(turnSequence),
    userIdentityHash: traceUserIdentity(userId),
  }
}

export function buildPendingTurnTrace(traceContext) {
  return safeTraceValue({
    schemaVersion: CHAT_TRACE_SCHEMA_VERSION,
    traceContext,
    lifecycle: { status: 'pending' },
    persistence: { status: 'not_started' },
  })
}

export function mergeAiTurnTrace({ traceContext, observability, persistenceStatus = 'pending_commit' }) {
  return safeTraceValue({
    schemaVersion: CHAT_TRACE_SCHEMA_VERSION,
    ...(observability || {}),
    traceContext: { ...(observability?.traceContext || {}), ...traceContext },
    lifecycle: { status: 'processing' },
    persistence: { status: persistenceStatus },
  })
}

export function failedTurnTrace({ traceContext, existingTrace, error, persistenceStatus = 'failed_turn_pending' }) {
  return safeTraceValue({
    schemaVersion: CHAT_TRACE_SCHEMA_VERSION,
    ...(existingTrace || {}),
    traceContext: { ...(existingTrace?.traceContext || {}), ...traceContext },
    lifecycle: { status: 'failed' },
    validation: {
      status: error?.code === 'AI_RESPONSE_INVALID' ? 'rejected' : 'not_completed',
      reason: error?.code || error?.name || 'ERROR',
    },
    provider: {
      status: 'failed',
      code: error?.code || null,
      source: error?.source || null,
    },
    persistence: { status: persistenceStatus },
    finalResponse: { status: 'error', code: error?.code || 'INTERNAL_ERROR' },
  })
}

export function committedTurnTrace(trace, status) {
  return safeTraceValue({
    ...(trace || {}),
    lifecycle: { status: status === 'committed' ? 'completed' : 'failed' },
    persistence: { status },
  })
}

export function emitLogicalTurnTrace(trace, sink = console.info) {
  if (process.env.NODE_TEST_CONTEXT || process.env.CHAT_TRACE_LOGGING === 'false') return
  sink('[chat.turn.trace]', safeTraceValue(trace))
}
