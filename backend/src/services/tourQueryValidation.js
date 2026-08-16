const NUMERIC_QUERY_RULES = {
  page: { integer: true, min: 1 },
  limit: { integer: true, min: 1 },
  minPrice: { integer: false, min: 0 },
  maxPrice: { integer: false, min: 0 },
  minDays: { integer: true, min: 1 },
  maxDays: { integer: true, min: 1 },
}

function parseNumericQueryValue(field, rawValue, rule) {
  if (Array.isArray(rawValue)) {
    return { error: `Tham số "${field}" không hợp lệ.` }
  }

  const text = String(rawValue).trim()
  if (!text) return { error: `Tham số "${field}" không hợp lệ.` }

  const value = Number(text)
  if (!Number.isFinite(value)) return { error: `Tham số "${field}" không hợp lệ.` }
  if (rule.integer && !Number.isInteger(value)) {
    return { error: `Tham số "${field}" phải là số nguyên.` }
  }
  if (value < rule.min) return { error: `Tham số "${field}" phải lớn hơn hoặc bằng ${rule.min}.` }

  return { value }
}

export function validateTourNumericQuery(query = {}) {
  const values = {}

  for (const [field, rule] of Object.entries(NUMERIC_QUERY_RULES)) {
    if (query[field] === undefined) continue

    const parsed = parseNumericQueryValue(field, query[field], rule)
    if (parsed.error) return { valid: false, field, message: parsed.error }
    values[field] = parsed.value
  }

  return { valid: true, values }
}
