const test = require('node:test');
const assert = require('node:assert/strict');

const { buildGeminiClientOptions } = require('../src/config/gemini');
const {
  providerCapabilitySnapshot,
  resetProviderHealth,
} = require('../src/services/providerHealthService');

const ORIGINAL_ENV = {
  GEMINI_PROVIDER_MODE: process.env.GEMINI_PROVIDER_MODE,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  SHOPAIKEY_API_KEY: process.env.SHOPAIKEY_API_KEY,
};

test.after(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetProviderHealth();
});

test('google mode keeps the Google API key and default endpoint', () => {
  const options = buildGeminiClientOptions({
    GEMINI_PROVIDER_MODE: 'google',
    GEMINI_API_KEY: 'google-test-key',
    SHOPAIKEY_API_KEY: 'ignored-shopaikey-key',
    SHOPAIKEY_GEMINI_BASE_URL: 'https://api.shopaikey.test',
  });

  assert.deepEqual(options, { apiKey: 'google-test-key' });
});

test('shopaikey mode uses the ShopAIKey key and Gemini base URL', () => {
  const options = buildGeminiClientOptions({
    GEMINI_PROVIDER_MODE: 'shopaikey',
    GEMINI_API_KEY: 'ignored-google-key',
    SHOPAIKEY_API_KEY: 'shopaikey-test-key',
    SHOPAIKEY_GEMINI_BASE_URL: 'https://api.shopaikey.com',
  });

  assert.deepEqual(options, {
    apiKey: 'shopaikey-test-key',
    httpOptions: { baseUrl: 'https://api.shopaikey.com' },
  });
});

test('provider health treats the selected ShopAIKey key as configured', () => {
  process.env.GEMINI_PROVIDER_MODE = 'shopaikey';
  delete process.env.GEMINI_API_KEY;
  process.env.SHOPAIKEY_API_KEY = 'shopaikey-test-key';
  resetProviderHealth();

  assert.equal(providerCapabilitySnapshot().status, 'configured');
});
