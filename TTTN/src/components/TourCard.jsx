import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { formatPrice } from '../utils/format.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useFavorites } from '../context/FavoritesContext.jsx'
import { useToast } from './ui/Toast.jsx'

// Thẻ tour — có nút yêu thích độc lập với link mở chi tiết.
export default function TourCard({ tour, onFavoriteChange }) {
  const [imgError, setImgError] = useState(false)
  const [savingFavorite, setSavingFavorite] = useState(false)
  const { user } = useAuth()
  const { favoriteIds, toggleFavorite } = useFavorites()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const onSale = tour.oldPrice != null && tour.oldPrice > tour.basePrice
  const discount = onSale ? Math.floor((1 - tour.basePrice / tour.oldPrice) * 100) : 0
  const isFavorite = favoriteIds.has(String(tour._id))

  async function toggle() {
    if (!user) {
      navigate('/login', { state: { from: location } })
      return
    }
    if (savingFavorite) return
    setSavingFavorite(true)
    const res = await toggleFavorite(tour._id)
    setSavingFavorite(false)
    if (!res.success) {
      toast(res.message || 'Không cập nhật được tour yêu thích.', 'error')
      return
    }
    toast(res.message)
    onFavoriteChange?.(res.isFavorite)
  }

  return (
    <article className="card-surface group relative overflow-hidden transition hover:-translate-y-1 hover:shadow-float">
      <button
        type="button"
        aria-label={isFavorite ? `Bỏ ${tour.name} khỏi yêu thích` : `Thêm ${tour.name} vào yêu thích`}
        aria-pressed={isFavorite}
        disabled={savingFavorite}
        onClick={toggle}
        className={`absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border border-white/70 bg-white/95 text-[20px] shadow-soft transition hover:scale-105 disabled:opacity-60 ${isFavorite ? 'text-coralD' : 'text-muted'}`}
      >
        {isFavorite ? '♥' : '♡'}
      </button>

      <Link to={`/tour/${tour.slug}`} className="block">
        <div className="relative aspect-[4/3] overflow-hidden">
          {imgError || !tour.images?.[0] ? (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-teal to-jade px-6 text-center font-heading text-xl font-semibold text-white">
              {tour.location}
            </div>
          ) : (
            <img
              src={tour.images[0]}
              alt={tour.name}
              loading="lazy"
              onError={() => setImgError(true)}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
          )}

          {onSale && (
            <span className="absolute left-3 top-3 max-w-[calc(100%-4.5rem)] truncate rounded-pill bg-coral px-2.5 py-1 text-[12.5px] font-bold text-white">
              {tour.promotionLabel || `-${discount}%`}
            </span>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between text-[13px] text-muted">
            <span>📍 {tour.location}</span>
            <span>{tour.days} ngày</span>
          </div>
          <h3
            title={tour.name}
            className="mt-2 line-clamp-2 min-h-[3.25rem] break-normal pb-px font-heading text-[18px] font-semibold leading-[1.4] text-ink [overflow-wrap:normal] [word-break:normal]"
          >
            {tour.name}
          </h3>
          <div className="mt-2 flex items-center gap-1 text-[13.5px] text-muted">
            <span className="text-gold">★</span>
            <span className="font-semibold text-ink">{(tour.avgRating || 0).toFixed(1)}</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-heading text-[19px] font-semibold text-coralD">{formatPrice(tour.basePrice)}</span>
            {onSale && <span className="text-[13.5px] text-muted line-through">{formatPrice(tour.oldPrice)}</span>}
          </div>
        </div>
      </Link>
    </article>
  )
}
