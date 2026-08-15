import { createHmac } from 'node:crypto'
import {
  AI_CHAT_CONTRACT_VERSION,
  AiGatewayError,
  AiResponseInvalidError,
  AiUnavailableError,
  aiGatewayErrorFromResponse,
  serviceStatusFromResponse,
  validateAiChatResponse,
} from './aiResponseContract.js'

export { AiGatewayError, AiResponseInvalidError, AiUnavailableError }

const TIMEOUT_MS = 45_000

export function trustedAiPrincipal(userId, secret) {
  const identity = String(userId || '').trim()
  const key = String(secret || '')
  if (!identity || !key) throw new AiUnavailableError('Missing trusted AI principal inputs')
  return createHmac('sha256', key).update(identity).digest('hex')
}

export async function sinhTraLoi({
  userId,
  message,
  userName,
  tourContext,
  pageContext = null,
  constraintState = {},
  entityState = {},
  history = [],
  bookingContext = null,
  preferenceContext = null,
  traceContext = null,
}) {
  const url = String(process.env.AI_SERVICE_URL || '').trim()
  if (!url) throw new AiUnavailableError('AI_SERVICE_URL is not configured')

  const apiKey = String(process.env.AI_SERVICE_API_KEY || '')
  const principal = trustedAiPrincipal(userId, apiKey)
  let timeout
  try {
    const controller = new AbortController()
    timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const response = await fetch(`${url.replace(/\/$/, '')}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': apiKey,
        'x-ai-principal-id': principal,
        'x-ai-contract-version': String(AI_CHAT_CONTRACT_VERSION),
      },
      body: JSON.stringify({
        contractVersion: AI_CHAT_CONTRACT_VERSION,
        prompt: message,
        userName,
        tourContext,
        pageContext,
        constraintState,
        entityState,
        history,
        bookingContext,
        preferenceContext,
        traceContext,
      }),
      signal: controller.signal,
    })

    let data
    try {
      data = await response.json()
    } catch (error) {
      throw new AiResponseInvalidError(`Invalid JSON: ${error.message}`)
    }
    if (!response.ok) throw aiGatewayErrorFromResponse(response.status, data)

    const validated = validateAiChatResponse(data)
    return {
      contractVersion: validated.contractVersion,
      reply: validated.reply,
      suggestedTours: validated.tours.slice(0, 3).map((tour) => ({
        _id: tour._id || tour.tourId,
        title: String(tour.title || tour.name || ''),
        price: Number(tour.price ?? tour.basePrice) || 0,
        image: String(tour.image || tour.images?.[0] || ''),
        ...(tour.priceBasis && typeof tour.priceBasis === 'object' ? { priceBasis: tour.priceBasis } : {}),
        ...(tour.departure && typeof tour.departure === 'object' ? { departure: tour.departure } : {}),
        ...(tour.availability && typeof tour.availability === 'object' ? { availability: tour.availability } : {}),
      })),
      intent: validated.intent && typeof validated.intent === 'object' ? validated.intent : {},
      decision: validated.decision,
      constraintState: validated.constraintState,
      entityState: validated.entityState,
      referencedTourIds: validated.referencedTourIds,
      referencedBookingIds: validated.referencedBookingIds,
      structuredContent: validated.structuredContent,
      retrievalStatus: validated.retrievalStatus,
      providerStatus: validated.providerStatus,
      outcome: validated.outcome,
      warnings: validated.warnings,
      serviceStatus: serviceStatusFromResponse(validated),
      observability: validated.observability,
    }
  } catch (error) {
    if (error instanceof AiGatewayError) throw error
    throw new AiUnavailableError(error.message)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
