import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'
import {
  createVnpayUrl,
  verifyVnpayCallback,
  verifyMomoCallback,
  createMomoPayment,
  createMomoDemoUrl,
  verifyMomoDemoToken,
  getPaymentProviderConfig,
  vnpQuery,
} from '../src/services/paymentProviders.js'

test('cấu hình thanh toán chỉ công khai hai cổng Sandbox', () => {
  const names = [
    'VNP_PAYMENT_URL',
    'VNP_TMN_CODE', 'VNP_HASH_SECRET', 'MOMO_MODE', 'MOMO_ENDPOINT',
    'MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY',
  ]
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  Object.assign(process.env, {
    VNP_PAYMENT_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    VNP_TMN_CODE: 'TESTVNP', VNP_HASH_SECRET: 'sandbox-vnp-secret',
    MOMO_MODE: 'sandbox', MOMO_ENDPOINT: 'https://test-payment.momo.vn/v2/gateway/api/create',
    MOMO_PARTNER_CODE: 'TESTMOMO', MOMO_ACCESS_KEY: 'test-access', MOMO_SECRET_KEY: 'test-secret',
  })

  const config = getPaymentProviderConfig()
  assert.deepEqual(Object.keys(config), ['vnpay', 'momo'])
  assert.equal(config.vnpay.enabled, true)
  assert.equal(config.momo.enabled, true)
  assert.equal(config.vnpay.mode, 'sandbox')
  assert.equal(config.momo.mode, 'sandbox')
  assert.equal(Object.values(config).every((value) => value.testMode), true)

  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test('VNPay URL được ký và callback sửa dữ liệu bị từ chối', () => {
  process.env.VNP_TMN_CODE = 'TESTCODE'
  process.env.VNP_HASH_SECRET = 'test-vnp-secret'
  process.env.VNP_RETURN_URL = 'https://merchant.test/api/payments/vnpay/return'
  process.env.VNP_PAYMENT_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'

  const url = new URL(createVnpayUrl({
    orderId: 'VNP-TEST-001', amount: 1500000,
    orderInfo: 'Thanh toan don test', ipAddress: '127.0.0.1',
    expiresAt: new Date(Date.now() + 30 * 60_000),
  }))
  const params = Object.fromEntries(url.searchParams)
  assert.equal(verifyVnpayCallback(params).valid, true)
  params.vnp_Amount = '1'
  assert.equal(verifyVnpayCallback(params).valid, false)
})

test('VNPay callback thành công kiểm đúng amount và transaction', () => {
  const params = {
    vnp_TmnCode: process.env.VNP_TMN_CODE,
    vnp_TxnRef: 'VNP-TEST-002',
    vnp_Amount: '250000000',
    vnp_ResponseCode: '00',
    vnp_TransactionStatus: '00',
    vnp_TransactionNo: '12345678',
  }
  params.vnp_SecureHash = crypto.createHmac('sha512', process.env.VNP_HASH_SECRET).update(vnpQuery(params)).digest('hex')
  const result = verifyVnpayCallback(params)
  assert.deepEqual(
    { valid: result.valid, success: result.success, amount: result.amount, txnId: result.txnId },
    { valid: true, success: true, amount: 2500000, txnId: '12345678' }
  )
})

test('MoMo callback dùng HMAC SHA256 và phát hiện tamper', () => {
  process.env.MOMO_PARTNER_CODE = 'MOMOTEST'
  process.env.MOMO_ACCESS_KEY = 'access-test'
  process.env.MOMO_SECRET_KEY = 'secret-test'
  const input = {
    partnerCode: 'MOMOTEST', orderId: 'MOMO-TEST-001', requestId: 'REQ-1', amount: '100000',
    orderInfo: 'Thanh toan test', orderType: 'momo_wallet', transId: '9999', resultCode: '0',
    message: 'Successful.', payType: 'webApp', responseTime: '1720000000000', extraData: '',
  }
  const raw = `accessKey=access-test&amount=100000&extraData=&message=Successful.&orderId=MOMO-TEST-001&orderInfo=Thanh toan test&orderType=momo_wallet&partnerCode=MOMOTEST&payType=webApp&requestId=REQ-1&responseTime=1720000000000&resultCode=0&transId=9999`
  input.signature = crypto.createHmac('sha256', process.env.MOMO_SECRET_KEY).update(raw).digest('hex')
  assert.equal(verifyMomoCallback(input).valid, true)
  input.amount = '100001'
  assert.equal(verifyMomoCallback(input).valid, false)
})

test('MoMo demo chỉ tạo URL có token hợp lệ trong môi trường development', () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    MOMO_MODE: process.env.MOMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
  }
  process.env.NODE_ENV = 'development'
  process.env.MOMO_MODE = 'demo'
  process.env.JWT_SECRET = 'demo-test-secret-at-least-32-characters'
  process.env.PUBLIC_BASE_URL = 'https://vietvoyage.ngrok-free.app/'

  const orderId = 'MOMO-DEMO-001'
  const url = new URL(createMomoDemoUrl({ orderId }))
  assert.equal(url.origin, 'https://vietvoyage.ngrok-free.app')
  assert.equal(verifyMomoDemoToken(orderId, url.searchParams.get('token')), true)
  assert.equal(verifyMomoDemoToken(`${orderId}-tampered`, url.searchParams.get('token')), false)

  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test('MoMo sandbox ký đúng URL ngrok được sinh tự động', async () => {
  const names = [
    'MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY', 'MOMO_ENDPOINT',
    'MOMO_REDIRECT_URL', 'MOMO_IPN_URL', 'MOMO_REQUEST_TYPE', 'PUBLIC_BASE_URL', 'NGROK_DOMAIN',
  ]
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  const previousFetch = globalThis.fetch
  process.env.MOMO_PARTNER_CODE = 'MOMOTEST'
  process.env.MOMO_ACCESS_KEY = 'access-test'
  process.env.MOMO_SECRET_KEY = 'secret-test'
  process.env.MOMO_ENDPOINT = 'https://test-payment.momo.vn/v2/gateway/api/create'
  process.env.MOMO_REQUEST_TYPE = 'payWithMethod'
  process.env.NGROK_DOMAIN = 'vietvoyage.ngrok-free.app'
  delete process.env.PUBLIC_BASE_URL

  globalThis.fetch = async (_endpoint, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.redirectUrl, 'https://vietvoyage.ngrok-free.app/api/payments/momo/return')
    assert.equal(body.ipnUrl, 'https://vietvoyage.ngrok-free.app/api/payments/momo/ipn')
    assert.equal(body.requestType, 'payWithMethod')
    const raw = `accessKey=access-test&amount=10000&extraData=&ipnUrl=${body.ipnUrl}&orderId=MOMO-TEST-CREATE&orderInfo=Thanh toan test&partnerCode=MOMOTEST&redirectUrl=${body.redirectUrl}&requestId=REQ-CREATE&requestType=payWithMethod`
    assert.equal(body.signature, crypto.createHmac('sha256', 'secret-test').update(raw).digest('hex'))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        resultCode: 0,
        payUrl: 'https://test-payment.momo.vn/v2/gateway/pay?demo=1',
        qrCodeUrl: 'momo-test-qr-payload',
        deeplink: 'momo://app?action=payWithApp',
      }),
    }
  }

  const result = await createMomoPayment({
    orderId: 'MOMO-TEST-CREATE', requestId: 'REQ-CREATE', amount: 10000, orderInfo: 'Thanh toan test',
  })
  assert.match(result.payUrl, /^https:\/\/test-payment\.momo\.vn\//)
  assert.equal(result.qrCodeData, 'momo-test-qr-payload')
  assert.match(result.deeplink, /^momo:\/\//)

  globalThis.fetch = previousFetch
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})
