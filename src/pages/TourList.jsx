import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getTours } from '../services/tourService.js'
import TourCard from '../components/TourCard.jsx'
import TourFilters from '../components/TourFilters.jsx'

// Trang danh sách tour — bộ lọc lấy URL query string làm nguồn duy nhất
export default function TourList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tours, setTours] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Đọc toàn bộ bộ lọc TỪ URL
  const page = Number(searchParams.get('page')) || 1
  const q = searchParams.get('q') || ''
  const region = searchParams.get('region') || ''
  const minPrice = searchParams.get('minPrice') || ''
  const maxPrice = searchParams.get('maxPrice') || ''
  const days = searchParams.get('days') || ''
  const sort = searchParams.get('sort') || ''

  const filters = { q, region, minPrice, maxPrice, days, sort }

  // Đánh số mỗi lần gọi: gõ từ khoá hoặc đổi bộ lọc liên tiếp khiến nhiều request cùng bay,
  // request cũ về sau sẽ ghi đè kết quả của bộ lọc mới nếu không bỏ qua kết quả lỗi thời.
  const requestId = useRef(0)

  // Tải danh sách theo bộ lọc hiện tại trên URL
  async function load() {
    const id = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const res = await getTours({ page, q, region, minPrice, maxPrice, days, sort })
      if (id !== requestId.current) return // đã có request mới hơn — bỏ kết quả này
      if (!res.success) {
        setError('Không tải được danh sách tour.')
        return
      }
      setTours(res.data)
      setPagination(res.pagination)
    } catch {
      if (id !== requestId.current) return
      setError('Không tải được danh sách tour.')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, region, minPrice, maxPrice, days, sort])

  // Ghi bộ lọc vào URL — bỏ tham số mặc định, reset page về 1
  function handleFilterChange(next) {
    const params = {}
    if (next.q) params.q = next.q
    if (next.region) params.region = next.region
    if (Number(next.minPrice) > 0) params.minPrice = String(next.minPrice)
    if (Number(next.maxPrice) > 0) params.maxPrice = String(next.maxPrice)
    if (next.days) params.days = next.days
    if (next.sort) params.sort = next.sort
    setSearchParams(params)
  }

  // Đổi trang — chỉ ghi page, giữ nguyên bộ lọc, cuộn lên đầu
  function goToPage(p) {
    const params = new URLSearchParams(searchParams)
    if (p <= 1) params.delete('page')
    else params.set('page', String(p))
    setSearchParams(params)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const totalPages = pagination?.totalPages ?? 1
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)

  return (
    <div className="wrap py-[56px]">
      {/* Đầu trang */}
      <p className="eyebrow">DANH SÁCH TOUR</p>
      <h1 className="mt-2 font-heading text-[30px] font-semibold text-ink">Tất cả tour</h1>
      {pagination && (
        <p className="mt-2 text-[14px] text-muted">Tìm thấy {pagination.total} tour</p>
      )}

      {/* Bộ lọc */}
      <div className="mt-6">
        <TourFilters value={filters} onChange={handleFilterChange} />
      </div>

      {/* Đang tải — 6 khối skeleton */}
      {loading && (
        <div className="mt-7 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-card bg-sand animate-pulse">
              <div className="aspect-[4/3] bg-sand" />
              <div className="p-4">
                <div className="h-4 w-2/3 rounded bg-line" />
                <div className="mt-3 h-4 w-1/3 rounded bg-line" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lỗi */}
      {!loading && error && (
        <div className="card-surface mt-7 p-6 text-center">
          <p className="text-coralD">{error}</p>
          <button type="button" className="btn-teal mt-4" onClick={load}>
            Thử lại
          </button>
        </div>
      )}

      {/* Rỗng */}
      {!loading && !error && tours.length === 0 && (
        <div className="mt-7">
          <p className="text-muted">Không có tour nào phù hợp.</p>
          <button type="button" className="btn-teal mt-4" onClick={() => setSearchParams({})}>
            Xoá bộ lọc
          </button>
        </div>
      )}

      {/* Có dữ liệu */}
      {!loading && !error && tours.length > 0 && (
        <>
          <div className="mt-7 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {tours.map((tour) => (
              <TourCard key={tour._id} tour={tour} />
            ))}
          </div>

          {/* Phân trang */}
          {totalPages > 1 && (
            <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                className="btn-ghost disabled:cursor-not-allowed disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                Trước
              </button>

              {pageNumbers.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => goToPage(p)}
                  className={
                    p === page
                      ? 'min-w-[40px] rounded-pill bg-teal px-3 py-2 font-semibold text-white'
                      : 'min-w-[40px] rounded-pill border border-line px-3 py-2 text-ink hover:bg-sand'
                  }
                >
                  {p}
                </button>
              ))}

              <button
                type="button"
                className="btn-ghost disabled:cursor-not-allowed disabled:opacity-40"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Sau
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
