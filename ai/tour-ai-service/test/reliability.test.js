const test = require('node:test');
const assert = require('node:assert/strict');

const gemini = require('../src/config/gemini');
const ragService = require('../src/services/ragService');

const ORIGINAL_GENERATE = gemini.generateChatReply;
const ORIGINAL_RAG = ragService.getRagContext;
const ORIGINAL_FIND = ragService.findMentionedTours;
const { filterAndRankHydratedTours: rankTours } = ragService;

const TOUR_ID = '64b000000000000000000071';

function loadChatService({ generateChatReply, getRagContext, findMentionedTours = async () => [] }) {
  gemini.generateChatReply = generateChatReply;
  ragService.getRagContext = getRagContext;
  ragService.findMentionedTours = findMentionedTours;
  delete require.cache[require.resolve('../src/services/chatService')];
  return require('../src/services/chatService');
}

test.afterEach(() => {
  gemini.generateChatReply = ORIGINAL_GENERATE;
  ragService.getRagContext = ORIGINAL_RAG;
  ragService.findMentionedTours = ORIGINAL_FIND;
  delete require.cache[require.resolve('../src/services/chatService')];
});

test('general grounded answer chỉ gọi generation một lần và reuse intent/state deterministic', async () => {
  let generationCalls = 0;
  let retrievalCalls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      generationCalls += 1;
      return 'Câu trả lời grounded.';
    },
    getRagContext: async () => {
      retrievalCalls += 1;
      return {
        tours: [{ _id: TOUR_ID, name: 'Tour test', days: 4, basePrice: 5_500_000, images: [] }],
        contextText: 'Tour test, 4 ngày, 5.500.000đ',
        matchedChunks: [],
      };
    },
  });

  const result = await generateChatAnswer({ prompt: 'Có gì đáng chú ý ở tour vừa nói?' });
  assert.equal(result.reply, 'Câu trả lời grounded.');
  assert.equal(retrievalCalls, 1);
  assert.equal(generationCalls, 1);
  assert.equal(result.structuredContent.type, 'grounded_answer');
  assert.equal(result.structuredContent.tours[0].tourId, TOUR_ID);
});

test('Gemini 429 dùng safe grounded fallback, không 500 và không invent fact ngoài tour hydrated', async () => {
  let generationCalls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      generationCalls += 1;
      const error = new Error('quota');
      error.status = 429;
      throw error;
    },
    getRagContext: async () => ({
      tours: [{ _id: TOUR_ID, name: 'Tour test', days: 4, basePrice: 5_500_000, images: [] }],
      contextText: 'Tour test, 4 ngày, 5.500.000đ',
      matchedChunks: [],
    }),
  });

  const result = await generateChatAnswer({ prompt: 'Có gì đáng chú ý trong hành trình này?' });
  assert.equal(generationCalls, 1);
  assert.equal(result.structuredContent.type, 'grounded_fallback');
  assert.deepEqual(result.structuredContent.tours[0], {
    tourId: TOUR_ID,
    name: 'Tour test',
    price: 5_500_000,
    duration: 4,
    highlights: [],
  });
  assert.match(result.reply, /4 ngày/);
  assert.match(result.reply, /5\.500\.000đ/);
  assert.doesNotMatch(result.reply, /khách sạn|máy bay|chính sách hủy/i);
});

test('site-level question trả deterministic general answer, không retrieval hoặc chọn tour ngẫu nhiên', async () => {
  let generationCalls = 0;
  let retrievalCalls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      generationCalls += 1;
      throw new Error('Gemini must not be called');
    },
    getRagContext: async () => {
      retrievalCalls += 1;
      return {
        tours: [{ _id: TOUR_ID, name: 'Tour ngẫu nhiên', days: 4, basePrice: 5_500_000, images: [] }],
        contextText: 'Tour ngẫu nhiên',
        matchedChunks: [],
      };
    },
  });

  const result = await generateChatAnswer({ prompt: 'VietVoyage có gì nổi bật?' });
  assert.equal(retrievalCalls, 0);
  assert.equal(generationCalls, 0);
  assert.equal(result.structuredContent.type, 'grounded_answer');
  assert.equal(result.structuredContent.scope, 'site');
  assert.match(result.reply, /tìm và so sánh tour/i);
  assert.doesNotMatch(result.reply, /Tour ngẫu nhiên|4 ngày|5\.500\.000đ/);
});

test('greeting và chitchat trả deterministic assistant response, không retrieval hoặc Gemini', async () => {
  let generationCalls = 0;
  let retrievalCalls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      generationCalls += 1;
      throw new Error('Gemini must not be called');
    },
    getRagContext: async () => {
      retrievalCalls += 1;
      return { tours: [], contextText: '', matchedChunks: [] };
    },
  });

  const cases = [
    ['Xin chào', 'greeting'],
    ['Chao ban', 'greeting'],
    ['Hôm nay bạn khỏe không?', 'chitchat'],
    ['Xin chào, hôm nay bạn khỏe không?', 'chitchat'],
    ['Cảm ơn nhé', 'acknowledgement'],
    ['Bạn là ai?', 'identity'],
    ['Bạn có thể giúp gì cho tôi?', 'capabilities'],
  ];
  for (const [prompt, kind] of cases) {
    const result = await generateChatAnswer({
      prompt,
      constraintState: { destination: 'Đà Lạt' },
    });
    assert.equal(result.intent.requestType, 'general');
    assert.equal(result.constraintState.destination, 'Đà Lạt');
    assert.equal(result.constraintState.dateRange, undefined);
    assert.equal(result.structuredContent.type, 'grounded_answer');
    assert.equal(result.structuredContent.scope, 'assistant');
    assert.equal(result.structuredContent.kind, kind);
    assert.doesNotMatch(result.reply, /chưa tìm thấy dữ liệu tour|điểm đến|thời lượng|ngân sách/i);
  }
  assert.equal(retrievalCalls, 0);
  assert.equal(generationCalls, 0);
});

test('general conversation classifier không chặn recommendation', async () => {
  let generationCalls = 0;
  let retrievalCalls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      generationCalls += 1;
      return '';
    },
    getRagContext: async () => {
      retrievalCalls += 1;
      return { tours: [], contextText: '', matchedChunks: [] };
    },
  });

  const result = await generateChatAnswer({ prompt: 'Tìm tour biển' });
  assert.equal(result.intent.requestType, 'recommendation');
  assert.equal(result.decision.action, 'SEARCH');
  assert.equal(result.structuredContent.type, 'recommendation');
  assert.equal(retrievalCalls, 1);
  assert.equal(generationCalls, 0);
});

test('relative-date recommendation không hỏi lại ngày, ngân sách hoặc số người đã biết', async () => {
  let retrievalCalls = 0;
  let generationCalls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      generationCalls += 1;
      throw new Error('Gemini must not be called');
    },
    getRagContext: async () => {
      retrievalCalls += 1;
      return { tours: [], contextText: '', matchedChunks: [] };
    },
  });

  const result = await generateChatAnswer({
    prompt: '5 ngày nữa tôi muốn đi du lịch nhưng chưa biết đi đâu, tài chính 4 triệu cho 2 người',
    now: '2026-08-13T05:00:00.000Z',
  });
  assert.equal(result.intent.requestType, 'recommendation');
  assert.equal(result.constraintState.dateRange.start, '2026-08-18');
  assert.equal(result.constraintState.totalBudget, 4_000_000);
  assert.equal(result.constraintState.maxPrice, 2_000_000);
  assert.equal(result.constraintState.travelers, 2);
  assert.equal(result.constraintState.days, undefined);
  assert.equal(result.decision.action, 'SEARCH');
  assert.equal(result.structuredContent.type, 'recommendation');
  assert.doesNotMatch(result.reply, /\?\s*$/);
  assert.equal(retrievalCalls, 1);
  assert.equal(generationCalls, 0);
});

test('Gemini failure cho general question dùng fallback đúng intent, không mô tả candidate đầu tiên', async () => {
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      const error = new Error('quota');
      error.status = 429;
      throw error;
    },
    getRagContext: async () => ({
      tours: [{ _id: TOUR_ID, name: 'Tour ngẫu nhiên', days: 4, basePrice: 5_500_000, images: [] }],
      contextText: 'Tour ngẫu nhiên, 4 ngày, 5.500.000đ',
      matchedChunks: [],
    }),
  });

  const result = await generateChatAnswer({ prompt: 'Bạn có thể hỗ trợ gì thêm?' });
  assert.equal(result.structuredContent.type, 'grounded_fallback');
  assert.match(result.reply, /câu hỏi chung/i);
  assert.doesNotMatch(result.reply, /Tour ngẫu nhiên|4 ngày|5\.500\.000đ/);
});

test('explicit destination general query dùng Mongo-resolved IDs trước semantic retrieval', async () => {
  let retrievalOptions = null;
  let generationCalls = 0;
  const daLatId = '64b000000000000000000075';
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      generationCalls += 1;
      return 'Đà Lạt có khí hậu mát mẻ theo mô tả tour hiện có.';
    },
    findMentionedTours: async (prompt) => {
      assert.equal(prompt, 'Tour Đà Lạt có gì hay?');
      return [{ _id: daLatId }];
    },
    getRagContext: async (_prompt, options) => {
      retrievalOptions = options;
      return {
        tours: [{
          _id: daLatId,
          name: 'Tour Đà Lạt 3N3Đ',
          location: 'Đà Lạt',
          region: 'Miền Nam',
          status: 'published',
          isActive: true,
          days: 3,
          basePrice: 4_500_000,
          images: [],
          highlights: [],
          itinerary: [],
          departures: [],
        }],
        contextText: 'Tour Đà Lạt 3N3Đ',
        matchedChunks: [],
      };
    },
  });

  const result = await generateChatAnswer({ prompt: 'Tour Đà Lạt có gì hay?' });
  assert.deepEqual(retrievalOptions.directTourIds, [daLatId]);
  assert.equal(retrievalOptions.skipChroma, true);
  assert.equal(generationCalls, 0);
  assert.deepEqual(result.referencedTourIds, [daLatId]);
  assert.equal(result.decision.action, 'ANSWER');
  assert.equal(result.structuredContent.type, 'tour_detail');
});

test('temporary trip constraint routes to recommendation instead of booking/general generation', async () => {
  let retrievalCalls = 0;
  let generationCalls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      generationCalls += 1;
      return '';
    },
    getRagContext: async () => {
      retrievalCalls += 1;
      return { tours: [], contextText: '', matchedChunks: [] };
    },
  });

  const result = await generateChatAnswer({ prompt: 'Chuyến này dưới 5 triệu.' });
  assert.equal(result.intent.requestType, 'recommendation');
  assert.equal(result.constraintState.maxPrice, 5_000_000);
  assert.equal(result.decision.action, 'SEARCH');
  assert.equal(result.structuredContent.type, 'recommendation');
  assert.equal(retrievalCalls, 1);
  assert.equal(generationCalls, 0);
});

test('explicit destination không tồn tại trả clarification an toàn, không gọi retrieval hoặc Gemini', async () => {
  let retrievalCalls = 0;
  let generationCalls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      generationCalls += 1;
      return '';
    },
    findMentionedTours: async () => [],
    getRagContext: async () => {
      retrievalCalls += 1;
      return { tours: [], contextText: '', matchedChunks: [] };
    },
  });

  const result = await generateChatAnswer({ prompt: 'Tour Atlantis có gì hay?' });
  assert.equal(retrievalCalls, 0);
  assert.equal(generationCalls, 0);
  assert.equal(result.structuredContent.type, 'clarification');
  assert.equal(result.structuredContent.missingFor, 'entity');
  assert.match(result.reply, /chưa tìm thấy tour published\/active/i);
});

test('timeout wrapper reject có mã phân loại và không log prompt', async () => {
  const { withTimeout } = require('../src/config/gemini');
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, 'Gemini generation'),
    (error) => error.code === 'GEMINI_TIMEOUT' && !String(error.message).includes('PRIVATE-PROMPT')
  );
});

test('generated business claim không có trong hydrated data bị validation fallback', async () => {
  const { validateGeneratedReply } = loadChatService({
    generateChatReply: async () => '',
    getRagContext: async () => ({ tours: [], contextText: '', matchedChunks: [] }),
  });
  const tours = [{
    _id: TOUR_ID,
    name: 'Tour test',
    days: 4,
    basePrice: 5_500_000,
    departures: [{ price: 5_700_000, availableSlots: 0 }],
    itinerary: [],
    inclusions: [],
    exclusions: [],
  }];
  assert.deepEqual(validateGeneratedReply('Tour kéo dài 5 ngày.', tours), { valid: false, reason: 'unsupported_duration' });
  assert.deepEqual(validateGeneratedReply('Tour còn 5 chỗ.', tours), { valid: false, reason: 'unsupported_availability' });
  assert.deepEqual(validateGeneratedReply('Tour ở khách sạn 5 sao.', tours), { valid: false, reason: 'unsupported_accommodation' });
  assert.equal(validateGeneratedReply('Tour 4 ngày, giá 5.500.000đ và đã hết 0 chỗ.', tours).valid, true);
});

test('generation prompt chỉ gửi tối đa bốn user turns, không đưa assistant fact cũ vào model', () => {
  const { buildGenerationPrompt } = loadChatService({
    generateChatReply: async () => '',
    getRagContext: async () => ({ tours: [], contextText: '', matchedChunks: [] }),
  });
  const prompt = buildGenerationPrompt({
    prompt: 'Câu mới',
    contextText: 'Dữ liệu thật',
    constraintState: { days: 4 },
    history: [
      { role: 'user', content: 'U1' },
      { role: 'assistant', content: 'FACT-CŨ-KHÔNG-XÁC-MINH' },
      { role: 'user', content: 'U2' },
      { role: 'user', content: 'U3' },
      { role: 'user', content: 'U4' },
      { role: 'user', content: 'U5' },
    ],
  });
  assert.doesNotMatch(prompt, /FACT-CŨ-KHÔNG-XÁC-MINH/);
  assert.doesNotMatch(prompt, /Khách: U1/);
  for (const turn of ['U2', 'U3', 'U4', 'U5']) assert.match(prompt, new RegExp(`Khách: ${turn}`));
});

test('multi-turn A giữ constraint, ordinal entity và live sold-out availability', async () => {
  const FIRST = '64b000000000000000000081';
  const SECOND = '64b000000000000000000082';
  const toursById = new Map([
    [FIRST, { _id: FIRST, name: 'Tour biển Nha Trang', location: 'Nha Trang', region: 'Miền Trung', days: 4, basePrice: 5_400_000, images: [], highlights: [], itinerary: [], departures: [] }],
    [SECOND, { _id: SECOND, name: 'Tour biển Đà Nẵng', location: 'Đà Nẵng', region: 'Miền Trung', days: 4, basePrice: 5_800_000, images: [], highlights: [], itinerary: [], departures: [{ _id: '64b000000000000000000083', date: new Date('2026-09-24T17:00:00.000Z'), availableSlots: 0, totalSlots: 20, price: 5_900_000 }] }],
  ]);
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => { throw new Error('Gemini must not be called'); },
    getRagContext: async (_prompt, options) => ({
      tours: options.directTourIds?.length
        ? options.directTourIds.map((id) => toursById.get(String(id))).filter(Boolean)
        : [...toursById.values()].filter((tour) => !(options.constraintState.exclusions || []).some((value) => tour.name.includes(value))),
      contextText: 'hydrated',
      matchedChunks: [],
    }),
  });

  const one = await generateChatAnswer({ prompt: 'Tìm tour biển.', now: '2026-08-13T00:00:00Z' });
  assert.equal(one.decision.action, 'SEARCH');
  assert.equal(one.structuredContent.type, 'recommendation');

  const two = await generateChatAnswer({
    prompt: '4 ngày dưới 6 triệu.',
    constraintState: one.constraintState,
    entityState: one.entityState,
    now: '2026-08-13T00:00:00Z',
  });
  assert.equal(two.structuredContent.type, 'recommendation');
  assert.equal(two.constraintState.days, 4);
  assert.equal(two.constraintState.maxPrice, 6_000_000);

  const three = await generateChatAnswer({
    prompt: 'Không Phú Quốc.',
    constraintState: two.constraintState,
    entityState: two.entityState,
    now: '2026-08-13T00:00:00Z',
  });
  assert.deepEqual(three.constraintState.exclusions, ['Phú Quốc']);

  const four = await generateChatAnswer({
    prompt: 'Tour thứ hai thì sao?',
    constraintState: three.constraintState,
    entityState: three.entityState,
    now: '2026-08-13T00:00:00Z',
  });
  assert.equal(four.structuredContent.type, 'comparison');
  assert.deepEqual(four.referencedTourIds, [FIRST, SECOND]);

  const five = await generateChatAnswer({
    prompt: '25/9 còn chỗ không?',
    constraintState: four.constraintState,
    entityState: { ...four.entityState, lastReferencedTourIds: [SECOND] },
    now: '2026-08-13T00:00:00Z',
  });
  assert.equal(five.structuredContent.type, 'availability');
  assert.equal(five.structuredContent.departures[0].availableSlots, 0);
  assert.match(five.reply, /0 chỗ/);
});

test('date-only continuation keeps the referenced tour instead of matching an unrelated tour name', async () => {
  let directIds = null;
  let mentionLookupCalls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => { throw new Error('Gemini must not be called'); },
    findMentionedTours: async (prompt) => {
      mentionLookupCalls += 1;
      assert.equal(prompt, '27 thì sao?');
      return [{ _id: '64b000000000000000000099' }];
    },
    getRagContext: async (_prompt, options) => {
      directIds = options.directTourIds;
      return {
        tours: [{
          _id: TOUR_ID,
          name: 'Tour QA 4 ngày',
          location: 'QA',
          region: 'Miền Bắc',
          status: 'published',
          isActive: true,
          days: 4,
          basePrice: 4_321_000,
          images: [],
          highlights: [],
          itinerary: [],
          departures: [{
            _id: '64b000000000000000000072',
            date: new Date('2026-08-27T01:00:00.000Z'),
            availableSlots: 7,
            totalSlots: 10,
            price: 4_455_000,
          }],
        }],
        contextText: 'hydrated',
        matchedChunks: [],
      };
    },
  });

  const result = await generateChatAnswer({
    prompt: '27 thì sao?',
    constraintState: { dateRange: { start: '2026-08-24', end: '2026-08-24', label: '24/8/2026' } },
    entityState: { lastRequestType: 'availability', lastReferencedTourIds: [TOUR_ID] },
    now: '2026-08-13T00:00:00Z',
  });

  assert.equal(mentionLookupCalls, 0);
  assert.deepEqual(directIds, [TOUR_ID]);
  assert.equal(result.structuredContent.type, 'availability');
  assert.equal(result.structuredContent.tourId, TOUR_ID);
  assert.equal(result.structuredContent.departures[0].availableSlots, 7);
});

test('word ordinal uses recent structured IDs instead of searching tour names', async () => {
  const first = '64b000000000000000000081';
  const second = '64b000000000000000000082';
  let mentionLookupCalls = 0;
  let directIds = null;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => { throw new Error('Gemini must not be called'); },
    findMentionedTours: async () => {
      mentionLookupCalls += 1;
      return [{ _id: '64b000000000000000000099' }];
    },
    getRagContext: async (_prompt, options) => {
      directIds = options.directTourIds;
      return {
        tours: options.directTourIds.map((id) => ({
          _id: id,
          name: id === first ? 'Tour đầu tiên' : 'Tour thứ hai',
          location: 'QA',
          region: 'Miền Trung',
          status: 'published',
          isActive: true,
          days: 4,
          basePrice: id === first ? 5_400_000 : 5_800_000,
          images: [],
          highlights: [],
          itinerary: [],
          departures: [],
        })),
        contextText: 'hydrated',
        matchedChunks: [],
      };
    },
  });

  const result = await generateChatAnswer({
    prompt: 'Tour thứ hai thì sao?',
    constraintState: { days: 4, maxPrice: 6_000_000 },
    entityState: {
      lastRequestType: 'recommendation',
      lastSuggestedTourIds: [first, second],
      lastReferencedTourIds: [first, second],
    },
  });

  assert.equal(mentionLookupCalls, 0);
  assert.deepEqual(directIds, [first, second]);
  assert.equal(result.structuredContent.type, 'comparison');
  assert.deepEqual(result.structuredContent.tours.map((tour) => tour.tourId), [first, second]);
});

test('multi-turn B dùng preference ở conversation mới nhưng current active pace override', async () => {
  const BEACH = '64b000000000000000000091';
  const ACTIVE = '64b000000000000000000092';
  const beachTour = { _id: BEACH, name: 'Nha Trang nghỉ dưỡng', location: 'Nha Trang', region: 'Miền Trung', status: 'published', isActive: true, days: 4, basePrice: 5_400_000, images: [], tags: ['biển', 'nghỉ dưỡng'], highlights: ['Resort và thời gian tự do'], itinerary: [], departures: [] };
  const activeTour = { _id: ACTIVE, name: 'Sa Pa khám phá', location: 'Sa Pa', region: 'Miền Bắc', status: 'published', isActive: true, days: 4, basePrice: 5_700_000, images: [], tags: ['núi', 'khám phá'], highlights: ['Trekking trải nghiệm'], itinerary: [], departures: [] };
  const profile = {
    interests: ['biển'],
    travelStyles: ['nghỉ dưỡng'],
    preferredDestinations: [],
    preferredRegions: [],
    dislikedDestinations: [],
    dislikedRegions: [],
    dislikedInterests: [],
    dislikedTravelStyles: [],
    accommodationPreferences: [],
    dislikedAccommodationPreferences: [],
    budgetPreference: null,
    durationPreference: null,
    pace: 'relaxed',
  };
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => { throw new Error('Gemini must not be called'); },
    getRagContext: async (_prompt, options) => {
      const ranked = rankTours([beachTour, activeTour], options.constraintState, {
        requestType: 'recommendation',
        orderedIds: [BEACH, ACTIVE],
        preferences: options.preferenceContext.profile,
      });
      assert.ok(ranked.length > 0, JSON.stringify({ constraints: options.constraintState, preferences: options.preferenceContext.profile }));
      return {
        tours: ranked,
        contextText: 'hydrated',
        matchedChunks: [],
      };
    },
  });

  const broad = await generateChatAnswer({
    prompt: 'Tìm tour cho tôi.',
    preferenceContext: { profile },
  });
  assert.equal(broad.intent.requestType, 'recommendation', JSON.stringify(broad));
  assert.equal(broad.structuredContent?.type, 'recommendation', JSON.stringify(broad));
  assert.ok(broad.structuredContent.tours.length > 0, JSON.stringify(broad));
  assert.equal(broad.structuredContent.tours[0].tourId, BEACH);
  assert.match(broad.structuredContent.tours[0].savedPreferenceReasons.join(' '), /nghỉ dưỡng|biển|nhẹ nhàng/i);

  const override = await generateChatAnswer({
    prompt: 'Nhưng lần này muốn khám phá nhiều.',
    constraintState: broad.constraintState,
    entityState: broad.entityState,
    preferenceContext: { profile },
  });
  assert.equal(override.intent.requestType, 'recommendation', JSON.stringify(override));
  assert.equal(override.structuredContent?.type, 'recommendation', JSON.stringify(override));
  assert.equal(override.constraintState.pace, 'active');
  assert.equal(override.structuredContent.tours[0].tourId, ACTIVE);
  assert.doesNotMatch(override.structuredContent.tours[0].savedPreferenceReasons.join(' '), /nhẹ nhàng|nghỉ dưỡng/i);
});
