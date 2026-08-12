import crypto from 'crypto'

export class PaymentConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PaymentConfigError'
    this.statusCode = 503
    this.code = 'PAYMENT_NOT_CONFIGURED'
  }
}

function requireEnv(names, provider) {
  const values = {}
  const missing = []
  for (const name of names) {
    const value = String(process.env[name] || '').trim()
    if (!value) missing.push(name)
    values[name] = value
  }
  if (missing.length) throw new PaymentConfigError(`${provider} chưa được cấu hình trên máy chủ (thiếu ${missing.join(', ')}).`)
  return values
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || '').toLowerCase())
  const right = Buffer.from(String(b || '').toLowerCase())
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function normalizedPublicBaseUrl() {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim()
  const ngrokDomain = String(process.env.NGROK_DOMAIN || '').trim()
  const candidate = configured || (ngrokDomain ? `https://${ngrokDomain}` : '')
  if (!candidate) return ''

  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function hasEnv(names) {
  return names.every((name) => String(process.env[name] || '').trim())
}

function endpointUrl(value, provider) {
  try {
    const url = new URL(String(value || '').trim())
    if (url.protocol !== 'https:') throw new Error('HTTPS required')
    return url
  } catch {
    throw new PaymentConfigError(`Endpoint ${provider} không hợp lệ hoặc không dùng HTTPS.`)
  }
}

export function getVnpayMode() {
  return 'sandbox'
}

export function getMomoMode() {
  return String(process.env.MOMO_MODE || 'sandbox').trim().toLowerCase() === 'demo' ? 'demo' : 'sandbox'
}

export function getPaymentProviderConfig() {
  const vnpayMode = getVnpayMode()
  const momoMode = getMomoMode()
  const vnpayConfigured = hasEnv(['VNP_TMN_CODE', 'VNP_HASH_SECRET', 'VNP_PAYMENT_URL'])
  const momoConfigured = momoMode === 'demo' || hasEnv(['MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY', 'MOMO_ENDPOINT'])
  const vnpayEndpointReady = (() => {
    try {
      const url = new URL(String(process.env.VNP_PAYMENT_URL || ''))
      return url.protocol === 'https:' && /sandbox/i.test(url.hostname)
    } catch {
      return false
    }
  })()
  const momoEndpointReady = (() => {
    try {
      const url = new URL(String(process.env.MOMO_ENDPOINT || ''))
      return url.protocol === 'https:' && (momoMode === 'demo' || url.hostname === 'test-payment.momo.vn')
    } catch {
      return momoMode === 'demo'
    }
  })()
  return {
    vnpay: {
      mode: vnpayMode,
      testMode: true,
      enabled: vnpayConfigured && vnpayEndpointReady,
    },
    momo: {
      mode: momoMode,
      testMode: true,
      enabled: momoConfigured && momoEndpointReady,
    },
  }
}

function callbackUrl(envName, path, provider) {
  const publicBaseUrl = normalizedPublicBaseUrl()
  if (publicBaseUrl) return `${publicBaseUrl}${path}`
  return requireEnv([envName], provider)[envName]
}

function demoSecret() {
  return requireEnv(['JWT_SECRET'], 'MoMo demo').JWT_SECRET
}

export function isMomoDemoMode() {
  return getMomoMode() === 'demo'
}

function assertMomoDemoAllowed() {
  if (!isMomoDemoMode()) throw new PaymentConfigError('MoMo demo chưa được bật (MOMO_MODE=demo).')
  if (String(process.env.NODE_ENV || 'development').toLowerCase() === 'production') {
    throw new PaymentConfigError('MoMo demo bị vô hiệu hóa trong môi trường production.')
  }
}

export function createMomoDemoUrl({ orderId }) {
  assertMomoDemoAllowed()
  const token = crypto.createHmac('sha256', demoSecret()).update(orderId, 'utf8').digest('hex')
  const base = normalizedPublicBaseUrl() || `http://localhost:${process.env.PORT || 5000}`
  return `${base}/api/payments/momo/demo/${encodeURIComponent(orderId)}?token=${token}`
}

export function verifyMomoDemoToken(orderId, token) {
  assertMomoDemoAllowed()
  const expected = crypto.createHmac('sha256', demoSecret()).update(String(orderId || ''), 'utf8').digest('hex')
  return safeEqual(token, expected)
}

function encodeVnp(value) {
  return encodeURIComponent(String(value)).replace(/%20/g, '+')
}

export function vnpQuery(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${encodeVnp(key)}=${encodeVnp(params[key])}`)
    .join('&')
}

function vnpDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`
}

export function createVnpayUrl({ orderId, amount, orderInfo, ipAddress, expiresAt }) {
  const cfg = requireEnv(['VNP_TMN_CODE', 'VNP_HASH_SECRET'], 'VNPay')
  const paymentUrl = String(process.env.VNP_PAYMENT_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html').trim()
  const parsedPaymentUrl = endpointUrl(paymentUrl, 'VNPay')
  if (!/sandbox/i.test(parsedPaymentUrl.hostname)) {
    throw new PaymentConfigError('VNPay Sandbox phải dùng endpoint Sandbox.')
  }
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: cfg.VNP_TMN_CODE,
    vnp_Amount: Math.round(amount * 100),
    vnp_CurrCode: 'VND',
    vnp_TxnRef: orderId,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: 'other',
    vnp_Locale: 'vn',
    vnp_ReturnUrl: callbackUrl('VNP_RETURN_URL', '/api/payments/vnpay/return', 'VNPay'),
    vnp_IpAddr: String(ipAddress || '127.0.0.1').replace(/^::ffff:/, '') || '127.0.0.1',
    vnp_CreateDate: vnpDate(new Date()),
    vnp_ExpireDate: vnpDate(expiresAt),
  }
  const query = vnpQuery(params)
  const signature = crypto.createHmac('sha512', cfg.VNP_HASH_SECRET).update(query, 'utf8').digest('hex')
  return `${paymentUrl}?${query}&vnp_SecureHash=${signature}`
}

export function verifyVnpayCallback(input) {
  const cfg = requireEnv(['VNP_TMN_CODE', 'VNP_HASH_SECRET'], 'VNPay')
  const params = { ...input }
  const received = params.vnp_SecureHash
  delete params.vnp_SecureHash
  delete params.vnp_SecureHashType
  const expected = crypto.createHmac('sha512', cfg.VNP_HASH_SECRET).update(vnpQuery(params), 'utf8').digest('hex')
  return {
    valid: safeEqual(received, expected) && params.vnp_TmnCode === cfg.VNP_TMN_CODE,
    orderId: String(params.vnp_TxnRef || ''),
    amount: Number(params.vnp_Amount) / 100,
    success: params.vnp_ResponseCode === '00' && (!params.vnp_TransactionStatus || params.vnp_TransactionStatus === '00'),
    txnId: String(params.vnp_TransactionNo || ''),
    responseCode: String(params.vnp_ResponseCode || ''),
  }
}

function momoSignature(data, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(data, 'utf8').digest('hex')
}

export async function createMomoPayment({ orderId, requestId, amount, orderInfo }) {
  const cfg = requireEnv(
    ['MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY'],
    'MoMo'
  )
  const endpoint = String(process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create').trim()
  const mode = getMomoMode()
  const parsedEndpoint = endpointUrl(endpoint, 'MoMo')
  if (mode !== 'sandbox' || parsedEndpoint.hostname !== 'test-payment.momo.vn') {
    throw new PaymentConfigError('MoMo Sandbox phải dùng endpoint test-payment.momo.vn.')
  }
  const redirectUrl = callbackUrl('MOMO_REDIRECT_URL', '/api/payments/momo/return', 'MoMo')
  const ipnUrl = callbackUrl('MOMO_IPN_URL', '/api/payments/momo/ipn', 'MoMo')
  const extraData = ''
  const requestType = String(process.env.MOMO_REQUEST_TYPE || 'payWithMethod').trim()
  if (!['payWithMethod', 'captureWallet'].includes(requestType)) {
    throw new PaymentConfigError('MOMO_REQUEST_TYPE phải là payWithMethod hoặc captureWallet.')
  }
  const raw = [
    `accessKey=${cfg.MOMO_ACCESS_KEY}`,
    `amount=${amount}`,
    `extraData=${extraData}`,
    `ipnUrl=${ipnUrl}`,
    `orderId=${orderId}`,
    `orderInfo=${orderInfo}`,
    `partnerCode=${cfg.MOMO_PARTNER_CODE}`,
    `redirectUrl=${redirectUrl}`,
    `requestId=${requestId}`,
    `requestType=${requestType}`,
  ].join('&')

  const body = {
    partnerCode: cfg.MOMO_PARTNER_CODE,
    partnerName: String(process.env.MOMO_PARTNER_NAME || 'VietVoyage Test').trim(),
    storeId: String(process.env.MOMO_STORE_ID || 'VietVoyageTestStore').trim(),
    requestId,
    amount,
    orderId,
    orderInfo,
    redirectUrl,
    ipnUrl,
    requestType,
    extraData,
    lang: 'vi',
    autoCapture: true,
    signature: momoSignature(raw, cfg.MOMO_SECRET_KEY),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 35_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.resultCode !== 0 || !data.payUrl) {
      throw new Error(data.message || `MoMo trả HTTP ${response.status}`)
    }
    return {
      payUrl: data.payUrl,
      qrCodeData: String(data.qrCodeUrl || ''),
      deeplink: String(data.deeplink || ''),
      deeplinkMiniApp: String(data.deeplinkMiniApp || ''),
    }
  } finally {
    clearTimeout(timer)
  }
}

export function verifyMomoCallback(input) {
  const cfg = requireEnv(['MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY'], 'MoMo')
  const raw = [
    `accessKey=${cfg.MOMO_ACCESS_KEY}`,
    `amount=${input.amount}`,
    `extraData=${input.extraData || ''}`,
    `message=${input.message || ''}`,
    `orderId=${input.orderId || ''}`,
    `orderInfo=${input.orderInfo || ''}`,
    `orderType=${input.orderType || ''}`,
    `partnerCode=${input.partnerCode || ''}`,
    `payType=${input.payType || ''}`,
    `requestId=${input.requestId || ''}`,
    `responseTime=${input.responseTime || ''}`,
    `resultCode=${input.resultCode}`,
    `transId=${input.transId || ''}`,
  ].join('&')
  const expected = momoSignature(raw, cfg.MOMO_SECRET_KEY)
  return {
    valid: input.partnerCode === cfg.MOMO_PARTNER_CODE && safeEqual(input.signature, expected),
    orderId: String(input.orderId || ''),
    amount: Number(input.amount),
    success: Number(input.resultCode) === 0,
    txnId: String(input.transId || ''),
    responseCode: String(input.resultCode ?? ''),
  }
}
