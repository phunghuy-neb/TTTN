const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const gemini = require('../src/config/gemini');
const ragService = require('../src/services/ragService');
const {
  SEMANTIC_STATE_KEY,
  getEffectiveConstraintState,
  normalizeText,
} = require('../src/services/travelAdvisorService');
const {
  buildGroundingContract,
} = require('../src/services/factualGroundingService');
const { successEnvelope } = require('../src/services/aiContractService');

const ORIGINAL_GENERATE = gemini.generateChatReply;
const ORIGINAL_RAG = ragService.getRagContext;
const ORIGINAL_FIND = ragService.findMentionedTours;
const NOW = new Date('2026-08-14T00:00:00.000Z');
const IDS = {
  ninhBinh: '64b000000000000000009101',
  hue: '64b000000000000000009102',
  daLat: '64b000000000000000009103',
  hoiAn: '64b000000000000000009104',
  nhaTrang: '64b000000000000000009105',
  singapore: '64b000000000000000009106',
};

function departure(id, price, slots) {
  return {
    _id: id,
    date: new Date('2026-09-20T03:00:00.000Z'),
    price,
    availableSlots: slots,
    totalSlots: 12,
  };
}

const TOURS = [
  {
    _id: IDS.ninhBinh, name: 'Ninh Bình 2 ngày', location: 'Ninh Bình', region: 'Miền Bắc', days: 2,
    basePrice: 3_000_000, tags: ['văn hóa'], highlights: ['Tràng An'], summary: 'Cố đô và cảnh quan đá vôi.',
    cancellationPolicy: 'Hoàn 70% trước 7 ngày.', departures: [departure('64b000000000000000009201', 3_200_000, 8)],
  },
  {
    _id: IDS.hue, name: 'Huế 2 ngày', location: 'Huế', region: 'Miền Trung', days: 2,
    basePrice: 3_500_000, tags: ['văn hóa'], highlights: ['Đại Nội'], summary: 'Di sản cố đô.',
    cancellationPolicy: 'Hoàn 60% trước 7 ngày.', departures: [departure('64b000000000000000009202', 3_700_000, 4)],
  },
  {
    _id: IDS.daLat, name: 'Đà Lạt 3 ngày', location: 'Đà Lạt', region: 'Miền Nam', days: 3,
    basePrice: 3_400_000, tags: ['núi', 'săn mây'], highlights: ['Cầu Đất'], summary: 'Săn bình minh và biển mây ở cao nguyên.',
    cancellationPolicy: 'Hoàn 75% trước 7 ngày.', departures: [departure('64b000000000000000009203', 3_650_000, 5)],
  },
  {
    _id: IDS.hoiAn, name: 'Hội An 3 ngày', location: 'Hội An', region: 'Miền Trung', days: 3,
    basePrice: 4_500_000, tags: ['văn hóa', 'ẩm thực'], highlights: ['Phố cổ'], summary: 'Ẩm thực và di sản địa phương.',
    cancellationPolicy: 'Hoàn 65% trước 7 ngày.', departures: [departure('64b000000000000000009204', 4_700_000, 10)],
  },
  {
    _id: IDS.nhaTrang, name: 'Nha Trang 3 ngày', location: 'Nha Trang', region: 'Miền Trung', days: 3,
    basePrice: 4_000_000, tags: ['biển', 'đảo'], highlights: ['Vịnh Nha Trang'], summary: 'Tắm biển và tham quan đảo.',
    cancellationPolicy: 'Hoàn 50% trước 7 ngày.', departures: [departure('64b000000000000000009205', 4_300_000, 9)],
  },
  {
    _id: IDS.singapore, name: 'Singapore 4 ngày', location: 'Singapore', region: 'Quốc tế', days: 4,
    basePrice: 7_000_000, tags: ['khám phá'], highlights: ['Marina Bay'], summary: 'Khám phá đô thị hiện đại.',
    cancellationPolicy: 'Không hoàn vé máy bay.', departures: [departure('64b000000000000000009206', 7_500_000, 6)],
  },
].map((tour) => ({
  status: 'published', isActive: true, images: [], itinerary: [], inclusions: [], exclusions: [], ...tour,
}));

gemini.generateChatReply = async () => {
  throw new Error('Phase 9B deterministic runtime cases must not require provider generation');
};

ragService.findMentionedTours = async (prompt) => {
  const normalized = normalizeText(prompt);
  return TOURS.filter((tour) => normalized.includes(normalizeText(tour.location))).slice(0, 3);
};

ragService.getRagContext = async (prompt, options = {}) => {
  const constraints = getEffectiveConstraintState(options.constraintState || {});
  const requestType = options.requestType || options.intent?.requestType || 'recommendation';
  const direct = new Set((options.directTourIds || []).map(String));
  const excluded = new Set((options.excludeTourIds || []).map(String));
  const pool = TOURS.filter((tour) => direct.has(String(tour._id)) || !excluded.has(String(tour._id)));
  const tours = ragService.filterAndRankHydratedTours(pool, constraints, {
    requestType,
    directTourIds: [...direct],
    orderedIds: pool.map((tour) => String(tour._id)),
    limit: requestType === 'recommendation' ? 3 : 6,
    now: NOW,
  });
  const grounding = buildGroundingContract(tours, constraints, { now: NOW });
  return {
    tours,
    contextText: 'phase-9b browser-equivalent grounded fixture',
    matchedChunks: [],
    zeroResult: tours.length ? null : {
      cause: options.alternativeResults ? 'alternative_exhausted' : 'user_constraints',
      blockingFields: constraints?.[SEMANTIC_STATE_KEY]?.slots?.budget?.status === 'known' ? ['budget'] : [],
    },
    retrievalStatus: { status: 'healthy', degraded: false, mode: 'fixture', reasons: [], fallbackUsed: false, inventoryComplete: true },
    factualGrounding: grounding,
    trace: {
      filters: constraints,
      mode: 'fixture', status: 'healthy', reasons: [],
      candidateIds: { direct: [...direct], excluded: [...excluded], discovered: [], hydrated: pool.map((tour) => String(tour._id)), selected: tours.map((tour) => String(tour._id)) },
      ranking: tours.map((tour, index) => ({ rank: index + 1, tourId: String(tour._id), score: 10 - index })),
      grounding: grounding.tours.map((item) => ({ tourId: item.tourId, fingerprint: item.fingerprint })),
      zeroResult: null,
    },
  };
};

delete require.cache[require.resolve('../src/services/chatService')];
const { generateChatAnswer } = require('../src/services/chatService');

let backendRuntime;

test.before(async () => {
  const root = path.resolve(__dirname, '../../..');
  const booking = await import(pathToFileURL(path.join(root, 'backend/src/services/aiBookingReadService.js')).href);
  const entity = await import(pathToFileURL(path.join(root, 'backend/src/services/chatEntityLifecycleService.js')).href);
  const contract = await import(pathToFileURL(path.join(root, 'backend/src/services/aiResponseContract.js')).href);
  backendRuntime = { ...booking, ...entity, ...contract };
});

test.after(() => {
  gemini.generateChatReply = ORIGINAL_GENERATE;
  ragService.getRagContext = ORIGINAL_RAG;
  ragService.findMentionedTours = ORIGINAL_FIND;
  delete require.cache[require.resolve('../src/services/chatService')];
});

function candidateIdsFromResult(result) {
  return [...new Set([
    ...(result.tours || []).map((tour) => String(tour._id || tour.tourId || '')),
    ...((result.structuredContent?.tours || []).map((tour) => String(tour.tourId || tour._id || ''))),
  ].filter(Boolean))];
}

function createBrowserRuntime() {
  const emptyBookingRepository = {
    async findOwnedByIdentifier() { return null; },
    async findOwned() { return []; },
    async findOwnedByIds() { return []; },
    async findLatestAttempts() { return []; },
    async findOwnedByTourName() { return []; },
  };
  const buildBookingContext = backendRuntime.createAiBookingReadService(emptyBookingRepository);
  const conversation = { constraintState: {}, entityState: {}, history: [], sequence: 0, historyEpoch: 0 };
  return {
    conversation,
    async post(frontendPayload) {
      assert.equal(typeof frontendPayload.clientMessageId, 'string');
      const bookingContext = await buildBookingContext({
        userId: '64b000000000000000009999',
        message: frontendPayload.message,
        entityState: conversation.entityState,
        history: conversation.history,
      });
      const result = await generateChatAnswer({
        prompt: frontendPayload.message,
        pageContext: frontendPayload.pageContext || { pageType: 'AI_ASSISTANT' },
        constraintState: conversation.constraintState,
        entityState: conversation.entityState,
        history: conversation.history,
        bookingContext: bookingContext.active ? bookingContext : null,
        now: NOW,
      });
      const validated = backendRuntime.validateAiChatResponse(successEnvelope(result));
      conversation.sequence += 1;
      const lifecycle = backendRuntime.applyCandidateListLifecycle(result.entityState, {
        candidateTourIds: candidateIdsFromResult(result),
        logicalTurnId: frontendPayload.clientMessageId,
        turnSequence: conversation.sequence,
        historyEpoch: conversation.historyEpoch,
      });
      conversation.constraintState = validated.constraintState;
      conversation.entityState = lifecycle.entityState;
      conversation.history.push(
        { role: 'user', content: frontendPayload.message },
        {
          role: 'assistant', content: validated.reply,
          referencedTourIds: validated.referencedTourIds,
          suggestedTourIds: candidateIdsFromResult(result),
          candidateList: lifecycle.candidateList,
          structuredContent: validated.structuredContent,
        },
      );
      return { ...result, candidateList: lifecycle.candidateList, entityState: lifecycle.entityState, bookingContext };
    },
  };
}

function payload(message, index = 1) {
  return {
    message,
    clientMessageId: `phase9b-turn-${index}`,
    requestId: `phase9b-request-${index}`,
    conversationId: 'phase9b-conversation',
    pageContext: { pageType: 'AI_ASSISTANT' },
  };
}

test('browser path keeps a 6-8m budget range with unspecified scope', async () => {
  const runtime = createBrowserRuntime();
  const result = await runtime.post(payload('2 người, ngân sách khoảng 6-8 triệu, muốn đi 3 ngày'));
  const budget = result.constraintState[SEMANTIC_STATE_KEY].slots.budget;
  assert.deepEqual({ operator: budget.operator, scope: budget.scope, min: budget.min, max: budget.max }, {
    operator: 'range', scope: 'unspecified', min: 6_000_000, max: 8_000_000,
  });
  assert.equal(result.decision.action, 'SEARCH');
  assert.doesNotMatch(result.reply, /tối đa 8\.000\.000đ mỗi người/i);
  assert.match(result.reply, /6\.000\.000đ–8\.000\.000đ/);
});

test('browser path preserves destination exclusion and duration operator ownership', async () => {
  const excludedRuntime = createBrowserRuntime();
  const excluded = await excludedRuntime.post(payload('gợi ý tour nhưng đừng cho tôi Đà Lạt'));
  assert.deepEqual(excluded.constraintState[SEMANTIC_STATE_KEY].slots.destination.excludedValues, ['Đà Lạt']);
  assert.equal(excluded.constraintState.destination, undefined);
  assert.ok(!excluded.referencedTourIds.includes(IDS.daLat));

  const durationRuntime = createBrowserRuntime();
  const duration = await durationRuntime.post(payload('tôi muốn đi tối đa 3 ngày', 2));
  assert.equal(duration.constraintState[SEMANTIC_STATE_KEY].slots.duration.operator, 'max');
  assert.equal(duration.constraintState[SEMANTIC_STATE_KEY].slots.duration.maxDays, 3);
  assert.equal(duration.constraintState.destination, undefined);
  assert.ok(duration.structuredContent.tours.every((tour) => tour.duration <= 3));
});

test('browser path understands colloquial constraints and keeps text/cards consistent', async () => {
  const runtime = createBrowserRuntime();
  const result = await runtime.post(payload('hai đứa có tầm 8 củ, đi đâu vui vui 3 hôm cũng được'));
  assert.equal(result.decision.action, 'SEARCH');
  assert.equal(result.constraintState.travelers, 2);
  assert.equal(result.constraintState[SEMANTIC_STATE_KEY].slots.budget.target, 8_000_000);
  assert.equal(result.constraintState[SEMANTIC_STATE_KEY].slots.duration.targetDays, 3);
  assert.equal(result.constraintState[SEMANTIC_STATE_KEY].slots.destination.status, 'intentionally_open');
  assert.equal(result.structuredContent.type, 'recommendation');
  assert.ok(result.tours.length > 0);
  assert.doesNotMatch(result.reply, /chưa thể trả lời chắc chắn câu hỏi chung/i);
});

test('ng traveler abbreviation persists into total price and availability follow-ups', async () => {
  const runtime = createBrowserRuntime();
  const list = await runtime.post(payload('2 ng muốn đi 3 ngày, tổng 11 triệu', 1));
  assert.equal(list.constraintState.travelers, 2);

  const selected = await runtime.post(payload('cái đầu?', 2));
  const price = await runtime.post(payload('giá tổng?', 3));
  assert.equal(price.structuredContent.partySize, 2);
  assert.match(price.reply, /cho 2 người/);

  const availability = await runtime.post(payload('còn đủ 2 ng ngày 20/9 không?', 4));
  assert.equal(availability.structuredContent.departures[0].partySize, 2);
  assert.equal(selected.entityState.selectedTourId, availability.structuredContent.tourId);
});

test('approximate total budget labels a materially cheaper tour as below the target', async () => {
  const runtime = createBrowserRuntime();
  const result = await runtime.post(payload('gợi ý tour Đà Lạt khoảng 12 triệu tổng cho 2 người'));

  assert.deepEqual(result.referencedTourIds, [IDS.daLat]);
  assert.match(result.reply, /tổng giá ước tính 6\.800\.000đ cho 2 người thấp hơn mốc khoảng 12\.000\.000đ/i);
  assert.doesNotMatch(result.reply, /6\.800\.000đ cho 2 người cao hơn mốc/i);
});

test('approximate total budget keeps the above-target label for a materially dearer tour', async () => {
  const runtime = createBrowserRuntime();
  const result = await runtime.post(payload('gợi ý tour Đà Lạt khoảng 8 triệu tổng cho 3 người'));

  assert.deepEqual(result.referencedTourIds, [IDS.daLat]);
  assert.match(result.reply, /tổng giá ước tính 10\.200\.000đ cho 3 người cao hơn mốc khoảng 8\.000\.000đ/i);
});

test('approximate total budget does not emit a trade-off inside the matching tolerance', async () => {
  const runtime = createBrowserRuntime();
  const result = await runtime.post(payload('gợi ý tour Đà Lạt khoảng 7 triệu tổng cho 2 người'));

  assert.deepEqual(result.referencedTourIds, [IDS.daLat]);
  assert.match(result.reply, /mức giá tương thích với ngân sách khoảng 7\.000\.000đ cho 2 người/i);
  assert.doesNotMatch(result.reply, /(?:cao hơn|thấp hơn) mốc khoảng/i);
});

test('browser multi-turn constraint updates are not hijacked by booking and affect ranking', async () => {
  const runtime = createBrowserRuntime();
  await runtime.post(payload('gợi ý cho tôi tour khoảng 8 triệu cho 2 người, đi đâu cũng được', 1));
  await runtime.post(payload('tôi không muốn đi biển', 2));
  const travelers = await runtime.post(payload('à đổi thành 3 người', 3));
  assert.equal(travelers.bookingContext.active, false);
  assert.equal(travelers.decision.action, 'SEARCH');
  assert.equal(travelers.constraintState.travelers, 3);

  const duration = await runtime.post(payload('muốn đi khoảng 3 ngày', 4));
  assert.equal(duration.decision.action, 'SEARCH');
  assert.equal(duration.structuredContent.tours[0].tourId, IDS.daLat);
  assert.ok(!duration.referencedTourIds.includes(IDS.nhaTrang));
  assert.match(duration.reply, /tổng giá ước tính .* cao hơn mốc khoảng 8\.000\.000đ/i);

  const destination = await runtime.post(payload('Đà Lạt thì sao?', 5));
  assert.equal(destination.decision.action, 'SEARCH');
  assert.deepEqual(destination.referencedTourIds, [IDS.daLat]);
});

test('browser candidate lifecycle resolves ordinal, anaphora and party rehydration', async () => {
  const runtime = createBrowserRuntime();
  const list = await runtime.post(payload('gợi ý tour tối đa 5 triệu mỗi người', 1));
  assert.ok(list.candidateList?.tourIds.length >= 2);
  const expectedSecond = list.candidateList.tourIds[1];

  const ordinal = await runtime.post(payload('tour thứ 2', 2));
  assert.equal(ordinal.decision.action, 'ANSWER');
  assert.deepEqual(ordinal.referencedTourIds, [expectedSecond]);
  assert.equal(ordinal.entityState.selectedTourId, expectedSecond);

  const facts = await runtime.post(payload('tour đó giá bao nhiêu và còn đủ cho 3 người không?', 3));
  assert.deepEqual(facts.referencedTourIds, [expectedSecond]);
  assert.deepEqual(facts.structuredContent.requestedFacts, ['availability', 'price']);
  assert.equal(facts.constraintState.travelers, 3);

  const changedParty = await runtime.post(payload('nếu đổi thành 4 người thì sao?', 4));
  assert.equal(changedParty.bookingContext.active, false);
  assert.equal(changedParty.decision.operation, 'mixed_tour_facts');
  assert.deepEqual(changedParty.referencedTourIds, [expectedSecond]);
  assert.equal(changedParty.structuredContent.facts[0].departures[0].partySize, 4);
});

test('bare price follow-up keeps a selected tour that survives a party-size rerank', async () => {
  const runtime = createBrowserRuntime();
  const list = await runtime.post(payload('gợi ý tour tối đa 5 triệu mỗi người cho 2 người', 1));
  const expectedSecond = list.candidateList.tourIds[1];

  const selected = await runtime.post(payload('cái thứ 2?', 2));
  assert.deepEqual(selected.referencedTourIds, [expectedSecond]);
  assert.equal(selected.entityState.selectedTourId, expectedSecond);

  const reranked = await runtime.post(payload('đổi thành 3 người', 3));
  assert.equal(reranked.decision.action, 'SEARCH');
  assert.ok(reranked.candidateList.tourIds.includes(expectedSecond));

  const total = await runtime.post(payload('giá tổng giờ?', 4));
  assert.equal(total.decision.action, 'ANSWER');
  assert.equal(total.decision.operation, 'tour_detail');
  assert.deepEqual(total.referencedTourIds, [expectedSecond]);
  assert.equal(total.structuredContent.requestedFact, 'price_total');
  assert.equal(total.structuredContent.partySize, 3);
});

test('previous-choice wording returns to the prior selected tour after a later ordinal switch', async () => {
  const runtime = createBrowserRuntime();
  const list = await runtime.post(payload('gợi ý tour tối đa 5 triệu mỗi người', 1));
  const secondId = list.candidateList.tourIds[1];
  const thirdId = list.candidateList.tourIds[2];

  await runtime.post(payload('cái thứ 2?', 2));
  const third = await runtime.post(payload('cái thứ 3?', 3));
  assert.equal(third.entityState.selectedTourId, thirdId);

  const previous = await runtime.post(payload('thôi cái trước', 4));
  assert.equal(previous.decision.action, 'ANSWER');
  assert.equal(previous.decision.operation, 'tour_detail');
  assert.deepEqual(previous.referencedTourIds, [secondId]);
  assert.equal(previous.entityState.selectedTourId, secondId);
  assert.equal(previous.entityState.previousSelectedTourId, thirdId);
});

test('bare facts follow an explicit single-tour focus outside the active candidate list', async () => {
  const runtime = createBrowserRuntime();
  const list = await runtime.post(payload('gợi ý tour tối đa 5 triệu mỗi người cho 2 người', 1));
  assert.ok(!list.candidateList.tourIds.includes(IDS.singapore));

  const explicit = await runtime.post(payload('tour Singapore giá bao nhiêu?', 2));
  assert.deepEqual(explicit.referencedTourIds, [IDS.singapore]);
  assert.equal(explicit.entityState.selectedTourId, IDS.singapore);

  const total = await runtime.post(payload('giá tổng?', 3));
  assert.equal(total.decision.action, 'ANSWER');
  assert.deepEqual(total.referencedTourIds, [IDS.singapore]);
  assert.equal(total.structuredContent.requestedFact, 'price_total');
  assert.equal(total.structuredContent.partySize, 2);
});

test('bare availability keeps an explicit tour focus after a party rerank drops it from the active list', async () => {
  const runtime = createBrowserRuntime();
  await runtime.post(payload('gợi ý tour tối đa 5 triệu mỗi người cho 2 người', 1));
  const explicit = await runtime.post(payload('tour Singapore giá bao nhiêu?', 2));
  assert.deepEqual(explicit.referencedTourIds, [IDS.singapore]);

  const reranked = await runtime.post(payload('đổi thành 3 người', 3));
  assert.ok(!reranked.candidateList.tourIds.includes(IDS.singapore));
  assert.equal(reranked.entityState.focusedTourId, IDS.singapore);

  const availability = await runtime.post(payload('còn chỗ tuần sau không', 4));
  assert.equal(availability.decision.action, 'ANSWER');
  assert.deepEqual(availability.referencedTourIds, [IDS.singapore]);
  assert.equal(availability.constraintState.travelers, 3);
});

test('criteria update remains recommendation routing rather than booking', async () => {
  const runtime = createBrowserRuntime();
  await runtime.post(payload('gợi ý tour cho 2 người', 1));
  const result = await runtime.post(payload('vậy đổi tiêu chí thành tối đa 3 ngày đi', 2));
  assert.equal(result.bookingContext.active, false);
  assert.equal(result.decision.action, 'SEARCH');
  assert.equal(result.constraintState[SEMANTIC_STATE_KEY].slots.duration.operator, 'max');
});

test('alternative lists exclude the active result set and historical references survive reload', async () => {
  const runtime = createBrowserRuntime();
  const first = await runtime.post(payload('gợi ý tour tối đa 5 triệu mỗi người', 1));
  const second = await runtime.post(payload('cho tôi danh sách khác', 2));
  assert.equal(second.decision.operation, 'recommendation_alternative');
  assert.ok(second.candidateList);
  assert.notDeepEqual(second.candidateList.tourIds, first.candidateList.tourIds);
  assert.ok(second.candidateList.tourIds.every((id) => !first.candidateList.tourIds.includes(id)));

  runtime.conversation.entityState = JSON.parse(JSON.stringify(runtime.conversation.entityState));
  runtime.conversation.constraintState = JSON.parse(JSON.stringify(runtime.conversation.constraintState));
  const historical = await runtime.post(payload('phương án thứ hai ban nãy thì sao?', 3));
  assert.deepEqual(historical.referencedTourIds, [first.candidateList.tourIds[1]]);
  assert.equal(historical.entityState.selectedTourId, first.candidateList.tourIds[1]);

  const anaphora = await runtime.post(payload('tour đó còn chỗ không và chính sách hủy thế nào?', 4));
  assert.deepEqual(anaphora.referencedTourIds, [first.candidateList.tourIds[1]]);
  assert.deepEqual(anaphora.structuredContent.requestedFacts, ['availability', 'cancellation_policy']);
});

test('mixed budget update with colloquial list khác still excludes the active result set', async () => {
  const runtime = createBrowserRuntime();
  const first = await runtime.post(payload('gợi ý tour tối đa 5 triệu mỗi người', 1));
  const second = await runtime.post(payload('tăng lên 6 triệu rồi cho list khác', 2));

  assert.equal(second.decision.operation, 'recommendation_alternative');
  assert.ok(second.candidateList);
  assert.ok(second.candidateList.tourIds.every((id) => !first.candidateList.tourIds.includes(id)));
});

test('rejecting the current plural candidate set requests alternatives instead of entity clarification', async () => {
  const runtime = createBrowserRuntime();
  const first = await runtime.post(payload('gợi ý tour cho 2 người', 1));
  const second = await runtime.post(payload('không thích mấy cái này', 2));

  assert.equal(second.decision.action, 'SEARCH');
  assert.equal(second.decision.operation, 'recommendation_alternative');
  assert.ok(second.candidateList);
  assert.ok(second.candidateList.tourIds.every((id) => !first.candidateList.tourIds.includes(id)));
  assert.equal(second.entityState.pendingClarification, null);
});

test('consecutive plural rejections do not resurrect candidate lists the user already rejected', async () => {
  const runtime = createBrowserRuntime();
  const first = await runtime.post(payload('gợi ý tour cho 2 người', 1));
  const second = await runtime.post(payload('không thích mấy cái này', 2));
  const third = await runtime.post(payload('mấy tour này không hợp', 3));
  const rejectedIds = new Set([...first.candidateList.tourIds, ...second.candidateList.tourIds]);

  assert.equal(third.decision.action, 'SEARCH');
  assert.equal(third.decision.operation, 'recommendation_alternative');
  if (third.candidateList) {
    assert.ok(third.candidateList.tourIds.every((id) => !rejectedIds.has(id)));
  } else {
    assert.equal(third.outcome.code, 'NO_RESULTS');
  }
});

test('historical comparison wording compares the current and previous selected tours', async () => {
  const runtime = createBrowserRuntime();
  const first = await runtime.post(payload('gợi ý tour tối đa 5 triệu mỗi người', 1));
  const previous = await runtime.post(payload('cái thứ 2?', 2));
  const alternatives = await runtime.post(payload('cho tôi danh sách khác', 3));
  const current = await runtime.post(payload('cái cuối?', 4));
  const comparison = await runtime.post(payload('so với cái lúc nãy thì sao', 5));

  assert.equal(comparison.decision.action, 'ANSWER');
  assert.equal(comparison.structuredContent.type, 'comparison');
  assert.deepEqual(
    new Set(comparison.referencedTourIds),
    new Set([current.entityState.selectedTourId, previous.entityState.selectedTourId]),
  );
  assert.ok(alternatives.candidateList.tourIds.includes(current.entityState.selectedTourId));
  assert.ok(first.candidateList.tourIds.includes(previous.entityState.selectedTourId));
});

test('embedded historical ordinal clears stale entity clarification and resumes the fact request', async () => {
  const runtime = createBrowserRuntime();
  const first = await runtime.post(payload('gợi ý tour tối đa 5 triệu mỗi người', 1));
  await runtime.post(payload('cho tôi danh sách khác', 2));
  runtime.conversation.entityState.pendingAction = 'tour_detail';
  runtime.conversation.entityState.pendingClarification = {
    slot: 'entity.tour_selection', type: 'entity_selection', allowedAnswerKinds: ['ordinal'],
    candidateTourIds: first.candidateList.tourIds, requestType: 'tour_detail', resumeOperation: 'tour_detail',
  };
  const result = await runtime.post(payload('vậy tour thứ 2 lúc nãy giá bao nhiêu?', 3));
  assert.equal(result.decision.action, 'ANSWER');
  assert.deepEqual(result.referencedTourIds, [first.candidateList.tourIds[1]]);
  assert.equal(result.entityState.pendingClarification, null);
  assert.equal(result.structuredContent.requestedFact, 'price');
});

test('historical ordinal keeps the list where that ordinal was originally selected', async () => {
  const runtime = createBrowserRuntime();
  const first = await runtime.post(payload('gợi ý tour tối đa 5 triệu mỗi người', 1));
  const selected = await runtime.post(payload('tour thứ 2', 2));
  assert.equal(selected.entityState.selectedCandidateListId, first.candidateList.candidateListId);

  await runtime.post(payload('đổi tiêu chí thành tối đa 3 ngày', 3));
  await runtime.post(payload('cho tôi danh sách khác', 4));
  runtime.conversation.entityState = JSON.parse(JSON.stringify(runtime.conversation.entityState));

  const historical = await runtime.post(payload('tour thứ 2 lúc nãy thì sao?', 5));
  assert.deepEqual(historical.referencedTourIds, [first.candidateList.tourIds[1]]);
  assert.equal(historical.entityState.selectedCandidateListId, first.candidateList.candidateListId);
});

test('paraphrases generalize across traveler, duration, exclusion, ordinal and alternatives', async () => {
  const runtime = createBrowserRuntime();
  const first = await runtime.post(payload('8 triệu tầm tầm cho hai đứa, đi đâu cũng được', 1));
  assert.equal(first.constraintState.travelers, 2);
  assert.equal(first.constraintState[SEMANTIC_STATE_KEY].slots.budget.scope, 'total');

  const three = await runtime.post(payload('tụi mình ba người nhé', 2));
  assert.equal(three.constraintState.travelers, 3);
  const maxDays = await runtime.post(payload('không quá ba hôm', 3));
  assert.equal(maxDays.constraintState[SEMANTIC_STATE_KEY].slots.duration.operator, 'max');
  const excluded = await runtime.post(payload('né Đà Lạt giúp mình', 4));
  assert.ok(excluded.constraintState[SEMANTIC_STATE_KEY].slots.destination.excludedValues.includes('Đà Lạt'));

  const other = await runtime.post(payload('đưa mình vài lựa chọn khác', 5));
  assert.equal(other.decision.operation, 'recommendation_alternative');
  if (other.candidateList?.tourIds.length >= 2) {
    const selected = await runtime.post(payload('cái số hai', 6));
    assert.deepEqual(selected.referencedTourIds, [other.candidateList.tourIds[1]]);
  }
});

test('zero-result copy and recommendation evidence stay natural and factual', async () => {
  const zeroRuntime = createBrowserRuntime();
  const zero = await zeroRuntime.post(payload('gợi ý tour với tổng ngân sách 1 triệu cho 2 người', 1));
  assert.equal(zero.outcome.code, 'NO_RESULTS');
  assert.match(zero.reply, /1\.000\.000đ cho 2 người/);
  assert.doesNotMatch(zero.reply, /các hướng nới|nới các loại trừ|cho 2(?:[.,;]|$)/i);

  const resultRuntime = createBrowserRuntime();
  const result = await resultRuntime.post(payload('đi đâu cũng được, khoảng 3 ngày và không muốn đi biển', 2));
  assert.ok(result.structuredContent.tours.length > 0);
  for (const item of result.structuredContent.tours) {
    assert.match(result.reply, new RegExp(item.name));
    assert.ok(item.reasons.every((reason) => !/khớp chủ đề biển/i.test(reason)));
  }
  assert.ok(result.structuredContent.tours.some((item) => item.reasons.some((reason) => /3 ngày/.test(reason))));
});

test('an unresolved tour pronoun after zero results stays a clarification', async () => {
  const runtime = createBrowserRuntime();
  const zero = await runtime.post(payload('cuối tuần sau muốn đổi gió 3 hôm, 2 ng, tổng 9 củ, ko biển nha', 1));
  assert.equal(zero.outcome.code, 'NO_RESULTS');

  const ordinal = await runtime.post(payload('cái đầu?', 2));
  assert.equal(ordinal.decision.action, 'CLARIFY');
  assert.deepEqual(ordinal.referencedTourIds, []);

  const suitability = await runtime.post(payload('tour này hợp người ngại leo nhiều ko, nói gọn thôi', 3));
  assert.equal(suitability.decision.action, 'CLARIFY');
  assert.equal(suitability.decision.reason, 'tour_entity_ambiguous');
  assert.deepEqual(suitability.referencedTourIds, []);
  assert.equal(suitability.candidateList, null);
  assert.match(suitability.reply, /chưa xác định được tour/i);
});

test('an itinerary-by-day formatting request without a tour asks for the tour', async () => {
  const runtime = createBrowserRuntime();
  await runtime.post(payload('2 ng, tổng 9tr, ko biển nha', 1));

  const result = await runtime.post(payload('tóm tắt từng ngày, xuống dòng giúp mình', 2));
  assert.equal(result.decision.action, 'CLARIFY');
  assert.equal(result.decision.reason, 'tour_entity_ambiguous');
  assert.match(result.reply, /chưa xác định (?:được|chắc) tour/i);
  assert.equal(result.constraintState.travelers, 2);
  assert.equal(result.constraintState.totalBudget, 9_000_000);
});
