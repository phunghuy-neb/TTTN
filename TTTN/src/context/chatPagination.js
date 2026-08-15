function identity(item, fallbackIndex) {
  return String(item?._id || item?.candidateListId || `fallback:${fallbackIndex}`)
}

function dedupe(items = []) {
  const seen = new Set()
  return items.filter((item, index) => {
    const key = identity(item, index)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizePagination(response = {}, fallbackLimit = 20) {
  const page = Math.max(1, Number(response.page) || 1)
  const limit = Math.max(1, Number(response.limit) || fallbackLimit)
  const total = Math.max(0, Number(response.total) || 0)
  const totalPages = Math.max(0, Number(response.totalPages) || Math.ceil(total / limit))
  return {
    page,
    limit,
    total,
    totalPages,
    hasMore: typeof response.hasMore === 'boolean' ? response.hasMore : page < totalPages,
  }
}

// The API returns newest-first pages; the UI keeps messages oldest-first.
export function mergeMessagePage(current = [], apiMessages = [], { replace = false } = {}) {
  const chronologicalPage = [...apiMessages].reverse()
  return dedupe(replace ? chronologicalPage : [...chronologicalPage, ...current])
}

export function mergeConversationPage(current = [], conversations = [], { replace = false } = {}) {
  return dedupe(replace ? conversations : [...current, ...conversations])
}
