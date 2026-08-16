const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVIDER_FAILURE_CLASSES,
  classifyProviderError,
  executeProviderRequest,
} = require('../src/services/providerReliabilityService');
const { generateChatReply } = require('../src/config/gemini');
const { ERROR_CODES, providerError: normalizeProviderError } = require('../src/services/aiContractService');

function quotaError() {
  const error = new Error('Resource exhausted');
  error.name = 'ApiError';
  error.status = 429;
  error.error = {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
          quotaDimensions: { model: 'gemini-3.5-flash', location: 'global' },
          quotaValue: '20',
        }],
      },
      {
        '@type': 'type.googleapis.com/google.rpc.RetryInfo',
        retryDelay: '47s',
      },
    ],
  };
  return error;
}

function providerError(status, extras = {}) {
  return Object.assign(new Error(`provider ${status}`), { status, ...extras });
}

test('daily quota 429 is classified exactly and never retried', async () => {
  const classified = classifyProviderError(quotaError());
  assert.equal(classified.failureClass, PROVIDER_FAILURE_CLASSES.QUOTA_EXHAUSTED);
  assert.equal(classified.retryable, false);
  assert.equal(classified.httpStatus, 429);
  assert.equal(classified.providerStatus, 'RESOURCE_EXHAUSTED');
  assert.equal(classified.retryAfterMs, 47_000);
  assert.equal(classified.quotaMetric, 'generativelanguage.googleapis.com/generate_content_free_tier_requests');
  assert.equal(classified.quotaId, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  assert.equal(classified.quotaLocation, 'global');
  assert.equal(classified.quotaValue, '20');

  let attempts = 0;
  await assert.rejects(
    executeProviderRequest({
      request: async () => {
        attempts += 1;
        throw quotaError();
      },
      maxAttempts: 3,
      totalTimeoutMs: 60_000,
      sleep: async () => assert.fail('quota-exhausted request must not sleep or retry'),
    }),
    (error) => error.providerMeta?.failureClass === PROVIDER_FAILURE_CLASSES.QUOTA_EXHAUSTED
      && error.providerMeta?.attemptCount === 1
      && error.providerMeta?.providerAttempted === true
      && error.providerMeta?.providerSucceeded === false
  );
  assert.equal(attempts, 1);
});

test('daily quota wins when a temporary quota violation appears first', async () => {
  const error = quotaError();
  const quotaFailure = error.error.details.find((detail) => detail['@type'].endsWith('QuotaFailure'));
  quotaFailure.violations.unshift({
    quotaMetric: 'generativelanguage.googleapis.com/generate_content_requests',
    quotaId: 'GenerateRequestsPerMinutePerProjectPerModel',
    quotaDimensions: { model: 'gemini-3.5-flash', location: 'global' },
    quotaValue: '10',
  });

  const classified = classifyProviderError(error);
  assert.equal(classified.failureClass, PROVIDER_FAILURE_CLASSES.QUOTA_EXHAUSTED);
  assert.equal(classified.retryable, false);
  assert.equal(classified.quotaId, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  assert.equal(classified.quotaValue, '20');

  let attempts = 0;
  await assert.rejects(
    executeProviderRequest({
      request: async () => {
        attempts += 1;
        throw error;
      },
      maxAttempts: 2,
      totalTimeoutMs: 60_000,
      sleep: async () => assert.fail('mixed quota evidence with a daily limit must not retry'),
    }),
    (caught) => caught.providerMeta?.failureClass === PROVIDER_FAILURE_CLASSES.QUOTA_EXHAUSTED
      && caught.providerMeta?.attemptCount === 1
  );
  assert.equal(attempts, 1);
});

test('temporary 429 respects provider delay and succeeds on the bounded retry', async () => {
  let attempts = 0;
  const delays = [];
  const result = await executeProviderRequest({
    request: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw providerError(429, {
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [{
              '@type': 'type.googleapis.com/google.rpc.RetryInfo',
              retryDelay: '0.05s',
            }],
          },
        });
      }
      return { text: 'ok' };
    },
    maxAttempts: 2,
    totalTimeoutMs: 2_000,
    jitterRatio: 0,
    sleep: async (delay) => delays.push(delay),
  });

  assert.equal(attempts, 2);
  assert.deepEqual(delays, [50]);
  assert.equal(result.providerMeta.attemptCount, 2);
  assert.equal(result.providerMeta.retryCount, 1);
  assert.equal(result.providerMeta.providerSucceeded, true);
});

test('temporary 429 also respects HTTP Retry-After and does not wait past the total deadline', async () => {
  let attempts = 0;
  const delays = [];
  const result = await executeProviderRequest({
    request: async () => {
      attempts += 1;
      if (attempts === 1) throw providerError(429, { headers: { 'Retry-After': '0.05' } });
      return { text: 'ok' };
    },
    maxAttempts: 2,
    totalTimeoutMs: 2_000,
    jitterRatio: 0,
    sleep: async (delay) => delays.push(delay),
  });
  assert.equal(result.providerMeta.attemptCount, 2);
  assert.deepEqual(delays, [50]);

  let longDelayAttempts = 0;
  await assert.rejects(
    executeProviderRequest({
      request: async () => {
        longDelayAttempts += 1;
        throw providerError(429, { headers: { 'Retry-After': '47' } });
      },
      maxAttempts: 2,
      totalTimeoutMs: 1_000,
      jitterRatio: 0,
      sleep: async () => assert.fail('deadline-bounded retry must not sleep'),
    }),
    (error) => error.providerMeta?.failureClass === PROVIDER_FAILURE_CLASSES.RATE_LIMIT_TEMPORARY
      && error.providerMeta?.retryStoppedReason === 'deadline'
      && error.providerMeta?.attemptCount === 1
  );
  assert.equal(longDelayAttempts, 1);
});

test('503 retries once then succeeds with exponential policy metadata', async () => {
  let attempts = 0;
  const delays = [];
  const result = await executeProviderRequest({
    request: async () => {
      attempts += 1;
      if (attempts === 1) throw providerError(503);
      return { text: 'ok' };
    },
    maxAttempts: 2,
    totalTimeoutMs: 2_000,
    baseDelayMs: 25,
    jitterRatio: 0,
    sleep: async (delay) => delays.push(delay),
  });

  assert.equal(attempts, 2);
  assert.deepEqual(delays, [25]);
  assert.equal(result.providerMeta.attemptCount, 2);
  assert.equal(result.providerMeta.retryCount, 1);
});

test('exponential retry applies injectable jitter without changing the attempt bound', async () => {
  let attempts = 0;
  const delays = [];
  await executeProviderRequest({
    request: async () => {
      attempts += 1;
      if (attempts === 1) throw providerError(503);
      return { text: 'ok' };
    },
    maxAttempts: 2,
    totalTimeoutMs: 2_000,
    baseDelayMs: 100,
    jitterRatio: 0.2,
    random: () => 1,
    sleep: async (delay) => delays.push(delay),
  });
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [120]);
});

test('repeated 503 stops at max attempts without an extra call', async () => {
  let attempts = 0;
  const delays = [];
  await assert.rejects(
    executeProviderRequest({
      request: async () => {
        attempts += 1;
        throw providerError(503);
      },
      maxAttempts: 3,
      totalTimeoutMs: 2_000,
      baseDelayMs: 20,
      jitterRatio: 0,
      sleep: async (delay) => delays.push(delay),
    }),
    (error) => error.providerMeta?.failureClass === PROVIDER_FAILURE_CLASSES.CAPACITY_5XX
      && error.providerMeta?.attemptCount === 3
      && error.providerMeta?.retryCount === 2
  );
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [20, 40]);
});

test('timeout aborts the active request and returns bounded timeout metadata', async () => {
  let activeSignal = null;
  let attempts = 0;
  await assert.rejects(
    executeProviderRequest({
      request: ({ signal }) => {
        attempts += 1;
        activeSignal = signal;
        return new Promise(() => {});
      },
      maxAttempts: 2,
      totalTimeoutMs: 40,
      attemptTimeoutMs: 10,
      sleep: async () => assert.fail('application timeout must not start a duplicate provider attempt'),
    }),
    (error) => error.code === 'GEMINI_TIMEOUT'
      && error.providerMeta?.failureClass === PROVIDER_FAILURE_CLASSES.NETWORK_TIMEOUT
      && error.providerMeta?.attemptCount === 1
      && error.providerMeta?.retryable === false
  );
  assert.equal(activeSignal?.aborted, true);
  assert.equal(attempts, 1);
});

test('provider timeout codes never start a duplicate attempt', async () => {
  for (const code of ['ETIMEDOUT', 'ECONNABORTED']) {
    let attempts = 0;
    await assert.rejects(
      executeProviderRequest({
        request: async () => {
          attempts += 1;
          throw Object.assign(new Error(`provider timeout ${code}`), { code });
        },
        maxAttempts: 2,
        totalTimeoutMs: 2_000,
        sleep: async () => assert.fail(`${code} must not sleep or retry`),
      }),
      (error) => error.providerMeta?.failureClass === PROVIDER_FAILURE_CLASSES.NETWORK_TIMEOUT
        && error.providerMeta?.retryable === false
        && error.providerMeta?.attemptCount === 1
    );
    assert.equal(attempts, 1);
  }
});

test('non-retryable 4xx performs exactly one provider attempt', async () => {
  let attempts = 0;
  await assert.rejects(
    executeProviderRequest({
      request: async () => {
        attempts += 1;
        throw providerError(400);
      },
      maxAttempts: 3,
      totalTimeoutMs: 2_000,
      sleep: async () => assert.fail('non-retryable 4xx must not sleep'),
    }),
    (error) => error.providerMeta?.failureClass === PROVIDER_FAILURE_CLASSES.OTHER_PROVIDER_FAILURE
      && error.providerMeta?.attemptCount === 1
      && error.providerMeta?.retryCount === 0
  );
  assert.equal(attempts, 1);
});

test('Gemini wrapper passes an AbortSignal and returns provider attempt metadata', async () => {
  const calls = [];
  const client = {
    models: {
      generateContent: async (request) => {
        calls.push(request);
        return { text: 'Grounded response' };
      },
    },
  };

  const result = await generateChatReply('private prompt', 'system', {
    client,
    includeMetadata: true,
    maxAttempts: 2,
    totalTimeoutMs: 1_000,
    jitterRatio: 0,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.systemInstruction, 'system');
  assert.equal(calls[0].config.abortSignal instanceof AbortSignal, true);
  assert.equal(result.text, 'Grounded response');
  assert.equal(result.providerMeta.providerAttempted, true);
  assert.equal(result.providerMeta.providerSucceeded, true);
  assert.equal(result.providerMeta.attemptCount, 1);
});

test('Gemini wrapper aborts the SDK request when its attempt times out', async () => {
  let signal = null;
  const client = {
    models: {
      generateContent: ({ config }) => {
        signal = config.abortSignal;
        return new Promise(() => {});
      },
    },
  };

  await assert.rejects(
    generateChatReply('private prompt', 'system', {
      client,
      includeMetadata: true,
      maxAttempts: 1,
      totalTimeoutMs: 25,
      attemptTimeoutMs: 10,
    }),
    (error) => error.code === 'GEMINI_TIMEOUT'
      && error.providerMeta?.failureClass === PROVIDER_FAILURE_CLASSES.NETWORK_TIMEOUT
  );
  assert.equal(signal?.aborted, true);
});

test('empty provider text is a typed validator rejection with one successful transport attempt', async () => {
  const client = {
    models: {
      generateContent: async () => ({ text: '   ' }),
    },
  };

  await assert.rejects(
    generateChatReply('private prompt', 'system', {
      client,
      includeMetadata: true,
      maxAttempts: 1,
      totalTimeoutMs: 1_000,
    }),
    (error) => error.code === 'GEMINI_EMPTY_RESPONSE'
      && error.providerMeta?.failureClass === PROVIDER_FAILURE_CLASSES.VALIDATOR_REJECTION
      && error.providerMeta?.providerAttempted === true
      && error.providerMeta?.providerSucceeded === true
      && error.providerMeta?.attemptCount === 1
  );
});

test('application error taxonomy keeps quota distinct while mapping retryable provider classes safely', () => {
  const quota = normalizeProviderError(quotaError());
  assert.equal(quota.code, ERROR_CODES.AI_PROVIDER_QUOTA_EXHAUSTED);
  assert.equal(quota.retryable, false);

  const temporary = normalizeProviderError(providerError(429));
  assert.equal(temporary.code, ERROR_CODES.AI_PROVIDER_RATE_LIMITED);
  assert.equal(temporary.retryable, true);

  const capacity = normalizeProviderError(providerError(503));
  assert.equal(capacity.code, ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
  assert.equal(capacity.providerMeta.failureClass, PROVIDER_FAILURE_CLASSES.CAPACITY_5XX);

  const nonRetryable = normalizeProviderError(providerError(400));
  assert.equal(nonRetryable.code, ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
  assert.equal(nonRetryable.retryable, false);
});
