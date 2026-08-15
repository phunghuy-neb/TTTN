const test = require('node:test');
const assert = require('node:assert/strict');

const Tour = require('../src/models/Tour');
const { findMentionedTours } = require('../src/services/ragService');

const ORIGINAL_FIND = Tour.find;

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function mockFind(pool, onQuery = () => {}) {
  Tour.find = (query) => {
    onQuery(query);
    const regexes = (query.$or || []).map((condition) => Object.values(condition)[0]).filter((value) => value instanceof RegExp);
    const rows = pool.filter((tour) =>
      tour.status === query.status &&
      tour.isActive !== false &&
      regexes.some((regex) => regex.test(tour.searchText) || regex.test(tour.slug))
    );
    const chain = {
      select() { return chain; },
      limit() { return chain; },
      lean: async () => rows,
    };
    return chain;
  };
}

test.afterEach(() => {
  Tour.find = ORIGINAL_FIND;
});

test('Mongo explicit lookup resolve destination có dấu và không dấu', async () => {
  const active = {
    _id: '64b000000000000000000075',
    name: 'Tour Đà Lạt 3N3Đ',
    location: 'Đà Lạt',
    slug: 'tour-da-lat-3n3d',
    searchText: 'tour da lat 3n3d',
    status: 'published',
    isActive: true,
  };
  mockFind([active]);

  const accented = await findMentionedTours('Tour Đà Lạt có gì hay?');
  const plain = await findMentionedTours('Tour Da Lat co gi hay?');
  assert.deepEqual(accented.map((tour) => String(tour._id)), [active._id]);
  assert.deepEqual(plain.map((tour) => String(tour._id)), [active._id]);
});

test('Mongo entity lookup resolves a destination title segment without requiring every question word in the tour name', async () => {
  const active = {
    _id: '64b000000000000000000078',
    name: 'Hội An — Phố cổ đèn lồng lung linh',
    location: 'Quảng Nam',
    slug: 'hoi-an-pho-co-den-long-lung-linh',
    searchText: 'hoi an pho co den long lung linh quang nam',
    status: 'published',
    isActive: true,
  };
  mockFind([active]);

  const result = await findMentionedTours('Hội An có phù hợp cho người mê chụp ảnh không?');
  assert.deepEqual(result.map((tour) => String(tour._id)), [active._id]);
});

test('Mongo explicit lookup luôn yêu cầu published/active và không trả tour ẩn', async () => {
  let capturedQuery = null;
  const pool = [
    { _id: '64b000000000000000000076', name: 'Tour Đà Lạt draft', location: 'Đà Lạt', slug: 'tour-da-lat-draft', searchText: 'tour da lat draft', status: 'draft', isActive: true },
    { _id: '64b000000000000000000077', name: 'Tour Đà Lạt inactive', location: 'Đà Lạt', slug: 'tour-da-lat-inactive', searchText: 'tour da lat inactive', status: 'published', isActive: false },
  ];
  mockFind(pool, (query) => { capturedQuery = query; });

  const result = await findMentionedTours('Tour Đà Lạt có gì hay?');
  assert.equal(capturedQuery.status, 'published');
  assert.deepEqual(capturedQuery.isActive, { $ne: false });
  assert.deepEqual(result, []);
});

test('Mongo explicit lookup trả rỗng với destination không tồn tại', async () => {
  mockFind([]);
  assert.deepEqual(await findMentionedTours('Tour Atlantis có gì hay?'), []);
});
