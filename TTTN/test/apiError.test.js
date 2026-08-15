import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeApiError } from '../src/services/apiError.js'

test('typed dependency errors retain retryability, source and request identity', () => {
  assert.deepEqual(normalizeApiError({
    message: 'provider unavailable',
    code: 'AI_PROVIDER_UNAVAILABLE',
    retryable: true,
    source: 'gemini',
    requestId: 'request-body',
  }, 503, 'request-header'), {
    success: false,
    message: 'provider unavailable',
    code: 'AI_PROVIDER_UNAVAILABLE',
    status: 503,
    retryable: true,
    source: 'gemini',
    requestId: 'request-body',
  })
})

test('request identity falls back to the response header', () => {
  const result = normalizeApiError({}, 500, 'request-header')
  assert.equal(result.requestId, 'request-header')
  assert.equal(result.retryable, false)
  assert.equal(result.source, null)
})
