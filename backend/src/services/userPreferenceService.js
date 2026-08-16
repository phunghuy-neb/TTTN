import UserPreference from '../models/UserPreference.js'

const ARRAY_FIELDS = [
  'travelStyles',
  'dislikedTravelStyles',
  'preferredRegions',
  'dislikedRegions',
  'preferredDestinations',
  'dislikedDestinations',
  'accommodationPreferences',
  'dislikedAccommodationPreferences',
  'interests',
  'dislikedInterests',
]

const DESTINATIONS = [
  'Phú Quốc',
  'Nha Trang',
  'Đà Nẵng',
  'Đà Lạt',
  'Hạ Long',
  'Sa Pa',
  'Hội An',
  'Huế',
  'Quảng Bình',
  'Ninh Bình',
  'Bình Hưng',
  'Miền Tây',
]

const REGIONS = ['Miền Bắc', 'Miền Trung', 'Miền Nam']

const TRAVEL_STYLES = [
  { value: 'nghỉ dưỡng', words: ['nghi duong', 'resort', 'thu gian'] },
  { value: 'khám phá', words: ['kham pha', 'thich kham pha', 'uu tien kham pha'] },
  { value: 'mạo hiểm', words: ['mao hiem', 'phieu luu', 'trekking'] },
  { value: 'gia đình', words: ['gia dinh'] },
  { value: 'tự do', words: ['thoi gian tu do', 'tu do buoi toi', 'buoi toi tu do'] },
]

const INTERESTS = [
  { value: 'biển', words: ['bien', 'dao', 'tam bien'] },
  { value: 'núi', words: ['nui', 'leo nui'] },
  { value: 'văn hóa', words: ['van hoa', 'di san', 'lich su'] },
  { value: 'ẩm thực', words: ['am thuc', 'mon ngon', 'hai san'] },
  { value: 'thiên nhiên', words: ['thien nhien', 'sinh thai'] },
  { value: 'trải nghiệm địa phương', words: ['trai nghiem dia phuong', 'doi song dia phuong', 'van hoa dia phuong'] },
  { value: 'check-in', words: ['check-in', 'check in', 'chup anh song ao'] },
]

const ACCOMMODATIONS = [
  { value: 'resort', words: ['resort'] },
  { value: 'khách sạn 5 sao', words: ['khach san 5 sao', '5 sao'] },
  { value: 'khách sạn 4 sao', words: ['khach san 4 sao', '4 sao'] },
  { value: 'khách sạn 3 sao', words: ['khach san 3 sao', '3 sao'] },
  { value: 'homestay', words: ['homestay'] },
  { value: 'khách sạn tiêu chuẩn', words: ['khach san tieu chuan', 'khach san vua phai'] },
  { value: 'khách sạn sang trọng', words: ['khach san sang', 'khach san sang trong', 'luxury hotel'] },
]

const ALLOWED_ARRAY_VALUES = {
  travelStyles: new Set(TRAVEL_STYLES.map((item) => item.value)),
  dislikedTravelStyles: new Set(TRAVEL_STYLES.map((item) => item.value)),
  preferredRegions: new Set(REGIONS),
  dislikedRegions: new Set(REGIONS),
  preferredDestinations: new Set(DESTINATIONS),
  dislikedDestinations: new Set(DESTINATIONS),
  accommodationPreferences: new Set(ACCOMMODATIONS.map((item) => item.value)),
  dislikedAccommodationPreferences: new Set(ACCOMMODATIONS.map((item) => item.value)),
  interests: new Set(INTERESTS.map((item) => item.value)),
  dislikedInterests: new Set(INTERESTS.map((item) => item.value)),
}

const MIN_PERSIST_CONFIDENCE = 0.8

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueStrings(values = []) {
  const seen = new Set()
  return values.map(String).map((value) => value.trim()).filter((value) => {
    const key = normalizeText(value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function emptyChanges() {
  return { add: {}, remove: {}, set: {}, unset: [] }
}

function append(changeMap, field, value) {
  changeMap[field] = uniqueStrings([...(changeMap[field] || []), value])
}

function removePending(changeMap, field, value) {
  const key = normalizeText(value)
  changeMap[field] = (changeMap[field] || []).filter((item) => normalizeText(item) !== key)
}

function durablePreferenceMessage(normalized) {
  return /(?:^|\b)(?:toi (?:rat )?(?:thich|khong thich|khong con thich|thuong|hay uu tien|uu tien)|gio toi thich|tu gio|nho (?:la )?toi|hay nho|so thich cua toi|quen|dung nho|xoa (?:so thich|ghi nho))\b/.test(normalized) ||
    /khach san .*(?:khong can sang|vua phai|on mot chut)/.test(normalized)
}

function temporaryOnlyMessage(normalized) {
  const temporary = /\b(?:lan nay|chuyen nay|chuyen di nay|dip nay)\b/.test(normalized)
  const explicitLongTerm = /\b(?:tu gio|thuong|nho|so thich|quen|dung nho)\b/.test(normalized)
  return temporary && !explicitLongTerm
}

function termMode(normalized, index, forgetMode) {
  if (forgetMode) return 'forget'
  const before = normalized.slice(Math.max(0, index - 36), index)
  if (/(?:khong (?:con )?thich|khong uu tien|ghet|tranh)\s*$/.test(before)) return 'dislike'
  return 'like'
}

function applyTerm(changes, { positiveField, negativeField, value, mode }) {
  if (mode === 'forget' || mode === 'replace') {
    append(changes.remove, positiveField, value)
    append(changes.remove, negativeField, value)
    return
  }
  if (mode === 'dislike') {
    append(changes.add, negativeField, value)
    append(changes.remove, positiveField, value)
    return
  }
  append(changes.add, positiveField, value)
  append(changes.remove, negativeField, value)
}

function extractTerms(normalized, definitions, fields, changes, forgetMode) {
  for (const definition of definitions) {
    let bestIndex = -1
    for (const word of definition.words) {
      const index = normalized.indexOf(word)
      if (index >= 0 && (bestIndex < 0 || index < bestIndex)) bestIndex = index
    }
    if (bestIndex < 0) continue
    applyTerm(changes, {
      ...fields,
      value: definition.value,
      mode: termMode(normalized, bestIndex, forgetMode),
    })
  }
}

function moneyValue(raw) {
  return Math.round(Number(String(raw).replace(',', '.')) * 1_000_000)
}

function extractBudget(normalized, changes, forgetMode) {
  if (!/(?:ngan sach|muc gia|tour|trieu|\btr\b)/.test(normalized)) return
  if (forgetMode && /(?:ngan sach|muc gia|gia tour)/.test(normalized)) {
    changes.unset.push('budgetPreference')
    return
  }
  if (!/\b(?:thuong|tu gio|nho|uu tien)\b/.test(normalized)) return
  const range = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:-|den|toi)\s*(\d+(?:[.,]\d+)?)\s*(?:trieu|tr)\b/)
  if (range) {
    const left = moneyValue(range[1])
    const right = moneyValue(range[2])
    changes.set.budgetPreference = { min: Math.min(left, right), max: Math.max(left, right), target: null }
    return
  }
  const single = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:trieu|tr)\b/)
  if (!single) return
  const value = moneyValue(single[1])
  if (/\b(?:duoi|toi da|khong qua|chi)\b/.test(normalized)) {
    changes.set.budgetPreference = { min: null, max: value, target: null }
  } else {
    changes.set.budgetPreference = { min: null, max: null, target: value }
  }
}

function extractDuration(normalized, changes, forgetMode) {
  if (forgetMode && /(?:thoi luong|so ngay|tour may ngay)/.test(normalized)) {
    changes.unset.push('durationPreference')
    return
  }
  if (!/\b(?:thuong|tu gio|nho|uu tien)\b/.test(normalized)) return
  const range = normalized.match(/(\d{1,2})\s*(?:-|den|toi)\s*(\d{1,2})\s*ngay\b/)
  if (range) {
    const left = Number(range[1])
    const right = Number(range[2])
    changes.set.durationPreference = { minDays: Math.min(left, right), maxDays: Math.max(left, right), targetDays: null }
    return
  }
  const single = normalized.match(/(\d{1,2})\s*ngay\b/)
  if (single) changes.set.durationPreference = { minDays: null, maxDays: null, targetDays: Number(single[1]) }
}

function extractPace(normalized, changes, forgetMode) {
  if (forgetMode && /(?:nhip do|lich trinh|di cham|di nhanh)/.test(normalized)) {
    changes.unset.push('pace')
    return
  }
  if (/(?:lich trinh nhe|nhip do cham|di cham|di nhe nhang|khong qua day|khong chay lich trinh|khong di qua nhieu|co thoi gian tu do)/.test(normalized)) changes.set.pace = 'relaxed'
  else if (/(?:lich trinh day|nhip do nhanh|di nhieu|nang dong)/.test(normalized)) changes.set.pace = 'active'
  else if (/(?:can bang|vua phai)/.test(normalized)) changes.set.pace = 'balanced'
}

function applyNaturalPreferencePatterns(normalized, changes, candidates) {
  if (/(?:khach san on mot chut|khach san vua phai|khong can khach san sang|khong can sang)/.test(normalized)) {
    removePending(changes.add, 'accommodationPreferences', 'khách sạn sang trọng')
    append(changes.add, 'accommodationPreferences', 'khách sạn tiêu chuẩn')
    append(changes.remove, 'dislikedAccommodationPreferences', 'khách sạn tiêu chuẩn')
    append(changes.add, 'dislikedAccommodationPreferences', 'khách sạn sang trọng')
    append(changes.remove, 'accommodationPreferences', 'khách sạn sang trọng')
    candidates.push(
      { field: 'accommodationPreferences', operation: 'add', value: 'khách sạn tiêu chuẩn', confidence: 0.9, source: 'natural_pattern' },
      { field: 'dislikedAccommodationPreferences', operation: 'add', value: 'khách sạn sang trọng', confidence: 0.9, source: 'natural_pattern' }
    )
  } else if (/khach san (?:on|tot) mot chut/.test(normalized)) {
    candidates.push({ field: 'accommodationPreferences', operation: 'add', value: 'khách sạn tiêu chuẩn', confidence: 0.65, source: 'ambiguous_natural_pattern' })
  }

  if (/(?:buoi toi|toi den).*(?:thoi gian tu do|duoc tu do)|(?:thoi gian tu do).*(?:buoi toi|toi den)/.test(normalized)) {
    append(changes.add, 'travelStyles', 'tự do')
    append(changes.remove, 'dislikedTravelStyles', 'tự do')
    candidates.push({ field: 'travelStyles', operation: 'add', value: 'tự do', confidence: 0.92, source: 'natural_pattern' })
  }

  if (/(?:an uong|mon ngon|am thuc).*(?:trai nghiem dia phuong|doi song dia phuong)|(?:trai nghiem dia phuong).*(?:an uong|mon ngon|am thuc)/.test(normalized)) {
    for (const value of ['ẩm thực', 'trải nghiệm địa phương']) {
      append(changes.add, 'interests', value)
      append(changes.remove, 'dislikedInterests', value)
      candidates.push({ field: 'interests', operation: 'add', value, confidence: 0.92, source: 'natural_pattern' })
    }
  }
  if (/(?:hon|thay vi).*(?:check-in|check in|chup anh song ao)|(?:khong thich|khong uu tien).*(?:check-in|check in|chup anh song ao)/.test(normalized)) {
    removePending(changes.add, 'interests', 'check-in')
    append(changes.add, 'dislikedInterests', 'check-in')
    append(changes.remove, 'interests', 'check-in')
    candidates.push({ field: 'dislikedInterests', operation: 'add', value: 'check-in', confidence: 0.9, source: 'natural_pattern' })
  }
}

function changesToCandidates(changes) {
  const candidates = []
  for (const [field, values] of Object.entries(changes.add)) {
    for (const value of values) candidates.push({ field, operation: 'add', value, confidence: 0.95, source: 'deterministic_allowlist' })
  }
  for (const [field, values] of Object.entries(changes.remove)) {
    for (const value of values) candidates.push({ field, operation: 'remove', value, confidence: 0.95, source: 'deterministic_allowlist' })
  }
  for (const [field, value] of Object.entries(changes.set)) {
    candidates.push({ field, operation: 'set', value, confidence: 0.95, source: 'deterministic_allowlist' })
  }
  for (const field of changes.unset) candidates.push({ field, operation: 'unset', value: null, confidence: 0.98, source: 'explicit_forget' })
  return candidates
}

function validatePreferenceChanges(changes, candidates) {
  const validated = emptyChanges()
  const accepted = []
  const seen = new Set()
  for (const candidate of candidates) {
    const key = `${candidate.field}:${candidate.operation}:${JSON.stringify(candidate.value)}`
    if (seen.has(key) || Number(candidate.confidence) < MIN_PERSIST_CONFIDENCE) continue
    seen.add(key)
    const allowedArray = ALLOWED_ARRAY_VALUES[candidate.field]
    if (allowedArray && ['add', 'remove'].includes(candidate.operation) && allowedArray.has(candidate.value)) {
      append(validated[candidate.operation], candidate.field, candidate.value)
      accepted.push(candidate)
      continue
    }
    if (candidate.operation === 'set' && candidate.field === 'pace' && ['relaxed', 'balanced', 'active'].includes(candidate.value)) {
      validated.set.pace = candidate.value
      accepted.push(candidate)
      continue
    }
    if (candidate.operation === 'set' && candidate.field === 'budgetPreference') {
      const { min, max, target } = candidate.value || {}
      if ([min, max, target].every((value) => value === null || (Number.isFinite(Number(value)) && Number(value) > 0)) && (!min || !max || min <= max)) {
        validated.set.budgetPreference = { min: min || null, max: max || null, target: target || null }
        accepted.push(candidate)
      }
      continue
    }
    if (candidate.operation === 'set' && candidate.field === 'durationPreference') {
      const { minDays, maxDays, targetDays } = candidate.value || {}
      if ([minDays, maxDays, targetDays].every((value) => value === null || (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 60)) && (!minDays || !maxDays || minDays <= maxDays)) {
        validated.set.durationPreference = { minDays: minDays || null, maxDays: maxDays || null, targetDays: targetDays || null }
        accepted.push(candidate)
      }
      continue
    }
    if (candidate.operation === 'unset' && ['pace', 'budgetPreference', 'durationPreference'].includes(candidate.field)) {
      validated.unset.push(candidate.field)
      accepted.push(candidate)
    }
  }
  validated.unset = [...new Set(validated.unset)]
  return { changes: validated, accepted }
}

function hasChanges(changes) {
  return Object.values(changes.add).some((values) => values.length) ||
    Object.values(changes.remove).some((values) => values.length) ||
    Object.keys(changes.set).length > 0 || changes.unset.length > 0
}

function isCommandOnly(normalized) {
  const searchOrComparison = /(?:\btim\b|goi y|de xuat|tu van|so sanh|danh sach tour|vai tour)/.test(normalized)
  const semanticUpdate = /\b(?:doi(?: tieu chi)? (?:thanh|sang)|sua (?:thanh|lai)|cap nhat|chuyen sang)\b/.test(normalized)
  const factualOrEvaluativeQuestion = /(?:con cho|khoi hanh|booking|thanh toan|tour nay|tour do|the nao|bao nhieu|co (?:phu hop|hop)|(?:phu hop|hop) (?:voi|cho)|co gi (?:hay|noi bat)|diem (?:gi |nao )?(?:noi bat|dang chu y)|hay giai thich)/.test(normalized)
  return !(searchOrComparison || semanticUpdate || factualOrEvaluativeQuestion)
}

export function extractPreferenceCommand(message) {
  const normalized = normalizeText(message)
  if (!normalized || temporaryOnlyMessage(normalized) || !durablePreferenceMessage(normalized)) {
    return { active: false, commandOnly: false, changes: emptyChanges() }
  }

  const changes = emptyChanges()
  const naturalCandidates = []
  const forgetMode = /\b(?:quen|dung nho|xoa (?:so thich|ghi nho))\b/.test(normalized)
  const comparisonIndex = normalized.indexOf(' hon ')

  for (const destination of DESTINATIONS) {
    const key = normalizeText(destination)
    const index = normalized.indexOf(key)
    if (index >= 0) applyTerm(changes, {
      positiveField: 'preferredDestinations',
      negativeField: 'dislikedDestinations',
      value: destination,
      mode: termMode(normalized, index, forgetMode),
    })
  }
  for (const region of REGIONS) {
    const key = normalizeText(region)
    const index = normalized.indexOf(key)
    if (index >= 0) applyTerm(changes, {
      positiveField: 'preferredRegions',
      negativeField: 'dislikedRegions',
      value: region,
      mode: termMode(normalized, index, forgetMode),
    })
  }

  extractTerms(normalized, TRAVEL_STYLES, {
    positiveField: 'travelStyles',
    negativeField: 'dislikedTravelStyles',
  }, changes, forgetMode)
  extractTerms(normalized, INTERESTS, {
    positiveField: 'interests',
    negativeField: 'dislikedInterests',
  }, changes, forgetMode)
  extractTerms(normalized, ACCOMMODATIONS, {
    positiveField: 'accommodationPreferences',
    negativeField: 'dislikedAccommodationPreferences',
  }, changes, forgetMode)
  extractBudget(normalized, changes, forgetMode)
  extractDuration(normalized, changes, forgetMode)
  extractPace(normalized, changes, forgetMode)
  applyNaturalPreferencePatterns(normalized, changes, naturalCandidates)

  if (comparisonIndex >= 0 && /\bthich\b/.test(normalized.slice(0, comparisonIndex))) {
    const afterPreferred = (values = []) => values.filter((value) => {
      const index = normalized.indexOf(normalizeText(value))
      return index > comparisonIndex
    })
    for (const field of ['travelStyles', 'interests', 'preferredDestinations', 'preferredRegions']) {
      for (const value of afterPreferred(changes.add[field] || [])) {
        append(changes.remove, field, value)
      }
      changes.add[field] = (changes.add[field] || []).filter((value) => !afterPreferred([value]).length)
    }
  }

  changes.unset = [...new Set(changes.unset)]
  const allCandidates = [...naturalCandidates, ...changesToCandidates(changes)]
  const { changes: validatedChanges, accepted } = validatePreferenceChanges(changes, allCandidates)
  const needsClarification = allCandidates.some((candidate) => Number(candidate.confidence) < MIN_PERSIST_CONFIDENCE) && !hasChanges(validatedChanges)
  return {
    active: true,
    commandOnly: isCommandOnly(normalized),
    forget: forgetMode,
    hasChanges: hasChanges(validatedChanges),
    needsClarification,
    candidates: allCandidates,
    acceptedCandidates: accepted,
    changes: validatedChanges,
  }
}

function sanitizeRange(value, fields) {
  if (!value || typeof value !== 'object') return null
  const result = {}
  for (const field of fields) {
    const number = Number(value[field])
    result[field] = Number.isFinite(number) && number > 0 ? number : null
  }
  return Object.values(result).some((item) => item !== null) ? result : null
}

export function sanitizePreferenceProfile(value = {}) {
  const profile = {}
  for (const field of ARRAY_FIELDS) profile[field] = uniqueStrings(value[field] || []).slice(0, 20)
  profile.budgetPreference = sanitizeRange(value.budgetPreference, ['min', 'max', 'target'])
  profile.durationPreference = sanitizeRange(value.durationPreference, ['minDays', 'maxDays', 'targetDays'])
  profile.pace = ['relaxed', 'balanced', 'active'].includes(value.pace) ? value.pace : null
  return profile
}

function mongoRepository() {
  return {
    async findOwned({ userId, session = null }) {
      const query = UserPreference.findOne({ userId })
      if (session) query.session(session)
      return query.lean()
    },
    async applyOwned({ userId, changes, session = null }) {
      let query = UserPreference.findOne({ userId })
      if (session) query = query.session(session)
      let preference = await query
      if (!preference) preference = new UserPreference({ userId })

      for (const field of ARRAY_FIELDS) {
        const removals = new Set((changes.remove?.[field] || []).map(normalizeText))
        const current = (preference[field] || []).filter((value) => !removals.has(normalizeText(value)))
        preference[field] = uniqueStrings([...current, ...(changes.add?.[field] || [])])
      }
      for (const [field, value] of Object.entries(changes.set || {})) preference.set(field, value)
      for (const field of changes.unset || []) preference.set(field, null)

      try {
        return (await preference.save({ session })).toObject()
      } catch (error) {
        if (error?.code !== 11000) throw error
        let existingQuery = UserPreference.findOne({ userId })
        if (session) existingQuery = existingQuery.session(session)
        const existing = await existingQuery
        if (!existing) throw error
        for (const field of ARRAY_FIELDS) {
          const removals = new Set((changes.remove?.[field] || []).map(normalizeText))
          const current = (existing[field] || []).filter((value) => !removals.has(normalizeText(value)))
          existing[field] = uniqueStrings([...current, ...(changes.add?.[field] || [])])
        }
        for (const [field, value] of Object.entries(changes.set || {})) existing.set(field, value)
        for (const field of changes.unset || []) existing.set(field, null)
        return (await existing.save({ session })).toObject()
      }
    },
  }
}

export function applyPreferenceChangesToProfile(profileValue, changes) {
  const profile = structuredClone(profileValue || {})
  for (const field of ARRAY_FIELDS) {
    const removals = new Set((changes.remove?.[field] || []).map(normalizeText))
    const current = (profile[field] || []).filter((value) => !removals.has(normalizeText(value)))
    profile[field] = uniqueStrings([...current, ...(changes.add?.[field] || [])])
  }
  for (const [field, value] of Object.entries(changes.set || {})) profile[field] = value
  for (const field of changes.unset || []) profile[field] = null
  return profile
}

const defaultRepository = mongoRepository()

export async function prepareUserPreferenceMessage({ userId, message }) {
  const command = extractPreferenceCommand(message)
  const current = await defaultRepository.findOwned({ userId })
  const projected = command.active && command.hasChanges
    ? applyPreferenceChangesToProfile(current, command.changes)
    : current
  return {
    profile: sanitizePreferenceProfile(projected || {}),
    update: command.active ? command : null,
    changes: command.active && command.hasChanges ? command.changes : null,
  }
}

export async function commitUserPreferenceChanges({ userId, changes, session }) {
  if (!changes) return defaultRepository.findOwned({ userId, session })
  return defaultRepository.applyOwned({ userId, changes, session })
}

export function createUserPreferenceService(repository = mongoRepository()) {
  return async function processUserPreferenceMessage({ userId, message }) {
    const command = extractPreferenceCommand(message)
    let profile
    if (command.active && command.hasChanges) {
      profile = await repository.applyOwned({ userId, changes: command.changes })
    } else {
      profile = await repository.findOwned({ userId })
    }
    return {
      profile: sanitizePreferenceProfile(profile || {}),
      update: command.active ? command : null,
    }
  }
}

export const processUserPreferenceMessage = createUserPreferenceService()

export { normalizeText }
