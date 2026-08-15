import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertConversationConsistency,
  ChatConsistencyError,
  ConversationClearedError,
  createChatTurnLifecycle,
  LogicalTurnConflictError,
  LogicalTurnFailedError,
  TurnOwnershipLostError,
} from '../src/services/chatTurnLifecycleService.js'
import { applyPreferenceChangesToProfile } from '../src/services/userPreferenceService.js'
import { AiResponseInvalidError } from '../src/services/aiResponseContract.js'

function clone(value) {
  return structuredClone(value)
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function memoryRepository({ failCommitAt = null } = {}) {
  let store = {
    conversation: {
      _id: 'conversation-1',
      userId: 'user-1',
      historyEpoch: 0,
      nextTurnSequence: 0,
      committedTurnSequence: 0,
      stateTurnSequence: 0,
      constraintState: {},
      entityState: {},
      processingTurnId: null,
      processingOwner: null,
      processingLeaseUntil: null,
    },
    turns: {},
    sequenceIndex: {},
    messages: [],
    preference: {},
  }
  let failureBoundary = failCommitAt

  function keyForEpochSequence(epoch, sequence) {
    return `${epoch}:${sequence}`
  }

  function requireOwnership(draft, turn, owner) {
    const conversation = draft.conversation
    if (conversation.historyEpoch !== turn.historyEpoch) throw new ConversationClearedError()
    if (
      conversation.processingTurnId !== turn._id
      || conversation.processingOwner !== owner
      || conversation.committedTurnSequence !== turn.sequence - 1
    ) {
      throw new TurnOwnershipLostError()
    }
  }

  function failAt(boundary) {
    if (failureBoundary === boundary) throw new Error(`injected:${boundary}`)
  }

  const repository = {
    async registerTurn({ userId, conversationId, logicalTurnId, request, requestHash }) {
      const existing = store.turns[logicalTurnId]
      if (existing) return clone(existing)
      const sequence = ++store.conversation.nextTurnSequence
      const turn = {
        _id: `turn-${sequence}`,
        userId,
        conversationId,
        logicalTurnId,
        request,
        requestHash,
        historyEpoch: store.conversation.historyEpoch,
        sequence,
        status: 'pending',
        attemptCount: 0,
        response: null,
        failure: null,
      }
      store.turns[logicalTurnId] = turn
      store.sequenceIndex[keyForEpochSequence(turn.historyEpoch, sequence)] = logicalTurnId
      return clone(turn)
    },

    async getTurn({ logicalTurnId }) {
      return clone(store.turns[logicalTurnId] || null)
    },

    async getTurnBySequence({ historyEpoch, sequence }) {
      const logicalTurnId = store.sequenceIndex[keyForEpochSequence(historyEpoch, sequence)]
      return clone(logicalTurnId ? store.turns[logicalTurnId] : null)
    },

    async getConversation() {
      return clone(store.conversation)
    },

    async claimTurn({ turn, owner, leaseMs }) {
      const conversation = store.conversation
      const lockActive = conversation.processingTurnId
        && Number(conversation.processingLeaseUntil || 0) > Date.now()
      if (
        conversation.historyEpoch !== turn.historyEpoch
        || conversation.committedTurnSequence !== turn.sequence - 1
        || lockActive
      ) return null

      conversation.processingTurnId = turn._id
      conversation.processingOwner = owner
      conversation.processingLeaseUntil = Date.now() + leaseMs
      const storedTurn = store.turns[turn.logicalTurnId]
      storedTurn.status = 'processing'
      storedTurn.attemptCount += 1
      return { conversation: clone(conversation), turn: clone(storedTurn), owner }
    },

    async commitSuccess({ turn, owner, payload }) {
      const draft = clone(store)
      requireOwnership(draft, turn, owner)

      if (payload.preferenceChanges) {
        draft.preference = applyPreferenceChangesToProfile(
          draft.preference,
          payload.preferenceChanges
        )
      }
      failAt('after_preference')

      draft.messages.push({
        ...payload.messages[0],
        logicalTurnId: turn.logicalTurnId,
        turnSequence: turn.sequence,
        historyEpoch: turn.historyEpoch,
      })
      failAt('after_user_message')
      draft.messages.push({
        ...payload.messages[1],
        logicalTurnId: turn.logicalTurnId,
        turnSequence: turn.sequence,
        historyEpoch: turn.historyEpoch,
      })
      failAt('after_assistant_message')

      Object.assign(draft.conversation, payload.conversationState, {
        committedTurnSequence: turn.sequence,
        stateTurnSequence: turn.sequence,
        processingTurnId: null,
        processingOwner: null,
        processingLeaseUntil: null,
      })
      failAt('after_conversation_state')

      const storedTurn = draft.turns[turn.logicalTurnId]
      storedTurn.status = 'completed'
      storedTurn.response = payload.response
      failAt('after_turn_complete')
      store = draft
      return { conversation: clone(store.conversation), turn: clone(storedTurn) }
    },

    async commitFailure({ turn, owner, failure }) {
      const draft = clone(store)
      requireOwnership(draft, turn, owner)
      draft.conversation.committedTurnSequence = turn.sequence
      draft.conversation.processingTurnId = null
      draft.conversation.processingOwner = null
      draft.conversation.processingLeaseUntil = null
      draft.turns[turn.logicalTurnId].status = 'failed'
      draft.turns[turn.logicalTurnId].failure = failure
      store = draft
    },

    async releaseClaim({ turn, owner }) {
      if (
        store.conversation.processingTurnId === turn._id
        && store.conversation.processingOwner === owner
      ) {
        store.conversation.processingTurnId = null
        store.conversation.processingOwner = null
        store.conversation.processingLeaseUntil = null
        store.turns[turn.logicalTurnId].status = 'pending'
      }
    },

    async clearConversation() {
      const oldEpoch = store.conversation.historyEpoch
      store.conversation.historyEpoch += 1
      store.conversation.nextTurnSequence = 0
      store.conversation.committedTurnSequence = 0
      store.conversation.stateTurnSequence = 0
      store.conversation.constraintState = {}
      store.conversation.entityState = {}
      store.conversation.processingTurnId = null
      store.conversation.processingOwner = null
      store.conversation.processingLeaseUntil = null
      store.messages = []
      for (const turn of Object.values(store.turns)) {
        if (turn.historyEpoch === oldEpoch && ['pending', 'processing'].includes(turn.status)) {
          turn.status = 'cancelled'
        }
      }
    },

    inspect() {
      return clone(store)
    },

    disableFailure() {
      failureBoundary = null
    },
  }
  return repository
}

function successPayload(turn, conversation, patch = {}, preferenceChanges = null) {
  return {
    preferenceChanges,
    messages: [
      { role: 'user', content: turn.request.message },
      { role: 'assistant', content: `reply:${turn.request.message}` },
    ],
    conversationState: {
      constraintState: { ...(conversation.constraintState || {}), ...patch },
      entityState: conversation.entityState || {},
    },
    response: { success: true, reply: `reply:${turn.request.message}` },
  }
}

function handle(lifecycle, logicalTurnId, request) {
  return lifecycle.handle({
    userId: 'user-1',
    conversationId: 'conversation-1',
    logicalTurnId,
    request,
  })
}

test('TEST 1 / AUD3-01: concurrent constraint turns retain budget and travelers', async () => {
  const repository = memoryRepository()
  const lifecycle = createChatTurnLifecycle({
    repository,
    pollMs: 1,
    executeTurn: async ({ turn, conversation }) => {
      if (turn.request.patch.budget) await new Promise((resolve) => setTimeout(resolve, 20))
      return successPayload(turn, conversation, turn.request.patch)
    },
  })

  await Promise.all([
    handle(lifecycle, 'budget-turn', { message: 'budget', patch: { budget: 8_000_000 } }),
    handle(lifecycle, 'travelers-turn', { message: 'travelers', patch: { travelers: 4 } }),
  ])

  const state = repository.inspect()
  assert.deepEqual(state.conversation.constraintState, { budget: 8_000_000, travelers: 4 })
  assert.deepEqual(state.messages.map((message) => message.turnSequence), [1, 1, 2, 2])
})

test('TEST 2 / AUD3-02: five retries create exactly one logical user/assistant pair', async () => {
  const repository = memoryRepository()
  let executions = 0
  const lifecycle = createChatTurnLifecycle({
    repository,
    pollMs: 1,
    executeTurn: async ({ turn, conversation }) => {
      executions += 1
      await new Promise((resolve) => setTimeout(resolve, 15))
      return successPayload(turn, conversation)
    },
  })
  const request = { message: 'same logical post' }
  const results = await Promise.all(Array.from({ length: 5 }, () => handle(lifecycle, 'same-turn', request)))

  const state = repository.inspect()
  assert.equal(executions, 1)
  assert.equal(Object.keys(state.turns).length, 1)
  assert.equal(state.messages.filter((message) => message.role === 'user').length, 1)
  assert.equal(state.messages.filter((message) => message.role === 'assistant').length, 1)
  assert.ok(results.every((result) => result.response.reply === 'reply:same logical post'))
  await assert.rejects(
    handle(lifecycle, 'same-turn', { message: 'different payload' }),
    LogicalTurnConflictError
  )
})

test('TEST 3 / AUD3-02: client abort followed by retry does not duplicate the turn', async () => {
  const repository = memoryRepository()
  const started = deferred()
  const release = deferred()
  let executions = 0
  const lifecycle = createChatTurnLifecycle({
    repository,
    pollMs: 1,
    executeTurn: async ({ turn, conversation }) => {
      executions += 1
      started.resolve()
      await release.promise
      return successPayload(turn, conversation)
    },
  })

  const abandonedResponse = handle(lifecycle, 'abort-retry-turn', { message: 'abort then retry' })
  await started.promise
  const retry = handle(lifecycle, 'abort-retry-turn', { message: 'abort then retry' })
  release.resolve()
  await Promise.all([abandonedResponse, retry])

  const state = repository.inspect()
  assert.equal(executions, 1)
  assert.equal(state.messages.length, 2)
})

test('TEST 4 / AUD3-03: clear creates an epoch boundary for an in-flight request', async () => {
  const repository = memoryRepository()
  const started = deferred()
  const release = deferred()
  const lifecycle = createChatTurnLifecycle({
    repository,
    pollMs: 1,
    executeTurn: async ({ turn, conversation }) => {
      started.resolve()
      await release.promise
      return successPayload(turn, conversation, { budget: 5_000_000 })
    },
  })

  const inFlight = handle(lifecycle, 'old-epoch-turn', { message: 'old epoch' })
  await started.promise
  await repository.clearConversation()
  release.resolve()
  await assert.rejects(inFlight, ConversationClearedError)

  const state = repository.inspect()
  assert.equal(state.conversation.historyEpoch, 1)
  assert.deepEqual(state.conversation.constraintState, {})
  assert.equal(state.messages.length, 0)
  assert.equal(state.turns['old-epoch-turn'].status, 'cancelled')
})

test('TEST 5 / AUD3-04: AI failure cannot persist a previewed durable preference', async () => {
  const repository = memoryRepository()
  const lifecycle = createChatTurnLifecycle({
    repository,
    pollMs: 1,
    executeTurn: async () => {
      const error = new Error('upstream unavailable after preference extraction')
      error.code = 'AI_UNAVAILABLE'
      throw error
    },
    terminalFailure(error) {
      return error.code === 'AI_UNAVAILABLE'
        ? { status: 503, code: error.code, message: error.message }
        : null
    },
  })

  await assert.rejects(
    handle(lifecycle, 'failed-preference-turn', {
      message: 'remember beach',
      preferenceChanges: { add: { interests: ['beach'] }, remove: {}, set: {}, unset: [] },
    }),
    LogicalTurnFailedError
  )
  const state = repository.inspect()
  assert.deepEqual(state.preference, {})
  assert.equal(state.messages.length, 0)
  assert.equal(state.conversation.stateTurnSequence, 0)
})

test('PHASE 7 TEST 13: invalid AI payload commits only a typed failed turn', async () => {
  const repository = memoryRepository()
  const lifecycle = createChatTurnLifecycle({
    repository,
    pollMs: 1,
    executeTurn: async () => {
      throw new AiResponseInvalidError('reply: must not be empty')
    },
    terminalFailure(error) {
      return error instanceof AiResponseInvalidError
        ? {
            status: error.status,
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          }
        : null
    },
  })

  await assert.rejects(
    handle(lifecycle, 'invalid-ai-response', {
      message: 'remember beach',
      preferenceChanges: { add: { interests: ['beach'] }, remove: {}, set: {}, unset: [] },
    }),
    (error) => error instanceof LogicalTurnFailedError
      && error.code === 'AI_RESPONSE_INVALID'
      && error.retryable === false
  )

  const state = repository.inspect()
  assert.deepEqual(state.preference, {})
  assert.equal(state.messages.length, 0)
  assert.deepEqual(state.conversation.constraintState, {})
  assert.equal(state.conversation.stateTurnSequence, 0)
  assert.equal(state.turns['invalid-ai-response'].status, 'failed')
  assert.equal(state.turns['invalid-ai-response'].failure.code, 'AI_RESPONSE_INVALID')
})

test('TEST 6: persistence failures at every commit boundary are atomic and retryable', async () => {
  const boundaries = [
    'after_preference',
    'after_user_message',
    'after_assistant_message',
    'after_conversation_state',
    'after_turn_complete',
  ]
  const preferenceChanges = {
    add: { interests: ['beach'] },
    remove: {},
    set: {},
    unset: [],
  }

  for (const boundary of boundaries) {
    const repository = memoryRepository({ failCommitAt: boundary })
    const lifecycle = createChatTurnLifecycle({
      repository,
      pollMs: 1,
      executeTurn: async ({ turn, conversation }) => successPayload(
        turn,
        conversation,
        { travelers: 2 },
        preferenceChanges
      ),
    })
    const request = { message: `failure:${boundary}` }
    await assert.rejects(handle(lifecycle, `turn-${boundary}`, request), /injected:/)

    let state = repository.inspect()
    assert.deepEqual(state.preference, {}, boundary)
    assert.equal(state.messages.length, 0, boundary)
    assert.deepEqual(state.conversation.constraintState, {}, boundary)
    assert.equal(state.conversation.stateTurnSequence, 0, boundary)

    repository.disableFailure()
    await handle(lifecycle, `turn-${boundary}`, request)
    state = repository.inspect()
    assert.equal(state.messages.length, 2, boundary)
    assert.equal(state.conversation.stateTurnSequence, 1, boundary)
    assertConversationConsistency(
      state.conversation,
      state.messages.find((message) => message.role === 'assistant')
    )
  }

  assert.throws(
    () => assertConversationConsistency(
      { historyEpoch: 0, stateTurnSequence: 3 },
      { historyEpoch: 0, turnSequence: 2 }
    ),
    ChatConsistencyError
  )
})

test('PHASE 8 INTERACTION: retrying a clarification turn preserves one pending clarification and one message pair', async () => {
  const repository = memoryRepository()
  let executions = 0
  const lifecycle = createChatTurnLifecycle({
    repository,
    pollMs: 1,
    executeTurn: async ({ turn, conversation }) => {
      executions += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      const payload = successPayload(turn, conversation)
      payload.conversationState.entityState = {
        pendingClarification: {
          slot: 'budget.scope',
          type: 'choice',
          allowedAnswerKinds: ['total', 'per_person'],
        },
      }
      payload.response.decision = { action: 'CLARIFY', reason: 'budget_scope_materially_ambiguous' }
      return payload
    },
  })
  const request = { message: 'budget needs a scope' }

  await Promise.all(Array.from({ length: 4 }, () => handle(lifecycle, 'clarification-retry', request)))

  const state = repository.inspect()
  assert.equal(executions, 1)
  assert.equal(state.messages.length, 2)
  assert.equal(state.conversation.entityState.pendingClarification.slot, 'budget.scope')
})

test('PHASE 8 INTERACTION: concurrent queued updates cannot cross a clear-history epoch', async () => {
  const repository = memoryRepository()
  const started = deferred()
  const release = deferred()
  const lifecycle = createChatTurnLifecycle({
    repository,
    pollMs: 1,
    executeTurn: async ({ turn, conversation }) => {
      if (turn.logicalTurnId === 'epoch-budget') {
        started.resolve()
        await release.promise
      }
      return successPayload(turn, conversation, turn.request.patch)
    },
  })

  const budget = handle(lifecycle, 'epoch-budget', { message: 'budget', patch: { budget: 9_000_000 } })
  const travelers = handle(lifecycle, 'epoch-travelers', { message: 'travelers', patch: { travelers: 3 } })
  await started.promise
  await repository.clearConversation()
  release.resolve()

  await assert.rejects(budget, ConversationClearedError)
  await assert.rejects(travelers, ConversationClearedError)
  const state = repository.inspect()
  assert.deepEqual(state.conversation.constraintState, {})
  assert.equal(state.messages.length, 0)
  assert.equal(state.conversation.historyEpoch, 1)
})

test('PHASE 8 INTERACTION: two lifecycle instances share turn ownership without duplicate execution', async () => {
  const repository = memoryRepository()
  let executions = 0
  const executeTurn = async ({ turn, conversation }) => {
    executions += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return successPayload(turn, conversation)
  }
  const firstWorker = createChatTurnLifecycle({ repository, pollMs: 1, executeTurn })
  const secondWorker = createChatTurnLifecycle({ repository, pollMs: 1, executeTurn })
  const request = { message: 'shared worker turn' }

  await Promise.all([
    handle(firstWorker, 'multi-instance-turn', request),
    handle(secondWorker, 'multi-instance-turn', request),
  ])

  assert.equal(executions, 1)
  assert.equal(repository.inspect().messages.length, 2)
})
