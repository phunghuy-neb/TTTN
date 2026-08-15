import { createHash, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import ChatMessage from '../models/ChatMessage.js'
import ChatTurn from '../models/ChatTurn.js'
import Conversation from '../models/Conversation.js'
import {
  committedTurnTrace,
  emitLogicalTurnTrace,
  failedTurnTrace,
} from './chatTurnTraceService.js'

const DEFAULT_LEASE_MS = 120_000
const DEFAULT_POLL_MS = 40
const DEFAULT_WAIT_MS = 180_000

export class ChatLifecycleError extends Error {
  constructor(message, { status = 500, code = 'CHAT_LIFECYCLE_ERROR' } = {}) {
    super(message)
    this.name = this.constructor.name
    this.status = status
    this.code = code
  }
}

export class LogicalTurnConflictError extends ChatLifecycleError {
  constructor() {
    super('clientMessageId da duoc dung cho noi dung khac.', {
      status: 409,
      code: 'LOGICAL_TURN_CONFLICT',
    })
  }
}

export class ConversationClearedError extends ChatLifecycleError {
  constructor() {
    super('Cuoc tro chuyen da duoc xoa trong khi yeu cau dang xu ly.', {
      status: 409,
      code: 'CONVERSATION_CLEARED',
    })
  }
}

export class LogicalTurnFailedError extends ChatLifecycleError {
  constructor(failure = {}) {
    super(failure.message || 'Khong the xu ly luot chat.', {
      status: failure.status || 500,
      code: failure.code || 'CHAT_TURN_FAILED',
    })
    this.retryable = Boolean(failure.retryable)
    this.source = failure.source || null
  }
}

export class TurnOwnershipLostError extends ChatLifecycleError {
  constructor() {
    super('Quyen xu ly luot chat da duoc chuyen cho worker khac.', {
      status: 409,
      code: 'TURN_OWNERSHIP_LOST',
    })
  }
}

export class ChatConsistencyError extends ChatLifecycleError {
  constructor() {
    super('Lich su chat va conversation state khong dong bo.', {
      status: 409,
      code: 'CHAT_CONSISTENCY_ERROR',
    })
  }
}

export function normalizeLogicalTurnId(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return randomUUID()
  if (normalized.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new ChatLifecycleError('clientMessageId khong hop le.', {
      status: 400,
      code: 'VALIDATION_ERROR',
    })
  }
  return normalized
}

export function hashChatTurnRequest(request) {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}

function matchesTurnRequest(turn, requestHash) {
  if (turn.requestHash !== requestHash) throw new LogicalTurnConflictError()
  return turn
}

export function assertConversationConsistency(conversation, latestAssistantMessage) {
  const stateTurnSequence = Number(conversation?.stateTurnSequence || 0)
  if (!stateTurnSequence) return true
  if (
    Number(latestAssistantMessage?.historyEpoch) !== Number(conversation.historyEpoch || 0)
    || Number(latestAssistantMessage?.turnSequence) !== stateTurnSequence
  ) {
    throw new ChatConsistencyError()
  }
  return true
}

export function createMongoChatTurnRepository({ commitPreferenceChanges, defaultTitle = 'Cuoc tro chuyen moi' }) {
  return {
    async registerTurn({ userId, conversationId, logicalTurnId, request, requestHash, requestId, trace }) {
      try {
        return await mongoose.connection.transaction(async (session) => {
          const existing = await ChatTurn.findOne({ conversationId, logicalTurnId }).session(session).lean()
          if (existing) {
            matchesTurnRequest(existing, requestHash)
            return ChatTurn.findOneAndUpdate(
              { _id: existing._id },
              {
                $set: {
                  requestId: existing.requestId || requestId,
                  trace: existing.trace || trace || null,
                },
                $addToSet: { requestIds: requestId },
              },
              { new: true, session }
            ).lean()
          }

          const conversation = await Conversation.findOneAndUpdate(
            { _id: conversationId, userId },
            [{
              $set: {
                historyEpoch: { $ifNull: ['$historyEpoch', 0] },
                committedTurnSequence: { $ifNull: ['$committedTurnSequence', 0] },
                stateTurnSequence: { $ifNull: ['$stateTurnSequence', 0] },
                nextTurnSequence: {
                  $add: [{ $ifNull: ['$nextTurnSequence', 0] }, 1],
                },
              },
            }],
            { new: true, session, updatePipeline: true }
          ).lean()
          if (!conversation) {
            throw new ChatLifecycleError('Khong tim thay cuoc tro chuyen.', {
              status: 404,
              code: 'CONVERSATION_NOT_FOUND',
            })
          }

          const [turn] = await ChatTurn.create([{
            userId,
            conversationId,
            logicalTurnId,
            requestHash,
            request,
            requestId,
            requestIds: [requestId],
            trace: trace ? {
              ...trace,
              traceContext: {
                ...(trace.traceContext || {}),
                historyEpoch: Number(conversation.historyEpoch || 0),
                turnSequence: Number(conversation.nextTurnSequence),
              },
            } : null,
            historyEpoch: Number(conversation.historyEpoch || 0),
            sequence: Number(conversation.nextTurnSequence),
          }], { session })
          return turn.toObject()
        })
      } catch (error) {
        if (error?.code !== 11000) throw error
        const existing = await ChatTurn.findOne({ conversationId, logicalTurnId }).lean()
        if (!existing) throw error
        matchesTurnRequest(existing, requestHash)
        return ChatTurn.findOneAndUpdate(
          { _id: existing._id },
          {
            $set: {
              requestId: existing.requestId || requestId,
              trace: existing.trace || trace || null,
            },
            $addToSet: { requestIds: requestId },
          },
          { new: true }
        ).lean()
      }
    },

    getTurn({ userId, conversationId, logicalTurnId }) {
      return ChatTurn.findOne({ userId, conversationId, logicalTurnId }).lean()
    },

    getTurnBySequence({ userId, conversationId, historyEpoch, sequence }) {
      return ChatTurn.findOne({ userId, conversationId, historyEpoch, sequence }).lean()
    },

    getConversation({ userId, conversationId }) {
      return Conversation.findOne({ _id: conversationId, userId }).lean()
    },

    async claimTurn({ userId, conversationId, turn, owner, leaseMs = DEFAULT_LEASE_MS }) {
      const now = new Date()
      const leaseUntil = new Date(now.getTime() + leaseMs)
      return mongoose.connection.transaction(async (session) => {
        const conversation = await Conversation.findOneAndUpdate(
          {
            _id: conversationId,
            userId,
            historyEpoch: turn.historyEpoch,
            committedTurnSequence: turn.sequence - 1,
            $or: [
              { processingTurnId: null },
              { processingTurnId: { $exists: false } },
              { processingLeaseUntil: { $lt: now } },
            ],
          },
          {
            $set: {
              processingTurnId: turn._id,
              processingOwner: owner,
              processingLeaseUntil: leaseUntil,
            },
          },
          { new: true, session }
        ).lean()
        if (!conversation) return null

        const claimedTurn = await ChatTurn.findOneAndUpdate(
          {
            _id: turn._id,
            userId,
            conversationId,
            historyEpoch: turn.historyEpoch,
            status: { $in: ['pending', 'processing'] },
          },
          {
            $set: {
              status: 'processing',
              startedAt: now,
              failure: null,
              trace: {
                ...(turn.trace || {}),
                lifecycle: { status: 'processing' },
                persistence: { status: 'not_started' },
              },
            },
            $inc: { attemptCount: 1 },
          },
          { new: true, session }
        ).lean()
        if (!claimedTurn) throw new TurnOwnershipLostError()
        return { conversation, turn: claimedTurn, owner }
      })
    },

    async commitSuccess({ userId, conversationId, turn, owner, payload }) {
      const result = await mongoose.connection.transaction(async (session) => {
        const now = new Date()
        const conversationUpdate = {
          ...payload.conversationState,
          committedTurnSequence: turn.sequence,
          stateTurnSequence: turn.sequence,
          processingTurnId: null,
          processingOwner: null,
          processingLeaseUntil: null,
          lastMessageAt: payload.messageAt || now,
        }
        const conversation = await Conversation.findOneAndUpdate(
          {
            _id: conversationId,
            userId,
            historyEpoch: turn.historyEpoch,
            committedTurnSequence: turn.sequence - 1,
            processingTurnId: turn._id,
            processingOwner: owner,
          },
          { $set: conversationUpdate },
          { new: true, session }
        )
        if (!conversation) {
          const current = await Conversation.findOne({ _id: conversationId, userId }).session(session).lean()
          if (!current || Number(current.historyEpoch || 0) !== Number(turn.historyEpoch)) {
            throw new ConversationClearedError()
          }
          throw new TurnOwnershipLostError()
        }

        if (payload.preferenceChanges) {
          await commitPreferenceChanges({
            userId,
            changes: payload.preferenceChanges,
            session,
          })
        }

        const messages = payload.messages.map((message) => ({
          ...message,
          userId,
          conversationId,
          logicalTurnId: turn.logicalTurnId,
          turnSequence: turn.sequence,
          historyEpoch: turn.historyEpoch,
        }))
        await ChatMessage.insertMany(messages, { session })

        const completedTurn = await ChatTurn.findOneAndUpdate(
          {
            _id: turn._id,
            status: 'processing',
            historyEpoch: turn.historyEpoch,
          },
          {
            $set: {
              status: 'completed',
              response: payload.response,
              failure: null,
              trace: committedTurnTrace(payload.trace || turn.trace, 'committed'),
              completedAt: now,
            },
          },
          { new: true, session }
        ).lean()
        if (!completedTurn) throw new TurnOwnershipLostError()
        return { conversation: conversation.toObject(), turn: completedTurn }
      })
      emitLogicalTurnTrace(result.turn.trace)
      return result
    },

    async commitFailure({ userId, conversationId, turn, owner, failure, trace }) {
      const result = await mongoose.connection.transaction(async (session) => {
        const conversation = await Conversation.findOneAndUpdate(
          {
            _id: conversationId,
            userId,
            historyEpoch: turn.historyEpoch,
            committedTurnSequence: turn.sequence - 1,
            processingTurnId: turn._id,
            processingOwner: owner,
          },
          {
            $set: {
              committedTurnSequence: turn.sequence,
              processingTurnId: null,
              processingOwner: null,
              processingLeaseUntil: null,
            },
          },
          { new: true, session }
        ).lean()
        if (!conversation) {
          const current = await Conversation.findOne({ _id: conversationId, userId }).session(session).lean()
          if (!current || Number(current.historyEpoch || 0) !== Number(turn.historyEpoch)) {
            throw new ConversationClearedError()
          }
          throw new TurnOwnershipLostError()
        }

        const failedTurn = await ChatTurn.findOneAndUpdate(
          { _id: turn._id, status: 'processing', historyEpoch: turn.historyEpoch },
          {
            $set: {
              status: 'failed',
              failure,
              trace: committedTurnTrace(trace || turn.trace, 'failed_turn_committed'),
              completedAt: new Date(),
            },
          },
          { new: true, session }
        ).lean()
        if (!failedTurn) throw new TurnOwnershipLostError()
        return failedTurn
      })
      emitLogicalTurnTrace(result.trace)
      return result
    },

    async releaseClaim({ userId, conversationId, turn, owner }) {
      await mongoose.connection.transaction(async (session) => {
        const lockRelease = await Conversation.updateOne(
          {
            _id: conversationId,
            userId,
            historyEpoch: turn.historyEpoch,
            processingTurnId: turn._id,
            processingOwner: owner,
          },
          {
            $set: {
              processingTurnId: null,
              processingOwner: null,
              processingLeaseUntil: null,
            },
          },
          { session }
        )
        if (lockRelease.modifiedCount === 1) {
          await ChatTurn.updateOne(
            { _id: turn._id, status: 'processing', historyEpoch: turn.historyEpoch },
            { $set: { status: 'pending' } },
            { session }
          )
        }
      })
    },

    async clearConversation({ userId, conversationId }) {
      return mongoose.connection.transaction(async (session) => {
        const current = await Conversation.findOne({ _id: conversationId, userId }).session(session).lean()
        if (!current) {
          throw new ChatLifecycleError('Khong tim thay cuoc tro chuyen.', {
            status: 404,
            code: 'CONVERSATION_NOT_FOUND',
          })
        }
        const oldEpoch = Number(current.historyEpoch || 0)
        const epochFilter = oldEpoch === 0
          ? { $or: [{ historyEpoch: 0 }, { historyEpoch: { $exists: false } }] }
          : { historyEpoch: oldEpoch }
        const conversation = await Conversation.findOneAndUpdate(
          { _id: conversationId, userId, ...epochFilter },
          {
            $inc: { historyEpoch: 1 },
            $set: {
              title: defaultTitle,
              lastMessageAt: new Date(),
              constraintState: {},
              entityState: {},
              nextTurnSequence: 0,
              committedTurnSequence: 0,
              stateTurnSequence: 0,
              processingTurnId: null,
              processingOwner: null,
              processingLeaseUntil: null,
            },
          },
          { new: true, session }
        ).lean()
        if (!conversation) throw new TurnOwnershipLostError()

        await ChatTurn.updateMany(
          {
            userId,
            conversationId,
            historyEpoch: oldEpoch,
            status: { $in: ['pending', 'processing'] },
          },
          [{
            $set: {
              status: 'cancelled',
              failure: {
                status: 409,
                code: 'CONVERSATION_CLEARED',
                message: 'Cuoc tro chuyen da duoc xoa.',
              },
              trace: {
                $mergeObjects: [
                  { $cond: [{ $eq: [{ $type: '$trace' }, 'object'] }, '$trace', {}] },
                  {
                    lifecycle: { status: 'cancelled' },
                    persistence: { status: 'cancelled_by_clear' },
                  },
                ],
              },
              completedAt: '$$NOW',
            },
          }],
          { session }
        )
        const result = await ChatMessage.deleteMany({ userId, conversationId }).session(session)
        return { conversation, deletedCount: result.deletedCount }
      })
    },
  }
}

function terminalTurnResult(turn) {
  if (turn.status === 'completed') return { turn, response: turn.response }
  if (turn.status === 'failed') throw new LogicalTurnFailedError(turn.failure)
  if (turn.status === 'cancelled') throw new ConversationClearedError()
  return null
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createChatTurnLifecycle({
  repository,
  executeTurn,
  terminalFailure,
  leaseMs = DEFAULT_LEASE_MS,
  pollMs = DEFAULT_POLL_MS,
  waitMs = DEFAULT_WAIT_MS,
}) {
  return {
    async handle({
      userId,
      conversationId,
      logicalTurnId,
      request,
      requestIdentity = request,
      context = {},
      requestId = null,
      trace = null,
    }) {
      const requestHash = hashChatTurnRequest(requestIdentity)
      const target = await repository.registerTurn({
        userId,
        conversationId,
        logicalTurnId,
        request,
        requestHash,
        requestId,
        trace,
      })
      matchesTurnRequest(target, requestHash)

      const deadline = Date.now() + waitMs
      while (Date.now() < deadline) {
        const currentTarget = await repository.getTurn({ userId, conversationId, logicalTurnId })
        if (!currentTarget) throw new TurnOwnershipLostError()
        const conversation = await repository.getConversation({ userId, conversationId })
        if (!conversation || Number(conversation.historyEpoch || 0) !== Number(target.historyEpoch)) {
          throw new ConversationClearedError()
        }
        const terminal = terminalTurnResult(currentTarget)
        if (terminal) return terminal
        const nextSequence = Number(conversation.committedTurnSequence || 0) + 1
        const nextTurn = await repository.getTurnBySequence({
          userId,
          conversationId,
          historyEpoch: target.historyEpoch,
          sequence: nextSequence,
        })
        if (!nextTurn) {
          await wait(pollMs)
          continue
        }

        const owner = randomUUID()
        const claim = await repository.claimTurn({
          userId,
          conversationId,
          turn: nextTurn,
          owner,
          leaseMs,
        })
        if (!claim) {
          await wait(pollMs)
          continue
        }

        try {
          const payload = await executeTurn({
            userId,
            conversation: claim.conversation,
            turn: claim.turn,
            context,
          })
          await repository.commitSuccess({
            userId,
            conversationId,
            turn: claim.turn,
            owner,
            payload,
          })
        } catch (error) {
          if (error instanceof ConversationClearedError || error instanceof TurnOwnershipLostError) {
            continue
          }
          const failure = terminalFailure?.(error)
          if (failure) {
            const failureTrace = failedTurnTrace({
              traceContext: claim.turn.trace?.traceContext || {},
              existingTrace: error.turnTrace || claim.turn.trace,
              error,
            })
            try {
              await repository.commitFailure({
                userId,
                conversationId,
                turn: claim.turn,
                owner,
                failure,
                trace: failureTrace,
              })
            } catch (commitError) {
              if (
                !(commitError instanceof ConversationClearedError)
                && !(commitError instanceof TurnOwnershipLostError)
              ) throw commitError
            }
            continue
          }
          await repository.releaseClaim({
            userId,
            conversationId,
            turn: claim.turn,
            owner,
          }).catch(() => {})
          throw error
        }
      }
      throw new ChatLifecycleError('Qua thoi gian cho xu ly luot chat.', {
        status: 503,
        code: 'CHAT_TURN_TIMEOUT',
      })
    },
  }
}
