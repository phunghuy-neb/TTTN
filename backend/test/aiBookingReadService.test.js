import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import {
  bookingTimeFilter,
  createAiBookingReadService,
  parseBookingRequest,
} from '../src/services/aiBookingReadService.js'

const USER_A = new mongoose.Types.ObjectId().toString()
const USER_B = new mongoose.Types.ObjectId().toString()
const BOOKING_A1 = new mongoose.Types.ObjectId().toString()
const BOOKING_A2 = new mongoose.Types.ObjectId().toString()
const BOOKING_B = new mongoose.Types.ObjectId().toString()
const TOUR_ID = new mongoose.Types.ObjectId().toString()

test('cancellation policy read-only text is not a booking cancel command', () => {
  const result = parseBookingRequest('tour thu hai con cho khong va chinh sach huy the nao')
  assert.equal(result.active, false)
  assert.equal(result.actionType, null)
})

test('tour constraint changes require booking-specific evidence before activating booking context', async () => {
  const messages = [
    'à đổi thành 3 người',
    'nếu đổi thành 4 người thì sao?',
    'vậy đổi tiêu chí thành tối đa 3 ngày đi',
    'chuyển sang 4 khách',
  ]
  const calls = []
  const read = createAiBookingReadService({
    async findOwnedByIdentifier(args) { calls.push(['identifier', args]); return null },
    async findOwned(args) { calls.push(['owned', args]); return [] },
    async findOwnedByIds(args) { calls.push(['ids', args]); return [] },
    async findLatestAttempts(args) { calls.push(['attempts', args]); return [] },
    async findOwnedByTourName(args) { calls.push(['name', args]); return [] },
  })
  for (const message of messages) {
    const parsed = parseBookingRequest(message)
    assert.equal(parsed.active, false, message)
    assert.equal(parsed.actionType, null, message)
    assert.deepEqual(await read({ userId: USER_A, message }), { active: false }, message)
  }
  assert.deepEqual(calls, [])
})

test('trusted booking page can still interpret a concise passenger/departure change', () => {
  const passenger = parseBookingRequest('đổi thành 4 người', new Date(), { trustedBookingContext: true })
  const departure = parseBookingRequest('đổi sang ngày khác', new Date(), { trustedBookingContext: true })
  assert.equal(passenger.active, true)
  assert.equal(passenger.actionType, 'change_passengers')
  assert.equal(departure.active, true)
  assert.equal(departure.actionType, 'change_departure')
})

function booking({ id, user, code, createdAt, departureDate, status = 'pending_payment', totalPrice = 5_000_000 }) {
  return {
    _id: id,
    user,
    bookingCode: code,
    tour: {
      _id: TOUR_ID,
      slug: 'tour-test',
      location: 'Đà Nẵng',
      days: 4,
      cancellationPolicy: 'Liên hệ VietVoyage để được hỗ trợ.',
      departures: [],
    },
    tourName: `Tour ${code}`,
    departureId: null,
    departureDate: new Date(departureDate),
    guests: 2,
    unitPrice: totalPrice / 2,
    originalPrice: totalPrice,
    discountAmount: 0,
    totalPrice,
    status,
    paymentMethod: status === 'paid' ? 'momo' : 'vnpay',
    paidAt: status === 'paid' ? new Date('2026-08-12T03:00:00.000Z') : null,
    paymentExpiresAt: new Date('2026-08-20T03:00:00.000Z'),
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  }
}

function matchesQuery(item, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === 'status' && value?.$in) return value.$in.includes(item.status)
    if (value && typeof value === 'object' && ('$gte' in value || '$lt' in value)) {
      const actual = new Date(item[key])
      return (!value.$gte || actual >= value.$gte) && (!value.$lt || actual < value.$lt)
    }
    return String(item[key]) === String(value)
  })
}

function repository(bookings, attempts = []) {
  return {
    async findOwnedByIdentifier({ userId, id, code }) {
      return bookings.find((item) => String(item.user) === String(userId) && (id ? String(item._id) === String(id) : item.bookingCode === code)) || null
    },
    async findOwned({ userId, query = {}, sort = { createdAt: -1 }, limit = 20 }) {
      const [sortKey, direction] = Object.entries(sort)[0]
      return bookings
        .filter((item) => String(item.user) === String(userId) && matchesQuery(item, query))
        .sort((left, right) => (new Date(left[sortKey]) - new Date(right[sortKey])) * direction)
        .slice(0, limit)
    },
    async findOwnedByIds({ userId, ids }) {
      return bookings.filter((item) => String(item.user) === String(userId) && ids.includes(String(item._id)))
    },
    async findLatestAttempts({ userId, bookingIds }) {
      return attempts
        .filter((attempt) => String(attempt.user) === String(userId) && bookingIds.includes(String(attempt.booking)))
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    },
    async findOwnedByTourName({ userId, normalizedName }) {
      const terms = normalizedName.split(' ')
      const normalize = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
      return bookings.filter((item) => String(item.user) === String(userId) && terms.every((term) => normalize(item.tourName).includes(term)))
    },
  }
}

const BOOKINGS = [
  booking({ id: BOOKING_A1, user: USER_A, code: 'VV-A-000001', createdAt: '2026-08-12T04:00:00.000Z', departureDate: '2026-09-10T01:00:00.000Z' }),
  booking({ id: BOOKING_A2, user: USER_A, code: 'VV-A-000002', createdAt: '2026-08-13T04:00:00.000Z', departureDate: '2026-09-20T02:00:00.000Z', status: 'paid', totalPrice: 7_000_000 }),
  booking({ id: BOOKING_B, user: USER_B, code: 'VV-B-000001', createdAt: '2026-08-13T05:00:00.000Z', departureDate: '2026-09-15T03:00:00.000Z' }),
]

test('nhận diện booking/payment read-only và mutation guidance', () => {
  assert.equal(parseBookingRequest('Tour tôi đặt gần nhất là tour nào?').active, true)
  assert.equal(parseBookingRequest('Booking này thanh toán chưa?').requestType, 'payment_status')
  const action = parseBookingRequest('Hủy booking này giúp tôi')
  assert.equal(action.requestType, 'guidance_action')
  assert.equal(action.actionType, 'cancel')
  assert.equal(parseBookingRequest('Huy booking nay').actionType, 'cancel')
})

test('cancel intent chỉ match token độc lập, không match substring trong chuyến hoặc Thủy', () => {
  assert.equal(parseBookingRequest('Chuyến này dưới 5 triệu').active, false)
  assert.equal(parseBookingRequest('Tour Thủy Biều có gì hay?').active, false)
})

test('tour đặt hôm qua lọc createdAt theo Asia/Ho_Chi_Minh, không lọc departureDate', () => {
  const filter = bookingTimeFilter('Tour tôi đặt hôm qua mấy giờ bắt đầu?', new Date('2026-08-13T05:00:00.000Z'))
  assert.equal(filter.field, 'createdAt')
  assert.equal(filter.start.toISOString(), '2026-08-11T17:00:00.000Z')
  assert.equal(filter.end.toISOString(), '2026-08-12T17:00:00.000Z')
})

test('booking gần nhất chỉ lấy dữ liệu thuộc user hiện tại', async () => {
  const read = createAiBookingReadService(repository(BOOKINGS))
  const result = await read({ userId: USER_A, message: 'Tour tôi đặt gần nhất là tour nào?', now: new Date('2026-08-13T06:00:00.000Z') })
  assert.deepEqual(result.allowedBookingIds, [BOOKING_A2])
  assert.equal(result.bookings[0].bookingCode, 'VV-A-000002')
})

test('booking ID của user khác trả not found và không lộ dữ liệu', async () => {
  const read = createAiBookingReadService(repository(BOOKINGS))
  const result = await read({ userId: USER_A, message: `Xem booking ${BOOKING_B}` })
  assert.equal(result.notFound, true)
  assert.equal(result.reason, 'BOOKING_NOT_FOUND')
  assert.deepEqual(result.bookings, [])
  assert.deepEqual(result.allowedBookingIds, [])
})

test('payment attempt luôn lọc cả user và booking ownership', async () => {
  const attempts = [
    { _id: new mongoose.Types.ObjectId(), booking: BOOKING_A1, user: USER_A, provider: 'vnpay', status: 'failed', amount: 5_000_000, responseCode: '24', createdAt: new Date('2026-08-13T01:00:00Z') },
    { _id: new mongoose.Types.ObjectId(), booking: BOOKING_A1, user: USER_B, provider: 'momo', status: 'paid', amount: 1, responseCode: '0', createdAt: new Date('2026-08-13T02:00:00Z') },
  ]
  const read = createAiBookingReadService(repository(BOOKINGS, attempts))
  const result = await read({ userId: USER_A, message: `Booking ${BOOKING_A1} thanh toán chưa?` })
  assert.equal(result.bookings[0].payment.latestAttempt.provider, 'vnpay')
  assert.equal(result.bookings[0].payment.latestAttempt.status, 'failed')
  assert.equal(result.bookings[0].payment.latestAttempt.amount, 5_000_000)
})

test('đơn thứ hai resolve theo structured list và vẫn ownership-check', async () => {
  const read = createAiBookingReadService(repository(BOOKINGS))
  const result = await read({
    userId: USER_A,
    message: 'Đơn thứ hai thì sao?',
    entityState: { lastListedBookingIds: [BOOKING_A2, BOOKING_A1, BOOKING_B] },
  })
  assert.deepEqual(result.allowedBookingIds, [BOOKING_A1])
  assert.equal(result.bookings[0].bookingCode, 'VV-A-000001')
})

test('booking page của user khác không được dùng làm current context', async () => {
  const read = createAiBookingReadService(repository(BOOKINGS))
  const result = await read({ userId: USER_A, message: 'Booking này thanh toán chưa?', rawPageBookingId: BOOKING_B })
  assert.equal(result.notFound, true)
  assert.equal(result.ownedPageBookingId, null)
  assert.deepEqual(result.allowedBookingIds, [])
})

test('tháng sau trả danh sách upcoming thuộc user, không gồm user khác', async () => {
  const read = createAiBookingReadService(repository(BOOKINGS))
  const result = await read({ userId: USER_A, message: 'Tháng sau tôi có tour nào?', now: new Date('2026-08-13T05:00:00.000Z') })
  assert.deepEqual(result.listedBookingIds, [BOOKING_A1, BOOKING_A2])
  assert.equal(result.bookings.length, 2)
})

test('tên tour rõ ràng resolve booking thuộc user và hỏi lại nếu user có nhiều đơn cùng tour', async () => {
  const named = [
    { ...BOOKINGS[0], tourName: 'Tour Phú Quốc 4N3Đ' },
    { ...BOOKINGS[1], tourName: 'Tour Huế 3N2Đ' },
    { ...BOOKINGS[2], tourName: 'Tour Phú Quốc riêng của user B' },
  ]
  const read = createAiBookingReadService(repository(named))
  const result = await read({ userId: USER_A, message: 'Booking Phú Quốc của tôi khởi hành khi nào?' })
  assert.deepEqual(result.allowedBookingIds, [BOOKING_A1])
  assert.equal(result.bookings[0].tourName, 'Tour Phú Quốc 4N3Đ')
})

test('stress table: booking/payment/mutation intent remains read-only (15 cases)', () => {
  const cases = [
    ['booking gần nhất', 'booking_detail', null],
    ['tour tôi đặt hôm qua', 'booking_detail', null],
    ['tháng sau tôi có tour nào?', 'booking_list', null],
    ['đơn thứ hai thì sao?', 'booking_detail', null],
    ['booking này thanh toán chưa?', 'payment_status', null],
    ['đơn gần nhất còn bao nhiêu tiền phải trả?', 'payment_status', null],
    ['Hủy booking này giúp tôi', 'guidance_action', 'cancel'],
    ['Huy booking nay', 'guidance_action', 'cancel'],
    ['Đổi lịch booking này giúp tôi', 'guidance_action', 'change_departure'],
    ['Đổi hành khách booking này', 'guidance_action', 'change_passengers'],
    ['Refund booking này', 'guidance_action', 'refund'],
    ['Thanh toán booking này giúp tôi', 'guidance_action', 'pay'],
    ['Áp dụng voucher cho booking này', 'guidance_action', 'apply_voucher'],
    ['Chuyến này dưới 5 triệu', null, null],
    ['Tour Thủy Biều có gì hay?', null, null],
  ]
  for (const [message, requestType, actionType] of cases) {
    const result = parseBookingRequest(message, new Date('2026-08-13T05:00:00.000Z'))
    assert.equal(result.active, Boolean(requestType), message)
    if (requestType) assert.equal(result.requestType, requestType, message)
    assert.equal(result.actionType, actionType, message)
  }
})

test('stress security: fake/foreign IDs never escape ownership filter and repository has no mutation surface', async () => {
  const repo = repository(BOOKINGS)
  assert.equal('save' in repo, false)
  assert.equal('update' in repo, false)
  assert.equal('delete' in repo, false)
  const read = createAiBookingReadService(repo)
  for (const message of [
    `Xem booking ${BOOKING_B}`,
    `Booking ${BOOKING_B} thanh toán chưa?`,
    `Hủy booking ${BOOKING_B} giúp tôi`,
    `Xem booking ${new mongoose.Types.ObjectId()}`,
  ]) {
    const result = await read({ userId: USER_A, message })
    assert.equal(result.notFound, true, message)
    assert.deepEqual(result.bookings, [], message)
    assert.deepEqual(result.allowedBookingIds, [], message)
  }
})
