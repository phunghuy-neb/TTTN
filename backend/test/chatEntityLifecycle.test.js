import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCandidateListLifecycle,
  buildPaginationMeta,
  extractVisibleTourIdentity,
  mergeCandidateCards,
  sanitizeCandidateEntityState,
} from '../src/services/chatEntityLifecycleService.js'

const IDS = {
  a: '64b000000000000000000001',
  b: '64b000000000000000000002',
  c: '64b000000000000000000003',
  d: '64b000000000000000000004',
  e: '64b000000000000000000005',
  f: '64b000000000000000000006',
}

test('same logical turn keeps one stable candidate-list identity', () => {
  const first = applyCandidateListLifecycle({}, {
    candidateTourIds: [IDS.a, IDS.b, IDS.c],
    logicalTurnId: 'turn-1',
    turnSequence: 1,
    historyEpoch: 0,
  })
  const retry = applyCandidateListLifecycle(first.entityState, {
    candidateTourIds: [IDS.a, IDS.b, IDS.c],
    logicalTurnId: 'turn-1',
    turnSequence: 1,
    historyEpoch: 0,
  })

  assert.equal(retry.candidateList.candidateListId, first.candidateList.candidateListId)
  assert.equal(retry.entityState.candidateLists.length, 1)
  assert.equal(retry.entityState.previousCandidateListId, undefined)
})

test('new candidate list preserves active and previous lists without overwrite', () => {
  const list1 = applyCandidateListLifecycle({}, {
    candidateTourIds: [IDS.a, IDS.b, IDS.c],
    logicalTurnId: 'turn-1',
    turnSequence: 1,
    historyEpoch: 2,
  })
  const list2 = applyCandidateListLifecycle(list1.entityState, {
    candidateTourIds: [IDS.d, IDS.e, IDS.f],
    logicalTurnId: 'turn-2',
    turnSequence: 2,
    historyEpoch: 2,
  })

  assert.equal(list2.entityState.candidateLists.length, 2)
  assert.equal(list2.entityState.previousCandidateListId, list1.candidateList.candidateListId)
  assert.equal(list2.entityState.activeCandidateListId, list2.candidateList.candidateListId)
  assert.deepEqual(list2.entityState.candidateLists[0].tourIds, [IDS.a, IDS.b, IDS.c])
})

test('identical visible result set reuses stable candidate identity instead of inventing a new list', () => {
  const first = applyCandidateListLifecycle({}, {
    candidateTourIds: [IDS.a, IDS.b, IDS.c],
    logicalTurnId: 'turn-one',
    turnSequence: 1,
    historyEpoch: 0,
  })
  const repeated = applyCandidateListLifecycle(first.entityState, {
    candidateTourIds: [IDS.a, IDS.b, IDS.c],
    logicalTurnId: 'turn-two',
    turnSequence: 2,
    historyEpoch: 0,
  })
  assert.equal(repeated.candidateList.candidateListId, first.candidateList.candidateListId)
  assert.equal(repeated.entityState.candidateLists.length, 1)
  assert.equal(repeated.entityState.previousCandidateListId, undefined)
})

test('selected candidate-list anchor survives later active lists and sanitization', () => {
  const first = applyCandidateListLifecycle({}, {
    candidateTourIds: [IDS.a, IDS.b, IDS.c],
    logicalTurnId: 'turn-one',
    turnSequence: 1,
    historyEpoch: 0,
  })
  const anchored = {
    ...first.entityState,
    selectedTourId: IDS.b,
    currentTourId: IDS.b,
    selectedCandidateListId: first.candidateList.candidateListId,
  }
  const later = applyCandidateListLifecycle(anchored, {
    candidateTourIds: [IDS.d, IDS.e, IDS.f],
    logicalTurnId: 'turn-two',
    turnSequence: 2,
    historyEpoch: 0,
  })
  const sanitized = sanitizeCandidateEntityState(later.entityState)

  assert.equal(sanitized.activeCandidateListId, later.candidateList.candidateListId)
  assert.equal(sanitized.selectedCandidateListId, first.candidateList.candidateListId)
  assert.equal(sanitized.selectedTourId, IDS.b)
})

test('all visible card and structured tour IDs enter entity memory', () => {
  const identity = extractVisibleTourIdentity({
    suggestedTours: [{ _id: IDS.a }, { _id: IDS.b }],
    referencedTourIds: [IDS.f],
    structuredContent: { type: 'grounded_answer', tours: [{ tourId: IDS.b }, { tourId: IDS.c }] },
  })

  assert.deepEqual(identity.candidateTourIds, [IDS.a, IDS.b, IDS.c])
  assert.deepEqual(identity.referencedTourIds, [IDS.a, IDS.b, IDS.c, IDS.f])
})

test('stored card snapshot reconstructs the same visible card identity', () => {
  const snapshot = { _id: IDS.b, title: 'Tour B', price: 3_270_000, image: '/b.jpg' }
  const cards = mergeCandidateCards({
    tourIds: [IDS.b],
    snapshots: [snapshot],
    toursById: new Map([[IDS.b, {
      _id: IDS.b,
      name: 'Tour B renamed',
      basePrice: 2_920_000,
      images: ['/new.jpg'],
      status: 'published',
      isActive: true,
    }]]),
  })

  assert.deepEqual(cards, [{ ...snapshot, unavailable: false }])
})

test('missing historical tour stays on its original ID and is marked unavailable', () => {
  const cards = mergeCandidateCards({
    tourIds: [IDS.c],
    snapshots: [{ _id: IDS.c, title: 'Tour C', price: 4_000_000 }],
    toursById: new Map(),
  })

  assert.equal(cards[0]._id, IDS.c)
  assert.equal(cards[0].unavailable, true)
})

test('message pagination exposes all 130 messages without silent truncation', () => {
  assert.deepEqual(buildPaginationMeta(130, 1, 100), {
    total: 130,
    page: 1,
    limit: 100,
    totalPages: 2,
    hasMore: true,
  })
  assert.equal(buildPaginationMeta(130, 2, 100).hasMore, false)
})

test('conversation pagination exposes all 35 conversations', () => {
  assert.deepEqual(buildPaginationMeta(35, 1, 20), {
    total: 35,
    page: 1,
    limit: 20,
    totalPages: 2,
    hasMore: true,
  })
  assert.equal(buildPaginationMeta(35, 2, 20).hasMore, false)
})
