import mongoose from 'mongoose'
import Booking from '../models/Booking.js'
import PaymentAttempt from '../models/PaymentAttempt.js'

const TIME_ZONE = 'Asia/Ho_Chi_Minh'
const ACTIVE_TRIP_STATUSES = ['pending_payment', 'paid']

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueIds(values = []) {
  return [...new Set(values.map(String).filter((value) => mongoose.isValidObjectId(value)))]
}

function localParts(now = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now).map((part) => [part.type, part.value])
  )
}

function isoDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day))
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function addDays(iso, amount) {
  const [year, month, day] = iso.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day + amount))
  return isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
}

function vietnamDayRange(iso) {
  return {
    start: new Date(`${iso}T00:00:00+07:00`),
    end: new Date(`${addDays(iso, 1)}T00:00:00+07:00`),
  }
}

function vietnamMonthRange(year, month) {
  const next = new Date(Date.UTC(year, month, 1))
  return {
    start: new Date(`${isoDate(year, month, 1)}T00:00:00+07:00`),
    end: new Date(`${isoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, 1)}T00:00:00+07:00`),
  }
}

function bookingTimeFilter(message, now = new Date()) {
  const normalized = normalizeText(message)
  const parts = localParts(now)
  const today = isoDate(Number(parts.year), Number(parts.month), Number(parts.day))
  const bookingTimePhrase = /(?:dat|booking|don).{0,18}(?:hom qua|hom nay|thang nay)|(?:hom qua|hom nay|thang nay).{0,18}(?:dat|booking|don)/.test(normalized)
  const asksDeparture = !bookingTimePhrase && /sap di|khoi hanh|di luc|bat dau|thang sau.*(?:tour|di)|tour nao.*thang sau/.test(normalized)

  if (normalized.includes('hom qua')) {
    const range = vietnamDayRange(addDays(today, -1))
    return { field: asksDeparture ? 'departureDate' : 'createdAt', ...range, label: 'hôm qua' }
  }
  if (normalized.includes('hom nay')) {
    const range = vietnamDayRange(today)
    return { field: asksDeparture ? 'departureDate' : 'createdAt', ...range, label: 'hôm nay' }
  }
  if (normalized.includes('thang sau')) {
    const next = new Date(Date.UTC(Number(parts.year), Number(parts.month), 1))
    return {
      field: 'departureDate',
      ...vietnamMonthRange(next.getUTCFullYear(), next.getUTCMonth() + 1),
      label: 'tháng sau',
    }
  }
  if (normalized.includes('thang nay')) {
    return {
      field: asksDeparture ? 'departureDate' : 'createdAt',
      ...vietnamMonthRange(Number(parts.year), Number(parts.month)),
      label: 'tháng này',
    }
  }
  if (/sap di|gan nhat.*(?:di|khoi hanh)|tour.*ke tiep/.test(normalized)) {
    return { field: 'departureDate', start: now, end: null, label: 'sắp tới' }
  }
  return null
}

function ordinalFromMessage(message) {
  const normalized = normalizeText(message)
  const numeric = normalized.match(/(?:don|booking)\s*(?:thu\s*)?(\d{1,2})\b/)
  if (numeric) return Number(numeric[1])
  const words = { 'dau tien': 1, mot: 1, hai: 2, ba: 3 }
  for (const [word, value] of Object.entries(words)) {
    if (new RegExp(`(?:don|booking)\\s*(?:thu\\s*)?${word}\\b`).test(normalized)) return value
  }
  return null
}

function hasCancelIntent(normalized) {
  const commandText = normalized.replace(/\b(?:chinh sach huy|phi huy|dieu kien huy)\b/g, ' ')
  return /(?:^|\s)(?:huy|cancel)(?=\s|$)/.test(commandText)
}

function parseBookingRequest(message, now = new Date(), { trustedBookingContext = false } = {}) {
  const normalized = normalizeText(message)
  const explicitCode = message.match(/\bVV-[A-Z0-9-]{6,40}\b/i)?.[0]?.toUpperCase() || null
  const explicitId = message.match(/\b[0-9a-fA-F]{24}\b/)?.[0] || null
  const rawActionType = hasCancelIntent(normalized)
    ? 'cancel'
    : /doi.*(?:ngay|lich|khoi hanh)/.test(normalized)
      ? 'change_departure'
      : /doi.*(?:hanh khach|nguoi|khach)/.test(normalized)
        ? 'change_passengers'
        : /hoan tien|refund/.test(normalized)
          ? 'refund'
          : /(?:thanh toan|tra tien).*(?:giup|ho|luon)|(?:giup|ho).*(?:thanh toan|tra tien)/.test(normalized)
            ? 'pay'
            : /(?:ap dung|apply).*(?:voucher|ma giam)/.test(normalized)
              ? 'apply_voucher'
              : null
  const explicitDomainEvidence = Boolean(
    explicitCode || explicitId ||
    /\b(?:booking|don dat|ma don|dat tour|tour da dat|chuyen da dat|thanh toan|payment|giao dich|voucher|hoan tien|refund)\b/.test(normalized)
  )
  const actionType = rawActionType && (explicitDomainEvidence || trustedBookingContext) ? rawActionType : null
  const paymentRead = /thanh toan (?:chua|roi|thanh cong)|trang thai (?:payment|thanh toan)|payment|giao dich|phuong thuc thanh toan|thanh toan bang gi|bao nhieu tien (?:phai tra|con lai)|con bao nhieu tien|tien phai tra|con lai bao nhieu/.test(normalized)
  const upcomingList = /thang sau.*(?:tour|don)|(?:tour|don).*thang sau|tour.*sap di|sap toi.*tour|toi co tour nao/.test(normalized)
  const listRequest = upcomingList || /cac don|danh sach.*(?:don|booking)|nhung booking|toi co.*booking|(?:booking|don).*(?:hom qua|hom nay|thang nay)|(?:hom qua|hom nay|thang nay).*(?:booking|don)/.test(normalized)
  const domain = Boolean(
    actionType || paymentRead || explicitCode || explicitId ||
    /booking|don (?:dat|gan nhat|nay|do|thu)|tour toi (?:dat|sap di)|ma don|trang thai don|ngay khoi hanh|so (?:khach|hanh khach)|tong tien/.test(normalized) ||
    upcomingList
  )

  return {
    active: domain,
    requestType: actionType ? 'guidance_action' : paymentRead ? 'payment_status' : listRequest ? 'booking_list' : 'booking_detail',
    actionType,
    explicitCode,
    explicitId,
    ordinal: ordinalFromMessage(message),
    timeFilter: bookingTimeFilter(message, now),
    wantsLatest: /gan nhat|vua dat|moi nhat/.test(normalized),
    referencesCurrent: /booking nay|don nay|don do|booking do/.test(normalized),
    wantsUpcoming: upcomingList || /sap di|sap toi|khoi hanh gan nhat/.test(normalized),
    evidence: {
      strength: explicitDomainEvidence ? 'explicit' : trustedBookingContext ? 'trusted_context' : 'none',
      explicitDomainEvidence,
      trustedBookingContext,
    },
  }
}

function idsFromStructuredContent(content) {
  if (!content || typeof content !== 'object') return []
  return uniqueIds([
    content.bookingId,
    ...(Array.isArray(content.bookings) ? content.bookings.map((booking) => booking?.bookingId) : []),
  ])
}

function collectBookingMemory(history = [], entityState = {}) {
  const next = { ...entityState }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index] || {}
    const referenced = uniqueIds(item.referencedBookingIds || [])
    const structured = idsFromStructuredContent(item.structuredContent)
    if (!next.lastReferencedBookingIds?.length && referenced.length) next.lastReferencedBookingIds = referenced
    if (!next.lastListedBookingIds?.length && structured.length > 1) next.lastListedBookingIds = structured
    if (!next.lastReferencedBookingIds?.length && structured.length === 1) next.lastReferencedBookingIds = structured
    if (next.lastReferencedBookingIds?.length && next.lastListedBookingIds?.length) break
  }
  next.recentBookingIds = uniqueIds([
    ...(next.lastReferencedBookingIds || []),
    ...(next.lastListedBookingIds || []),
    ...(next.recentBookingIds || []),
  ]).slice(0, 12)
  return next
}

function paymentSnapshot(booking, attempt = null) {
  const paid = ['paid', 'completed'].includes(booking.status) || Boolean(booking.paidAt)
  const payable = booking.status === 'pending_payment'
  return {
    bookingStatus: booking.status,
    paid,
    payable,
    amountPaid: paid ? Number(booking.totalPrice) : 0,
    amountDue: payable ? Number(booking.totalPrice) : 0,
    paymentMethod: booking.paymentMethod || null,
    paidAt: booking.paidAt || null,
    paymentExpiresAt: booking.paymentExpiresAt || null,
    latestAttempt: attempt ? {
      attemptId: String(attempt._id),
      provider: attempt.provider,
      status: attempt.status,
      amount: Number(attempt.amount),
      responseCode: attempt.responseCode || '',
      processedAt: attempt.processedAt || null,
      expiresAt: attempt.expiresAt || null,
      createdAt: attempt.createdAt || null,
    } : null,
  }
}

function sanitizeBooking(booking, attempt = null) {
  const tour = booking.tour && typeof booking.tour === 'object' ? booking.tour : null
  const departure = tour?.departures?.find((item) => String(item._id) === String(booking.departureId)) || null
  return {
    bookingId: String(booking._id),
    bookingCode: booking.bookingCode,
    tourId: String(tour?._id || booking.tour || ''),
    tourName: booking.tourName,
    tourSlug: tour?.slug || '',
    tourLocation: tour?.location || '',
    tourDays: Number(tour?.days || 0),
    departureId: booking.departureId ? String(booking.departureId) : null,
    departureDate: booking.departureDate,
    departure: departure ? {
      date: departure.date,
      price: Number(departure.price),
      availableSlots: Number(departure.availableSlots),
      totalSlots: Number(departure.totalSlots),
    } : null,
    guests: Number(booking.guests),
    unitPrice: Number(booking.unitPrice),
    originalPrice: Number(booking.originalPrice || booking.unitPrice * booking.guests),
    discountAmount: Number(booking.discountAmount || 0),
    totalPrice: Number(booking.totalPrice),
    status: booking.status,
    payment: paymentSnapshot(booking, attempt),
    cancellationPolicy: tour?.cancellationPolicy || '',
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    detailPath: `/bookings/${booking._id}`,
    paymentPath: booking.status === 'pending_payment' ? `/payment?bookingId=${booking._id}` : null,
  }
}

function buildMongoRepository() {
  const populate = {
    path: 'tour',
    select: 'name slug location days cancellationPolicy departures',
  }
  return {
    async findOwnedByIdentifier({ userId, id, code }) {
      const identifier = id && mongoose.isValidObjectId(id) ? { _id: id } : code ? { bookingCode: code } : null
      if (!identifier) return null
      return Booking.findOne({ ...identifier, user: userId }).populate(populate).lean()
    },
    async findOwned({ userId, query = {}, sort = { createdAt: -1 }, limit = 20 }) {
      return Booking.find({ user: userId, ...query }).sort(sort).limit(limit).populate(populate).lean()
    },
    async findOwnedByIds({ userId, ids }) {
      if (!ids.length) return []
      return Booking.find({ _id: { $in: ids }, user: userId }).populate(populate).lean()
    },
    async findLatestAttempts({ userId, bookingIds }) {
      if (!bookingIds.length) return []
      return PaymentAttempt.find({ user: userId, booking: { $in: bookingIds } })
        .sort({ createdAt: -1 })
        .select('_id booking provider status amount responseCode processedAt expiresAt createdAt')
        .lean()
    },
    async findOwnedByTourName({ userId, normalizedName }) {
      if (!normalizedName) return []
      const terms = normalizedName.split(/[^a-z0-9]+/).filter((word) => word.length >= 3)
      if (!terms.length) return []
      const regex = new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
      return Booking.find({ user: userId, tourName: regex })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate(populate)
        .lean()
    },
  }
}

function queryForRequest(request, now) {
  const query = {}
  let sort = request.wantsUpcoming ? { departureDate: 1 } : { createdAt: -1 }
  if (request.timeFilter) {
    const { field, start, end } = request.timeFilter
    query[field] = { $gte: start, ...(end ? { $lt: end } : {}) }
    if (field === 'departureDate') {
      query.status = { $in: ACTIVE_TRIP_STATUSES }
      sort = { departureDate: 1 }
    }
  } else if (request.wantsUpcoming) {
    query.departureDate = { $gte: now }
    query.status = { $in: ACTIVE_TRIP_STATUSES }
    sort = { departureDate: 1 }
  }
  return { query, sort }
}

export function createAiBookingReadService(repository = buildMongoRepository()) {
  return async function buildOwnedBookingContext({
    userId,
    message,
    rawPageBookingId = null,
    conversationBookingId = null,
    entityState = {},
    history = [],
    now = new Date(),
  }) {
    const memory = collectBookingMemory(history, entityState)
    const request = parseBookingRequest(message, now, {
      trustedBookingContext: Boolean(rawPageBookingId || conversationBookingId),
    })
    if (!request.active) return { active: false }
    let selected = []
    let ownedPageBooking = null

    if (rawPageBookingId && mongoose.isValidObjectId(rawPageBookingId)) {
      ownedPageBooking = await repository.findOwnedByIdentifier({ userId, id: rawPageBookingId })
    }

    if (request.explicitId || request.explicitCode) {
      const exact = await repository.findOwnedByIdentifier({
        userId,
        id: request.explicitId,
        code: request.explicitCode,
      })
      if (!exact) {
        return {
          active: true,
          requestType: request.requestType,
          notFound: true,
          reason: 'BOOKING_NOT_FOUND',
          ownedPageBookingId: ownedPageBooking ? String(ownedPageBooking._id) : null,
          entityState: memory,
          bookings: [],
          allowedBookingIds: [],
        }
      }
      selected = [exact]
    } else if (request.ordinal) {
      const listedIds = uniqueIds(memory.lastListedBookingIds || [])
      const selectedId = listedIds[request.ordinal - 1]
      if (!selectedId) {
        return {
          active: true,
          requestType: request.requestType,
          needsClarification: true,
          reason: 'BOOKING_ORDINAL_NOT_FOUND',
          ownedPageBookingId: ownedPageBooking ? String(ownedPageBooking._id) : null,
          entityState: memory,
          bookings: [],
          allowedBookingIds: [],
        }
      }
      selected = await repository.findOwnedByIds({ userId, ids: [selectedId] })
    } else if (ownedPageBooking && ['booking_detail', 'payment_status', 'guidance_action'].includes(request.requestType)) {
      selected = [ownedPageBooking]
    } else if (rawPageBookingId && request.referencesCurrent) {
      return {
        active: true,
        requestType: request.requestType,
        notFound: true,
        reason: 'BOOKING_NOT_FOUND',
        ownedPageBookingId: null,
        entityState: memory,
        bookings: [],
        allowedBookingIds: [],
      }
    } else if (conversationBookingId && mongoose.isValidObjectId(conversationBookingId)) {
      selected = await repository.findOwnedByIds({ userId, ids: [conversationBookingId] })
      if (!selected.length) {
        return {
          active: true,
          requestType: request.requestType,
          notFound: true,
          reason: 'BOOKING_NOT_FOUND',
          ownedPageBookingId: ownedPageBooking ? String(ownedPageBooking._id) : null,
          entityState: memory,
          bookings: [],
          allowedBookingIds: [],
        }
      }
    } else if (request.referencesCurrent) {
      const recentReferenced = uniqueIds(memory.lastReferencedBookingIds || [])
      if (recentReferenced.length === 1) selected = await repository.findOwnedByIds({ userId, ids: recentReferenced })
      else if (recentReferenced.length > 1 || memory.lastListedBookingIds?.length > 1) {
        const candidates = await repository.findOwnedByIds({
          userId,
          ids: recentReferenced.length ? recentReferenced : memory.lastListedBookingIds,
        })
        return {
          active: true,
          requestType: request.requestType,
          needsClarification: true,
          reason: 'BOOKING_AMBIGUOUS',
          ownedPageBookingId: ownedPageBooking ? String(ownedPageBooking._id) : null,
          entityState: memory,
          bookings: candidates.map((booking) => sanitizeBooking(booking)),
          allowedBookingIds: candidates.map((booking) => String(booking._id)),
        }
      }
    }

    if (!selected.length && !request.wantsLatest && !request.timeFilter && !request.wantsUpcoming) {
      const normalizedMessage = normalizeText(message)
      const stopWords = new Set(['booking', 'don', 'tour', 'toi', 'cua', 'nay', 'do', 'gan', 'nhat', 'thanh', 'toan', 'chua', 'trang', 'thai', 'ma', 'chi', 'tiet', 'bao', 'nhieu', 'tien', 'khach', 'ngay', 'khoi', 'hanh', 'khi', 'nao', 'luc', 'may', 'gio', 'giup', 'huy'])
      const nameTerms = normalizedMessage.split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !stopWords.has(word))
      if (nameTerms.length) {
        const named = await repository.findOwnedByTourName({ userId, normalizedName: nameTerms.join(' ') })
        if (named.length === 1) selected = named
        else if (named.length > 1) {
          return {
            active: true,
            requestType: request.requestType,
            needsClarification: true,
            reason: 'BOOKING_AMBIGUOUS',
            ownedPageBookingId: ownedPageBooking ? String(ownedPageBooking._id) : null,
            entityState: memory,
            bookings: named.map((booking) => sanitizeBooking(booking)),
            allowedBookingIds: named.map((booking) => String(booking._id)),
          }
        }
      }
    }

    if (!selected.length) {
      const { query, sort } = queryForRequest(request, now)
      const limit = request.requestType === 'booking_list' ? 5 : 5
      const matches = await repository.findOwned({ userId, query, sort, limit })
      if (request.requestType === 'booking_list') selected = matches
      else if (request.wantsLatest || request.timeFilter || request.wantsUpcoming || request.requestType === 'payment_status' || request.requestType === 'guidance_action') {
        selected = matches.slice(0, 1)
      } else if (matches.length === 1) selected = matches
      else if (matches.length > 1) {
        return {
          active: true,
          requestType: request.requestType,
          needsClarification: true,
          reason: 'BOOKING_AMBIGUOUS',
          ownedPageBookingId: ownedPageBooking ? String(ownedPageBooking._id) : null,
          entityState: memory,
          bookings: matches.map((booking) => sanitizeBooking(booking)),
          allowedBookingIds: matches.map((booking) => String(booking._id)),
        }
      }
    }

    if (!selected.length) {
      return {
        active: true,
        requestType: request.requestType,
        notFound: true,
        reason: 'BOOKING_NOT_FOUND',
        ownedPageBookingId: ownedPageBooking ? String(ownedPageBooking._id) : null,
        entityState: memory,
        bookings: [],
        allowedBookingIds: [],
      }
    }

    const selectedIds = selected.map((booking) => String(booking._id))
    const attempts = await repository.findLatestAttempts({ userId, bookingIds: selectedIds })
    const latestByBooking = new Map()
    for (const attempt of attempts) {
      const bookingId = String(attempt.booking)
      if (!latestByBooking.has(bookingId)) latestByBooking.set(bookingId, attempt)
    }
    const bookings = selected.map((booking) => sanitizeBooking(booking, latestByBooking.get(String(booking._id))))
    return {
      active: true,
      requestType: request.requestType,
      actionType: request.actionType,
      evidence: request.evidence,
      timeLabel: request.timeFilter?.label || null,
      ownedPageBookingId: ownedPageBooking ? String(ownedPageBooking._id) : null,
      entityState: memory,
      bookings,
      resolvedBookingIds: request.requestType === 'booking_list' ? [] : selectedIds,
      listedBookingIds: request.requestType === 'booking_list' ? selectedIds : [],
      allowedBookingIds: selectedIds,
    }
  }
}

export const buildOwnedBookingContext = createAiBookingReadService()

export {
  TIME_ZONE,
  normalizeText,
  parseBookingRequest,
  bookingTimeFilter,
  collectBookingMemory,
  sanitizeBooking,
}
