import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getFavoriteSuggestions, getFavoriteTours } from '../services/favoriteService.js'
import TourCard from '../components/TourCard.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Pagination from '../components/ui/Pagination.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'

export default function Favorites() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const [tours, setTours] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)

  useEffect(() => {
    let active = true
    setSuggestionsLoading(true)
    getFavoriteSuggestions(4).then((res) => {
      if (!active) return
      if (res.success) setSuggestions(res.data)
      setSuggestionsLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError('')
      const res = await getFavoriteTours({ page })
      if (!active) return
      if (res.success) {
        if (res.data.length === 0 && page > 1) {
          setSearchParams({})
          return
        }
        setTours(res.data)
        setPagination(res.pagination)
      } else setError(res.message || 'Không tải được tour yêu thích.')
      setLoading(false)
    })()
    return () => { active = false }
  }, [page, setSearchParams])

  function goToPage(nextPage) {
    setSearchParams(nextPage > 1 ? { page: String(nextPage) } : {})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="wrap py-[56px]">
      <p className="eyebrow">DANH SÁCH CỦA BẠN</p>
      <h1 className="mt-2 font-heading text-[30px] font-semibold text-ink">Tour yêu thích</h1>
      <p className="mt-2 text-[14.5px] text-muted">Lưu lại những hành trình bạn muốn cân nhắc và đặt sau.</p>

      {loading && (
        <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[360px] rounded-card" />)}
        </div>
      )}

      {!loading && error && <div className="card-surface mt-7 p-6 text-center text-coralD">{error}</div>}

      {!loading && !error && tours.length === 0 && (
        <EmptyState
          className="mt-7"
          title="Bạn chưa lưu tour nào"
          description="Bấm biểu tượng trái tim trên tour để thêm vào danh sách yêu thích."
          action={<Link to="/tours" className="btn-teal">Khám phá tour</Link>}
        />
      )}

      {!loading && !error && tours.length > 0 && (
        <>
          <p className="mt-5 text-[14px] text-muted">Đã lưu {pagination?.total || tours.length} tour</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {tours.map((tour) => (
              <TourCard
                key={tour._id}
                tour={tour}
                onFavoriteChange={(isFavorite) => {
                  if (!isFavorite) {
                    setTours((current) => {
                      if (current.length === 1 && page > 1) {
                        setSearchParams({ page: String(page - 1) })
                        return current
                      }
                      return current.filter((item) => item._id !== tour._id)
                    })
                    setPagination((current) => current ? { ...current, total: Math.max(0, current.total - 1) } : current)
                  }
                }}
              />
            ))}
          </div>
          <Pagination page={page} totalPages={pagination?.totalPages || 1} onPageChange={goToPage} />
        </>
      )}

      <section className="mt-12 border-t border-line pt-9">
        <p className="eyebrow">GỢI Ý CHO BẠN</p>
        <h2 className="mt-2 font-heading text-[24px] font-semibold text-ink">Có thể bạn cũng thích</h2>
        <p className="mt-1 text-[14px] text-muted">Ưu tiên tour cùng khu vực, điểm đến và chủ đề bạn đã lưu.</p>
        {suggestionsLoading ? (
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[360px] rounded-card" />)}
          </div>
        ) : suggestions.length > 0 ? (
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {suggestions.map((tour) => (
              <TourCard
                key={tour._id}
                tour={tour}
                onFavoriteChange={(isFavorite) => {
                  if (isFavorite) {
                    setSuggestions((current) => current.filter((item) => item._id !== tour._id))
                    if (page === 1) setTours((current) => [tour, ...current.filter((item) => item._id !== tour._id)].slice(0, 12))
                    setPagination((current) => current ? { ...current, total: current.total + 1 } : { page: 1, total: 1, totalPages: 1 })
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-card border border-line bg-white p-5 text-[14px] text-muted">Chưa có tour phù hợp để gợi ý thêm.</p>
        )}
      </section>
    </div>
  )
}
