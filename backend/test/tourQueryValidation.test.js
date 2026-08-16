import test from 'node:test'
import assert from 'node:assert/strict'
import Tour from '../src/models/Tour.js'
import { getTours } from '../src/controllers/tourController.js'

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

async function invokeGetTours(query) {
  const originalFind = Tour.find
  const originalCountDocuments = Tour.countDocuments
  let findCalls = 0
  let countCalls = 0
  let capturedFilter = null

  Tour.find = (filter) => {
    findCalls += 1
    capturedFilter = filter
    return {
      sort() { return this },
      skip() { return this },
      limit() { return this },
      select: async () => [],
    }
  }
  Tour.countDocuments = async () => {
    countCalls += 1
    return 0
  }

  const res = responseRecorder()
  try {
    await getTours({ query, user: null }, res)
    return { res, findCalls, countCalls, capturedFilter }
  } finally {
    Tour.find = originalFind
    Tour.countDocuments = originalCountDocuments
  }
}

const invalidQueries = [
  ['page=abc', { page: 'abc' }],
  ['page=0', { page: '0' }],
  ['page=-1', { page: '-1' }],
  ['page=1.5', { page: '1.5' }],
  ['limit=abc', { limit: 'abc' }],
  ['limit=0', { limit: '0' }],
  ['limit=-1', { limit: '-1' }],
  ['limit=1.5', { limit: '1.5' }],
  ['minPrice=abc', { minPrice: 'abc' }],
  ['maxPrice=abc', { maxPrice: 'abc' }],
  ['minPrice=-1', { minPrice: '-1' }],
  ['maxPrice=-1', { maxPrice: '-1' }],
  ['minDays=abc', { minDays: 'abc' }],
  ['maxDays=abc', { maxDays: 'abc' }],
  ['minDays=0', { minDays: '0' }],
  ['maxDays=1.5', { maxDays: '1.5' }],
]

for (const [label, query] of invalidQueries) {
  test(`tour query validation rejects ${label} with a stable 400 envelope`, async () => {
    const { res, findCalls, countCalls } = await invokeGetTours(query)

    assert.equal(res.statusCode, 400)
    assert.equal(res.body?.success, false)
    assert.equal(res.body?.code, 'VALIDATION_ERROR')
    assert.match(res.body?.message || '', /^Tham số ".+" /)
    assert.equal(findCalls, 0)
    assert.equal(countCalls, 0)
  })
}

test('valid tour numeric filters keep the existing filter and pagination semantics', async () => {
  const { res, capturedFilter } = await invokeGetTours({
    page: '2',
    limit: '6',
    minPrice: '1000000.5',
    maxPrice: '3000000',
    minDays: '2',
    maxDays: '5',
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body?.success, true)
  assert.equal(res.body?.page, 2)
  assert.equal(res.body?.totalPages, 0)
  assert.deepEqual(capturedFilter.days, { $gte: 2, $lte: 5 })
  assert.deepEqual(capturedFilter.basePrice, { $gte: 1000000.5, $lte: 3000000 })
})
