import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const scraperPath = new URL('../scraper/ivivuScraper.js', import.meta.url)
const scraperSource = readFileSync(scraperPath, 'utf8')

test('scraper keeps existing Mongo tours and only scans domestic categories', () => {
  assert.doesNotMatch(scraperSource, /Tour\.deleteMany\s*\(/)
  assert.match(scraperSource, /tour-trong-nuoc/)
  assert.doesNotMatch(scraperSource, /tour-nuoc-ngoai|tour-chau-a|tour-chau-au/)
})

test('scraper resolves destinations at runtime and skips unknown or foreign tours', () => {
  assert.match(scraperSource, /resolveTourRegions/)
  assert.match(scraperSource, /isForeignTourName/)
  assert.match(scraperSource, /resolvedRegions\.length === 0/)
})
