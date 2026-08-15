const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectEntityMemory,
  resolveEntityIds,
} = require('../src/services/travelAdvisorService');
const { buildTourFactualContext } = require('../src/services/factualGroundingService');

const IDS = {
  a: '64b000000000000000000001',
  b: '64b000000000000000000002',
  c: '64b000000000000000000003',
  d: '64b000000000000000000004',
  e: '64b000000000000000000005',
  f: '64b000000000000000000006',
  deleted: '64b000000000000000000099',
};

function candidateList(candidateListId, tourIds, sequence) {
  return {
    candidateListId,
    createdTurnId: `turn-${sequence}`,
    createdTurnSequence: sequence,
    historyEpoch: 0,
    source: 'recommendation',
    tourIds,
  };
}

const LIST_1 = candidateList('candidates:0:1:turn-1', [IDS.a, IDS.b, IDS.c], 1);
const LIST_2 = candidateList('candidates:0:2:turn-2', [IDS.d, IDS.e, IDS.f], 2);

function stateWithTwoLists() {
  return {
    candidateLists: [LIST_1, LIST_2],
    activeCandidateListId: LIST_2.candidateListId,
    previousCandidateListId: LIST_1.candidateListId,
    lastSuggestedTourIds: LIST_2.tourIds,
  };
}

test('active candidate list resolves tour thu 2 to B', () => {
  const resolved = resolveEntityIds({
    message: 'tour thứ 2',
    requestType: 'tour_detail',
    entityState: {
      candidateLists: [LIST_1],
      activeCandidateListId: LIST_1.candidateListId,
    },
  });
  assert.deepEqual(resolved.ids, [IDS.b]);
  assert.equal(resolved.candidateListId, LIST_1.candidateListId);
});

test('historical ordinal uses previous list and never silently selects E', () => {
  const resolved = resolveEntityIds({
    message: 'tour thứ 2 lúc nãy',
    requestType: 'tour_detail',
    entityState: stateWithTwoLists(),
  });
  assert.deepEqual(resolved.ids, [IDS.b]);
  assert.notDeepEqual(resolved.ids, [IDS.e]);
  assert.equal(resolved.candidateListId, LIST_1.candidateListId);
});

test('general grounded reply candidateList remains ordinal-referenceable', () => {
  const entityState = collectEntityMemory([
    { role: 'assistant', candidateList: { ...LIST_1, source: 'grounded_answer' } },
  ], {});
  const resolved = resolveEntityIds({
    message: 'tour thứ 2',
    requestType: 'tour_detail',
    entityState,
  });
  assert.deepEqual(resolved.ids, [IDS.b]);
});

test('serialized conversation state keeps ordinal behavior after restart', () => {
  const before = stateWithTwoLists();
  const afterRestart = JSON.parse(JSON.stringify(before));
  const resolved = resolveEntityIds({
    message: 'tour thứ 2 lúc nãy',
    requestType: 'tour_detail',
    entityState: afterRestart,
  });
  assert.deepEqual(resolved.ids, [IDS.b]);
});

test('old and new candidate lists coexist without overwriting identity', () => {
  const memory = collectEntityMemory([], stateWithTwoLists());
  assert.equal(memory.candidateLists.length, 2);
  assert.deepEqual(memory.candidateLists[0].tourIds, [IDS.a, IDS.b, IDS.c]);
  assert.deepEqual(memory.candidateLists[1].tourIds, [IDS.d, IDS.e, IDS.f]);
});

test('stable entity ID rehydrates changed price and availability facts', () => {
  const resolved = resolveEntityIds({
    message: 'tour thứ 2',
    requestType: 'tour_detail',
    entityState: { candidateLists: [LIST_1], activeCandidateListId: LIST_1.candidateListId },
  });
  const dateRange = { start: '2026-09-20', end: '2026-09-20' };
  const oldFacts = buildTourFactualContext({
    _id: resolved.ids[0],
    name: 'Tour B',
    basePrice: 2_000_000,
    days: 3,
    departures: [{ _id: 'dep-old', date: new Date('2026-09-19T17:00:00.000Z'), price: 2_000_000, availableSlots: 8 }],
  }, { dateRange, travelers: 2 });
  const currentFacts = buildTourFactualContext({
    _id: resolved.ids[0],
    name: 'Tour B',
    basePrice: 2_500_000,
    days: 3,
    departures: [{ _id: 'dep-new', date: new Date('2026-09-19T17:00:00.000Z'), price: 2_700_000, availableSlots: 1 }],
  }, { dateRange, travelers: 2 });

  assert.equal(oldFacts.tourId, IDS.b);
  assert.equal(currentFacts.tourId, IDS.b);
  assert.equal(currentFacts.priceBasis.amount, 2_700_000);
  assert.equal(currentFacts.availability.availableForParty, false);
  assert.notEqual(currentFacts.fingerprint, oldFacts.fingerprint);
});

test('deleted entity keeps its original ID and is never remapped', () => {
  const deletedList = candidateList('candidates:0:3:turn-3', [IDS.a, IDS.deleted, IDS.c], 3);
  const resolved = resolveEntityIds({
    message: 'tour thứ 2',
    requestType: 'tour_detail',
    entityState: { candidateLists: [deletedList], activeCandidateListId: deletedList.candidateListId },
  });
  assert.deepEqual(resolved.ids, [IDS.deleted]);
});

test('pre-reload and post-reload semantic resolution are equivalent', () => {
  const entityState = stateWithTwoLists();
  const input = { message: 'tour thứ 2 lúc nãy', requestType: 'tour_detail' };
  const before = resolveEntityIds({ ...input, entityState });
  const after = resolveEntityIds({ ...input, entityState: JSON.parse(JSON.stringify(entityState)) });
  assert.deepEqual(after, before);
});
