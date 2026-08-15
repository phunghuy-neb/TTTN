export const AI_CHAT_CONTRACT_VERSION = 1
export const SEMANTIC_STATE_VERSION = 2

export const AI_ERROR_CODES = Object.freeze({
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_RESPONSE_INVALID: 'AI_RESPONSE_INVALID',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  AI_PROVIDER_RATE_LIMITED: 'AI_PROVIDER_RATE_LIMITED',
  RAG_DEGRADED: 'RAG_DEGRADED',
  NO_RESULTS: 'NO_RESULTS',
  INVALID_INPUT: 'INVALID_INPUT',
  BOOKING_ERROR: 'BOOKING_ERROR',
  DB_ERROR: 'DB_ERROR',
  RATE_LIMIT: 'RATE_LIMIT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
})

const ACTIONS = new Set(['SEARCH', 'ANSWER', 'CLARIFY', 'ERROR'])
const ERROR_CODES = new Set(Object.values(AI_ERROR_CODES))
const OUTCOME_CODES = new Set(['OK', AI_ERROR_CODES.NO_RESULTS])
const STRUCTURED_TYPES = new Set([
  'action_error',
  'availability',
  'booking_detail',
  'booking_guidance',
  'booking_not_found',
  'booking_summary',
  'clarification',
  'comparison',
  'grounded_answer',
  'grounded_fallback',
  'mixed_tour_facts',
  'payment_status',
  'preference_update',
  'recommendation',
  'tour_detail',
  'upcoming_bookings',
])
const OBJECT_ID = /^[0-9a-fA-F]{24}$/

const PUBLIC_MESSAGES = Object.freeze({
  [AI_ERROR_CODES.AI_UNAVAILABLE]: 'Trợ lý AI đang tạm gián đoạn. Bạn thử lại sau ít phút nhé.',
  [AI_ERROR_CODES.AI_RESPONSE_INVALID]: 'Trợ lý AI trả về dữ liệu không hợp lệ.',
  [AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE]: 'Nhà cung cấp AI đang tạm gián đoạn.',
  [AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED]: 'Nhà cung cấp AI đang quá tải. Bạn thử lại sau ít phút nhé.',
  [AI_ERROR_CODES.RAG_DEGRADED]: 'Hệ thống truy xuất tour đang suy giảm và chưa thể trả lời an toàn.',
  [AI_ERROR_CODES.INVALID_INPUT]: 'Yêu cầu gửi tới trợ lý AI không hợp lệ.',
  [AI_ERROR_CODES.BOOKING_ERROR]: 'Không thể xử lý dữ liệu booking cho yêu cầu này.',
  [AI_ERROR_CODES.DB_ERROR]: 'Dữ liệu trợ lý đang tạm thời không khả dụng.',
  [AI_ERROR_CODES.RATE_LIMIT]: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
  [AI_ERROR_CODES.INTERNAL_ERROR]: 'Trợ lý AI gặp lỗi nội bộ.',
})

export class AiGatewayError extends Error {
  constructor(code, detail = '', { status = 503, retryable = true, source = 'ai_service' } = {}) {
    super(PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES[AI_ERROR_CODES.AI_UNAVAILABLE])
    this.name = 'AiGatewayError'
    this.code = ERROR_CODES.has(code) ? code : AI_ERROR_CODES.AI_UNAVAILABLE
    this.status = status
    this.retryable = Boolean(retryable)
    this.source = source
    this.detail = String(detail || '')
  }
}

export class AiUnavailableError extends AiGatewayError {
  constructor(detail = '') {
    super(AI_ERROR_CODES.AI_UNAVAILABLE, detail, { status: 503, retryable: true })
    this.name = 'AiUnavailableError'
    this.chiTiet = detail
  }
}

export class AiResponseInvalidError extends AiGatewayError {
  constructor(detail = '') {
    super(AI_ERROR_CODES.AI_RESPONSE_INVALID, detail, {
      status: 502,
      retryable: false,
      source: 'ai_contract',
    })
    this.name = 'AiResponseInvalidError'
  }
}

function invalid(path, reason) {
  throw new AiResponseInvalidError(`${path}: ${reason}`)
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'expected object')
  return value
}

function string(value, path, { nonEmpty = true } = {}) {
  if (typeof value !== 'string') invalid(path, 'expected string')
  if (nonEmpty && !value.trim()) invalid(path, 'must not be empty')
  return value
}

function stringArray(value, path) {
  if (!Array.isArray(value)) invalid(path, 'expected array')
  value.forEach((item, index) => string(item, `${path}[${index}]`))
  return value
}

function objectId(value, path) {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) invalid(path, 'expected ObjectId string')
  return value
}

function objectIdArray(value, path) {
  if (!Array.isArray(value)) invalid(path, 'expected array')
  value.forEach((item, index) => objectId(item, `${path}[${index}]`))
  return value
}

function validateBookingSummary(value, path) {
  const booking = object(value, path)
  objectId(String(booking.bookingId || ''), `${path}.bookingId`)
  objectId(String(booking.tourId || ''), `${path}.tourId`)
  return booking
}

function validateDecision(value) {
  const decision = object(value, 'decision')
  if (!ACTIONS.has(decision.action)) invalid('decision.action', 'unsupported action')
  string(decision.operation, 'decision.operation')
  string(decision.reason, 'decision.reason')
  stringArray(decision.requiredMissing, 'decision.requiredMissing')
  stringArray(decision.optionalMissing, 'decision.optionalMissing')
  stringArray(decision.assumptions, 'decision.assumptions')
  if (decision.action === 'CLARIFY') {
    const clarification = object(decision.clarification, 'decision.clarification')
    string(clarification.slot, 'decision.clarification.slot')
    string(clarification.type, 'decision.clarification.type')
    stringArray(clarification.allowedAnswerKinds, 'decision.clarification.allowedAnswerKinds')
    if (clarification.candidateTourIds != null) {
      objectIdArray(clarification.candidateTourIds, 'decision.clarification.candidateTourIds')
    }
    if (clarification.candidateBookingIds != null) {
      objectIdArray(clarification.candidateBookingIds, 'decision.clarification.candidateBookingIds')
    }
  } else if (decision.clarification !== null) {
    invalid('decision.clarification', 'must be null outside CLARIFY')
  }
  return decision
}

function validateStructuredContent(value, decision) {
  const content = object(value, 'structuredContent')
  string(content.type, 'structuredContent.type')
  if (!STRUCTURED_TYPES.has(content.type)) invalid('structuredContent.type', 'unsupported type')
  if (decision.action === 'SEARCH') {
    if (content.type !== 'recommendation') invalid('structuredContent.type', 'SEARCH requires recommendation')
    if (!Array.isArray(content.tours)) invalid('structuredContent.tours', 'SEARCH requires tours array')
  }
  if (decision.action === 'CLARIFY') {
    if (content.type !== 'clarification') invalid('structuredContent.type', 'CLARIFY requires clarification')
    if (content.slot !== decision.clarification.slot) invalid('structuredContent.slot', 'must match decision clarification slot')
  }
  if (decision.action === 'ERROR' && content.type !== 'action_error') {
    invalid('structuredContent.type', 'ERROR requires action_error')
  }
  if (decision.action === 'ANSWER' && ['clarification', 'recommendation'].includes(content.type)) {
    invalid('structuredContent.type', 'does not match ANSWER action')
  }
  if (content.type === 'comparison' && !Array.isArray(content.tours)) invalid('structuredContent.tours', 'comparison requires tours')
  if (content.type === 'availability' && !Array.isArray(content.departures)) invalid('structuredContent.departures', 'availability requires departures')
  if (content.type === 'mixed_tour_facts' && !Array.isArray(content.facts)) invalid('structuredContent.facts', 'mixed facts require facts')
  if (content.type === 'grounded_fallback') string(content.reason, 'structuredContent.reason')
  if (content.type === 'action_error') string(content.reason, 'structuredContent.reason')
  if (content.type === 'booking_not_found') string(content.reason, 'structuredContent.reason')
  if (content.type === 'preference_update') {
    if (typeof content.updated !== 'boolean') invalid('structuredContent.updated', 'expected boolean')
    if (typeof content.forgotten !== 'boolean') invalid('structuredContent.forgotten', 'expected boolean')
  }
  if (content.type === 'upcoming_bookings') {
    if (!Array.isArray(content.bookings)) invalid('structuredContent.bookings', 'expected array')
    content.bookings.forEach((booking, index) => validateBookingSummary(booking, `structuredContent.bookings[${index}]`))
  }
  if (['booking_detail', 'booking_summary', 'booking_guidance', 'payment_status'].includes(content.type)) {
    validateBookingSummary(content.booking, 'structuredContent.booking')
  }
  if (content.type === 'booking_guidance') string(content.action, 'structuredContent.action')
  if (content.candidateTourIds != null) objectIdArray(content.candidateTourIds, 'structuredContent.candidateTourIds')
  if (content.candidateBookingIds != null) objectIdArray(content.candidateBookingIds, 'structuredContent.candidateBookingIds')
  if (Array.isArray(content.tours)) {
    content.tours.forEach((tour, index) => {
      object(tour, `structuredContent.tours[${index}]`)
      objectId(String(tour?.tourId || tour?._id || ''), `structuredContent.tours[${index}].tourId`)
    })
  }
  if (content.tourId != null) objectId(String(content.tourId), 'structuredContent.tourId')
  return content
}

function validateState(value, path) {
  const state = object(value, path)
  if (state._semanticState && Number(state._semanticState.version) !== SEMANTIC_STATE_VERSION) {
    invalid(`${path}._semanticState.version`, `expected ${SEMANTIC_STATE_VERSION}`)
  }
  return state
}

function validateTourCards(value) {
  if (!Array.isArray(value)) invalid('tours', 'expected array')
  value.forEach((tour, index) => {
    object(tour, `tours[${index}]`)
    objectId(String(tour?._id || tour?.tourId || ''), `tours[${index}]._id`)
  })
  return value
}

function validateRetrievalStatus(value) {
  if (value == null) return null
  const status = object(value, 'retrievalStatus')
  if (!['healthy', 'degraded'].includes(status.status)) invalid('retrievalStatus.status', 'unsupported status')
  if (typeof status.degraded !== 'boolean') invalid('retrievalStatus.degraded', 'expected boolean')
  if (status.degraded !== (status.status === 'degraded')) invalid('retrievalStatus.degraded', 'must match status')
  stringArray(status.reasons || [], 'retrievalStatus.reasons')
  return status
}

function validateProviderStatus(value) {
  if (value == null) return null
  const status = object(value, 'providerStatus')
  if (!['healthy', 'degraded', 'skipped'].includes(status.status)) invalid('providerStatus.status', 'unsupported status')
  if (status.code != null && !ERROR_CODES.has(status.code)) invalid('providerStatus.code', 'unsupported error code')
  if (typeof status.fallbackUsed !== 'boolean') invalid('providerStatus.fallbackUsed', 'expected boolean')
  if (status.status === 'degraded' && status.code == null) invalid('providerStatus.code', 'required when degraded')
  if (status.status !== 'degraded' && status.code != null) invalid('providerStatus.code', 'must be null unless degraded')
  return status
}

function validateOutcome(value) {
  if (value == null) return { code: 'OK' }
  const outcome = object(value, 'outcome')
  if (!OUTCOME_CODES.has(outcome.code)) invalid('outcome.code', 'unsupported outcome')
  return outcome
}

function validateObservability(value) {
  if (value == null) return null
  const trace = object(value, 'observability')
  if (Number(trace.schemaVersion) !== 1) invalid('observability.schemaVersion', 'unsupported version')
  object(trace.traceContext, 'observability.traceContext')
  object(trace.semantic, 'observability.semantic')
  object(trace.action, 'observability.action')
  object(trace.retrieval, 'observability.retrieval')
  object(trace.provider, 'observability.provider')
  object(trace.validation, 'observability.validation')
  object(trace.finalResponse, 'observability.finalResponse')
  return trace
}

export function validateAiChatResponse(value) {
  const data = object(value, 'response')
  if (data.success === false || data.error != null) invalid('response', 'error envelope cannot be used as success')
  if (data.success != null && data.success !== true) invalid('success', 'expected true')
  if (data.contractVersion != null && Number(data.contractVersion) !== AI_CHAT_CONTRACT_VERSION) {
    invalid('contractVersion', `unsupported version ${data.contractVersion}`)
  }
  const reply = string(data.reply, 'reply').trim()
  const decision = validateDecision(data.decision)
  const structuredContent = validateStructuredContent(data.structuredContent, decision)
  const constraintState = validateState(data.constraintState, 'constraintState')
  const entityState = object(data.entityState, 'entityState')
  const tours = validateTourCards(data.tours ?? data.suggestedTours ?? [])
  const referencedTourIds = objectIdArray(data.referencedTourIds || [], 'referencedTourIds')
  const referencedBookingIds = objectIdArray(data.referencedBookingIds || [], 'referencedBookingIds')
  const retrievalStatus = validateRetrievalStatus(data.retrievalStatus)
  const providerStatus = validateProviderStatus(data.providerStatus)
  const outcome = validateOutcome(data.outcome)
  const warnings = stringArray(data.warnings || [], 'warnings')
  const observability = validateObservability(data.observability)
  return {
    ...data,
    contractVersion: Number(data.contractVersion) || 0,
    reply,
    decision,
    structuredContent,
    constraintState,
    entityState,
    tours,
    referencedTourIds,
    referencedBookingIds,
    retrievalStatus,
    providerStatus,
    outcome,
    warnings,
    observability,
  }
}

function statusForErrorCode(code, fallbackStatus) {
  if (code === AI_ERROR_CODES.RATE_LIMIT) return 429
  if (code === AI_ERROR_CODES.INVALID_INPUT) return 400
  if (code === AI_ERROR_CODES.AI_RESPONSE_INVALID) return 502
  if ([AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE, AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED, AI_ERROR_CODES.RAG_DEGRADED, AI_ERROR_CODES.DB_ERROR].includes(code)) return 503
  if ([AI_ERROR_CODES.BOOKING_ERROR, AI_ERROR_CODES.INTERNAL_ERROR].includes(code)) return 502
  return fallbackStatus >= 400 ? fallbackStatus : 503
}

export function aiGatewayErrorFromResponse(status, payload) {
  const error = payload?.error
  if (
    !error
    || typeof error !== 'object'
    || !ERROR_CODES.has(error.code)
    || typeof error.message !== 'string'
    || !error.message.trim()
    || typeof error.source !== 'string'
    || !error.source.trim()
    || typeof error.retryable !== 'boolean'
  ) {
    return new AiResponseInvalidError(`Invalid AI error envelope for HTTP ${status}`)
  }
  return new AiGatewayError(error.code, error.message, {
    status: statusForErrorCode(error.code, status),
    retryable: error.retryable !== false,
    source: typeof error.source === 'string' ? error.source : 'ai_service',
  })
}

export function serviceStatusFromResponse(response) {
  const codes = []
  if (response.retrievalStatus?.degraded) codes.push(AI_ERROR_CODES.RAG_DEGRADED)
  if (response.providerStatus?.status === 'degraded' && response.providerStatus.code) codes.push(response.providerStatus.code)
  return {
    degraded: codes.length > 0,
    codes: [...new Set(codes)],
    retrieval: response.retrievalStatus,
    provider: response.providerStatus,
  }
}
