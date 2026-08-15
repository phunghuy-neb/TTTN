const MAX_CANDIDATE_LISTS = 24

function uniqueStrings(values = []) {
  const list = Array.isArray(values) ? values : []
  return [...new Set(list.map(String).filter(Boolean))]
}

export function candidateTourIdsFromStructuredContent(structuredContent) {
  if (!structuredContent || typeof structuredContent !== 'object') return []
  const listIds = Array.isArray(structuredContent.tours)
    ? structuredContent.tours.map((tour) => tour?.tourId || tour?._id)
    : []
  return uniqueStrings(listIds)
}

export function extractVisibleTourIdentity({ suggestedTours = [], referencedTourIds = [], structuredContent = null } = {}) {
  const cardIds = uniqueStrings(suggestedTours.map((tour) => tour?._id || tour?.tourId))
  const structuredIds = candidateTourIdsFromStructuredContent(structuredContent)
  const candidateTourIds = uniqueStrings([...cardIds, ...structuredIds])
  return {
    candidateTourIds,
    referencedTourIds: uniqueStrings([...candidateTourIds, ...referencedTourIds]),
  }
}

export function normalizeCandidateLists(entityState = {}, sanitizeTourIds = uniqueStrings) {
  const lists = Array.isArray(entityState.candidateLists) ? entityState.candidateLists : []
  return lists
    .map((list) => {
      const candidateListId = String(list?.candidateListId || '').trim()
      const tourIds = sanitizeTourIds(list?.tourIds || [])
      if (!candidateListId || !tourIds.length) return null
      return {
        candidateListId,
        createdTurnId: String(list.createdTurnId || ''),
        createdTurnSequence: Number(list.createdTurnSequence || 0),
        historyEpoch: Number(list.historyEpoch || 0),
        source: String(list.source || 'unknown'),
        tourIds,
      }
    })
    .filter(Boolean)
    .slice(-MAX_CANDIDATE_LISTS)
}

export function sanitizeCandidateEntityState(entityState = {}, sanitizeTourIds = uniqueStrings) {
  const next = entityState && typeof entityState === 'object' ? { ...entityState } : {}
  const tourKeys = ['lastSuggestedTourIds', 'lastReferencedTourIds', 'recentTourIds', 'ambiguousTourIds']
  for (const key of tourKeys) {
    const values = sanitizeTourIds(next[key] || [])
    if (values.length) next[key] = values
    else delete next[key]
  }
  const candidateLists = normalizeCandidateLists(next, sanitizeTourIds)
  if (candidateLists.length) next.candidateLists = candidateLists
  else delete next.candidateLists
  const validListIds = new Set(candidateLists.map((list) => list.candidateListId))
  for (const key of ['activeCandidateListId', 'previousCandidateListId', 'selectedCandidateListId']) {
    const value = String(next[key] || '')
    if (validListIds.has(value)) next[key] = value
    else delete next[key]
  }
  for (const key of ['selectedTourId', 'currentTourId']) {
    const value = sanitizeTourIds([next[key]])[0]
    if (value) next[key] = value
    else delete next[key]
  }
  return next
}

export function applyCandidateListLifecycle(entityState = {}, {
  candidateTourIds = [],
  logicalTurnId,
  turnSequence,
  historyEpoch,
  source = 'assistant_result',
  sanitizeTourIds = uniqueStrings,
} = {}) {
  const next = sanitizeCandidateEntityState(entityState, sanitizeTourIds)
  const tourIds = sanitizeTourIds(candidateTourIds)
  if (!tourIds.length) return { entityState: next, candidateList: null }

  const candidateListId = `candidates:${Number(historyEpoch || 0)}:${Number(turnSequence || 0)}:${String(logicalTurnId || '')}`
  const candidateList = {
    candidateListId,
    createdTurnId: String(logicalTurnId || ''),
    createdTurnSequence: Number(turnSequence || 0),
    historyEpoch: Number(historyEpoch || 0),
    source,
    tourIds,
  }
  const lists = normalizeCandidateLists(next, sanitizeTourIds)
    .filter((list) => list.candidateListId !== candidateListId)
  const activeList = lists.find((list) => list.candidateListId === next.activeCandidateListId)
  if (activeList && activeList.tourIds.join('|') === tourIds.join('|')) {
    return {
      candidateList: activeList,
      entityState: {
        ...next,
        lastSuggestedTourIds: tourIds,
        lastReferencedTourIds: tourIds,
        recentTourIds: sanitizeTourIds([...tourIds, ...(next.recentTourIds || [])]).slice(0, 24),
      },
    }
  }
  const previousCandidateListId = next.activeCandidateListId && next.activeCandidateListId !== candidateListId
    ? next.activeCandidateListId
    : next.previousCandidateListId
  const candidateLists = [...lists, candidateList].slice(-MAX_CANDIDATE_LISTS)
  return {
    candidateList,
    entityState: {
      ...next,
      candidateLists,
      activeCandidateListId: candidateListId,
      ...(previousCandidateListId ? { previousCandidateListId } : {}),
      lastSuggestedTourIds: tourIds,
      lastReferencedTourIds: tourIds,
      recentTourIds: sanitizeTourIds([...tourIds, ...(next.recentTourIds || [])]).slice(0, 24),
    },
  }
}

export function buildPaginationMeta(total, page, limit) {
  const safeTotal = Math.max(0, Number(total) || 0)
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.max(1, Number(limit) || 1)
  const totalPages = Math.ceil(safeTotal / safeLimit)
  return {
    total: safeTotal,
    page: safePage,
    limit: safeLimit,
    totalPages,
    hasMore: safePage < totalPages,
  }
}

export function mergeCandidateCards({ tourIds = [], snapshots = [], toursById = new Map() } = {}) {
  const snapshotList = Array.isArray(snapshots) ? snapshots : []
  const snapshotById = new Map(snapshotList.map((tour) => [String(tour?._id || ''), tour]))
  return uniqueStrings(tourIds).map((tourId) => {
    const snapshot = snapshotById.get(tourId)
    const current = toursById.get(tourId)
    if (!snapshot && !current) {
      return { _id: tourId, title: 'Tour không còn khả dụng', price: 0, image: '', unavailable: true }
    }
    return {
      _id: tourId,
      title: String(snapshot?.title || snapshot?.name || current?.name || ''),
      price: Number(snapshot?.price ?? current?.basePrice) || 0,
      image: String(snapshot?.image || current?.images?.[0] || ''),
      ...(snapshot?.priceBasis ? { priceBasis: snapshot.priceBasis } : {}),
      ...(snapshot?.departure ? { departure: snapshot.departure } : {}),
      ...(snapshot?.availability ? { availability: snapshot.availability } : {}),
      unavailable: !current || current.status !== 'published' || current.isActive === false,
    }
  })
}
