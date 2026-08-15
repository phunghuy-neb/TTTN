import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeConversationPage,
  mergeMessagePage,
  normalizePagination,
} from '../src/context/chatPagination.js'

test('two API pages reconstruct all 130 messages in chronological order', () => {
  const newestPage = Array.from({ length: 100 }, (_, index) => ({ _id: `m${130 - index}` }))
  const olderPage = Array.from({ length: 30 }, (_, index) => ({ _id: `m${30 - index}` }))
  const current = mergeMessagePage([], newestPage, { replace: true })
  const all = mergeMessagePage(current, olderPage)

  assert.equal(all.length, 130)
  assert.equal(all[0]._id, 'm1')
  assert.equal(all.at(-1)._id, 'm130')
  assert.equal(new Set(all.map((item) => item._id)).size, 130)
})

test('reloaded assistant cards and candidate-list identity survive page merging', () => {
  const candidateList = { candidateListId: 'candidates:0:4:turn-4', tourIds: ['tour-b'] }
  const assistant = {
    _id: 'm4',
    role: 'assistant',
    suggestedTours: [{ _id: 'tour-b', title: 'Tour B', price: 3_270_000 }],
    candidateList,
  }
  const messages = mergeMessagePage([], [assistant], { replace: true })

  assert.deepEqual(messages[0].suggestedTours, assistant.suggestedTours)
  assert.deepEqual(messages[0].candidateList, candidateList)
})

test('two API pages expose all 35 conversations without duplicates', () => {
  const first = Array.from({ length: 20 }, (_, index) => ({ _id: `c${35 - index}` }))
  const second = Array.from({ length: 15 }, (_, index) => ({ _id: `c${15 - index}` }))
  const all = mergeConversationPage(mergeConversationPage([], first, { replace: true }), second)

  assert.equal(all.length, 35)
  assert.equal(all[0]._id, 'c35')
  assert.equal(all.at(-1)._id, 'c1')
})

test('pagination metadata preserves explicit hasMore and derives legacy responses', () => {
  assert.equal(normalizePagination({ page: 1, limit: 20, total: 35, totalPages: 2, hasMore: true }).hasMore, true)
  assert.equal(normalizePagination({ page: 2, limit: 20, total: 35, totalPages: 2 }).hasMore, false)
})
