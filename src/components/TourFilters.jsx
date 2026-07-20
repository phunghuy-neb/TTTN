// Thanh lọc/sắp xếp — KHÔNG tự giữ state, KHÔNG đọc URL.
// Chỉ nhận bộ lọc hiện tại qua prop `value` và báo thay đổi qua `onChange`.

// Ánh xạ khoảng giá ↔ cặp minPrice/maxPrice (đơn vị VNĐ, '' hoặc '0' = không giới hạn)
const PRICE_OPTIONS = [
  { key: '', label: 'Tất cả', min: '', max: '' },
  { key: 'lt3', label: 'Dưới 3 triệu', min: '0', max: '3000000' },
  { key: '3-6', label: '3–6 triệu', min: '3000000', max: '6000000' },
  { key: 'gt6', label: 'Trên 6 triệu', min: '6000000', max: '0' },
]

// Suy ra khoá khoảng giá đang chọn từ min/max hiện tại
function priceKey(minPrice, maxPrice) {
  const mn = Number(minPrice) || 0
  const mx = Number(maxPrice) || 0
  if (mn === 0 && mx === 3000000) return 'lt3'
  if (mn === 3000000 && mx === 6000000) return '3-6'
  if (mn === 6000000 && mx === 0) return 'gt6'
  return ''
}

export default function TourFilters({ value, onChange }) {
  // Có ít nhất một bộ lọc khác mặc định
  const hasFilter = !!(
    value.q ||
    value.region ||
    Number(value.minPrice) ||
    Number(value.maxPrice) ||
    value.days ||
    value.sort
  )

  // Đổi khoảng giá → ghi cặp min/max tương ứng
  function changePrice(key) {
    const opt = PRICE_OPTIONS.find((o) => o.key === key)
    onChange({ ...value, minPrice: opt.min, maxPrice: opt.max })
  }

  // Xoá toàn bộ về mặc định
  function clearAll() {
    onChange({ q: '', region: '', minPrice: '', maxPrice: '', days: '', sort: '' })
  }

  return (
    <div className="card-surface p-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        {/* Từ khoá */}
        <div className="md:flex-1">
          <label className="mb-1 block text-[13px] font-medium text-muted">Từ khoá</label>
          <input
            type="text"
            value={value.q}
            onChange={(e) => onChange({ ...value, q: e.target.value })}
            placeholder="Tên tour hoặc điểm đến"
            className="field-input w-full"
          />
        </div>

        {/* Khu vực */}
        <div className="md:w-[160px]">
          <label className="mb-1 block text-[13px] font-medium text-muted">Khu vực</label>
          <select
            value={value.region}
            onChange={(e) => onChange({ ...value, region: e.target.value })}
            className="field-input w-full"
          >
            <option value="">Tất cả</option>
            <option value="Miền Bắc">Miền Bắc</option>
            <option value="Miền Trung">Miền Trung</option>
            <option value="Miền Nam">Miền Nam</option>
          </select>
        </div>

        {/* Khoảng giá */}
        <div className="md:w-[160px]">
          <label className="mb-1 block text-[13px] font-medium text-muted">Khoảng giá</label>
          <select
            value={priceKey(value.minPrice, value.maxPrice)}
            onChange={(e) => changePrice(e.target.value)}
            className="field-input w-full"
          >
            {PRICE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Số ngày */}
        <div className="md:w-[150px]">
          <label className="mb-1 block text-[13px] font-medium text-muted">Số ngày</label>
          <select
            value={value.days}
            onChange={(e) => onChange({ ...value, days: e.target.value })}
            className="field-input w-full"
          >
            <option value="">Tất cả</option>
            <option value="2-3">2–3 ngày</option>
            <option value="4-5">4–5 ngày</option>
            <option value="6+">Từ 6 ngày</option>
          </select>
        </div>

        {/* Sắp xếp */}
        <div className="md:w-[180px]">
          <label className="mb-1 block text-[13px] font-medium text-muted">Sắp xếp</label>
          <select
            value={value.sort}
            onChange={(e) => onChange({ ...value, sort: e.target.value })}
            className="field-input w-full"
          >
            <option value="">Mặc định</option>
            <option value="price-asc">Giá thấp đến cao</option>
            <option value="price-desc">Giá cao đến thấp</option>
            <option value="rating-desc">Đánh giá cao nhất</option>
          </select>
        </div>

        {/* Xoá bộ lọc — chỉ hiện khi đang có bộ lọc */}
        {hasFilter && (
          <button type="button" className="btn-ghost md:self-end" onClick={clearAll}>
            Xoá bộ lọc
          </button>
        )}
      </div>
    </div>
  )
}
