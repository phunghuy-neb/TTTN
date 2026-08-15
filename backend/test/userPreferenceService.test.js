import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createUserPreferenceService,
  extractPreferenceCommand,
} from '../src/services/userPreferenceService.js'

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
}

function memoryRepository() {
  const profiles = new Map()
  return {
    profiles,
    async findOwned({ userId }) {
      return profiles.get(String(userId)) || null
    },
    async applyOwned({ userId, changes }) {
      const key = String(userId)
      const profile = structuredClone(profiles.get(key) || {})
      for (const [field, values] of Object.entries(changes.remove)) {
        const removed = new Set(values.map(normalize))
        profile[field] = (profile[field] || []).filter((value) => !removed.has(normalize(value)))
      }
      for (const [field, values] of Object.entries(changes.add)) {
        const current = profile[field] || []
        profile[field] = [...new Map([...current, ...values].map((value) => [normalize(value), value])).values()]
      }
      for (const [field, value] of Object.entries(changes.set)) profile[field] = value
      for (const field of changes.unset) profile[field] = null
      profiles.set(key, profile)
      return profile
    },
  }
}

test('sở thích biển và nghỉ dưỡng đủ rõ được lưu structured', async () => {
  const repository = memoryRepository()
  const processPreference = createUserPreferenceService(repository)
  const result = await processPreference({ userId: 'user-a', message: 'Tôi thích tour biển và nghỉ dưỡng.' })
  assert.deepEqual(result.profile.interests, ['biển'])
  assert.deepEqual(result.profile.travelStyles, ['nghỉ dưỡng'])
  assert.equal(result.update.commandOnly, true)
})

test('constraint tạm thời không biến thành preference dài hạn', () => {
  assert.equal(extractPreferenceCommand('Chuyến này dưới 5 triệu.').active, false)
  assert.equal(extractPreferenceCommand('Lần này tôi muốn đi núi.').active, false)
})

test('ngân sách thường chọn được lưu nhưng yêu cầu chuyến hiện tại thì không', async () => {
  const repository = memoryRepository()
  const processPreference = createUserPreferenceService(repository)
  await processPreference({ userId: 'user-a', message: 'Tôi thường chọn tour khoảng 5-7 triệu.' })
  assert.deepEqual(repository.profiles.get('user-a').budgetPreference, {
    min: 5_000_000,
    max: 7_000_000,
    target: null,
  })
  await processPreference({ userId: 'user-a', message: 'Chuyến này dưới 5 triệu.' })
  assert.equal(repository.profiles.get('user-a').budgetPreference.max, 7_000_000)
})

test('không thích Phú Quốc chuyển preference sang disliked, không giữ mâu thuẫn', async () => {
  const repository = memoryRepository()
  const processPreference = createUserPreferenceService(repository)
  await processPreference({ userId: 'user-a', message: 'Tôi thích Phú Quốc.' })
  await processPreference({ userId: 'user-a', message: 'Tôi không thích Phú Quốc nữa.' })
  assert.deepEqual(repository.profiles.get('user-a').preferredDestinations, [])
  assert.deepEqual(repository.profiles.get('user-a').dislikedDestinations, ['Phú Quốc'])
})

test('đổi ý và quên preference loại bỏ giá trị cũ', async () => {
  const repository = memoryRepository()
  const processPreference = createUserPreferenceService(repository)
  await processPreference({ userId: 'user-a', message: 'Tôi thích khám phá.' })
  await processPreference({ userId: 'user-a', message: 'Giờ tôi thích nghỉ dưỡng hơn khám phá.' })
  assert.deepEqual(repository.profiles.get('user-a').travelStyles, ['nghỉ dưỡng'])
  await processPreference({ userId: 'user-a', message: 'Tôi thích tour biển.' })
  await processPreference({ userId: 'user-a', message: 'Quên sở thích biển của tôi.' })
  assert.deepEqual(repository.profiles.get('user-a').interests, [])
})

test('repository luôn cô lập profile theo userId nguồn backend', async () => {
  const repository = memoryRepository()
  const processPreference = createUserPreferenceService(repository)
  await processPreference({ userId: 'user-a', message: 'Tôi thích tour biển.' })
  await processPreference({ userId: 'user-b', message: 'Tôi thích tour núi.' })
  const userA = await processPreference({ userId: 'user-a', message: 'Tìm tour cho tôi.' })
  const userB = await processPreference({ userId: 'user-b', message: 'Tìm tour cho tôi.' })
  assert.deepEqual(userA.profile.interests, ['biển'])
  assert.deepEqual(userB.profile.interests, ['núi'])
})

test('cách nói tự nhiên về nhịp đi nhẹ nhàng được chuẩn hóa với confidence đủ cao', () => {
  const result = extractPreferenceCommand('Tôi thích đi nhẹ nhàng, không chạy lịch trình quá nhiều.')
  assert.equal(result.hasChanges, true)
  assert.equal(result.changes.set.pace, 'relaxed')
  assert.ok(result.acceptedCandidates.every((candidate) => candidate.confidence >= 0.8))
})

test('khách sạn ổn nhưng không cần sang không tạo preference mâu thuẫn', () => {
  const result = extractPreferenceCommand('Khách sạn ổn một chút nhưng không cần sang.')
  assert.deepEqual(result.changes.add.accommodationPreferences, ['khách sạn tiêu chuẩn'])
  assert.deepEqual(result.changes.add.dislikedAccommodationPreferences, ['khách sạn sang trọng'])
  assert.ok(!(result.changes.add.accommodationPreferences || []).includes('khách sạn sang trọng'))
})

test('thời gian tự do buổi tối được chuẩn hóa thành travel style cho phép', () => {
  const result = extractPreferenceCommand('Buổi tối tôi thích có thời gian tự do.')
  assert.deepEqual(result.changes.add.travelStyles, ['tự do'])
  assert.ok(result.acceptedCandidates.some((candidate) => candidate.value === 'tự do'))
})

test('ẩm thực và trải nghiệm địa phương hơn check-in không lưu hai phía mâu thuẫn', () => {
  const result = extractPreferenceCommand('Tôi thích ăn uống và trải nghiệm địa phương hơn check-in.')
  assert.deepEqual(result.changes.add.interests, ['ẩm thực', 'trải nghiệm địa phương'])
  assert.deepEqual(result.changes.add.dislikedInterests, ['check-in'])
  assert.ok(!(result.changes.add.interests || []).includes('check-in'))
})

test('mô tả khách sạn mơ hồ confidence thấp không được persist', () => {
  const result = extractPreferenceCommand('Tôi thích khách sạn tốt một chút.')
  assert.equal(result.hasChanges, false)
  assert.equal(result.needsClarification, true)
  assert.equal(result.acceptedCandidates.length, 0)
})

test('mọi array candidate được persist đều thuộc allowlist backend', () => {
  const samples = [
    'Tôi thích đi nhẹ nhàng, không chạy lịch trình quá nhiều.',
    'Khách sạn ổn một chút nhưng không cần sang.',
    'Buổi tối tôi thích có thời gian tự do.',
    'Tôi thích ăn uống và trải nghiệm địa phương hơn check-in.',
  ]
  for (const message of samples) {
    const result = extractPreferenceCommand(message)
    assert.ok(result.acceptedCandidates.length > 0)
    assert.ok(result.acceptedCandidates.every((candidate) => candidate.source !== 'ambiguous_natural_pattern'))
  }
})

test('stress table: preference rõ lưu được, constraint tạm thời và câu mơ hồ không persist (15 cases)', () => {
  const cases = [
    ['Tôi thích biển.', true], ['Tôi thích nghỉ dưỡng.', true], ['Tôi không thích Phú Quốc nữa.', true],
    ['Quên sở thích biển của tôi.', true], ['Tôi thường chọn tour khoảng 5-7 triệu.', true],
    ['Tôi thích lịch trình nhẹ nhàng.', true], ['Tôi thích trải nghiệm địa phương.', true],
    ['Chuyến này dưới 5 triệu.', false], ['Lần này muốn đi núi.', false], ['Ngày mai đi Đà Lạt.', false],
    ['4 triệu cho 2 người.', false], ['Đi khoảng 3 ngày.', false], ['Tìm tour biển.', false],
    ['Khách sạn tốt một chút.', false], ['Đi chỗ đẹp.', false],
  ]
  for (const [message, active] of cases) assert.equal(extractPreferenceCommand(message).active, active, message)
})
