const { GoogleGenAI } = require("@google/genai");
const { OpenAI } = require("openai");
const {
  PROVIDER_FAILURE_CLASSES,
  executeProviderRequest,
} = require("../services/providerReliabilityService");

/**
 * Module dùng chung để gọi Gemini API (và mở rộng hỗ trợ OpenAI/Gorouter).
 *
 * Ghi chú (rút ra từ quá trình triển khai Tuần 2):
 * SDK cũ @google/generative-ai và các model gemini-1.5-flash / gemini-2.5-flash
 * đã ngừng phục vụ người dùng mới nên dự án dùng SDK mới @google/genai.
 * Tên model KHÔNG hard-code mà lấy từ .env (GEMINI_CHAT_MODEL, GEMINI_EMBEDDING_MODEL)
 * để chỉ cần sửa .env khi nhà cung cấp đổi/khai tử model, không phải sửa code.
 */

let googleClient = null;
let openaiClient = null;
let officialOpenAIClient = null;
const DEFAULT_SHOPAIKEY_GEMINI_BASE_URL = "https://api.shopaikey.com";

function positiveTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function withTimeout(value, timeoutMs, operation) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error(`${operation} timed out`);
      error.code = "GEMINI_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  const promise = typeof value === "function"
    ? Promise.resolve().then(() => value(controller.signal))
    : value;
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function resolveProviderConfig(env = process.env) {
  const mode = String(env.GEMINI_PROVIDER_MODE || "google").trim().toLowerCase();
  if (mode === "openai") {
    return {
      mode,
      keyName: "OPENAI_API_KEY",
      apiKey: String(env.OPENAI_API_KEY || "").trim(),
      baseUrl: null,
      isOpenAICompatible: true
    };
  }
  if (mode === "shopaikey") {
    return {
      mode,
      keyName: "SHOPAIKEY_API_KEY",
      apiKey: String(env.SHOPAIKEY_API_KEY || "").trim(),
      baseUrl: String(
        env.SHOPAIKEY_GEMINI_BASE_URL || DEFAULT_SHOPAIKEY_GEMINI_BASE_URL
      ).trim().replace(/\/+$/, ""),
      isOpenAICompatible: true
    };
  }
  return {
    mode: "google",
    keyName: "GEMINI_API_KEY",
    apiKey: String(env.GEMINI_API_KEY || "").trim(),
    baseUrl: null,
    isOpenAICompatible: false
  };
}

function getGoogleClient(env = process.env) {
  if (!googleClient) {
    const apiKey = String(env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error(`Thiếu biến môi trường GEMINI_API_KEY trong file .env để dùng cho tính năng Embedding.`);
    }
    googleClient = new GoogleGenAI({ apiKey });
  }
  return googleClient;
}

function getOfficialOpenAIClient(env = process.env) {
  if (!officialOpenAIClient) {
    const apiKey = String(env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error(`Thiếu biến môi trường OPENAI_API_KEY trong file .env để dùng cho tính năng Embedding.`);
    }
    officialOpenAIClient = new OpenAI({ apiKey });
  }
  return officialOpenAIClient;
}

function getOpenAIClient(env = process.env) {
  if (!openaiClient) {
    const provider = resolveProviderConfig(env);
    if (!provider.apiKey) throw new Error(`Thiếu biến môi trường ${provider.keyName} trong file .env`);
    openaiClient = new OpenAI({
      apiKey: provider.apiKey,
      ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
    });
  }
  return openaiClient;
}

/**
 * Sinh câu trả lời hội thoại tự nhiên.
 * @param {string} prompt - Nội dung người dùng hỏi
 * @param {string} [systemInstruction] - Chỉ dẫn hệ thống (VD: yêu cầu trả lời dựa trên context)
 * @returns {Promise<string>}
 */
async function generateChatReply(prompt, systemInstruction, options = {}) {
  const providerConfig = resolveProviderConfig();
  console.log("providerConfig:", providerConfig);
  const model = process.env.GEMINI_CHAT_MODEL || "gemini-3.5-flash";
  const totalTimeoutMs = positiveTimeout(
    options.totalTimeoutMs ?? process.env.GEMINI_GENERATION_TIMEOUT_MS,
    20_000
  );
  const configuredAttemptTimeout = options.attemptTimeoutMs
    ?? process.env.GEMINI_PROVIDER_ATTEMPT_TIMEOUT_MS;

  const result = await executeProviderRequest({
    request: async ({ signal }) => {
      if (providerConfig.isOpenAICompatible) {
        const client = getOpenAIClient();
        const messages = [];
        if (systemInstruction) {
          messages.push({ role: "system", content: systemInstruction });
        }
        messages.push({ role: "user", content: prompt });
        
        return client.chat.completions.create({
          model,
          messages,
        }, { signal: signal }); // OpenAI SDK uses AbortSignal via 'signal' in node-fetch
      } else {
        const ai = options.client || getGoogleClient();
        return ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            ...(systemInstruction ? { systemInstruction } : {}),
            abortSignal: signal,
          },
        });
      }
    },
    maxAttempts: positiveInteger(
      options.maxAttempts ?? process.env.GEMINI_PROVIDER_MAX_ATTEMPTS,
      2
    ),
    totalTimeoutMs,
    attemptTimeoutMs: configuredAttemptTimeout == null
      ? null
      : positiveTimeout(configuredAttemptTimeout, null),
    baseDelayMs: positiveTimeout(
      options.baseDelayMs ?? process.env.GEMINI_PROVIDER_BACKOFF_BASE_MS,
      250
    ),
    jitterRatio: options.jitterRatio
      ?? Number(process.env.GEMINI_PROVIDER_JITTER_RATIO || 0.2),
    sleep: options.sleep,
    random: options.random,
    now: options.now,
    operation: "Gemini generation",
  });

  let text = "";
  if (providerConfig.isOpenAICompatible) {
    text = result.value?.choices?.[0]?.message?.content?.trim() || "";
  } else {
    text = result.value?.text?.trim() || "";
  }
  
  if (!text) {
    console.log("Empty response debug:", JSON.stringify(result?.value, null, 2));
    const error = new Error("AI provider returned an empty response");
    error.name = "GeminiEmptyResponseError";
    error.code = "GEMINI_EMPTY_RESPONSE";
    error.providerMeta = {
      ...result.providerMeta,
      failureClass: PROVIDER_FAILURE_CLASSES.VALIDATOR_REJECTION,
    };
    throw error;
  }

  return options.includeMetadata ? { text, providerMeta: result.providerMeta } : text;
}

/**
 * Sinh vector embedding cho MỘT đoạn văn bản.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const [vector] = await embedBatch([text]);
  return vector;
}

/**
 * Sinh vector embedding cho NHIỀU đoạn văn bản trong một lần gọi (batch),
 * dùng khi đồng bộ toàn bộ chunk của một tour trong syncTourVectors.js.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  const providerConfig = resolveProviderConfig();
  const model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
  const timeoutMs = positiveTimeout(process.env.GEMINI_EMBEDDING_TIMEOUT_MS, 12_000);

  const result = await executeProviderRequest({
    request: async ({ signal }) => {
      // Bắt buộc dùng OpenAI chính chủ cho Embeddings do Gorouter không hỗ trợ
      const client = getOfficialOpenAIClient();
      return client.embeddings.create({
        model,
        input: texts,
      }, { signal: signal });
    },
    maxAttempts: 1,
    totalTimeoutMs: timeoutMs,
    attemptTimeoutMs: timeoutMs,
    operation: "Gemini embedding",
  });

  return result.value.data.map((e) => e.embedding);
}

module.exports = {
  generateChatReply,
  embedText,
  embedBatch,
  getClient: getGoogleClient,
  withTimeout,
  resolveGeminiProviderConfig: resolveProviderConfig,
  buildGeminiClientOptions: () => ({}),
};
