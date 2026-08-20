export const PRICE_OPTIONS = [
  { key: '', label: 'Tất cả', min: '', max: '' },
  { key: 'lt3', label: 'Dưới 3 triệu', min: '0', max: '2999999' },
  { key: '3-6', label: '3–6 triệu', min: '3000000', max: '6000000' },
  { key: 'gt6', label: 'Trên 6 triệu', min: '6000001', max: '0' },
]

export function priceKey(minPrice, maxPrice) {
  const mn = Number(minPrice) || 0
  const mx = Number(maxPrice) || 0
  const option = PRICE_OPTIONS.find((item) => Number(item.min) === mn && Number(item.max) === mx)
  return option?.key || ''
}
