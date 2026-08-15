export function normalizeApiError(data = {}, status = 0, headerRequestId = null) {
  return {
    success: false,
    message: data.message || 'Co loi xay ra.',
    code: data.code || 'REQUEST_ERROR',
    status,
    retryable: Boolean(data.retryable),
    source: data.source || null,
    requestId: data.requestId || headerRequestId || null,
  }
}
