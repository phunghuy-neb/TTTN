import mongoose from 'mongoose'
import ChatMessage from '../models/ChatMessage.js'
import ChatTurn from '../models/ChatTurn.js'
import Conversation from '../models/Conversation.js'
import Tour from '../models/Tour.js'
import { sinhTraLoi, AiGatewayError } from '../services/aiAdapter.js'
import { AI_ERROR_CODES } from '../services/aiResponseContract.js'
import { toChatDependencyError } from '../services/chatDependencyError.js'
import { buildOwnedBookingContext } from '../services/aiBookingReadService.js'
import {
  commitUserPreferenceChanges,
  prepareUserPreferenceMessage,
} from '../services/userPreferenceService.js'
import {
  assertConversationConsistency,
  ChatConsistencyError,
  ChatLifecycleError,
  createChatTurnLifecycle,
  createMongoChatTurnRepository,
  normalizeLogicalTurnId,
} from '../services/chatTurnLifecycleService.js'
import {
  applyCandidateListLifecycle,
  buildPaginationMeta,
  extractVisibleTourIdentity,
  mergeCandidateCards,
  sanitizeCandidateEntityState,
} from '../services/chatEntityLifecycleService.js'
import {
  buildPendingTurnTrace,
  buildTraceContext,
  failedTurnTrace,
  mergeAiTurnTrace,
  normalizeRequestId,
} from '../services/chatTurnTraceService.js'

const DEFAULT_TITLE = 'Cuộc trò chuyện mới'

function makeTitle(content) {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return DEFAULT_TITLE
  return normalized.length > 64 ? `${normalized.slice(0, 61)}...` : normalized
}

function serializeConversation(conversation) {
  return {
    _id: conversation._id,
    title: conversation.title,
    type: conversation.type || 'GENERAL',
    bookingId: conversation.bookingId || null,
    historyEpoch: Number(conversation.historyEpoch || 0),
    committedTurnSequence: Number(conversation.committedTurnSequence || 0),
    stateTurnSequence: Number(conversation.stateTurnSequence || 0),
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  }
}

const PAGE_TYPES = new Set([
  'HOME',
  'SEARCH',
  'TOUR_LIST',
  'TOUR_DETAIL',
  'CHECKOUT',
  'PAYMENT',
  'BOOKING_SUCCESS',
  'MY_BOOKINGS',
  'BOOKING_DETAIL',
  'AI_ASSISTANT',
  'OTHER',
])

function sanitizeSearchContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const allowed = ['q', 'region', 'minPrice', 'maxPrice', 'days', 'sort']
  const result = {}
  for (const key of allowed) {
    const raw = value[key]
    if (typeof raw === 'string' && raw.trim()) result[key] = raw.trim().slice(0, 160)
    else if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = raw
  }
  return Object.keys(result).length ? result : null
}

function sanitizeObjectIds(values = []) {
  const list = Array.isArray(values) ? values : []
  return [...new Set(list.map(String).filter((value) => mongoose.isValidObjectId(value)))].slice(0, 6)
}

function sanitizeAllObjectIds(values = []) {
  const list = Array.isArray(values) ? values : []
  return [...new Set(list.map(String).filter((value) => mongoose.isValidObjectId(value)))]
}

function sanitizeBookingPageId(value) {
  return mongoose.isValidObjectId(String(value || '')) ? String(value) : null
}

function sanitizeAiEntityState(nextState, previousState, bookingContext) {
  const rawNext = nextState && typeof nextState === 'object' ? { ...nextState } : { ...previousState }
  const next = sanitizeCandidateEntityState(rawNext, sanitizeAllObjectIds)
  const bookingKeys = [
    'lastReferencedBookingIds',
    'lastListedBookingIds',
    'recentBookingIds',
    'ambiguousBookingIds',
  ]
  if (!bookingContext?.active) {
    for (const key of bookingKeys) {
      if (previousState?.[key]) next[key] = previousState[key]
      else delete next[key]
    }
    return next
  }

  const allowed = new Set(sanitizeObjectIds(bookingContext.allowedBookingIds || []))
  for (const key of bookingKeys) {
    const values = sanitizeObjectIds(next[key] || []).filter((id) => allowed.has(id))
    if (values.length) next[key] = values
    else delete next[key]
  }
  return next
}

// Gan cac chatMessages cu vao mot conversation mac dinh khi user mo chat lan dau.
async function backfillLegacyMessages(userId) {
  const firstLegacyMessage = await ChatMessage.findOne({ userId, conversationId: null })
    .sort({ at: 1 })
    .lean()
  if (!firstLegacyMessage) return null

  const [lastLegacyMessage, firstUserMessage] = await Promise.all([
    ChatMessage.findOne({ userId, conversationId: null }).sort({ at: -1 }).lean(),
    ChatMessage.findOne({ userId, conversationId: null, role: 'user' }).sort({ at: 1 }).lean(),
  ])

  let conversation
  try {
    conversation = await Conversation.findOneAndUpdate(
      { userId, isDefault: true },
      {
        $setOnInsert: {
          userId,
          isDefault: true,
          title: makeTitle(firstUserMessage?.content || firstLegacyMessage.content),
          lastMessageAt: lastLegacyMessage?.at || new Date(),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
  } catch (error) {
    // Hai request dau tien co the backfill dong thoi; request sau dung ban ghi vua tao.
    if (error?.code !== 11000) throw error
    conversation = await Conversation.findOne({ userId, isDefault: true })
  }

  await ChatMessage.updateMany(
    { userId, conversationId: null },
    { $set: { conversationId: conversation._id, historyEpoch: 0 } }
  )
  return conversation
}

async function findOwnedConversation(userId, conversationId) {
  if (!mongoose.isValidObjectId(conversationId)) return null
  return Conversation.findOne({ _id: conversationId, userId })
}

async function getOrCreateConversation(userId, conversationId) {
  await backfillLegacyMessages(userId)

  if (conversationId) return findOwnedConversation(userId, conversationId)

  const latest = await Conversation.findOne({ userId }).sort({ lastMessageAt: -1 })
  if (latest) return latest

  return Conversation.create({ userId, title: DEFAULT_TITLE, lastMessageAt: new Date() })
}

export const createConversation = async (req, res) => {
  try {
    const requestedTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    const conversation = await Conversation.create({
      userId: req.user._id,
      title: requestedTitle ? makeTitle(requestedTitle) : DEFAULT_TITLE,
      lastMessageAt: new Date(),
    })
    res.status(201).json({ success: true, conversation: serializeConversation(conversation) })
  } catch (error) {
    console.error('[createConversation]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

export const listConversations = async (req, res) => {
  try {
    await backfillLegacyMessages(req.user._id)
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
    const query = { userId: req.user._id }
    const [conversations, total] = await Promise.all([
      Conversation.find(query)
        .sort({ lastMessageAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Conversation.countDocuments(query),
    ])
    const pagination = buildPaginationMeta(total, page, limit)

    res.json({
      success: true,
      conversations: conversations.map(serializeConversation),
      ...pagination,
    })
  } catch (error) {
    console.error('[listConversations]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

async function loadConversationMessagePage({ userId, conversation, page, limit }) {
  const skip = (page - 1) * limit
  const historyEpoch = Number(conversation.historyEpoch || 0)
  const epochFilter = historyEpoch === 0
    ? { $or: [{ historyEpoch: 0 }, { historyEpoch: { $exists: false } }] }
    : { historyEpoch }
  const query = { userId, conversationId: conversation._id, ...epochFilter }
  const [messages, total, latestAssistantMessage] = await Promise.all([
    ChatMessage.find(query).sort({ at: -1 }).skip(skip).limit(limit).lean(),
    ChatMessage.countDocuments(query),
    ChatMessage.findOne({ ...query, role: 'assistant', turnSequence: { $ne: null } })
      .sort({ turnSequence: -1 })
      .select('historyEpoch turnSequence')
      .lean(),
  ])
  return { messages, total, latestAssistantMessage }
}

async function hydrateMessagePresentation(messages = []) {
  const allTourIds = sanitizeAllObjectIds(messages.flatMap((message) => [
    ...(message.candidateList?.tourIds || []),
    ...(message.suggestedTourIds || []),
  ]))
  const tours = allTourIds.length
    ? await Tour.find({ _id: { $in: allTourIds } })
      .select('_id name basePrice images status isActive')
      .lean()
    : []
  const toursById = new Map(tours.map((tour) => [String(tour._id), tour]))
  return messages.map((message) => {
    const tourIds = sanitizeAllObjectIds([
      ...(message.candidateList?.tourIds || []),
      ...(message.suggestedTourIds || []),
    ])
    return {
      ...message,
      suggestedTours: message.role === 'assistant' && tourIds.length
        ? mergeCandidateCards({
          tourIds,
          snapshots: message.suggestedTours || [],
          toursById,
        })
        : [],
    }
  })
}

function serializeChatMessage(message) {
  return {
    _id: message._id,
    conversationId: message.conversationId,
    clientMessageId: message.logicalTurnId || null,
    turnSequence: message.turnSequence || null,
    historyEpoch: Number(message.historyEpoch || 0),
    role: message.role,
    content: message.content,
    tourId: message.tourId,
    pageContext: message.pageContext,
    referencedTourIds: message.referencedTourIds || [],
    suggestedTourIds: message.suggestedTourIds || [],
    suggestedTours: message.suggestedTours || [],
    candidateList: message.candidateList || null,
    referencedBookingIds: message.referencedBookingIds || [],
    structuredContent: message.structuredContent,
    contractVersion: message.contractVersion || null,
    outcome: message.outcome || null,
    serviceStatus: message.serviceStatus || null,
    warnings: message.warnings || [],
    at: message.at,
  }
}

function structuredTourSnapshots(structuredContent) {
  if (!Array.isArray(structuredContent?.tours)) return []
  return structuredContent.tours.map((tour) => ({
    _id: tour?.tourId || tour?._id,
    title: tour?.name || tour?.title || '',
    price: Number(tour?.price) || 0,
    ...(tour?.priceBasis ? { priceBasis: tour.priceBasis } : {}),
    ...(tour?.departure ? { departure: tour.departure } : {}),
    ...(tour?.availability ? { availability: tour.availability } : {}),
  }))
}

async function hydrateCandidateCardsForResult(result, candidateTourIds) {
  if (!candidateTourIds.length) return []
  const tours = await Tour.find({ _id: { $in: candidateTourIds } })
    .select('_id name basePrice images status isActive')
    .lean()
  return mergeCandidateCards({
    tourIds: candidateTourIds,
    snapshots: [...(result.suggestedTours || []), ...structuredTourSnapshots(result.structuredContent)],
    toursById: new Map(tours.map((tour) => [String(tour._id), tour])),
  })
}

export const getConversationMessages = async (req, res) => {
  try {
    await backfillLegacyMessages(req.user._id)
    const conversation = await findOwnedConversation(req.user._id, req.params.conversationId)
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy cuộc trò chuyện.',
        code: 'CONVERSATION_NOT_FOUND',
      })
    }

    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
    let responseConversation = conversation
    let snapshot = await loadConversationMessagePage({
      userId: req.user._id,
      conversation: responseConversation,
      page,
      limit,
    })
    try {
      assertConversationConsistency(responseConversation, snapshot.latestAssistantMessage)
    } catch (error) {
      if (!(error instanceof ChatConsistencyError)) throw error
      responseConversation = await findOwnedConversation(req.user._id, req.params.conversationId)
      if (!responseConversation) throw error
      snapshot = await loadConversationMessagePage({
        userId: req.user._id,
        conversation: responseConversation,
        page,
        limit,
      })
      assertConversationConsistency(responseConversation, snapshot.latestAssistantMessage)
    }
    const { total } = snapshot
    const messages = await hydrateMessagePresentation(snapshot.messages)
    const pagination = buildPaginationMeta(total, page, limit)

    res.json({
      success: true,
      conversation: serializeConversation(responseConversation),
      ...pagination,
      messages: messages.map(serializeChatMessage),
    })
  } catch (error) {
    console.error('[getConversationMessages]', error)
    if (error instanceof ChatLifecycleError) {
      return res.status(error.status).json({ success: false, message: error.message, code: error.code })
    }
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

function epochMessageFilter(historyEpoch) {
  return Number(historyEpoch || 0) === 0
    ? { $or: [{ historyEpoch: 0 }, { historyEpoch: { $exists: false } }] }
    : { historyEpoch: Number(historyEpoch) }
}

async function executeLogicalChatTurn({ userId, conversation, turn, context }) {
  const traceContext = buildTraceContext({
    requestId: turn.requestId || turn.trace?.traceContext?.requestId,
    logicalTurnId: turn.logicalTurnId,
    conversationId: conversation._id,
    historyEpoch: turn.historyEpoch,
    turnSequence: turn.sequence,
    userId,
  })
  const attachFailureTrace = (error, existingTrace = null) => {
    error.turnTrace = failedTurnTrace({ traceContext, existingTrace: existingTrace || turn.trace, error })
    return error
  }
  const { message, tourContext, rawPageBookingId } = turn.request
  const pageContext = structuredClone(turn.request.pageContext || { pageType: 'OTHER' })
  const history = await ChatMessage.find({
    userId,
    conversationId: conversation._id,
    ...epochMessageFilter(turn.historyEpoch),
  })
    .sort({ at: -1 })
    .limit(12)
    .select('role content referencedTourIds suggestedTourIds candidateList referencedBookingIds structuredContent pageContext')
    .lean()
  const orderedHistory = history.reverse()

  let preferenceContext
  try {
    preferenceContext = await prepareUserPreferenceMessage({ userId, message })
  } catch (error) {
    throw attachFailureTrace(toChatDependencyError(error, {
      source: 'preference_store',
      fallbackCode: AI_ERROR_CODES.DB_ERROR,
    }))
  }
  if (preferenceContext.update?.needsClarification) {
    console.warn('[chat.preference.validation]', {
      category: 'low_confidence_not_persisted',
      candidateCount: preferenceContext.update.candidates?.length || 0,
    })
  }
  let bookingContext
  try {
    bookingContext = await buildOwnedBookingContext({
      userId,
      message,
      rawPageBookingId,
      conversationBookingId: conversation.type === 'BOOKING_SUPPORT' ? conversation.bookingId : null,
      entityState: conversation.entityState || {},
      history: orderedHistory,
    })
  } catch (error) {
    throw attachFailureTrace(toChatDependencyError(error, {
      source: 'booking_adapter',
      fallbackCode: AI_ERROR_CODES.BOOKING_ERROR,
    }))
  }
  if (rawPageBookingId && !bookingContext.ownedPageBookingId) delete pageContext.bookingId

  let result
  try {
    result = await sinhTraLoi({
      userId,
      message,
      userName: context.userName,
      tourContext,
      pageContext,
      constraintState: conversation.constraintState || {},
      entityState: conversation.entityState || {},
      history: orderedHistory,
      bookingContext: bookingContext.active ? bookingContext : null,
      preferenceContext,
      traceContext,
    })
  } catch (error) {
    throw attachFailureTrace(error)
  }

  const now = new Date()
  const identity = extractVisibleTourIdentity({
    suggestedTours: result.suggestedTours,
    referencedTourIds: result.referencedTourIds,
    structuredContent: result.structuredContent,
  })
  const suggestedTourIds = sanitizeAllObjectIds(identity.candidateTourIds)
  const referencedTourIds = sanitizeAllObjectIds(identity.referencedTourIds)
  let suggestedTours
  try {
    suggestedTours = await hydrateCandidateCardsForResult(result, suggestedTourIds)
  } catch (error) {
    throw attachFailureTrace(toChatDependencyError(error, {
      source: 'tour_store',
      fallbackCode: AI_ERROR_CODES.DB_ERROR,
    }), mergeAiTurnTrace({ traceContext, observability: result.observability }))
  }
  const sanitizedEntityState = sanitizeAiEntityState(
    result.entityState,
    conversation.entityState || {},
    bookingContext
  )
  const candidateLifecycle = applyCandidateListLifecycle(sanitizedEntityState, {
    candidateTourIds: suggestedTourIds,
    logicalTurnId: turn.logicalTurnId,
    turnSequence: turn.sequence,
    historyEpoch: turn.historyEpoch,
    source: result.structuredContent?.type || 'assistant_result',
    sanitizeTourIds: sanitizeAllObjectIds,
  })
  const allowedBookingIds = new Set(sanitizeObjectIds(bookingContext.allowedBookingIds || []))
  const referencedBookingIds = sanitizeObjectIds(result.referencedBookingIds)
    .filter((bookingId) => allowedBookingIds.has(bookingId))
  let type = conversation.type || 'GENERAL'
  let bookingId = conversation.bookingId || null
  if (type === 'BOOKING_SUPPORT' && !bookingId) {
    const resolvedBookingIds = sanitizeObjectIds(bookingContext.resolvedBookingIds || [])
    if (resolvedBookingIds.length === 1) bookingId = resolvedBookingIds[0]
    else type = 'GENERAL'
  }

  return {
    messageAt: now,
    preferenceChanges: preferenceContext.changes,
    messages: [
      {
        role: 'user',
        content: message,
        tourId: tourContext?._id || null,
        pageContext,
        referencedTourIds,
        referencedBookingIds,
        at: now,
      },
      {
        role: 'assistant',
        content: result.reply,
        tourId: tourContext?._id || null,
        pageContext,
        referencedTourIds,
        suggestedTourIds,
        suggestedTours,
        candidateList: candidateLifecycle.candidateList,
        referencedBookingIds,
        structuredContent: result.structuredContent || null,
        contractVersion: result.contractVersion || null,
        outcome: result.outcome || null,
        serviceStatus: result.serviceStatus || null,
        warnings: result.warnings || [],
        at: new Date(now.getTime() + 1),
      },
    ],
    conversationState: {
      title: conversation.title === DEFAULT_TITLE && history.length === 0
        ? makeTitle(message)
        : conversation.title,
      constraintState: result.constraintState || conversation.constraintState || {},
      entityState: candidateLifecycle.entityState,
      type,
      bookingId,
    },
    trace: mergeAiTurnTrace({
      traceContext,
      observability: result.observability,
    }),
    response: {
      success: true,
      reply: result.reply,
      suggestedTours,
      candidateList: candidateLifecycle.candidateList,
      structuredContent: result.structuredContent || null,
      decision: result.decision || result.intent?.decision || null,
      contractVersion: result.contractVersion,
      outcome: result.outcome,
      serviceStatus: result.serviceStatus,
      warnings: result.warnings,
      clientMessageId: turn.logicalTurnId,
      turnSequence: turn.sequence,
      historyEpoch: turn.historyEpoch,
    },
  }
}

const chatTurnRepository = createMongoChatTurnRepository({
  commitPreferenceChanges: commitUserPreferenceChanges,
  defaultTitle: DEFAULT_TITLE,
})

const chatTurnLifecycle = createChatTurnLifecycle({
  repository: chatTurnRepository,
  executeTurn: executeLogicalChatTurn,
  terminalFailure(error) {
    const dependencyError = toChatDependencyError(error)
    if (!(dependencyError instanceof AiGatewayError)) return null
    console.error('[chat.ai_gateway.error]', {
      category: dependencyError.code,
      source: dependencyError.source,
      detail: dependencyError.detail,
    })
    return {
      status: dependencyError.status,
      code: dependencyError.code,
      message: dependencyError.message,
      retryable: dependencyError.retryable,
      source: dependencyError.source,
    }
  },
})

export const postChat = async (req, res) => {
  let requestId = null
  try {
    requestId = normalizeRequestId(req.get('x-request-id') || req.body?.requestId)
    res.set('x-request-id', requestId)
    const { message, tourId, conversationId, pageContext: rawPageContext } = req.body || {}
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập nội dung câu hỏi.',
        code: 'VALIDATION_ERROR',
        requestId,
      })
    }
    if (message.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Câu hỏi tối đa 1000 ký tự.',
        code: 'VALIDATION_ERROR',
        requestId,
      })
    }

    const conversation = await getOrCreateConversation(req.user._id, conversationId)
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy cuộc trò chuyện.',
        code: 'CONVERSATION_NOT_FOUND',
      })
    }

    const requestedTourId = rawPageContext?.tourId || tourId
    let tourContext = null
    if (requestedTourId) {
      const tour = /^[0-9a-fA-F]{24}$/.test(String(requestedTourId))
        ? await Tour.findOne({ _id: requestedTourId, status: 'published', isActive: { $ne: false } }).lean()
        : await Tour.findOne({ slug: requestedTourId, status: 'published', isActive: { $ne: false } }).lean()
      if (tour) {
        tourContext = {
          _id: String(tour._id),
          name: tour.name,
          location: tour.location,
          basePrice: tour.basePrice,
          days: tour.days,
          region: tour.region,
        }
      }
    }

    const pageType = PAGE_TYPES.has(String(rawPageContext?.pageType || '').toUpperCase())
      ? String(rawPageContext.pageType).toUpperCase()
      : (tourContext ? 'TOUR_DETAIL' : 'OTHER')
    const rawPageBookingId = sanitizeBookingPageId(rawPageContext?.bookingId)
    const searchContext = sanitizeSearchContext(rawPageContext?.searchContext)
    const pageContext = {
      pageType,
      ...(tourContext?._id ? { tourId: tourContext._id } : {}),
      ...(rawPageBookingId ? { bookingId: rawPageBookingId } : {}),
      ...(searchContext ? { searchContext } : {}),
    }
    const logicalTurnId = normalizeLogicalTurnId(
      req.body.clientMessageId || req.body.logicalTurnId || req.get('Idempotency-Key')
    )
    const traceContext = buildTraceContext({
      requestId,
      logicalTurnId,
      conversationId: conversation._id,
      historyEpoch: Number(conversation.historyEpoch || 0),
      turnSequence: Number(conversation.nextTurnSequence || 0) + 1,
      userId: req.user._id,
    })
    const request = {
      message: message.trim(),
      tourContext,
      rawPageBookingId,
      pageContext,
    }
    const lifecycleResult = await chatTurnLifecycle.handle({
      userId: req.user._id,
      conversationId: conversation._id,
      logicalTurnId,
      request,
      requestIdentity: {
        message: message.trim(),
        requestedTourId: String(requestedTourId || ''),
        pageType,
        rawPageBookingId,
        searchContext,
      },
      context: { userName: req.user.name },
      requestId,
      trace: buildPendingTurnTrace(traceContext),
    })
    const currentConversation = await findOwnedConversation(req.user._id, conversation._id)
    if (!currentConversation) {
      throw new ChatLifecycleError('Không tìm thấy cuộc trò chuyện.', {
        status: 404,
        code: 'CONVERSATION_NOT_FOUND',
      })
    }
    res.json({
      ...lifecycleResult.response,
      requestId,
      conversation: serializeConversation(currentConversation),
    })
  } catch (error) {
    console.error('[chat.request.error]', {
      category: error?.name === 'ValidationError' ? 'validation_error' : 'unhandled_error',
      errorName: error?.name || 'Error',
      errorCode: error?.code || null,
      requestId,
    })
    if (error instanceof ChatLifecycleError) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
        code: error.code,
        ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
        ...(error.source ? { source: error.source } : {}),
        ...(requestId ? { requestId } : {}),
      })
    }
    if (error?.status === 400 && error?.code === 'VALIDATION_ERROR') {
      return res.status(400).json({
        success: false,
        message: error.message,
        code: error.code,
        ...(requestId ? { requestId } : {}),
      })
    }
    const dependencyError = toChatDependencyError(error)
    if (dependencyError) {
      return res.status(dependencyError.status).json({
        success: false,
        message: dependencyError.message,
        code: dependencyError.code,
        retryable: dependencyError.retryable,
        source: dependencyError.source,
        ...(requestId ? { requestId } : {}),
      })
    }
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// API cu duoc giu de khong pha client cu: tra messages cua conversation gan nhat.
export const getChatHistory = async (req, res) => {
  try {
    const conversation = await getOrCreateConversation(req.user._id)
    req.params.conversationId = String(conversation._id)
    return getConversationMessages(req, res)
  } catch (error) {
    console.error('[getChatHistory]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

export const deleteChatHistory = async (req, res) => {
  try {
    const conversation = await getOrCreateConversation(req.user._id, req.body?.conversationId)
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy cuộc trò chuyện.',
        code: 'CONVERSATION_NOT_FOUND',
      })
    }
    const result = await chatTurnRepository.clearConversation({
      userId: req.user._id,
      conversationId: conversation._id,
    })
    res.json({
      success: true,
      message: `Đã xóa ${result.deletedCount} tin nhắn.`,
      historyEpoch: result.conversation.historyEpoch,
    })
  } catch (error) {
    console.error('[deleteChatHistory]', error)
    if (error instanceof ChatLifecycleError) {
      return res.status(error.status).json({ success: false, message: error.message, code: error.code })
    }
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

export const deleteConversation = async (req, res) => {
  try {
    const { id } = req.params
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu ID cuộc trò chuyện.' })

    const conversation = await Conversation.findOneAndDelete({ _id: id, userId: req.user._id })
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy cuộc trò chuyện.' })
    }

    await ChatMessage.deleteMany({ conversationId: id, userId: req.user._id })
    await ChatTurn.deleteMany({ conversationId: id, userId: req.user._id })

    res.json({ success: true, message: '�� x�a l?ch s? chat.' })
  } catch (error) {
    console.error('[deleteConversation]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}


