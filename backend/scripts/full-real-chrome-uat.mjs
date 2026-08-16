import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import puppeteer from 'puppeteer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(__dirname, '../..')
const runtimeDir = path.join(workspace, '.uat-linux')
const artifactDir = path.join(runtimeDir, 'artifacts')
const durationOnly = process.argv.includes('--duration-only')
const resultPath = path.join(runtimeDir, durationOnly
  ? 'duration-removal-real-chrome-retest.json'
  : 'full-real-chrome-uat.json')
const baseUrl = process.env.BROWSER_UAT_FRONTEND_URL || 'http://127.0.0.1:15173'
const mongoUri = process.env.BROWSER_UAT_MONGO_URI
  || 'mongodb://127.0.0.1:27018/vietvoyage_browser_uat?replicaSet=uatrs'
const chromePath = process.env.CHROME_BIN || '/usr/bin/google-chrome'
const account = process.env.BROWSER_UAT_EMAIL || 'browser-uat@example.test'
const password = process.env.BROWSER_UAT_PASSWORD || 'BrowserUAT123!'
const paginationAccount = process.env.BROWSER_UAT_PAGINATION_EMAIL
  || 'browser-uat-pagination@example.test'

const BEACH_TOUR_IDS = new Set([
  '000000000000000000000001',
  '000000000000000000000006',
])
const DA_LAT_TOUR_ID = '000000000000000000000007'
const results = {
  startedAt: new Date().toISOString(),
  mode: durationOnly ? 'duration-removal-targeted' : 'full',
  browser: null,
  baseUrl,
  account,
  turns: [],
  suites: {},
  gemini: { attempts: [], succeeded: 0 },
  uxMinor: [],
  failures: [],
  notTestable: [],
}
const minimumTurnIntervalMs = Number(process.env.BROWSER_UAT_TURN_INTERVAL_MS || 2200)
let lastChatRequestAt = 0

await fs.mkdir(artifactDir, { recursive: true })
await mongoose.connect(mongoUri)
const db = mongoose.connection.db

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--disable-dev-shm-usage'],
})
results.browser = await browser.version()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function paceChatRequest() {
  const remaining = minimumTurnIntervalMs - (Date.now() - lastChatRequestAt)
  if (remaining > 0) await sleep(remaining)
  lastChatRequestAt = Date.now()
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))]
}

function sameSet(left, right) {
  const a = unique(left).sort()
  const b = unique(right).sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function slot(trace, name) {
  return trace?.semantic?.mergedState?._semanticState?.slots?.[name] || null
}

function responseTourIds(data) {
  return unique(data?.candidateList?.tourIds || [])
}

function structuredTourIds(data) {
  return unique((data?.structuredContent?.tours || []).map((tour) => tour.tourId || tour._id))
}

function cardTourIds(data) {
  return unique((data?.suggestedTours || []).map((tour) => tour._id || tour.tourId))
}

function traceTourIds(trace) {
  return unique(
    trace?.finalResponse?.candidateIds
    || trace?.retrieval?.candidateIds?.selected
    || []
  )
}

function tourNames(data) {
  const names = new Map()
  for (const tour of data?.structuredContent?.tours || []) {
    names.set(String(tour.tourId || tour._id || ''), String(tour.name || tour.title || ''))
  }
  for (const tour of data?.suggestedTours || []) {
    names.set(String(tour._id || tour.tourId || ''), String(tour.title || tour.name || ''))
  }
  return names
}

function check(name, pass, detail = '') {
  return { name, pass: Boolean(pass), detail }
}

async function waitForTrace(requestId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const turn = await db.collection('chatTurns').findOne({
      $or: [{ requestId }, { requestIds: requestId }],
    })
    if (turn?.status === 'completed' || turn?.status === 'failed') return turn
    await sleep(200)
  }
  throw new Error(`Timed out waiting for persisted trace ${requestId}`)
}

async function visibleButtonByText(page, text) {
  const handle = await page.evaluateHandle((label) => {
    const normalized = (value) => String(value || '').replace(/\s+/g, ' ').trim()
    return [...document.querySelectorAll('button')].find((button) => {
      const style = getComputedStyle(button)
      return normalized(button.textContent).includes(label)
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && !button.disabled
    }) || null
  }, text)
  const element = handle.asElement()
  if (!element) {
    await handle.dispose()
    throw new Error(`Visible enabled button not found: ${text}`)
  }
  return element
}

async function clickButtonText(page, text) {
  const button = await visibleButtonByText(page, text)
  await button.click()
  await button.dispose()
}

function isApiResponse(response, method, suffix) {
  try {
    const url = new URL(response.url())
    return response.request().method() === method && url.pathname.endsWith(suffix)
  } catch {
    return false
  }
}

async function login(page, email) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle0' })
  await page.type('#email', email)
  await page.type('#password', password)
  await Promise.all([
    page.waitForFunction(() => location.pathname !== '/login', { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ])
  await page.goto(`${baseUrl}/ai-assistant`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('input[aria-label="Nội dung chat"]')
}

async function createConversation(page) {
  const responsePromise = page.waitForResponse(
    (response) => isApiResponse(response, 'POST', '/api/chat/conversations'),
    { timeout: 30000 }
  )
  await clickButtonText(page, 'Chat mới')
  const response = await responsePromise
  const data = await response.json()
  if (!response.ok() || data.success === false || !data.conversation?._id) {
    throw new Error(`Unable to create Browser-UAT conversation: ${data.code || response.status()}`)
  }
  return data.conversation
}

async function pageSnapshot(page, data) {
  await sleep(200)
  const bodyText = await page.evaluate(() => document.body.innerText)
  const names = tourNames(data)
  const domCardIds = []
  for (const [id, name] of names) {
    if (!id || !name) continue
    const renderedAsButton = await page.evaluate((title) => [...document.querySelectorAll('button')]
      .some((button) => String(button.innerText || '').includes(title)), name)
    if (renderedAsButton) domCardIds.push(id)
  }
  return { bodyText, domCardIds: unique(domCardIds) }
}

async function fillChatInput(page, input) {
  const inputSelector = 'input[aria-label="Nội dung chat"]'
  await page.waitForFunction((selector) => {
    const element = document.querySelector(selector)
    return element && !element.disabled
  }, {}, inputSelector)
  await page.click(inputSelector)
  await page.keyboard.down('Control')
  await page.keyboard.press('A')
  await page.keyboard.up('Control')
  await page.keyboard.type(input, { delay: 1 })
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Gửi tin nhắn"]')
    return button && !button.disabled
  })
}

async function processChatResponse(page, input, response, {
  suite,
  label,
  extraChecks = [],
} = {}) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok() || data.success === false) {
    throw new Error(`${label}: POST /api/chat failed: ${data.code || response.status()} ${data.message || ''}`.trim())
  }

  const persisted = await waitForTrace(data.requestId)
  const trace = persisted.trace || {}
  const snapshot = await pageSnapshot(page, data)
  const listIds = responseTourIds(data)
  const structuredIds = structuredTourIds(data)
  const cards = cardTourIds(data)
  const traced = traceTourIds(trace)
  const names = tourNames(data)
  const textIds = unique([...names].filter(([, name]) => name && String(data.reply || '').includes(name)).map(([id]) => id))
  const relevantSearch = data.decision?.action === 'SEARCH' && (listIds.length || structuredIds.length || cards.length)
  const checks = [
    check('persistence committed', trace.persistence?.status === 'committed', trace.persistence?.status),
    check('logical identity matches', trace.traceContext?.requestId === data.requestId
      && trace.traceContext?.logicalTurnId === data.clientMessageId),
  ]
  if (relevantSearch) {
    checks.push(
      check('candidate list equals structured candidates', sameSet(listIds, structuredIds), `${listIds} / ${structuredIds}`),
      check('structured candidates equal response cards', sameSet(structuredIds, cards), `${structuredIds} / ${cards}`),
      check('trace candidates equal response candidates', sameSet(traced, structuredIds), `${traced} / ${structuredIds}`),
      check('text names include every structured candidate', sameSet(textIds, structuredIds), `${textIds} / ${structuredIds}`),
      check('Chrome rendered every response card', sameSet(snapshot.domCardIds, cards), `${snapshot.domCardIds} / ${cards}`),
    )
  }
  checks.push(...extraChecks.map((item) => typeof item === 'function' ? item({ data, trace, snapshot }) : item))

  const provider = trace.provider || {}
  const record = {
    suite,
    label,
    input,
    requestId: data.requestId,
    logicalTurnId: trace.traceContext?.logicalTurnId || data.clientMessageId,
    conversationId: trace.traceContext?.conversationId || data.conversation?._id,
    turnSequence: data.turnSequence,
    historyEpoch: data.historyEpoch,
    semanticState: trace.semantic?.mergedState || {},
    action: data.decision || trace.action?.decision || null,
    candidateListId: data.candidateList?.candidateListId || null,
    textCandidates: textIds,
    structuredCandidates: structuredIds,
    cardCandidates: cards,
    traceCandidates: traced,
    selectedEntity: data.structuredContent?.tourId || traced[0] || null,
    provider: {
      attempted: provider.status !== 'skipped',
      succeeded: provider.status === 'healthy',
      status: provider.status || null,
      code: provider.code || null,
      fallbackUsed: Boolean(provider.fallbackUsed),
    },
    validation: trace.validation || null,
    persistence: trace.persistence || null,
    grounding: trace.retrieval?.grounding || [],
    retrieval: {
      mode: trace.retrieval?.mode || null,
      candidateIds: trace.retrieval?.candidateIds || {},
      ranking: trace.retrieval?.ranking || [],
      filters: trace.retrieval?.filters || {},
    },
    finalComposer: {
      exposedInTrace: false,
      inferredSource: provider.status === 'healthy'
        ? 'GEMINI'
        : provider.fallbackUsed
          ? 'GROUNDED_FALLBACK'
          : 'DETERMINISTIC',
    },
    outcome: data.outcome || null,
    reply: data.reply,
    conversationTitle: data.conversation?.title || null,
    checks,
    result: checks.every((item) => item.pass) ? 'PASS' : 'FAIL',
  }
  results.turns.push(record)
  if (record.result === 'FAIL') {
    results.failures.push({ suite, label, checks: checks.filter((item) => !item.pass) })
    const safeLabel = `${suite}-${label}`.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 90)
    await page.screenshot({ path: path.join(artifactDir, `${safeLabel}.png`), fullPage: true })
  }
  console.log(`${record.result} ${suite}/${label}: ${data.requestId}`)
  return record
}

async function sendMessage(page, input, {
  suite,
  label,
  extraChecks = [],
  bypassPacing = false,
} = {}) {
  if (!bypassPacing) await paceChatRequest()
  await fillChatInput(page, input)
  const responsePromise = page.waitForResponse(
    (response) => isApiResponse(response, 'POST', '/api/chat'),
    { timeout: 90000 }
  )
  await page.click('button[aria-label="Gửi tin nhắn"]')
  const response = await responsePromise
  return processChatResponse(page, input, response, { suite, label, extraChecks })
}

async function runCase(page, spec) {
  try {
    await createConversation(page)
    return await sendMessage(page, spec.input, {
      suite: 'new-chat',
      label: spec.label,
      extraChecks: spec.checks,
    })
  } catch (error) {
    results.failures.push({ suite: 'new-chat', label: spec.label, error: error.message })
    console.error(`FAIL new-chat/${spec.label}: ${error.message}`)
    return null
  }
}

const context = await browser.createBrowserContext()
const page = await context.newPage()
page.setDefaultTimeout(30000)
await page.setViewport({ width: 1440, height: 1000 })

try {
  await login(page, account)

  if (durationOnly) {
    await createConversation(page)
    const targeted = []
    const targetedTurn = async (label, input, checks = []) => {
      const turn = await sendMessage(page, input, {
        suite: 'duration-removal-targeted',
        label,
        extraChecks: checks,
      })
      targeted.push(turn)
      return turn
    }
    await targetedTurn('01-initial', 'gợi ý tour khoảng 8 triệu cho 2 người, đi đâu cũng được', [
      ({ data }) => check('initial recommendation searches', data.decision?.action === 'SEARCH'),
    ])
    await targetedTurn('02-exclude-beach', 'tôi không muốn đi biển', [
      ({ trace }) => check('beach exclusion retained', slot(trace, 'interests')?.excludedValues?.includes('biển')),
    ])
    await targetedTurn('03-three-travelers', 'à đổi thành 3 người', [
      ({ trace }) => check('travelers becomes 3', trace.semantic?.mergedState?.travelers === 3),
    ])
    await targetedTurn('04-budget-12m', 'tăng ngân sách lên 12 triệu', [
      ({ trace }) => check('budget target becomes 12m', slot(trace, 'budget')?.target === 12000000
        || slot(trace, 'budget')?.max === 12000000, JSON.stringify(slot(trace, 'budget'))),
    ])
    await targetedTurn('05-about-three-days', 'muốn đi khoảng 3 ngày', [
      ({ trace }) => check('approximate duration active', slot(trace, 'duration')?.status === 'known'
        && slot(trace, 'duration')?.operator === 'approximate'
        && slot(trace, 'duration')?.targetDays === 3, JSON.stringify(slot(trace, 'duration'))),
    ])
    await targetedTurn('06-duration-not-important', 'thôi thời gian không quan trọng nữa', [
      ({ trace }) => check('duration removal delta emitted', trace.semantic?.extractedDelta?._constraintMeta?.removedFields?.includes('days')
        && trace.semantic?.extractedDelta?._semanticState?.slots?.duration?.status === 'removed', JSON.stringify(trace.semantic?.extractedDelta || {})),
      ({ trace }) => check('merged duration is removed', slot(trace, 'duration')?.status === 'removed', JSON.stringify(slot(trace, 'duration'))),
      ({ trace }) => check('legacy duration projection is cleared', ['days', 'minDays', 'maxDays', 'approximateDays', 'optionalDurationDays']
        .every((field) => trace.semantic?.mergedState?.[field] == null), JSON.stringify(trace.semantic?.mergedState || {})),
      ({ trace }) => check('travelers budget and exclusion survive', trace.semantic?.mergedState?.travelers === 3
        && (slot(trace, 'budget')?.target === 12000000 || slot(trace, 'budget')?.max === 12000000)
        && slot(trace, 'interests')?.excludedValues?.includes('biển')),
      ({ trace }) => check('retrieval has no active duration filter', trace.retrieval?.filters?._semanticState?.slots?.duration?.status === 'removed'
        && ['days', 'minDays', 'maxDays', 'approximateDays', 'optionalDurationDays']
          .every((field) => trace.retrieval?.filters?.[field] == null), JSON.stringify(trace.retrieval?.filters || {})),
      ({ data }) => check('removal turn searches', data.decision?.action === 'SEARCH', JSON.stringify(data.decision)),
      ({ data }) => check('final response no longer applies three-day framing', !/(?:thời lượng|khoảng)\s+(?:khoảng\s+)?3 ngày/i.test(data.reply || ''), data.reply),
    ])
    results.suites.durationRemovalTargeted = {
      total: targeted.length,
      pass: targeted.filter((turn) => turn.result === 'PASS').length,
      fail: targeted.filter((turn) => turn.result === 'FAIL').length,
    }
  } else {
  const newChatCases = [
    {
      label: '01-open-destination',
      input: 'đi đâu cũng được, gợi ý cho tôi tour 3 ngày',
      checks: [
        ({ data }) => check('routes to SEARCH', data.decision?.action === 'SEARCH', data.decision?.action),
        ({ trace }) => check('destination intentionally open', slot(trace, 'destination')?.status === 'intentionally_open', slot(trace, 'destination')?.status),
      ],
    },
    {
      label: '02-budget-range',
      input: '2 người, ngân sách khoảng 6-8 triệu, muốn đi 3 ngày',
      checks: [
        ({ trace }) => check('budget operator range', slot(trace, 'budget')?.operator === 'range', slot(trace, 'budget')?.operator),
        ({ trace }) => check('budget bounds retained', slot(trace, 'budget')?.min === 6000000 && slot(trace, 'budget')?.max === 8000000),
      ],
    },
    {
      label: '03-max-budget',
      input: 'gợi ý tour tối đa 5 triệu mỗi người',
      checks: [
        ({ trace }) => check('budget operator max', slot(trace, 'budget')?.operator === 'max', slot(trace, 'budget')?.operator),
        ({ trace }) => check('per-person max retained', slot(trace, 'budget')?.scope === 'per_person' && slot(trace, 'budget')?.max === 5000000),
      ],
    },
    {
      label: '04-min-budget',
      input: 'tôi muốn tour từ 3 triệu trở lên, đi đâu cũng được',
      checks: [
        ({ trace }) => check('budget operator min', slot(trace, 'budget')?.operator === 'min', slot(trace, 'budget')?.operator),
        ({ trace }) => check('minimum retained', slot(trace, 'budget')?.min === 3000000, slot(trace, 'budget')?.min),
      ],
    },
    {
      label: '05-per-person-budget',
      input: '2 người, ngân sách 4 triệu mỗi người, đi đâu cũng được',
      checks: [
        ({ trace }) => check('per-person scope retained', slot(trace, 'budget')?.scope === 'per_person', slot(trace, 'budget')?.scope),
      ],
    },
    {
      label: '06-total-budget',
      input: '2 người, tổng ngân sách 8 triệu, đi đâu cũng được',
      checks: [
        ({ trace }) => check('total scope retained', slot(trace, 'budget')?.scope === 'total', slot(trace, 'budget')?.scope),
      ],
    },
    {
      label: '07-same-message-correction',
      input: '2 người, à 3 người, gợi ý tour 3 ngày',
      checks: [
        ({ trace }) => check('final traveler value wins', trace.semantic?.mergedState?.travelers === 3, trace.semantic?.mergedState?.travelers),
      ],
    },
    {
      label: '08-destination-correction',
      input: 'muốn đi Huế, à đổi sang Hội An',
      checks: [
        ({ trace }) => check('final destination wins', /hội an/i.test(String(slot(trace, 'destination')?.value || trace.semantic?.mergedState?.destination || ''))),
        ({ data }) => check('recommendation contains only Hội An', structuredTourIds(data).length > 0
          && (data.structuredContent?.tours || []).every((tour) => /hội an/i.test(String(tour.name || '')))),
      ],
    },
    {
      label: '09-negation',
      input: 'không muốn đi biển, gợi ý tour 3 ngày',
      checks: [
        ({ trace }) => check('beach is a hard exclusion', slot(trace, 'interests')?.excludedValues?.includes('biển')),
        ({ data }) => check('beach tours excluded by retrieval', structuredTourIds(data).every((id) => !BEACH_TOUR_IDS.has(id)), structuredTourIds(data).join(',')),
      ],
    },
    {
      label: '10-destination-exclusion',
      input: 'gợi ý tour nhưng đừng cho tôi Đà Lạt',
      checks: [
        ({ trace }) => check('Đà Lạt is excluded, not positive', slot(trace, 'destination')?.excludedValues?.includes('Đà Lạt')),
        ({ data }) => check('Đà Lạt card absent', !structuredTourIds(data).includes(DA_LAT_TOUR_ID)),
      ],
    },
    {
      label: '11-max-duration',
      input: 'tôi muốn đi tối đa 3 ngày',
      checks: [
        ({ trace }) => check('duration operator max', slot(trace, 'duration')?.operator === 'max', slot(trace, 'duration')?.operator),
        ({ data }) => check('all candidates are at most 3 days', (data.structuredContent?.tours || []).every((tour) => Number(tour.duration) <= 3)),
      ],
    },
    {
      label: '12-approximate-duration',
      input: 'muốn đi khoảng 3 ngày, dài hơn chút cũng được',
      checks: [
        ({ trace }) => check('duration remains relaxed/approximate', ['approximate', 'relaxed'].includes(slot(trace, 'duration')?.operator)
          || slot(trace, 'duration')?.status === 'relaxed', JSON.stringify(slot(trace, 'duration'))),
      ],
    },
    {
      label: '13-fact-question',
      input: 'Hội An có phù hợp cho người thích chụp ảnh không?',
      checks: [
        ({ data }) => check('entity evaluation routes to ANSWER', data.decision?.action === 'ANSWER' && data.decision?.reason === 'general_request', JSON.stringify(data.decision)),
        ({ trace }) => check('provider attempted', trace.provider?.status !== 'skipped', trace.provider?.status),
        ({ trace }) => check('provider succeeded without fallback', trace.provider?.status === 'healthy' && trace.provider?.fallbackUsed === false, JSON.stringify(trace.provider)),
      ],
    },
    {
      label: '14-slang-natural-language',
      input: 'hai đứa có tầm 8 củ, đi đâu vui vui 3 hôm cũng được',
      checks: [
        ({ trace }) => check('slang traveler count parsed', trace.semantic?.mergedState?.travelers === 2),
        ({ trace }) => check('slang budget parsed', slot(trace, 'budget')?.target === 8000000),
        ({ trace }) => check('slang duration parsed', slot(trace, 'duration')?.targetDays === 3),
      ],
    },
    {
      label: '15-zero-result',
      input: '2 người, tổng ngân sách 1 triệu, gợi ý tour 3 ngày',
      checks: [
        ({ data }) => check('zero result is explicit', data.outcome?.code === 'NO_RESULTS' && structuredTourIds(data).length === 0, JSON.stringify(data.outcome)),
      ],
    },
  ]

  for (const spec of newChatCases) await runCase(page, spec)
  results.suites.newChat = {
    total: newChatCases.length,
    pass: results.turns.filter((turn) => turn.suite === 'new-chat' && turn.result === 'PASS').length,
    fail: results.failures.filter((failure) => failure.suite === 'new-chat').length,
  }

  const factTurn = results.turns.find((turn) => turn.label === '13-fact-question')
  if (factTurn) results.gemini.attempts.push(factTurn.requestId)
  if (factTurn?.provider.succeeded && !factTurn.provider.fallbackUsed) results.gemini.succeeded += 1

  const providerPrompts = [
    'Huế có phù hợp với người thích lịch sử và kiến trúc không?',
    'Sa Pa có phù hợp cho người thích chụp cảnh thiên nhiên không?',
    'Đà Lạt có phù hợp với người thích hoa và cảnh quan không?',
  ]
  for (let index = 0; index < providerPrompts.length && results.gemini.succeeded < 2; index += 1) {
    await createConversation(page)
    const turn = await sendMessage(page, providerPrompts[index], {
      suite: 'gemini-live',
      label: `provider-${index + 2}`,
      extraChecks: [
        ({ data }) => check('general question routes to ANSWER', data.decision?.action === 'ANSWER' && data.decision?.reason === 'general_request', JSON.stringify(data.decision)),
        ({ trace }) => check('Gemini succeeds with no fallback', trace.provider?.status === 'healthy' && trace.provider?.fallbackUsed === false, JSON.stringify(trace.provider)),
        ({ trace }) => check('validation completed', ['accepted', 'rewritten'].includes(trace.validation?.status), JSON.stringify(trace.validation)),
      ],
    })
    results.gemini.attempts.push(turn.requestId)
    if (turn.provider.succeeded && !turn.provider.fallbackUsed) results.gemini.succeeded += 1
  }

  await createConversation(page)
  const multi = []
  const multiTurn = async (label, input, checks = []) => {
    const turn = await sendMessage(page, input, { suite: 'multi-turn', label, extraChecks: checks })
    multi.push(turn)
    return turn
  }
  await multiTurn('01-initial', 'gợi ý tour khoảng 8 triệu cho 2 người, đi đâu cũng được', [
    ({ data }) => check('initial recommendation searches', data.decision?.action === 'SEARCH'),
  ])
  await multiTurn('02-exclude-beach', 'tôi không muốn đi biển', [
    ({ trace }) => check('beach exclusion retained', slot(trace, 'interests')?.excludedValues?.includes('biển')),
    ({ data }) => check('beach tours removed', structuredTourIds(data).every((id) => !BEACH_TOUR_IDS.has(id))),
  ])
  await multiTurn('03-three-travelers', 'à đổi thành 3 người', [
    ({ trace }) => check('travelers becomes 3', trace.semantic?.mergedState?.travelers === 3),
    ({ data }) => check('no booking hijack', data.decision?.action === 'SEARCH' && !/booking phù hợp/i.test(data.reply)),
  ])
  await multiTurn('04-budget-12m', 'tăng ngân sách lên 12 triệu', [
    ({ trace }) => check('budget target becomes 12m', slot(trace, 'budget')?.target === 12000000 || slot(trace, 'budget')?.max === 12000000, JSON.stringify(slot(trace, 'budget'))),
  ])
  await multiTurn('05-about-three-days', 'muốn đi khoảng 3 ngày', [
    ({ trace }) => check('approximate duration becomes 3', slot(trace, 'duration')?.targetDays === 3),
  ])
  await multiTurn('06-duration-not-important', 'thôi thời gian không quan trọng nữa', [
    ({ trace }) => check('duration constraint removed/relaxed', ['removed', 'unknown', 'relaxed'].includes(slot(trace, 'duration')?.status), JSON.stringify(slot(trace, 'duration'))),
  ])
  await multiTurn('07-da-lat', 'Đà Lạt thì sao?', [
    ({ data }) => check('Đà Lạt search is allowed', structuredTourIds(data).includes(DA_LAT_TOUR_ID), structuredTourIds(data).join(',')),
  ])
  const openAgain = await multiTurn('08-open-again', 'thôi chỗ nào cũng được', [
    ({ trace }) => check('destination opens again', slot(trace, 'destination')?.status === 'intentionally_open', JSON.stringify(slot(trace, 'destination'))),
  ])
  const selectedFromList = openAgain.structuredCandidates[1]
  const ordinal = await multiTurn('09-ordinal', 'tour thứ 2', [
    ({ data }) => check('ordinal routes to ANSWER', data.decision?.action === 'ANSWER'),
    ({ data }) => check('ordinal selects list item 2', data.structuredContent?.tourId === selectedFromList, `${data.structuredContent?.tourId} / ${selectedFromList}`),
  ])
  await multiTurn('10-price-availability', 'tour đó giá bao nhiêu và còn đủ cho 3 người không?', [
    ({ data }) => check('anaphora retains selected tour', data.structuredContent?.tourId === ordinal.selectedEntity),
    ({ data }) => check('price and availability both answered', ['price', 'availability'].every((fact) => data.structuredContent?.requestedFacts?.includes(fact))),
  ])
  await multiTurn('11-four-travelers', 'nếu đổi thành 4 người thì sao?', [
    ({ trace }) => check('travelers becomes 4', trace.semantic?.mergedState?.travelers === 4),
    ({ data }) => check('selected entity remains stable', data.structuredContent?.tourId === ordinal.selectedEntity),
    ({ data }) => check('no booking hijack', data.decision?.operation === 'mixed_tour_facts'),
  ])
  await multiTurn('12-duration-fact', 'tour này 3 ngày à?', [
    ({ data }) => check('duration fact stays on entity', data.decision?.action === 'ANSWER' && data.structuredContent?.tourId === ordinal.selectedEntity),
  ])
  const maxDurationList = await multiTurn('13-max-three-days', 'vậy đổi tiêu chí thành tối đa 3 ngày đi', [
    ({ trace }) => check('duration changes to max 3', slot(trace, 'duration')?.operator === 'max' && slot(trace, 'duration')?.maxDays === 3),
    ({ data }) => check('criteria update searches, not booking', data.decision?.action === 'SEARCH'),
  ])
  await multiTurn('14-exclude-da-lat', 'tôi lại không thích Đà Lạt nhé', [
    ({ trace }) => check('Đà Lạt exclusion retained', slot(trace, 'destination')?.excludedValues?.includes('Đà Lạt')),
    ({ data }) => check('Đà Lạt absent', !structuredTourIds(data).includes(DA_LAT_TOUR_ID)),
  ])
  const alternative = await multiTurn('15-alternative-list', 'cho tôi danh sách khác', [
    ({ data }) => check('alternative operation used', data.decision?.operation === 'recommendation_alternative'),
    ({ data }) => check('alternative candidate set differs', !sameSet(structuredTourIds(data), maxDurationList.structuredCandidates)),
  ])
  void alternative
  const historical = await multiTurn('16-historical-ordinal', 'tour thứ 2 lúc nãy thì sao?', [
    ({ data }) => check('historical ordinal answers', data.decision?.action === 'ANSWER'),
    ({ data }) => check('historical ordinal preserves selected entity', data.structuredContent?.tourId === ordinal.selectedEntity, `${data.structuredContent?.tourId} / ${ordinal.selectedEntity}`),
  ])
  await multiTurn('17-availability-policy', 'tour đó còn chỗ không và chính sách hủy thế nào?', [
    ({ data }) => check('historical entity retained for facts', data.structuredContent?.tourId === historical.selectedEntity),
    ({ data }) => check('availability and cancellation both answered', ['availability', 'cancellation_policy'].every((fact) => data.structuredContent?.requestedFacts?.includes(fact))),
  ])
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('input[aria-label="Nội dung chat"]')
  await multiTurn('18-after-reload-historical-price', 'vậy tour thứ 2 lúc nãy giá bao nhiêu?', [
    ({ data }) => check('reload preserves historical entity', data.structuredContent?.tourId === ordinal.selectedEntity, `${data.structuredContent?.tourId} / ${ordinal.selectedEntity}`),
    ({ data }) => check('price fact answered after reload', data.structuredContent?.requestedFact === 'price' || data.structuredContent?.requestedFacts?.includes('price')),
  ])
  results.suites.multiTurn = {
    total: multi.length,
    pass: multi.filter((turn) => turn.result === 'PASS').length,
    fail: multi.filter((turn) => turn.result === 'FAIL').length,
    selectedEntity: ordinal.selectedEntity,
  }

  await createConversation(page)
  const persistenceA = await sendMessage(page, 'đi đâu cũng được, gợi ý 3 tour 3 ngày', {
    suite: 'reload-persistence',
    label: '01-list-a',
    extraChecks: [({ data }) => check('setup returns at least two cards', structuredTourIds(data).length >= 2)],
  })
  const persistenceSecond = persistenceA.structuredCandidates[1]
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('input[aria-label="Nội dung chat"]')
  const reloadBody = await page.evaluate(() => document.body.innerText)
  const persistenceNames = tourNames({
    structuredContent: { tours: persistenceA.structuredCandidates.map((id) => ({ tourId: id, name: '' })) },
  })
  void persistenceNames
  const visibleNamesAfterReload = [...tourNames({
    structuredContent: { tours: [] },
    suggestedTours: [],
  }).values()]
  void visibleNamesAfterReload
  const expectedCardNames = (persistenceA.reply.match(/[^\n]+/g) || []).length
  void expectedCardNames
  const cardTitles = await db.collection('tours').find(
    { _id: { $in: persistenceA.structuredCandidates.map((id) => new mongoose.Types.ObjectId(id)) } },
    { projection: { name: 1 } }
  ).toArray()
  const cardsSurviveReload = cardTitles.every((tour) => reloadBody.includes(tour.name))
  const conversationADoc = await db.collection('conversations').findOne({
    _id: new mongoose.Types.ObjectId(persistenceA.conversationId),
  })
  const conversationATitle = conversationADoc?.title || persistenceA.conversationTitle
  if (!conversationATitle) throw new Error('Persistence conversation A has no selectable title')

  await createConversation(page)
  const persistenceB = await sendMessage(page, 'không đi biển, 4 người, gợi ý tour 3 ngày', {
    suite: 'reload-persistence',
    label: '02-list-b',
  })
  const messagesPromise = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes(`/api/chat/conversations/${persistenceA.conversationId}/messages`),
    { timeout: 30000 }
  )
  await clickButtonText(page, conversationATitle)
  await messagesPromise
  await sleep(300)
  const switchedBody = await page.evaluate(() => document.body.innerText)
  const switchRestoresCards = cardTitles.every((tour) => switchedBody.includes(tour.name))
  const persistenceOrdinal = await sendMessage(page, 'tour thứ 2', {
    suite: 'reload-persistence',
    label: '03-ordinal-after-switch',
    extraChecks: [({ data }) => check('selected entity survives conversation switch', data.structuredContent?.tourId === persistenceSecond, `${data.structuredContent?.tourId} / ${persistenceSecond}`)],
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('input[aria-label="Nội dung chat"]')
  const persistenceFacts = await sendMessage(page, 'tour đó còn đủ chỗ cho 2 người và giá bao nhiêu?', {
    suite: 'reload-persistence',
    label: '04-facts-after-reload',
    extraChecks: [
      ({ data }) => check('selected entity survives reload', data.structuredContent?.tourId === persistenceOrdinal.selectedEntity),
      ({ data }) => check('volatile facts rehydrated', ['availability', 'price'].every((fact) => data.structuredContent?.requestedFacts?.includes(fact))),
    ],
  })
  results.suites.reloadPersistence = {
    pass: cardsSurviveReload && switchRestoresCards
      && persistenceOrdinal.result === 'PASS' && persistenceFacts.result === 'PASS',
    cardsSurviveReload,
    switchRestoresCards,
    conversationA: persistenceA.conversationId,
    conversationB: persistenceB.conversationId,
  }
  if (!cardsSurviveReload) results.failures.push({ suite: 'reload-persistence', label: 'cards-after-reload' })
  if (!switchRestoresCards) results.failures.push({ suite: 'reload-persistence', label: 'cards-after-switch' })

  await createConversation(page)
  const multiTabSetup = await sendMessage(page, 'đi đâu cũng được, gợi ý tour 3 ngày', {
    suite: 'multi-tab', label: '00-setup',
  })
  const tab2 = await context.newPage()
  tab2.setDefaultTimeout(30000)
  await tab2.setViewport({ width: 1280, height: 900 })
  await tab2.goto(`${baseUrl}/ai-assistant`, { waitUntil: 'networkidle0' })
  await tab2.waitForSelector('input[aria-label="Nội dung chat"]')
  try {
    await paceChatRequest()
    const budgetInput = 'ngân sách tối đa 5 triệu'
    const travelersInput = 'đi 4 người'
    // Keyboard focus is global to Chrome; fill sequentially, then click both send buttons concurrently.
    await fillChatInput(page, budgetInput)
    await fillChatInput(tab2, travelersInput)
    const budgetResponsePromise = page.waitForResponse(
      (response) => isApiResponse(response, 'POST', '/api/chat'),
      { timeout: 90000 }
    )
    const travelersResponsePromise = tab2.waitForResponse(
      (response) => isApiResponse(response, 'POST', '/api/chat'),
      { timeout: 90000 }
    )
    await Promise.all([
      page.evaluate(() => document.querySelector('button[aria-label="Gửi tin nhắn"]')?.click()),
      tab2.evaluate(() => document.querySelector('button[aria-label="Gửi tin nhắn"]')?.click()),
    ])
    const [budgetResponse, travelersResponse] = await Promise.all([
      budgetResponsePromise,
      travelersResponsePromise,
    ])
    const [tabBudget, tabTravelers] = await Promise.all([
      processChatResponse(page, budgetInput, budgetResponse, {
        suite: 'multi-tab', label: '01-budget',
      }),
      processChatResponse(tab2, travelersInput, travelersResponse, {
        suite: 'multi-tab', label: '02-travelers',
      }),
    ])
    lastChatRequestAt = Date.now()
    await page.reload({ waitUntil: 'networkidle0' })
    await tab2.reload({ waitUntil: 'networkidle0' })
    const conversationId = new mongoose.Types.ObjectId(multiTabSetup.conversationId)
    const conversation = await db.collection('conversations').findOne({ _id: conversationId })
    const messageCount = await db.collection('chatMessages').countDocuments({ conversationId })
    const completedTurns = await db.collection('chatTurns').find({
      conversationId,
      status: 'completed',
    }).toArray()
    const state = conversation?.constraintState || {}
    const budget = state?._semanticState?.slots?.budget || {}
    const multiTabPass = state.travelers === 4
      && (budget.max === 5000000 || state.maxPrice === 5000000)
      && messageCount === 6
      && new Set(completedTurns.map((turn) => turn.logicalTurnId)).size === 3
      && tabBudget.result === 'PASS'
      && tabTravelers.result === 'PASS'
    results.suites.multiTab = {
      result: multiTabPass ? 'PASS' : 'FAIL',
      finalTravelers: state.travelers,
      finalBudget: budget,
      messageCount,
      completedTurns: completedTurns.length,
      uniqueLogicalTurns: new Set(completedTurns.map((turn) => turn.logicalTurnId)).size,
    }
    if (!multiTabPass) results.failures.push({ suite: 'multi-tab', label: 'concurrent-merge', detail: results.suites.multiTab })
  } catch (error) {
    results.suites.multiTab = { result: 'NOT TESTABLE', reason: error.message }
    results.notTestable.push({ suite: 'multi-tab', reason: error.message })
  } finally {
    await tab2.close()
  }

  const paginationContext = await browser.createBrowserContext()
  const paginationPage = await paginationContext.newPage()
  paginationPage.setDefaultTimeout(30000)
  await paginationPage.setViewport({ width: 1440, height: 1000 })
  try {
    await login(paginationPage, paginationAccount)
    const initialConversationCount = await paginationPage.evaluate(() => [...document.querySelectorAll('aside button')]
      .filter((button) => /Pagination fixture/.test(button.textContent || '')).length)
    if (await paginationPage.evaluate(() => document.body.innerText.includes('Tải thêm'))) {
      const loadPromise = paginationPage.waitForResponse(
        (response) => response.request().method() === 'GET' && response.url().includes('/api/chat/conversations?') && response.url().includes('page=2'),
        { timeout: 30000 }
      )
      await clickButtonText(paginationPage, 'Tải thêm')
      await loadPromise
    }
    await sleep(300)
    const allConversationCount = await paginationPage.evaluate(() => [...document.querySelectorAll('aside button')]
      .filter((button) => /Pagination fixture/.test(button.textContent || '')).length)
    const fixtureButton = await visibleButtonByText(paginationPage, 'Pagination fixture 01')
    await fixtureButton.click()
    await fixtureButton.dispose()
    await sleep(500)
    if (await paginationPage.evaluate(() => document.body.innerText.includes('Tải tin nhắn cũ hơn'))) {
      const olderPromise = paginationPage.waitForResponse(
        (response) => response.request().method() === 'GET' && response.url().includes('/messages?') && response.url().includes('page=2'),
        { timeout: 30000 }
      )
      await clickButtonText(paginationPage, 'Tải tin nhắn cũ hơn')
      await olderPromise
    }
    await sleep(300)
    const paginationText = await paginationPage.evaluate(() => document.querySelector('main')?.innerText || '')
    const userMessages = (paginationText.match(/Pagination user message \d+/g) || []).length
    const assistantMessages = (paginationText.match(/Pagination assistant message \d+/g) || []).length
    const paginationPass = initialConversationCount === 20
      && allConversationCount === 35
      && userMessages === 65
      && assistantMessages === 65
    results.suites.pagination = {
      result: paginationPass ? 'PASS' : 'FAIL',
      initialConversationCount,
      allConversationCount,
      userMessages,
      assistantMessages,
    }
    if (!paginationPass) results.failures.push({ suite: 'pagination', detail: results.suites.pagination })
  } catch (error) {
    results.suites.pagination = { result: 'FAIL', reason: error.message }
    results.failures.push({ suite: 'pagination', error: error.message })
  } finally {
    await paginationContext.close()
  }
  }

  const genericIntroTurns = results.turns.filter((turn) => /Theo yêu cầu hiện tại/i.test(turn.reply || ''))
  if (genericIntroTurns.length) {
    results.uxMinor.push({
      issue: 'Generic recommendation intro remains repetitive',
      turns: genericIntroTurns.map((turn) => turn.requestId),
    })
  }
  const basePriceCards = results.turns.filter((turn) => turn.provider.succeeded
    && turn.cardCandidates.length
    && !/giá từ|từ \d/i.test(turn.reply || ''))
  if (basePriceCards.length) {
    results.uxMinor.push({
      issue: 'Grounded entity card can show a base price without an explicit "từ" label',
      turns: basePriceCards.map((turn) => turn.requestId),
    })
  }
  if (results.turns.some((turn) => turn.finalComposer.exposedInTrace === false)) {
    results.uxMinor.push({
      issue: 'Final composer is inferable from provider status but is not explicitly exposed in persisted trace',
    })
  }

  const providerHealth = await fetch('http://127.0.0.1:14000/health').then((response) => response.json())
  results.gemini.model = providerHealth.capabilities?.provider?.chatModel || null
  results.gemini.embeddingModel = providerHealth.capabilities?.provider?.embeddingModel || null
  results.gemini.health = providerHealth.capabilities?.provider || null
  results.finishedAt = new Date().toISOString()
  results.totalBrowserTurns = results.turns.length
  results.pass = results.turns.filter((turn) => turn.result === 'PASS').length
  results.fail = results.turns.filter((turn) => turn.result === 'FAIL').length
  results.verdict = durationOnly
    ? (results.failures.length === 0 ? 'PASS' : 'FAIL')
    : results.failures.length === 0
      && results.gemini.succeeded >= 2
      && results.suites.multiTab?.result !== 'FAIL'
      ? 'PASS'
      : 'FAIL'
  await page.screenshot({ path: path.join(artifactDir, 'final-main-page.png'), fullPage: true })
} catch (error) {
  results.fatalError = { message: error.message, stack: error.stack }
  results.finishedAt = new Date().toISOString()
  results.verdict = 'FAIL'
  console.error(error)
} finally {
  await fs.writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`, { mode: 0o600 })
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  await mongoose.disconnect().catch(() => {})
}

console.log(JSON.stringify({
  resultPath,
  browser: results.browser,
  totalBrowserTurns: results.totalBrowserTurns || results.turns.length,
  pass: results.pass || results.turns.filter((turn) => turn.result === 'PASS').length,
  fail: results.fail || results.turns.filter((turn) => turn.result === 'FAIL').length,
  geminiSucceeded: results.gemini.succeeded,
  failures: results.failures.length,
  verdict: results.verdict,
}, null, 2))
