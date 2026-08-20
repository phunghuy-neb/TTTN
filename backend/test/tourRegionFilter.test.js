import test from 'node:test'
import assert from 'node:assert/strict'
import Tour from '../src/models/Tour.js'
import { getTours } from '../src/controllers/tourController.js'

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test('runtime region filter preserves published/active, pagination and sort semantics', async () => {
  const originalFind = Tour.find
  const originalCountDocuments = Tour.countDocuments
  const findFilters = []
  let capturedSort = null
  let capturedSkip = null
  let capturedLimit = null

  const candidates = [
    { _id: 'central', name: 'Khởi hành Hà Nội → Quy Nhơn → Phú Yên' },
    { _id: 'cross', name: 'Ninh Bình → Huế → Đà Nẵng' },
    { _id: 'north', name: 'Khởi hành HCM → Hà Giang → Cao Bằng' },
  ]

  Tour.find = (filter) => {
    findFilters.push(filter)
    if (findFilters.length === 1) {
      return {
        select() { return this },
        lean: async () => candidates,
      }
    }
    return {
      sort(value) { capturedSort = value; return this },
      skip(value) { capturedSkip = value; return this },
      limit(value) { capturedLimit = value; return this },
      select: async () => [{ _id: 'cross' }],
    }
  }
  Tour.countDocuments = async () => 2

  const res = responseRecorder()
  try {
    await getTours({
      query: { region: 'Miền Trung', page: '2', limit: '1', sort: 'basePrice' },
      user: null,
    }, res)
  } finally {
    Tour.find = originalFind
    Tour.countDocuments = originalCountDocuments
  }

  assert.deepEqual(findFilters[0], { status: 'published', isActive: { $ne: false } })
  assert.deepEqual(findFilters[1], {
    status: 'published',
    isActive: { $ne: false },
    _id: { $in: ['central', 'cross'] },
  })
  assert.equal(capturedSort, 'basePrice')
  assert.equal(capturedSkip, 1)
  assert.equal(capturedLimit, 1)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.page, 2)
  assert.equal(res.body.totalPages, 2)
})
