import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTourRegions } from '../src/services/tourRegionResolver.js'

test('resolveTourRegions resolves single-region tours in Bắc, Trung and Nam', () => {
  assert.deepEqual(resolveTourRegions({ name: 'Khám phá Hạ Long' }), ['Miền Bắc'])
  assert.deepEqual(resolveTourRegions({ name: 'Khám phá Huế và Đà Nẵng' }), ['Miền Trung'])
  assert.deepEqual(resolveTourRegions({ location: 'Phú Quốc' }), ['Miền Nam'])
})

test('departure in another region does not become a tour destination', () => {
  assert.deepEqual(
    resolveTourRegions({ name: 'Khởi hành Hà Nội → Quy Nhơn → Phú Yên' }),
    ['Miền Trung']
  )
  assert.deepEqual(
    resolveTourRegions({ name: 'Khởi hành HCM → Hà Giang → Cao Bằng' }),
    ['Miền Bắc']
  )
})

test('resolveTourRegions supports Bắc + Trung tours', () => {
  assert.deepEqual(
    resolveTourRegions({ name: 'Ninh Bình → Huế → Đà Nẵng' }),
    ['Miền Bắc', 'Miền Trung']
  )
  assert.deepEqual(
    resolveTourRegions({ name: 'Hành trình di sản: Ninh Bình - Huế - Đà Nẵng' }),
    ['Miền Bắc', 'Miền Trung']
  )
})

test('resolveTourRegions supports Trung + Nam tours', () => {
  assert.deepEqual(
    resolveTourRegions({ name: 'Huế → Đà Nẵng → TP.HCM → Cần Thơ' }),
    ['Miền Trung', 'Miền Nam']
  )
})

test('resolveTourRegions supports Bắc + Trung + Nam tours', () => {
  assert.deepEqual(
    resolveTourRegions({ name: 'Hà Nội → Hạ Long → Huế → Đà Nẵng → TP.HCM → Cần Thơ' }),
    ['Miền Bắc', 'Miền Trung', 'Miền Nam']
  )
})

test('unknown destinations return an empty array instead of Miền Nam', () => {
  assert.deepEqual(resolveTourRegions({ name: 'Hành trình đến địa điểm bí ẩn' }), [])
  assert.deepEqual(resolveTourRegions({ name: 'Tour Nam Âu: Hà Nội - Miền Nam Pháp - Monaco' }), [])
})

test('itinerary departure text is ignored while visited places still count', () => {
  assert.deepEqual(resolveTourRegions({
    name: 'Hành trình di sản',
    itinerary: [
      { title: 'Hà Nội - Huế', description: 'Khởi hành từ Hà Nội, đến Huế tham quan Đại Nội.' },
      { title: 'Ngày 2', description: 'Khám phá phố cổ Hội An và Đà Nẵng.' },
      { title: 'Đà Nẵng - Hà Nội', description: 'Tự do buổi sáng, sau đó trở về Hà Nội.' },
    ],
  }), ['Miền Trung'])
})

test('exact segment matching prevents punctuation and phrase false positives', () => {
  assert.deepEqual(resolveTourRegions({ name: 'Phú Yên - Bãi Xép' }), ['Miền Trung'])
  assert.deepEqual(resolveTourRegions({ name: 'Hạ Long (Ăn Trưa)' }), ['Miền Bắc'])
  assert.deepEqual(resolveTourRegions({ name: 'Phật Thích ca Mâu ni' }), [])
  assert.deepEqual(resolveTourRegions({ name: 'Đường Hồ Chí Minh' }), [])
})

test('scraped pickup and return content does not create extra regions', () => {
  assert.deepEqual(resolveTourRegions({
    name: 'Tour Bình Hưng 2N2Đ: HCM - Ninh Chữ - Vĩnh Hy - Bình Hưng',
    itinerary: [
      {
        title: 'HCM - Đảo Bình Hưng',
        description: [
          'Điểm đón khách:',
          '- Điện Biên Phủ, Bình Thạnh.',
          '- Biên Hòa, Đồng Nai.',
          '- Bình Phước.',
          'Khởi hành đi Bình Hưng và tham quan Vĩnh Hy.',
        ].join('\n'),
      },
      {
        title: 'Trùng Sơn Cổ Tự - HCM',
        description: 'Xe đưa đoàn về lại TP.HCM, kết thúc chương trình.',
      },
    ],
  }), ['Miền Trung'])

  assert.deepEqual(resolveTourRegions({
    name: 'Tour Đà Nẵng 4N3Đ: Hà Nội - Đà Nẵng - Sơn Trà',
    itinerary: [
      {
        title: 'Hà Nội - Đà Nẵng - Sơn Trà',
        description: 'Khởi hành từ sân bay Nội Bài đi Đà Nẵng, tham quan Sơn Trà.',
      },
      {
        title: 'Đà Nẵng - Hà Nội',
        description: 'Ra sân bay, đáp chuyến bay về lại Hà Nội.',
      },
    ],
  }), ['Miền Trung'])
})

test('Đà Lạt and Lâm Đồng follow the Central convention', () => {
  assert.deepEqual(resolveTourRegions({ name: 'Đà Lạt' }), ['Miền Trung'])
  assert.deepEqual(resolveTourRegions({ location: 'Lâm Đồng' }), ['Miền Trung'])
})
