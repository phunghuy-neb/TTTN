import { request } from './api.js'

export async function initiatePayment(bookingId, provider) {
  const res = await request(`/payments/${bookingId}/initiate`, {
    method: 'POST',
    body: { provider },
    auth: true,
  })
  if (res.success === false) return res
  return {
    success: true,
    provider: res.provider,
    paymentUrl: res.paymentUrl,
    paymentQrDataUrl: res.paymentQrDataUrl || '',
    deeplink: res.deeplink || '',
    expiresAt: res.expiresAt,
    reused: res.reused,
  }
}

export async function getPaymentConfig() {
  const res = await request('/payments/config')
  if (res.success === false) return res
  return { success: true, data: res.providers || {} }
}
