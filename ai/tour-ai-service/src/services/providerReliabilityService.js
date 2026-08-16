const PROVIDER_FAILURE_CLASSES = Object.freeze({
  QUOTA_EXHAUSTED: 'PROVIDER_QUOTA_EXHAUSTED',
  RATE_LIMIT_TEMPORARY: 'PROVIDER_RATE_LIMIT_TEMPORARY',
  CAPACITY_5XX: 'PROVIDER_CAPACITY_5XX',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  VALIDATOR_REJECTION: 'VALIDATOR_REJECTION',
  OTHER_PROVIDER_FAILURE: 'OTHER_PROVIDER_FAILURE',
  UNKNOWN: 'UNKNOWN',
});

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
]);

const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJson(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function providerPayload(error) {
  const parsedMessage = parseJson(error?.message);
  const candidates = [
    error?.error,
    error?.response?.data?.error,
    error?.response?.body?.error,
    parsedMessage?.error,
    parsedMessage,
  ];
  return candidates.find((item) => item && typeof item === 'object' && !Array.isArray(item)) || {};
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase());
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found ? found[1] : null;
}

function durationMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value === 'object') {
    const seconds = Number(value.seconds || 0);
    const nanos = Number(value.nanos || 0);
    if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) return null;
    return Math.max(0, Math.round(seconds * 1000 + nanos / 1_000_000));
  }
  const normalized = String(value).trim();
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)(ms|s)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return Math.max(0, Math.round(amount * (String(match[2] || 's').toLowerCase() === 'ms' ? 1 : 1000)));
}

function retryAfterHeaderMs(error) {
  const value = headerValue(error?.headers || error?.response?.headers, 'retry-after');
  if (value == null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function detailList(error, payload) {
  return [payload?.details, error?.details, error?.error?.details]
    .filter(Array.isArray)
    .flat();
}

function detailOfType(details, suffix) {
  return details.find((detail) => String(detail?.['@type'] || detail?.type || '').endsWith(suffix)) || null;
}

function classifyProviderError(error) {
  const payload = providerPayload(error);
  const details = detailList(error, payload);
  const quotaDetail = detailOfType(details, 'google.rpc.QuotaFailure');
  const retryDetail = detailOfType(details, 'google.rpc.RetryInfo');
  const violations = Array.isArray(quotaDetail?.violations) ? quotaDetail.violations : [];
  const dailyViolation = violations.find((item) => {
    const id = String(item?.quotaId || '');
    const metric = String(item?.quotaMetric || '');
    return /(?:perday|daily|requestsperday)/i.test(id)
      || /free_tier_requests/i.test(metric) && /(?:perday|daily)/i.test(`${id} ${error?.message || ''}`);
  }) || null;
  const violation = dailyViolation || violations[0] || null;
  const httpStatus = Number(error?.status || error?.statusCode || payload?.code || error?.response?.status) || null;
  const providerStatus = typeof payload?.status === 'string'
    ? payload.status
    : typeof error?.providerStatus === 'string'
      ? error.providerStatus
      : null;
  const retryAfterMs = durationMs(retryDetail?.retryDelay) ?? retryAfterHeaderMs(error);
  const quotaId = violation?.quotaId ? String(violation.quotaId) : null;
  const quotaMetric = violation?.quotaMetric ? String(violation.quotaMetric) : null;
  const quotaDimensions = violation?.quotaDimensions && typeof violation.quotaDimensions === 'object'
    ? violation.quotaDimensions
    : {};
  const dailyQuota = Boolean(dailyViolation);
  const errorCode = String(error?.code || '').toUpperCase();
  const applicationTimeout = errorCode === 'GEMINI_TIMEOUT'
    || error?.name === 'TimeoutError'
    || TIMEOUT_CODES.has(errorCode);
  const networkFailure = NETWORK_CODES.has(errorCode);

  let failureClass = PROVIDER_FAILURE_CLASSES.UNKNOWN;
  let retryable = false;
  if (applicationTimeout) {
    failureClass = PROVIDER_FAILURE_CLASSES.NETWORK_TIMEOUT;
  } else if (networkFailure) {
    failureClass = PROVIDER_FAILURE_CLASSES.NETWORK_TIMEOUT;
    retryable = true;
  } else if (httpStatus === 429 && dailyQuota) {
    failureClass = PROVIDER_FAILURE_CLASSES.QUOTA_EXHAUSTED;
  } else if (httpStatus === 429) {
    failureClass = PROVIDER_FAILURE_CLASSES.RATE_LIMIT_TEMPORARY;
    retryable = true;
  } else if (httpStatus >= 500 && httpStatus <= 599) {
    failureClass = PROVIDER_FAILURE_CLASSES.CAPACITY_5XX;
    retryable = true;
  } else if (httpStatus >= 400 && httpStatus <= 499) {
    failureClass = PROVIDER_FAILURE_CLASSES.OTHER_PROVIDER_FAILURE;
  } else if (error) {
    failureClass = PROVIDER_FAILURE_CLASSES.OTHER_PROVIDER_FAILURE;
  }

  return {
    failureClass,
    retryable,
    httpStatus,
    providerStatus,
    retryAfterMs,
    quotaMetric,
    quotaId,
    quotaLocation: quotaDimensions.location ? String(quotaDimensions.location) : null,
    quotaModel: quotaDimensions.model ? String(quotaDimensions.model) : null,
    quotaValue: violation?.quotaValue == null ? null : String(violation.quotaValue),
  };
}

function timeoutError(operation) {
  const error = new Error(`${operation} timed out`);
  error.name = 'TimeoutError';
  error.code = 'GEMINI_TIMEOUT';
  return error;
}

async function abortableAttempt(request, timeoutMs, operation) {
  const controller = new AbortController();
  let timer = null;
  let timedOut = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(timeoutError(operation));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => request({ signal: controller.signal, timeoutMs })),
      timeout,
    ]);
  } catch (error) {
    if (timedOut) throw timeoutError(operation);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function failureMetadata(classified, state) {
  return {
    providerAttempted: state.attemptCount > 0,
    providerSucceeded: false,
    attemptCount: state.attemptCount,
    maxAttempts: state.maxAttempts,
    retryCount: state.retryDelaysMs.length,
    retryDelaysMs: [...state.retryDelaysMs],
    failureClass: classified.failureClass,
    retryable: classified.retryable,
    httpStatus: classified.httpStatus,
    providerErrorStatus: classified.providerStatus,
    retryAfterMs: classified.retryAfterMs,
    quotaMetric: classified.quotaMetric,
    quotaId: classified.quotaId,
    quotaLocation: classified.quotaLocation,
    quotaModel: classified.quotaModel,
    quotaValue: classified.quotaValue,
  };
}

function attachProviderMetadata(error, metadata) {
  const target = error instanceof Error ? error : new Error('Provider request failed');
  try {
    target.providerMeta = metadata;
    target.failureClass = metadata.failureClass;
    return target;
  } catch {
    const wrapped = new Error(target.message || 'Provider request failed', { cause: target });
    wrapped.providerMeta = metadata;
    wrapped.failureClass = metadata.failureClass;
    return wrapped;
  }
}

function retryDelayMs(classified, attempt, options) {
  const ratio = Math.max(0, Math.min(1, Number(options.jitterRatio) || 0));
  const random = typeof options.random === 'function' ? options.random : Math.random;
  if (classified.retryAfterMs != null) {
    return Math.max(0, Math.round(classified.retryAfterMs * (1 + ratio * Math.max(0, random()))));
  }
  const base = options.baseDelayMs * (2 ** Math.max(0, attempt - 1));
  const factor = ratio ? 1 - ratio + 2 * ratio * Math.max(0, Math.min(1, random())) : 1;
  return Math.max(0, Math.round(base * factor));
}

async function executeProviderRequest({
  request,
  maxAttempts = 2,
  totalTimeoutMs = 20_000,
  attemptTimeoutMs = null,
  baseDelayMs = 250,
  jitterRatio = 0.2,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  random = Math.random,
  now = Date.now,
  operation = 'Gemini generation',
} = {}) {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  const attemptsLimit = Math.min(5, positiveInteger(maxAttempts, 2));
  const totalBudget = positiveNumber(totalTimeoutMs, 20_000);
  const explicitAttemptBudget = attemptTimeoutMs == null ? null : positiveNumber(attemptTimeoutMs, null);
  const startedAt = now();
  const state = { attemptCount: 0, maxAttempts: attemptsLimit, retryDelaysMs: [] };

  while (state.attemptCount < attemptsLimit) {
    const elapsed = Math.max(0, now() - startedAt);
    const remaining = totalBudget - elapsed;
    if (remaining <= 0) {
      const classified = classifyProviderError(timeoutError(operation));
      throw attachProviderMetadata(timeoutError(operation), failureMetadata(classified, state));
    }
    const attemptsRemaining = attemptsLimit - state.attemptCount;
    const attemptBudget = Math.max(1, Math.min(
      remaining,
      explicitAttemptBudget || Math.floor(remaining / attemptsRemaining)
    ));
    state.attemptCount += 1;

    try {
      const value = await abortableAttempt(
        ({ signal, timeoutMs }) => request({ attempt: state.attemptCount, signal, timeoutMs }),
        attemptBudget,
        operation
      );
      return {
        value,
        providerMeta: {
          providerAttempted: true,
          providerSucceeded: true,
          attemptCount: state.attemptCount,
          maxAttempts: attemptsLimit,
          retryCount: state.retryDelaysMs.length,
          retryDelaysMs: [...state.retryDelaysMs],
          failureClass: null,
        },
      };
    } catch (error) {
      const classified = classifyProviderError(error);
      const metadata = failureMetadata(classified, state);
      if (!classified.retryable || state.attemptCount >= attemptsLimit) {
        throw attachProviderMetadata(error, metadata);
      }

      const delay = retryDelayMs(classified, state.attemptCount, {
        baseDelayMs: positiveNumber(baseDelayMs, 250),
        jitterRatio,
        random,
      });
      const remainingAfterAttempt = totalBudget - Math.max(0, now() - startedAt);
      if (delay >= remainingAfterAttempt) {
        metadata.retryStoppedReason = 'deadline';
        throw attachProviderMetadata(error, metadata);
      }
      state.retryDelaysMs.push(delay);
      await sleep(delay);
    }
  }

  const classified = classifyProviderError(timeoutError(operation));
  throw attachProviderMetadata(timeoutError(operation), failureMetadata(classified, state));
}

module.exports = {
  PROVIDER_FAILURE_CLASSES,
  classifyProviderError,
  executeProviderRequest,
};
