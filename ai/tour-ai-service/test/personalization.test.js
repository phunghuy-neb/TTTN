const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRecommendationItems,
  buildRecommendationReply,
  shouldClarifyRecommendationWithPreferences,
} = require('../src/services/travelAdvisorService');
const { filterAndRankHydratedTours, preferenceScore } = require('../src/services/ragService');
const { generateChatAnswer } = require('../src/services/chatService');
const { extractConstraintDelta, mergeConstraintState } = require('../src/services/travelAdvisorService');

const IDS = {
  beach: '64b000000000000000000021',
  mountain: '64b000000000000000000022',
};

function tour(overrides = {}) {
  return {
    _id: IDS.beach,
    name: 'Tour biển nghỉ dưỡng Nha Trang',
    location: 'Nha Trang',
    region: 'Miền Trung',
    status: 'published',
    isActive: true,
    days: 4,
    basePrice: 5_500_000,
    tags: ['biển', 'nghỉ dưỡng'],
    highlights: ['Resort sát biển'],
    itinerary: [],
    departures: [],
    reviews: [],
    ...overrides,
  };
}

const PROFILE = {
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
  pace: null,
};

test('profile có tín hiệu thì recommendation rộng không hỏi lại vô ích', () => {
  assert.equal(shouldClarifyRecommendationWithPreferences({}, PROFILE), false);
  assert.equal(shouldClarifyRecommendationWithPreferences({}, {}), true);
});

test('preference là soft ranking, không phải hard filter', () => {
  const ranked = filterAndRankHydratedTours([
    tour(),
    tour({ _id: IDS.mountain, name: 'Tour núi khám phá Sa Pa', location: 'Sa Pa', region: 'Miền Bắc', tags: ['núi', 'khám phá'] }),
  ], {}, { requestType: 'recommendation', orderedIds: [IDS.mountain, IDS.beach], preferences: PROFILE });
  assert.deepEqual(ranked.map((item) => String(item._id)), [IDS.beach, IDS.mountain]);
  assert.equal(ranked.length, 2);
});

test('constraint núi hiện tại override preference biển mà không sửa profile', () => {
  const ranked = filterAndRankHydratedTours([
    tour(),
    tour({ _id: IDS.mountain, name: 'Tour núi khám phá Sa Pa', location: 'Sa Pa', region: 'Miền Bắc', tags: ['núi', 'khám phá'] }),
  ], { interests: ['núi'] }, { requestType: 'recommendation', orderedIds: [IDS.beach, IDS.mountain], preferences: PROFILE });
  assert.equal(String(ranked[0]._id), IDS.mountain);
  assert.deepEqual(ranked.map((item) => String(item._id)), [IDS.mountain]);
  assert.deepEqual(PROFILE.interests, ['biển']);
});

test('explicit destination hiện tại không bị preferred destination cũ lấn át', () => {
  const ranked = filterAndRankHydratedTours([
    tour(),
    tour({ _id: IDS.mountain, name: 'Tour Sa Pa núi rừng', location: 'Sa Pa', region: 'Miền Bắc', tags: ['núi'] }),
  ], { destination: 'Sa Pa', region: 'Miền Bắc' }, {
    requestType: 'recommendation',
    orderedIds: [IDS.beach, IDS.mountain],
    preferences: { ...PROFILE, preferredDestinations: ['Nha Trang'] },
  });
  assert.deepEqual(ranked.map((item) => String(item._id)), [IDS.mountain]);
});

test('recommendation tách lý do current constraint và saved preference', () => {
  const items = buildRecommendationItems([tour()], { maxPrice: 6_000_000 }, new Date('2026-08-13T00:00:00Z'), PROFILE);
  assert.match(items[0].currentConstraintReasons.join(' '), /ngân sách/i);
  assert.match(items[0].savedPreferenceReasons.join(' '), /nghỉ dưỡng|biển/i);
  const reply = buildRecommendationReply(items);
  assert.match(reply, /Theo yêu cầu hiện tại/i);
  assert.match(reply, /Theo sở thích đã lưu/i);
});

test('semantic hints nhận diện tour biển/núi ngay cả khi dữ liệu không có tag chuẩn hóa', () => {
  const beachItems = buildRecommendationItems([
    tour({ tags: ['ivivu'], highlights: [], name: 'Tour Bình Hưng - Vĩnh Hy - San Hô', summary: '' }),
  ], {}, new Date('2026-08-13T00:00:00Z'), PROFILE);
  assert.match(beachItems[0].savedPreferenceReasons.join(' '), /biển/i);

  const ranked = filterAndRankHydratedTours([
    tour({ tags: ['ivivu'], highlights: [], name: 'Tour Bình Hưng - Vĩnh Hy - San Hô' }),
    tour({ _id: IDS.mountain, tags: ['ivivu'], highlights: [], name: 'Tour Tây Bắc - Sapa - Fansipan', location: 'Sapa', region: 'Miền Bắc' }),
  ], { interests: ['núi'] }, { requestType: 'recommendation', orderedIds: [IDS.beach, IDS.mountain], preferences: PROFILE });
  assert.equal(String(ranked[0]._id), IDS.mountain);
});

test('preference update command trả deterministic response, không cần Gemini', async () => {
  const result = await generateChatAnswer({
    prompt: 'Tôi thích tour biển và nghỉ dưỡng.',
    preferenceContext: {
      profile: PROFILE,
      update: { active: true, commandOnly: true, hasChanges: true, forget: false },
    },
  });
  assert.equal(result.structuredContent.type, 'preference_update');
  assert.equal(result.structuredContent.updated, true);
  assert.match(result.reply, /đã cập nhật sở thích/i);
});

test('current pace constraint override saved relaxed preference trong ranking và explanation', () => {
  const activeTour = tour({
    _id: IDS.mountain,
    name: 'Tour Sa Pa khám phá năng động',
    location: 'Sa Pa',
    region: 'Miền Bắc',
    tags: ['núi', 'khám phá'],
    highlights: ['Trekking và trải nghiệm bản địa'],
  });
  const state = mergeConstraintState({}, extractConstraintDelta('Nhưng lần này muốn khám phá nhiều.'));
  assert.equal(state.pace, 'active');
  const ranked = filterAndRankHydratedTours([tour(), activeTour], state, {
    requestType: 'recommendation',
    orderedIds: [IDS.beach, IDS.mountain],
    preferences: { ...PROFILE, pace: 'relaxed' },
  });
  assert.equal(String(ranked[0]._id), IDS.mountain);
  const items = buildRecommendationItems(ranked, state, new Date('2026-08-13T00:00:00Z'), { ...PROFILE, pace: 'relaxed' });
  assert.match(items[0].currentConstraintReasons.join(' '), /năng động|khám phá/i);
  assert.doesNotMatch(items[0].savedPreferenceReasons.join(' '), /nhẹ nhàng|nghỉ dưỡng/i);
});

test('hard exclusion hiện tại suppress saved preference xung đột và destination analogy', () => {
  const state = mergeConstraintState({}, extractConstraintDelta('không biển'));
  const inlandTour = tour({
    _id: IDS.mountain,
    name: 'Ninh Bình - Tràng An',
    location: 'Ninh Bình',
    region: 'Miền Bắc',
    tags: ['di sản', 'văn hóa'],
    highlights: ['Tràng An'],
    summary: 'Cảnh quan đá vôi được ví như Hạ Long trên cạn.',
  });
  const preferences = { ...PROFILE, preferredDestinations: ['Hạ Long'] };

  assert.equal(preferenceScore(inlandTour, preferences, state), 0);
  const items = buildRecommendationItems([inlandTour], state, new Date('2026-08-13T00:00:00Z'), preferences);
  assert.doesNotMatch(items[0].savedPreferenceReasons.join(' '), /biển|Hạ Long/i);
});
