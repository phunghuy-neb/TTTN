import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import puppeteer from 'puppeteer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(__dirname, '../..')
const outputPath = path.join(workspace, '.uat-linux', 'focused-browser-probes.json')
const baseUrl = process.env.BROWSER_UAT_FRONTEND_URL || 'http://127.0.0.1:15173'
const mongoUri = process.env.BROWSER_UAT_MONGO_URI
  || 'mongodb://127.0.0.1:27018/vietvoyage_browser_uat?replicaSet=uatrs'
const password = process.env.BROWSER_UAT_PASSWORD || 'BrowserUAT123!'

await mongoose.connect(mongoUri)
const db = mongoose.connection.db
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  headless: true,
  protocolTimeout: 240000,
  args: ['--disable-dev-shm-usage'],
})

function apiResponse(response, method, suffix) {
  try {
    return response.request().method() === method && new URL(response.url()).pathname.endsWith(suffix)
  } catch {
    return false
  }
}

async function login(page, email) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle0' })
  await page.type('#email', email)
  await page.type('#password', password)
  await Promise.all([
    page.waitForFunction(() => location.pathname !== '/login'),
    page.click('button[type="submit"]'),
  ])
  await page.goto(`${baseUrl}/ai-assistant`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Nội dung chat"]')
    return input && !input.disabled
  })
}

async function clickText(page, selector, text) {
  const clicked = await page.evaluate(({ selector, text }) => {
    const node = [...document.querySelectorAll(selector)].find((element) => {
      const style = getComputedStyle(element)
      return String(element.textContent || '').includes(text)
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && !element.disabled
    })
    if (!node) return false
    node.click()
    return true
  }, { selector, text })
  if (!clicked) throw new Error(`Button not found: ${text}`)
}

async function createConversation(page) {
  const responsePromise = page.waitForResponse(
    (response) => apiResponse(response, 'POST', '/api/chat/conversations')
  )
  await clickText(page, 'button', 'Chat mới')
  const data = await (await responsePromise).json()
  if (!data.conversation?._id) throw new Error('Conversation creation failed')
  return data.conversation
}

async function fill(page, value) {
  const selector = 'input[aria-label="Nội dung chat"]'
  await page.waitForFunction((inputSelector) => {
    const input = document.querySelector(inputSelector)
    return input && !input.disabled
  }, {}, selector)
  await page.evaluate((inputSelector, nextValue) => {
    const input = document.querySelector(inputSelector)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter.call(input, nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, selector, value)
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Gửi tin nhắn"]')
    return button && !button.disabled
  })
}

async function send(page, value) {
  await fill(page, value)
  const responsePromise = page.waitForResponse(
    (response) => apiResponse(response, 'POST', '/api/chat'),
    { timeout: 90000 }
  )
  await page.evaluate(() => document.querySelector('button[aria-label="Gửi tin nhắn"]')?.click())
  const response = await responsePromise
  const data = await response.json()
  if (!response.ok() || data.success === false) throw new Error(data.code || `HTTP_${response.status()}`)
  return data
}

async function waitForTrace(requestId) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const turn = await db.collection('chatTurns').findOne({ $or: [{ requestId }, { requestIds: requestId }] })
    if (turn?.status === 'completed') return turn
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Trace timeout: ${requestId}`)
}

const report = {
  startedAt: new Date().toISOString(),
  browser: await browser.version(),
  multiTab: null,
  pagination: null,
}

try {
  const mainContext = await browser.createBrowserContext()
  const tab1 = await mainContext.newPage()
  await tab1.setViewport({ width: 1440, height: 1000 })
  await login(tab1, 'browser-uat@example.test')
  const conversation = await createConversation(tab1)
  const setup = await send(tab1, 'đi đâu cũng được, gợi ý tour 3 ngày')
  console.log(`Multi-tab setup: ${setup.requestId}`)
  const tab2 = await mainContext.newPage()
  await tab2.setViewport({ width: 1280, height: 900 })
  await tab2.goto(`${baseUrl}/ai-assistant`, { waitUntil: 'networkidle0' })
  await tab2.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Nội dung chat"]')
    return input && !input.disabled
  })
  const activeKey = await tab1.evaluate(() => Object.keys(localStorage)
    .find((key) => key.startsWith('vietvoyage-active-conversation:')))
  const tab1Active = await tab1.evaluate((key) => localStorage.getItem(key), activeKey)
  const tab2Active = await tab2.evaluate((key) => localStorage.getItem(key), activeKey)
  if (tab1Active !== conversation._id || tab2Active !== conversation._id) {
    throw new Error(`Tabs did not share the active UAT conversation: ${tab1Active}/${tab2Active}`)
  }
  console.log(`Shared active conversation: ${conversation._id}`)

  const budgetInput = 'ngân sách tối đa 5 triệu'
  const travelersInput = 'đi 4 người'
  await fill(tab1, budgetInput)
  await fill(tab2, travelersInput)
  console.log('Both tab inputs are ready')
  const budgetResponsePromise = tab1.waitForResponse(
    (response) => apiResponse(response, 'POST', '/api/chat'),
    { timeout: 90000 }
  )
  const travelersResponsePromise = tab2.waitForResponse(
    (response) => apiResponse(response, 'POST', '/api/chat'),
    { timeout: 90000 }
  )
  const clickStartedAt = Date.now()
  await Promise.all([
    tab1.evaluate(() => document.querySelector('button[aria-label="Gửi tin nhắn"]')?.click()),
    tab2.evaluate(() => document.querySelector('button[aria-label="Gửi tin nhắn"]')?.click()),
  ])
  console.log('Both tab send buttons were clicked')
  const [budgetResponse, travelersResponse] = await Promise.all([
    budgetResponsePromise,
    travelersResponsePromise,
  ])
  const budgetData = await budgetResponse.json()
  const travelersData = await travelersResponse.json()
  if (!budgetResponse.ok() || !travelersResponse.ok()) {
    throw new Error(`Concurrent HTTP result: ${budgetResponse.status()}/${travelersResponse.status()}`)
  }
  const [budgetTurn, travelersTurn] = await Promise.all([
    waitForTrace(budgetData.requestId),
    waitForTrace(travelersData.requestId),
  ])
  const conversationId = new mongoose.Types.ObjectId(conversation._id)
  const persistedConversation = await db.collection('conversations').findOne({ _id: conversationId })
  const turns = await db.collection('chatTurns').find({ conversationId, status: 'completed' }).toArray()
  const messages = await db.collection('chatMessages').countDocuments({ conversationId })
  const state = persistedConversation?.constraintState || {}
  const budget = state?._semanticState?.slots?.budget || {}
  const startDeltaMs = Math.abs(new Date(budgetTurn.startedAt) - new Date(travelersTurn.startedAt))
  const pass = state.travelers === 4
    && (budget.max === 5000000 || state.maxPrice === 5000000)
    && messages === 6
    && turns.length === 3
    && new Set(turns.map((turn) => turn.logicalTurnId)).size === 3
    && startDeltaMs <= 2000
  report.multiTab = {
    result: pass ? 'PASS' : 'FAIL',
    conversationId: conversation._id,
    setupRequestId: setup.requestId,
    requestIds: [budgetData.requestId, travelersData.requestId],
    logicalTurnIds: [budgetTurn.logicalTurnId, travelersTurn.logicalTurnId],
    clickStartedAt,
    startDeltaMs,
    finalTravelers: state.travelers,
    finalBudget: budget,
    messages,
    completedTurns: turns.length,
    uniqueLogicalTurns: new Set(turns.map((turn) => turn.logicalTurnId)).size,
    persistence: [budgetTurn.trace?.persistence, travelersTurn.trace?.persistence],
  }
  console.log(`Multi-tab result: ${report.multiTab.result}`)
  await mainContext.close()

  const paginationContext = await browser.createBrowserContext()
  const page = await paginationContext.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  await login(page, 'browser-uat-pagination@example.test')
  const conversationCount = () => page.evaluate(() => [...document.querySelectorAll('aside button')]
    .filter((button) => /Pagination fixture/.test(button.textContent || '')).length)
  const initialConversations = await conversationCount()
  const moreConversations = page.waitForResponse(
    (response) => response.request().method() === 'GET'
      && response.url().includes('/api/chat/conversations?')
      && response.url().includes('page=2')
  )
  await clickText(page, 'aside button', 'Tải thêm')
  await moreConversations
  const allConversations = await conversationCount()
  const messagesResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET'
      && response.url().includes('/messages?')
      && response.url().includes('page=1')
  )
  await clickText(page, 'aside button', 'Pagination fixture 01')
  await messagesResponse
  const olderMessages = page.waitForResponse(
    (response) => response.request().method() === 'GET'
      && response.url().includes('/messages?')
      && response.url().includes('page=2')
  )
  await clickText(page, 'main button', 'Tải tin nhắn cũ hơn')
  await olderMessages
  await page.waitForFunction(() => {
    const text = document.querySelector('main')?.innerText || ''
    return (text.match(/Pagination user message \d+/g) || []).length === 65
      && (text.match(/Pagination assistant message \d+/g) || []).length === 65
  })
  const text = await page.evaluate(() => document.querySelector('main')?.innerText || '')
  const userMessages = (text.match(/Pagination user message \d+/g) || []).length
  const assistantMessages = (text.match(/Pagination assistant message \d+/g) || []).length
  const paginationPass = initialConversations === 20
    && allConversations === 35
    && userMessages === 65
    && assistantMessages === 65
  report.pagination = {
    result: paginationPass ? 'PASS' : 'FAIL',
    initialConversations,
    allConversations,
    userMessages,
    assistantMessages,
    totalMessages: userMessages + assistantMessages,
  }
  console.log(`Pagination result: ${report.pagination.result}`)
  await paginationContext.close()
} catch (error) {
  report.error = { message: error.message, stack: error.stack }
} finally {
  report.finishedAt = new Date().toISOString()
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  await browser.close().catch(() => {})
  await mongoose.disconnect().catch(() => {})
}

console.log(JSON.stringify({ outputPath, ...report }, null, 2))
