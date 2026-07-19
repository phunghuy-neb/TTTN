import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatPrice } from '../data/tours.js'

// Thẻ tour — ảnh 4/3 phía trên, thân chứa thông tin và giá
export default function TourCard({ tour }) {
  const [imgError, setImgError] = useState(false)

  // Có khuyến mãi khi oldPrice khác null
  const onSale = tour.oldPrice != null
  // Phần trăm giảm, làm tròn xuống
  const discount = onSale ? Math.floor((1 - tour.basePrice / tour.oldPrice) * 100) : 0

  return (
    <Link
      to={`/tour/${tour.id}`}
      className="card-surface group block overflow-hidden transition hover:-translate-y-1 hover:shadow-float"
    >
      {/* Ảnh minh họa tỉ lệ 4/3 */}
      <div className="relative aspect-[4/3] overflow-hidden">
        {imgError ? (
          // Ảnh lỗi — nền gradient hiển thị tên địa điểm, tránh vỡ giao diện lúc demo
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-teal to-jade font-heading text-xl font-semibold text-white">
            {tour.location}
          </div>
        ) : (
          <img
            src={tour.image}
            alt={tour.name}
            loading="lazy"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        )}

        {/* Badge giảm giá */}
        {onSale && (
          <span className="absolute left-3 top-3 rounded-pill bg-coral px-2.5 py-1 text-[12.5px] font-bold text-white">
            -{discount}%
          </span>
        )}
      </div>

      {/* Thân thẻ */}
      <div className="p-4">
        <div className="flex items-center justify-between text-[13px] text-muted">
          <span>📍 {tour.location}</span>
          <span>{tour.days} ngày</span>
        </div>

        <h3 className="mt-2 line-clamp-2 min-h-[3.25rem] font-heading text-[18px] font-semibold text-ink">
          {tour.name}
        </h3>

        <div className="mt-2 flex items-center gap-1 text-[13.5px] text-muted">
          <span className="text-gold">★</span>
          <span className="font-semibold text-ink">{tour.avgRating.toFixed(1)}</span>
        </div>

        {/* Giá — kèm giá gốc gạch ngang nếu đang giảm */}
        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-heading text-[19px] font-semibold text-coralD">
            {formatPrice(tour.basePrice)}
          </span>
          {onSale && (
            <span className="text-[13.5px] text-muted line-through">
              {formatPrice(tour.oldPrice)}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
