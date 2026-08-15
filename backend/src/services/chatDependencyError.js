import { AI_ERROR_CODES, AiGatewayError } from './aiResponseContract.js'

function isDatabaseError(error) {
  return error?.name === 'MongoServerError'
    || error?.name === 'MongoNetworkError'
    || error?.name === 'MongooseError'
    || error?.name === 'MongooseServerSelectionError'
}

export function toChatDependencyError(error, {
  source = 'backend',
  fallbackCode = null,
} = {}) {
  if (error instanceof AiGatewayError) return error
  const databaseFailure = isDatabaseError(error)
  const code = databaseFailure ? AI_ERROR_CODES.DB_ERROR : fallbackCode
  if (!code) return null
  return new AiGatewayError(code, error?.message || code, {
    status: databaseFailure ? 503 : 502,
    retryable: true,
    source,
  })
}

export { isDatabaseError }
