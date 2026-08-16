const test = require('node:test');
const assert = require('node:assert/strict');

const gemini = require('../src/config/gemini');
const ragService = require('../src/services/ragService');
const { buildGroundingContract } = require('../src/services/factualGroundingService');
const { ERROR_CODES } = require('../src/services/aiContractService');
const { PROVIDER_FAILURE_CLASSES } = require('../src/services/providerReliabilityService');

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

  const result = await generateChatAnswer({ prompt: 'Có gì đáng chú ý ở tour vừa nói?' });
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

test('MEDIUM-04 provider fallback addresses suitability and highlight questions without claiming a conclusion', async () => {
  const saPaTour = {
    _id: TOUR_ID,
    name: 'Sa Pa — Săn mây trên đỉnh Fansipan',
    location: 'Sa Pa',
    days: 3,
    basePrice: 4_100_000,
    images: [],
    highlights: ['Săn mây trên đỉnh Fansipan', 'Trải nghiệm văn hóa bản địa'],
    itinerary: [],
  };
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      const error = new Error('quota');
      error.status = 429;
      throw error;
    },
    getRagContext: async () => ({
      tours: [saPaTour],
      contextText: 'Sa Pa, săn mây trên đỉnh Fansipan, trải nghiệm văn hóa bản địa.',
      matchedChunks: [],
    }),
    findMentionedTours: async () => [saPaTour],
  });

  const cases = [
    {
      prompt: 'Sa Pa có phù hợp cho người thích chụp cảnh thiên nhiên và săn mây không?',
      expected: /chưa thể đánh giá chắc chắn mức độ phù hợp/i,
    },
    {
      prompt: 'Hành trình Sa Pa có hợp với người mê săn mây và trải nghiệm văn hóa không?',
      expected: /chưa thể đánh giá chắc chắn mức độ phù hợp/i,
    },
  ];

  for (const { prompt, expected } of cases) {
    const result = await generateChatAnswer({ prompt });
    assert.equal(result.decision.action, 'ANSWER', prompt);
    assert.equal(result.providerStatus.code, 'AI_PROVIDER_RATE_LIMITED', prompt);
    assert.equal(result.providerStatus.fallbackUsed, true, prompt);
    assert.match(result.reply, expected, prompt);
    assert.match(result.reply, /Săn mây trên đỉnh Fansipan/i, prompt);
    assert.doesNotMatch(result.reply, /rất phù hợp|hoàn toàn phù hợp/i, prompt);
  }
});

test('MEDIUM-04 contextual suitability fallback keeps the selected tour and states its limitation', async () => {
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      const error = new Error('provider down');
      error.status = 503;
      throw error;
    },
    getRagContext: async () => ({
      tours: [{
        _id: TOUR_ID,
        name: 'Sa Pa — Săn mây trên đỉnh Fansipan',
        location: 'Sa Pa',
        days: 3,
        basePrice: 4_100_000,
        images: [],
        highlights: ['Săn mây trên đỉnh Fansipan'],
        itinerary: [],
      }],
      contextText: 'Sa Pa, săn mây trên đỉnh Fansipan.',
      matchedChunks: [],
    }),
  });

  const result = await generateChatAnswer({
    prompt: 'Tour đó có hợp cho người mê săn mây không?',
    entityState: {
      selectedTourId: TOUR_ID,
      currentTourId: TOUR_ID,
      lastReferencedTourIds: [TOUR_ID],
    },
  });

  assert.equal(result.decision.action, 'ANSWER');
  assert.deepEqual(result.referencedTourIds, [TOUR_ID]);
  assert.match(result.reply, /chưa thể (?:đánh giá|kết luận) chắc chắn mức độ phù hợp/i);
  assert.match(result.reply, /Săn mây trên đỉnh Fansipan/i);
});

test('Stage 3C exact multi-intent suitability invokes Gemini and binds the named tour', async () => {
  let generationCalls = 0;
  const haLong = {
    _id: TOUR_ID,
    name: 'Vịnh Hạ Long — Kỳ quan trên biển',
    location: 'Quảng Ninh',
    region: 'Miền Bắc',
    status: 'published',
    isActive: true,
    days: 2,
    basePrice: 3_200_000,
    images: [],
    highlights: [],
    summary: 'Du thuyền khám phá vịnh Hạ Long.',
    itinerary: [{
      title: 'Hang Sửng Sốt — Hang Luồn',
      description: 'Tham quan hang Sửng Sốt và chèo kayak tại hang Luồn.',
      accommodation: 'Du thuyền 4 sao trên vịnh Hạ Long',
    }],
    departures: [],
  };
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      generationCalls += 1;
      return 'Lịch trình có chèo kayak tại hang Luồn và ngủ đêm trên du thuyền.';
    },
    findMentionedTours: async () => [haLong],
    getRagContext: async () => ({
      tours: [haLong],
      contextText: 'Vịnh Hạ Long, chèo kayak tại hang Luồn, ngủ đêm trên du thuyền.',
      matchedChunks: [],
    }),
  });

  const result = await generateChatAnswer({
    prompt: 'Tôi thích di sản thiên nhiên, chèo kayak và muốn ngủ đêm trên vịnh. Tour Vịnh Hạ Long — Kỳ quan trên biển có phù hợp không? Hãy giải thích ngắn gọn dựa trên lịch trình hiện có.',
    preferenceContext: {
      profile: { interests: ['thiên nhiên'], preferredDestinations: ['Hạ Long'] },
      update: { active: true, commandOnly: false, hasChanges: true, forget: false },
    },
  });

  assert.equal(generationCalls, 1);
  assert.equal(result.decision.action, 'ANSWER');
  assert.equal(result.decision.operation, 'general_answer');
  assert.equal(result.providerStatus.providerAttempted, true);
  assert.equal(result.providerStatus.providerSucceeded, true);
  assert.equal(result.providerStatus.fallbackUsed, false);
  assert.equal(result.providerStatus.finalComposer, 'gemini');
  assert.equal(result.providerStatus.provenanceClass, 'GEMINI_CONFIRMED');
  assert.deepEqual(result.referencedTourIds, [TOUR_ID]);
  assert.equal(result.entityState.selectedTourId, TOUR_ID);
  assert.equal(result.entityState.currentTourId, TOUR_ID);
  assert.deepEqual(result.entityState.lastReferencedTourIds, [TOUR_ID]);
  assert.equal(result.structuredContent.type, 'grounded_answer');
});

test('MEDIUM-04 factual fallback does not add suitability or highlight disclaimers to a price question', () => {
  const { providerFallbackReply } = loadChatService({
    generateChatReply: async () => '',
    getRagContext: async () => ({ tours: [], contextText: '', matchedChunks: [] }),
  });
  const saPaTour = {
    _id: TOUR_ID,
    name: 'Sa Pa — Săn mây trên đỉnh Fansipan',
    days: 3,
    basePrice: 4_100_000,
    highlights: ['Săn mây trên đỉnh Fansipan'],
    departures: [],
  };
  const reply = providerFallbackReply({
    prompt: 'Tour Sa Pa giá bao nhiêu?',
    tours: [saPaTour],
    hasVerifiedTourContext: true,
    grounding: buildGroundingContract([saPaTour], {}),
  });

  assert.match(reply, /4\.100\.000đ/);
  assert.doesNotMatch(reply, /mức độ phù hợp|điểm nổi bật/i);
});

test('MEDIUM-04 highlight fallback explicitly states the unavailable dimension and exposes only hydrated highlights', () => {
  const { providerFallbackReply } = loadChatService({
    generateChatReply: async () => '',
    getRagContext: async () => ({ tours: [], contextText: '', matchedChunks: [] }),
  });
  const saPaTour = {
    _id: TOUR_ID,
    name: 'Sa Pa — Săn mây trên đỉnh Fansipan',
    days: 3,
    basePrice: 4_100_000,
    highlights: ['Săn mây trên đỉnh Fansipan', 'Trải nghiệm văn hóa bản địa'],
    departures: [],
  };
  const reply = providerFallbackReply({
    prompt: 'Tour này có gì nổi bật?',
    tours: [saPaTour],
    hasVerifiedTourContext: true,
    grounding: buildGroundingContract([saPaTour], {}),
  });

  assert.match(reply, /chưa thể diễn giải đầy đủ điểm nổi bật/i);
  assert.match(reply, /Săn mây trên đỉnh Fansipan/);
  assert.match(reply, /Trải nghiệm văn hóa bản địa/);
  assert.doesNotMatch(reply, /rất phù hợp|hoàn toàn phù hợp/i);
});

test('provider fallback answers itinerary-focused suitability with grounded day details', () => {
  const { providerFallbackReply } = loadChatService({
    generateChatReply: async () => '',
    getRagContext: async () => ({ tours: [], contextText: '', matchedChunks: [] }),
  });
  const daLatTour = {
    _id: TOUR_ID,
    name: 'Đà Lạt — Thành phố ngàn hoa',
    days: 2,
    basePrice: 3_400_000,
    highlights: [],
    departures: [],
    itinerary: [
      { dayNumber: 1, title: 'Thác Datanla', description: 'Ghé thác Datanla trải nghiệm máng trượt.' },
      { dayNumber: 2, title: 'Đồi chè Cầu Đất', description: 'Săn bình minh và tham quan nông trại cà phê Arabica.' },
    ],
  };

  const reply = providerFallbackReply({
    prompt: 'Tour này có phù hợp để săn bình minh không? Hãy giải thích theo từng ngày của lịch trình.',
    tours: [daLatTour],
    hasVerifiedTourContext: true,
    grounding: buildGroundingContract([daLatTour], {}),
  });

  assert.match(reply, /chưa thể kết luận chắc chắn mức độ phù hợp/i);
  assert.match(reply, /Ngày 1:/i);
  assert.match(reply, /Thác Datanla/i);
  assert.match(reply, /trải nghiệm máng trượt/i);
  assert.match(reply, /Ngày 2:/i);
  assert.match(reply, /Đồi chè Cầu Đất/i);
  assert.match(reply, /săn bình minh và tham quan nông trại cà phê Arabica/i);
  assert.doesNotMatch(reply, /3\.400\.000đ/);
});

test('single-tour suitability fallback uses grounded itinerary even without an explicit itinerary keyword', () => {
  const { providerFallbackReply } = loadChatService({
    generateChatReply: async () => '',
    getRagContext: async () => ({ tours: [], contextText: '', matchedChunks: [] }),
  });
  const haLongTour = {
    _id: TOUR_ID,
    name: 'Vịnh Hạ Long — Kỳ quan trên biển',
    days: 2,
    basePrice: 3_200_000,
    highlights: [],
    departures: [],
    itinerary: [{
      dayNumber: 1,
      title: 'Hang Sửng Sốt — Hang Luồn',
      description: 'Tham quan hang Sửng Sốt và chèo kayak tại hang Luồn.',
      accommodation: 'Du thuyền 4 sao trên vịnh Hạ Long',
    }],
  };

  const reply = providerFallbackReply({
    prompt: 'Tour Hạ Long có hợp với người muốn chèo kayak và ngủ đêm trên vịnh không?',
    tours: [haLongTour],
    hasVerifiedTourContext: true,
    grounding: buildGroundingContract([haLongTour], {}),
  });

  assert.match(reply, /chưa thể kết luận chắc chắn mức độ phù hợp/i);
  assert.match(reply, /Ngày 1:/i);
  assert.match(reply, /chèo kayak tại hang Luồn/i);
  assert.match(reply, /lưu trú: Du thuyền 4 sao trên vịnh Hạ Long/i);
  assert.doesNotMatch(reply, /3\.200\.000đ/);
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
      return 'Tour kéo dài 3 ngày.';
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
  assert.equal(generationCalls, 1);
  assert.deepEqual(result.referencedTourIds, [daLatId]);
  assert.equal(result.decision.action, 'ANSWER');
  assert.equal(result.decision.operation, 'general_answer');
  assert.equal(result.structuredContent.type, 'grounded_answer');
  assert.equal(result.providerStatus.providerAttempted, true);
  assert.equal(result.providerStatus.providerSucceeded, true);
  assert.equal(result.providerStatus.fallbackUsed, false);
  assert.equal(result.providerStatus.provenanceClass, 'GEMINI_CONFIRMED');
  assert.equal(result.entityState.selectedTourId, daLatId);
  assert.equal(result.entityState.currentTourId, daLatId);
  assert.deepEqual(result.entityState.lastReferencedTourIds, [daLatId]);
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

test('MEDIUM-05 G05 unsupported itinerary opt-out claim is rejected into a grounded suitability fallback', async () => {
  const haLong = {
    _id: TOUR_ID,
    name: 'Vịnh Hạ Long — Kỳ quan trên biển',
    location: 'Hạ Long',
    days: 2,
    basePrice: 3_200_000,
    images: [],
    highlights: [],
    summary: 'Du thuyền qua đảo đá vôi, chèo kayak và ngủ đêm trên vịnh.',
    itinerary: [{
      title: 'Hang Sửng Sốt — Hang Luồn — Đảo Ti Tốp',
      description: 'Tham quan hang Sửng Sốt, chèo kayak tại hang Luồn và tắm biển ở đảo Ti Tốp.',
    }],
    departures: [],
  };
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => 'Bạn hoàn toàn có thể lựa chọn nghỉ ngơi trên du thuyền hoặc tham gia các hoạt động nhẹ nhàng phù hợp với nhu cầu của mình.',
    findMentionedTours: async () => [haLong],
    getRagContext: async () => ({
      tours: [haLong],
      contextText: 'Hạ Long, du thuyền, chèo kayak, hang Sửng Sốt, đảo Ti Tốp.',
      matchedChunks: [],
    }),
  });

  const result = await generateChatAnswer({
    prompt: 'Vịnh Hạ Long có phù hợp cho người muốn trải nghiệm thiên nhiên nhưng không thích đi bộ nhiều không?',
  });

  assert.equal(result.providerStatus.code, 'AI_RESPONSE_INVALID');
  assert.equal(result.providerStatus.fallbackUsed, true);
  assert.equal(result.observability.validation.status, 'rejected');
  assert.equal(result.observability.validation.reason, 'unsupported_operational_choice');
  assert.match(result.reply, /chưa thể (?:đánh giá|kết luận) chắc chắn mức độ phù hợp/i);
  assert.doesNotMatch(result.reply, /có thể lựa chọn nghỉ ngơi|bỏ qua/i);
});

test('implicit opt-out follow-up binds the selected tour before validator fallback', async () => {
  const phongNha = {
    _id: TOUR_ID,
    name: 'Phong Nha — Vương quốc hang động',
    location: 'Quảng Bình',
    days: 3,
    basePrice: 4_800_000,
    images: [],
    highlights: [],
    summary: 'Khám phá hệ thống hang động.',
    itinerary: [{
      title: 'Sông Chày — Hang Tối',
      description: 'Trải nghiệm zipline, bơi vào hang Tối và tắm bùn khoáng tự nhiên.',
    }],
    departures: [],
  };
  let directTourIds = null;
  let mentionCalls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => 'Bạn có thể bỏ qua đoạn bơi và chờ đoàn ở bên ngoài.',
    findMentionedTours: async () => {
      mentionCalls += 1;
      return [];
    },
    getRagContext: async (_prompt, options = {}) => {
      directTourIds = options.directTourIds || null;
      return {
        tours: [phongNha],
        contextText: 'Sông Chày, hang Tối, zipline, bơi và tắm bùn.',
        matchedChunks: [],
      };
    },
  });

  const result = await generateChatAnswer({
    prompt: 'có bỏ qua đoạn bơi được ko',
    entityState: {
      selectedTourId: TOUR_ID,
      currentTourId: TOUR_ID,
      lastReferencedTourIds: [TOUR_ID],
    },
  });

  assert.equal(mentionCalls, 0);
  assert.deepEqual(directTourIds, [TOUR_ID]);
  assert.deepEqual(result.referencedTourIds, [TOUR_ID]);
  assert.equal(result.observability.validation.reason, 'unsupported_operational_choice');
  assert.match(result.reply, /lịch trình.*bơi vào hang Tối/i);
  assert.match(result.reply, /không (?:nêu|có thông tin).*bỏ qua/i);
  assert.match(result.reply, /chưa thể xác nhận.*bỏ qua/i);
  assert.doesNotMatch(result.reply, /nhà cung cấp AI đang tạm gián đoạn|4\.800\.000/i);
  assert.doesNotMatch(result.reply, /\.\./);
  assert.doesNotMatch(result.reply, /có thể bỏ qua|chờ đoàn/i);
});

test('MEDIUM-05 L5-03 booking absence claim without booking evidence is rejected into a non-assertive fallback', async () => {
  const unrelatedTour = {
    _id: TOUR_ID,
    name: 'Tour Hội An',
    location: 'Hội An',
    days: 3,
    basePrice: 3_600_000,
    images: [],
    highlights: [],
    itinerary: [],
    departures: [],
  };
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => 'Hiện tại hệ thống chưa có dữ liệu về mã đặt chỗ ABC123 nên mã này không tồn tại.',
    findMentionedTours: async () => [],
    getRagContext: async () => ({
      tours: [unrelatedTour],
      contextText: 'Tour Hội An, 3 ngày, giá 3.600.000đ.',
      matchedChunks: [],
    }),
  });

  const result = await generateChatAnswer({ prompt: 'kiểm tra mã đặt chỗ ABC123' });

  assert.equal(result.providerStatus.code, 'AI_RESPONSE_INVALID');
  assert.equal(result.providerStatus.fallbackUsed, true);
  assert.equal(result.observability.validation.status, 'rejected');
  assert.equal(result.observability.validation.reason, 'booking_claim_without_evidence');
  assert.match(result.reply, /không thể kết luận mã .* tồn tại hay không/i);
  assert.doesNotMatch(result.reply, /hệ thống chưa có dữ liệu|mã này không tồn tại/i);
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

test('evaluative ordinal resolves the active candidate list instead of semantic lookup', async () => {
  const first = '64b000000000000000000083';
  const second = '64b000000000000000000084';
  const wrong = '64b000000000000000000085';
  let mentionLookupCalls = 0;
  let directIds = null;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => 'Tour thứ hai có điểm nổi bật đã được xác minh.',
    findMentionedTours: async () => {
      mentionLookupCalls += 1;
      return [{ _id: wrong }];
    },
    getRagContext: async (_prompt, options) => {
      directIds = options.directTourIds || null;
      const ids = options.directTourIds || [wrong];
      return {
        tours: ids.map((id) => ({
          _id: id,
          name: id === second ? 'Tour đúng thứ hai' : 'Tour không được chọn',
          status: 'published',
          isActive: true,
          days: 3,
          basePrice: 3_400_000,
          images: [],
          highlights: ['Điểm nổi bật đã được xác minh'],
          itinerary: [],
          departures: [],
        })),
        contextText: 'Điểm nổi bật đã được xác minh.',
        matchedChunks: [],
      };
    },
  });

  const result = await generateChatAnswer({
    prompt: 'cái thứ 2 có gì nổi bật',
    entityState: {
      candidateLists: [{
        candidateListId: 'active-list',
        createdTurnId: 'turn-list',
        createdTurnSequence: 10,
        historyEpoch: 0,
        source: 'recommendation',
        tourIds: [first, second],
      }],
      activeCandidateListId: 'active-list',
      lastSuggestedTourIds: [first, second],
      lastReferencedTourIds: [first, second],
    },
  });

  assert.equal(mentionLookupCalls, 0);
  assert.deepEqual(directIds, [second]);
  assert.equal(result.decision.action, 'ANSWER');
  assert.deepEqual(result.referencedTourIds, [second]);
  assert.equal(result.entityState.selectedTourId, second);
});

test('selected-tour evaluation rehydrates outside search constraints without leaking unrelated cards', async () => {
  const unrelatedId = '64b000000000000000000086';
  const selectedTour = {
    _id: TOUR_ID,
    name: 'Phong Nha — Vương quốc hang động',
    location: 'Quảng Bình',
    status: 'published',
    isActive: true,
    days: 3,
    basePrice: 4_800_000,
    images: [],
    highlights: [],
    itinerary: [{ description: 'Tham quan động Phong Nha.' }],
    departures: [],
  };
  const unrelatedTour = {
    ...selectedTour,
    _id: unrelatedId,
    name: 'Tour không liên quan',
    location: 'Nơi khác',
    basePrice: 2_000_000,
  };
  const retrievalCalls = [];
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => 'Tour Phong Nha có hoạt động tham quan động Phong Nha.',
    findMentionedTours: async () => [],
    getRagContext: async (_prompt, options = {}) => {
      retrievalCalls.push(options);
      if (options.directTourIds?.length) {
        return options.requestType === 'tour_detail' || Object.keys(options.constraintState || {}).length === 0
          ? { tours: [selectedTour], contextText: 'Phong Nha, tham quan động Phong Nha.', matchedChunks: [] }
          : { tours: [], contextText: '', matchedChunks: [] };
      }
      return { tours: [unrelatedTour], contextText: 'Tour không liên quan.', matchedChunks: [] };
    },
  });

  const result = await generateChatAnswer({
    prompt: 'tour này có gì đáng nhất',
    constraintState: {
      travelers: 4,
      maxTotalBudget: 8_000_000,
      totalBudget: 8_000_000,
      maxPrice: 2_000_000,
      days: 3,
      durationRequired: true,
    },
    entityState: {
      selectedTourId: TOUR_ID,
      currentTourId: TOUR_ID,
      lastReferencedTourIds: [TOUR_ID],
    },
  });

  assert.equal(retrievalCalls[0].requestType, 'tour_detail');
  assert.deepEqual(retrievalCalls[0].directTourIds, [TOUR_ID]);
  assert.deepEqual(result.referencedTourIds, [TOUR_ID]);
  assert.deepEqual(result.structuredContent.tours.map((tour) => tour.tourId), [TOUR_ID]);
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

test('Stage 3 successful provider attempt exposes unambiguous Gemini provenance', async () => {
  let calls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      calls += 1;
      return {
        text: 'Tour test kéo dài 4 ngày, giá từ 5.500.000đ.',
        providerMeta: {
          providerAttempted: true,
          providerSucceeded: true,
          attemptCount: 2,
          maxAttempts: 2,
          retryCount: 1,
          retryDelaysMs: [25],
          failureClass: null,
        },
      };
    },
    getRagContext: async () => ({
      tours: [{ _id: TOUR_ID, name: 'Tour test', days: 4, basePrice: 5_500_000, images: [], itinerary: [], departures: [] }],
      contextText: 'Tour test, 4 ngày, 5.500.000đ',
      matchedChunks: [],
    }),
  });

  const result = await generateChatAnswer({ prompt: 'Có gì đáng chú ý ở tour vừa nói?' });
  assert.equal(calls, 1);
  assert.equal(result.providerStatus.status, 'healthy');
  assert.equal(result.providerStatus.providerAttempted, true);
  assert.equal(result.providerStatus.providerSucceeded, true);
  assert.equal(result.providerStatus.attemptCount, 2);
  assert.equal(result.providerStatus.retryCount, 1);
  assert.equal(result.providerStatus.fallbackUsed, false);
  assert.equal(result.providerStatus.finalComposer, 'gemini');
  assert.equal(result.providerStatus.provenanceClass, 'GEMINI_CONFIRMED');
  assert.deepEqual(result.observability.provider, result.providerStatus);
});

test('Stage 3 quota exhaustion preserves provider metadata and does not masquerade as temporary rate limit', async () => {
  let calls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      calls += 1;
      const error = new Error('resource exhausted');
      error.status = 429;
      error.providerMeta = {
        providerAttempted: true,
        providerSucceeded: false,
        attemptCount: 1,
        maxAttempts: 2,
        retryCount: 0,
        retryDelaysMs: [],
        failureClass: PROVIDER_FAILURE_CLASSES.QUOTA_EXHAUSTED,
        httpStatus: 429,
        providerErrorStatus: 'RESOURCE_EXHAUSTED',
        retryAfterMs: 47_000,
        quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
        quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
        quotaLocation: 'global',
        quotaModel: 'gemini-3.5-flash',
        quotaValue: '20',
      };
      throw error;
    },
    getRagContext: async () => ({
      tours: [{ _id: TOUR_ID, name: 'Tour test', days: 4, basePrice: 5_500_000, images: [], highlights: [], itinerary: [], departures: [] }],
      contextText: 'Tour test, 4 ngày, 5.500.000đ',
      matchedChunks: [],
    }),
  });

  const result = await generateChatAnswer({ prompt: 'Có gì đáng chú ý ở tour vừa nói?' });
  assert.equal(calls, 1);
  assert.equal(result.providerStatus.code, ERROR_CODES.AI_PROVIDER_QUOTA_EXHAUSTED);
  assert.equal(result.providerStatus.failureClass, PROVIDER_FAILURE_CLASSES.QUOTA_EXHAUSTED);
  assert.equal(result.providerStatus.providerAttempted, true);
  assert.equal(result.providerStatus.providerSucceeded, false);
  assert.equal(result.providerStatus.attemptCount, 1);
  assert.equal(result.providerStatus.retryCount, 0);
  assert.equal(result.providerStatus.quotaValue, '20');
  assert.equal(result.providerStatus.fallbackUsed, true);
  assert.equal(result.providerStatus.finalComposer, 'deterministic_grounded_fallback');
  assert.equal(result.providerStatus.provenanceClass, 'GEMINI_FAILED_FALLBACK');
  assert.equal(result.observability.provider.quotaId, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
});

test('Stage 3 validator rejection records successful transport but deterministic final composer', async () => {
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => ({
      text: 'Tour test lưu trú tại khách sạn 5 sao.',
      providerMeta: {
        providerAttempted: true,
        providerSucceeded: true,
        attemptCount: 1,
        maxAttempts: 2,
        retryCount: 0,
        retryDelaysMs: [],
        failureClass: null,
      },
    }),
    getRagContext: async () => ({
      tours: [{ _id: TOUR_ID, name: 'Tour test', days: 4, basePrice: 5_500_000, images: [], highlights: [], itinerary: [], departures: [] }],
      contextText: 'Tour test, 4 ngày, 5.500.000đ',
      matchedChunks: [],
    }),
  });

  const result = await generateChatAnswer({ prompt: 'Có gì đáng chú ý ở tour vừa nói?' });
  assert.equal(result.providerStatus.code, ERROR_CODES.AI_RESPONSE_INVALID);
  assert.equal(result.providerStatus.providerAttempted, true);
  assert.equal(result.providerStatus.providerSucceeded, true);
  assert.equal(result.providerStatus.failureClass, PROVIDER_FAILURE_CLASSES.VALIDATOR_REJECTION);
  assert.equal(result.providerStatus.fallbackUsed, true);
  assert.equal(result.providerStatus.finalComposer, 'deterministic_grounded_fallback');
  assert.equal(result.providerStatus.provenanceClass, 'GEMINI_FAILED_FALLBACK');
  assert.doesNotMatch(result.reply, /khách sạn 5 sao/i);
});

test('Stage 3 empty provider response activates one-attempt grounded fallback provenance', async () => {
  let calls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      calls += 1;
      return {
        text: '   ',
        providerMeta: {
          providerAttempted: true,
          providerSucceeded: true,
          attemptCount: 1,
          maxAttempts: 2,
          retryCount: 0,
          retryDelaysMs: [],
          failureClass: null,
        },
      };
    },
    getRagContext: async () => ({
      tours: [{ _id: TOUR_ID, name: 'Tour test', days: 4, basePrice: 5_500_000, images: [], highlights: [], itinerary: [], departures: [] }],
      contextText: 'Tour test, 4 ngày, 5.500.000đ',
      matchedChunks: [],
    }),
  });

  const result = await generateChatAnswer({ prompt: 'Có gì đáng chú ý ở tour vừa nói?' });
  assert.equal(calls, 1);
  assert.equal(result.providerStatus.code, ERROR_CODES.AI_RESPONSE_INVALID);
  assert.equal(result.providerStatus.providerSucceeded, true);
  assert.equal(result.providerStatus.attemptCount, 1);
  assert.equal(result.providerStatus.failureClass, PROVIDER_FAILURE_CLASSES.VALIDATOR_REJECTION);
  assert.equal(result.providerStatus.finalComposer, 'deterministic_grounded_fallback');
  assert.equal(result.providerStatus.provenanceClass, 'GEMINI_FAILED_FALLBACK');
  assert.equal(result.structuredContent.type, 'grounded_fallback');
});

test('Stage 3 deterministic response explicitly records provider skipped provenance', async () => {
  let calls = 0;
  const { generateChatAnswer } = loadChatService({
    generateChatReply: async () => {
      calls += 1;
      throw new Error('Gemini must not be called');
    },
    getRagContext: async () => ({ tours: [], contextText: '', matchedChunks: [] }),
  });

  const result = await generateChatAnswer({ prompt: 'VietVoyage có gì nổi bật?' });
  assert.equal(calls, 0);
  assert.equal(result.providerStatus.status, 'skipped');
  assert.equal(result.providerStatus.providerAttempted, false);
  assert.equal(result.providerStatus.providerSucceeded, false);
  assert.equal(result.providerStatus.attemptCount, 0);
  assert.equal(result.providerStatus.fallbackUsed, false);
  assert.equal(result.providerStatus.finalComposer, 'deterministic_renderer');
  assert.equal(result.providerStatus.provenanceClass, 'DETERMINISTIC_CONFIRMED');
});
