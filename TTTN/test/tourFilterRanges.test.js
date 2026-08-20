import test from 'node:test'
import assert from 'node:assert/strict'
import { PRICE_OPTIONS, priceKey } from '../src/constants/tourFilterRanges.js'

function matchingRanges(price) {
  return PRICE_OPTIONS
    .filter((option) => option.key)
    .filter((option) => {
      const min = Number(option.min) || 0
      const max = Number(option.max) || Number.POSITIVE_INFINITY
      return price >= min && price <= max
    })
    .map((option) => option.key)
}

test('3,000,000 belongs only to the 3–6 million range', () => {
  assert.deepEqual(matchingRanges(2_999_999), ['lt3'])
  assert.deepEqual(matchingRanges(3_000_000), ['3-6'])
  assert.equal(priceKey('3000000', '6000000'), '3-6')
})

test('6,000,000 belongs only to the 3–6 million range', () => {
  assert.deepEqual(matchingRanges(6_000_000), ['3-6'])
  assert.deepEqual(matchingRanges(6_000_001), ['gt6'])
  assert.equal(priceKey('6000001', '0'), 'gt6')
})
