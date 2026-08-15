import { randomUUID } from 'node:crypto'

const baseUrl = String(process.env.BROWSER_UAT_BACKEND_URL || 'http://127.0.0.1:5000/api').replace(/\/$/, '')
const email = process.env.BROWSER_UAT_EMAIL || 'browser-uat@example.test'
const password = process.env.BROWSER_UAT_PASSWORD || 'BrowserUAT123!'

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

async function jsonRequest(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.success === false) {
    throw new Error(`${method} ${path} failed: ${data.code || response.status} ${data.message || ''}`.trim())
  }
  return data
}

const login = await jsonRequest('/auth/login', { method: 'POST', body: { email, password } })
const token = login.token
invariant(token, 'UAT login did not return a bearer token')

const createdConversations = []
let assertions = 0

async function createConversation() {
  const result = await jsonRequest('/chat/conversations', { method: 'POST', body: {}, token })
  const id = String(result.conversation?._id || '')
  invariant(id, 'Conversation creation did not return an ID')
  createdConversations.push(id)
  return id
}

async function turn(conversationId, message) {
  return jsonRequest('/chat', {
    method: 'POST',
    token,
    body: {
      message,
      conversationId,
      clientMessageId: randomUUID(),
      requestId: randomUUID(),
      pageContext: { pageType: 'AI_ASSISTANT' },
    },
  })
}

function check(condition, message) {
  invariant(condition, message)
  assertions += 1
}

async function isolated(message, verify) {
  const conversationId = await createConversation()
  const result = await turn(conversationId, message)
  await verify(result)
}

try {
  await isolated('2 người, ngân sách khoảng 6-8 triệu, muốn đi 3 ngày', async (result) => {
    check(result.decision?.action === 'SEARCH', 'NEW-03 did not route to SEARCH')
    check(!/tối đa 8\.000\.000đ mỗi người/i.test(result.reply), 'NEW-03 still invents per-person scope')
    check(/6\.000\.000đ–8\.000\.000đ/.test(result.reply), 'NEW-03 reply lost the budget range')
  })

  await isolated('gợi ý tour nhưng đừng cho tôi Đà Lạt', async (result) => {
    const titles = (result.suggestedTours || []).map((tour) => String(tour.title || ''))
    check(result.decision?.action === 'SEARCH', 'NEW-10 did not route to SEARCH')
    check(titles.every((title) => !/đà lạt/i.test(title)), 'NEW-10 returned an excluded Đà Lạt card')
    check(!/đúng điểm đến đà lạt/i.test(result.reply), 'NEW-10 reply inverted the exclusion')
  })

  await isolated('tôi muốn đi tối đa 3 ngày', async (result) => {
    check(result.decision?.action === 'SEARCH', 'NEW-11 did not route to SEARCH')
    check(!/điểm đến tối đa/i.test(result.reply), 'NEW-11 still treats the duration operator as a destination')
    check((result.structuredContent?.tours || []).every((tour) => Number(tour.duration) <= 3), 'NEW-11 returned a tour over the maximum duration')
  })

  await isolated('hai đứa có tầm 8 củ, đi đâu vui vui 3 hôm cũng được', async (result) => {
    check(result.decision?.action === 'SEARCH', 'NEW-14 did not route to SEARCH')
    check((result.suggestedTours || []).length > 0, 'NEW-14 did not return cards')
    check(!/chưa thể trả lời chắc chắn câu hỏi chung/i.test(result.reply), 'NEW-14 text contradicts recommendation cards')
  })

  const updateConversation = await createConversation()
  await turn(updateConversation, 'gợi ý cho tôi tour khoảng 8 triệu cho 2 người, đi đâu cũng được')
  await turn(updateConversation, 'tôi không muốn đi biển')
  const travelers = await turn(updateConversation, 'à đổi thành 3 người')
  check(travelers.decision?.action === 'SEARCH', 'B03 was not a tour search update')
  check(!/booking phù hợp/i.test(travelers.reply), 'B03 was hijacked by booking routing')
  const duration = await turn(updateConversation, 'muốn đi khoảng 3 ngày')
  check(duration.decision?.action === 'SEARCH', 'B05 did not remain a search')
  check((duration.structuredContent?.tours || [])[0]?.duration === 3, 'B05 did not prioritize the approximate target duration')
  const daLat = await turn(updateConversation, 'Đà Lạt thì sao?')
  check((daLat.suggestedTours || []).some((tour) => /đà lạt/i.test(String(tour.title || ''))), 'B07 falsely rejected Đà Lạt under the beach exclusion')

  const entityConversation = await createConversation()
  const firstList = await turn(entityConversation, 'gợi ý tour tối đa 5 triệu mỗi người, đi đâu cũng được')
  const firstIds = firstList.candidateList?.tourIds || []
  check(firstIds.length >= 2, 'B09 setup did not produce at least two candidates')
  const ordinal = await turn(entityConversation, 'tour thứ 2')
  check(ordinal.decision?.action === 'ANSWER', 'B09 did not answer the ordinal reference')
  check(ordinal.structuredContent?.tourId === firstIds[1], 'B09 resolved the wrong entity')
  const anaphora = await turn(entityConversation, 'tour đó giá bao nhiêu và còn đủ cho 3 người không?')
  check(anaphora.structuredContent?.tourId === firstIds[1], 'B10 lost the selected entity')
  check(anaphora.structuredContent?.requestedFacts?.includes('availability'), 'B10 omitted availability')
  const party = await turn(entityConversation, 'nếu đổi thành 4 người thì sao?')
  check(party.decision?.operation === 'mixed_tour_facts', 'B11 did not rehydrate entity facts')
  check(!/booking phù hợp/i.test(party.reply), 'B11 was hijacked by booking routing')
  const criteria = await turn(entityConversation, 'vậy đổi tiêu chí thành tối đa 3 ngày đi')
  check(criteria.decision?.action === 'SEARCH', 'B13 did not route to SEARCH')
  check(!/booking phù hợp/i.test(criteria.reply), 'B13 was hijacked by booking routing')

  const alternative = await turn(entityConversation, 'cho tôi danh sách khác')
  const secondIds = alternative.candidateList?.tourIds || []
  check(alternative.decision?.operation === 'recommendation_alternative', 'B15 lacks alternative-list semantics')
  if (secondIds.length) {
    check(secondIds.some((id) => !firstIds.includes(id)), 'B15 returned the same candidate set as a new list')
  } else {
    check(/chưa còn|không còn/i.test(alternative.reply), 'B15 did not explain that no different candidates remain')
  }
  const historical = await turn(entityConversation, 'tour thứ 2 lúc nãy thì sao?')
  check(historical.decision?.action === 'ANSWER', 'B16 did not answer the historical ordinal')
  check(historical.structuredContent?.tourId === firstIds[1], 'B16 resolved against the wrong list')
  const historicalFacts = await turn(entityConversation, 'tour đó còn chỗ không và chính sách hủy thế nào?')
  check(historicalFacts.structuredContent?.tourId === firstIds[1], 'B17 lost the historical entity')
  check(historicalFacts.structuredContent?.requestedFacts?.includes('cancellation_policy'), 'B17 omitted cancellation policy')
  const persisted = await turn(entityConversation, 'vậy tour thứ 2 lúc nãy giá bao nhiêu?')
  check(persisted.decision?.action === 'ANSWER', 'B18 did not resume the embedded historical fact request')
  check(persisted.structuredContent?.tourId === firstIds[1], 'B18 lost the persisted historical entity')

  console.log(`PHASE 9B runtime reproductions: ${assertions} assertions passed`)
} finally {
  for (const conversationId of createdConversations) {
    await jsonRequest('/chat/history', { method: 'DELETE', body: { conversationId }, token }).catch(() => {})
  }
}
