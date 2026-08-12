const stores = new Set()

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
  next()
}

// Rate limiter bộ nhớ phù hợp một instance. Khi scale nhiều instance nên thay
// store bằng Redis để giới hạn được chia sẻ toàn cụm.
export function rateLimit({ windowMs = 15 * 60_000, max = 300, prefix = 'global', skip } = {}) {
  const store = new Map()
  stores.add(store)
  return (req, res, next) => {
    if (skip?.(req)) return next()
    const now = Date.now()
    const key = `${prefix}:${req.ip}`
    let record = store.get(key)
    if (!record || record.resetAt <= now) record = { count: 0, resetAt: now + windowMs }
    record.count += 1
    store.set(key, record)
    res.setHeader('RateLimit-Limit', String(max))
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - record.count)))
    res.setHeader('RateLimit-Reset', String(Math.ceil(record.resetAt / 1000)))
    if (record.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((record.resetAt - now) / 1000)))
      return res.status(429).json({ success: false, message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.', code: 'RATE_LIMITED' })
    }
    next()
  }
}

// Dọn key hết hạn định kỳ, unref để không giữ process khi shutdown.
const cleanup = setInterval(() => {
  const now = Date.now()
  for (const store of stores) {
    for (const [key, record] of store) if (record.resetAt <= now) store.delete(key)
  }
}, 10 * 60_000)
cleanup.unref()
