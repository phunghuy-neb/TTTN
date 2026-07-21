import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getTours } from '../services/tourService.js'
import TourCard from '../components/TourCard.jsx'

// Thẻ skeleton lúc đang tải — giữ đúng tỉ lệ TourCard để bố cục không nhảy
function SkeletonCard() {
  return (
    <div className="card-surface overflow-hidden">
      <div className="aspect-[4/3] animate-pulse bg-sand" />
      <div className="p-4">
        <div className="h-4 w-1/2 animate-pulse rounded bg-sand" />
        <div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-sand" />
        <div className="mt-4 h-6 w-2/5 animate-pulse rounded bg-sand" />
      </div>
    </div>
  )
}

// Lưới skeleton đúng số lượng thẻ mong đợi của mỗi section
function TourGridSkeleton({ count }) {
  return (
    <div className="mt-7 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

// Khối lỗi + nút thử lại (§6.7)
function ErrorState({ message, onRetry }) {
  return (
    <div className="card-surface mt-7 p-6 text-center">
      <p className="text-coralD">{message}</p>
      <button type="button" className="btn-teal mt-4" onClick={onRetry}>
        Thử lại
      </button>
    </div>
  )
}

// Trang chủ — dữ liệu tour lấy qua tầng service, KHÔNG lọc/cắt trong component
export default function Home() {
  const navigate = useNavigate()
  // State cục bộ cho khối tìm kiếm hero (state giao diện, không phải dữ liệu)
  const [destination, setDestination] = useState('')
  const [days, setDays] = useState('2-3')

  // Dữ liệu tour đến từ getTours(); loading/error dùng chung cho cả hai lời gọi
  const [featured, setFeatured] = useState([])
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Tải song song hai nhóm tour để không cộng dồn độ trễ
  async function loadTours() {
    setLoading(true)
    setError('')
    try {
      const [featuredRes, dealsRes] = await Promise.all([
        getTours({ page: 1, limit: 6 }),
        getTours({ page: 1, limit: 6, deals: true }),
      ])
      if (!featuredRes.success || !dealsRes.success) {
        setError(featuredRes.message || dealsRes.message || 'Không tải được danh sách tour.')
        setFeatured([])
        setDeals([])
        return
      }
      setFeatured(featuredRes.data)
      setDeals(dealsRes.data)
    } catch {
      setError('Không tải được danh sách tour. Vui lòng thử lại.')
      setFeatured([])
      setDeals([])
    } finally {
      setLoading(false)
    }
  }

  // Chạy một lần khi mount
  useEffect(() => {
    loadTours()
  }, [])

  // Tìm tour → điều hướng sang /tours với query chỉ chứa tham số có giá trị
  function handleSearch() {
    const params = new URLSearchParams()
    if (destination.trim()) params.set('q', destination.trim())
    if (days) params.set('days', days)
    navigate(`/tours?${params.toString()}`)
  }

  return (
    <div>
      {/* a. Hero */}
      <section className="bg-gradient-to-br from-teal to-teal2 text-white">
        <div className="wrap py-[64px]">
          <p className="eyebrow !text-white/80">Khám phá Việt Nam</p>
          <h1 className="mt-3 max-w-[720px] font-heading text-[40px] font-semibold leading-tight">
            Đặt tour du lịch trong nước dễ dàng, giá tốt mỗi ngày
          </h1>
          <p className="mt-4 max-w-[560px] text-[16px] text-white/85">
            Hàng trăm hành trình chọn lọc khắp ba miền, đặt nhanh trong vài phút và trải nghiệm trọn vẹn.
          </p>

          {/* Khối tìm kiếm — CHỈ giao diện, điều hướng sang /tours */}
          <div className="card-surface mt-8 max-w-[720px] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Bạn muốn đi đâu?"
                className="field-input sm:flex-1"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <select
                className="field-input sm:w-[160px]"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              >
                <option value="2-3">2–3 ngày</option>
                <option value="4-5">4–5 ngày</option>
                <option value="6+">Trên 5 ngày</option>
              </select>
              <button type="button" className="btn-coral sm:w-auto" onClick={handleSearch}>
                Tìm tour
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* b. Khám phá tour */}
      <section id="tours" className="wrap py-[56px]">
        <p className="eyebrow">Điểm đến nổi bật</p>
        <h2 className="mt-2 font-heading text-[30px] font-semibold text-ink">Khám phá tour</h2>
        {loading ? (
          <TourGridSkeleton count={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={loadTours} />
        ) : featured.length > 0 ? (
          <div className="mt-7 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((tour) => (
              <TourCard key={tour._id} tour={tour} />
            ))}
          </div>
        ) : (
          <p className="mt-7 text-muted">
            Hiện chưa có tour nào để hiển thị. Vui lòng quay lại sau hoặc khám phá tất cả tour bên dưới.
          </p>
        )}
        <div className="mt-8 flex justify-center">
          <Link to="/tours" className="btn-ghost">
            Xem tất cả tour →
          </Link>
        </div>
      </section>

      {/* c. Tour đang ưu đãi */}
      <section id="uudai" className="bg-sand/40">
        <div className="wrap py-[56px]">
          <p className="eyebrow">Giá tốt hôm nay</p>
          <h2 className="mt-2 font-heading text-[30px] font-semibold text-ink">Tour đang ưu đãi</h2>
          {loading ? (
            <TourGridSkeleton count={3} />
          ) : error ? (
            <ErrorState message={error} onRetry={loadTours} />
          ) : deals.length > 0 ? (
            <div className="mt-7 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {deals.map((tour) => (
                <TourCard key={tour._id} tour={tour} />
              ))}
            </div>
          ) : (
            <p className="mt-7 text-muted">Hiện chưa có ưu đãi nào</p>
          )}
        </div>
      </section>

      {/* d. Dải giới thiệu Trợ lý AI */}
      <section className="wrap py-[56px]">
        <div className="card-surface bg-sand p-8 text-center sm:p-10">
          <h2 className="font-heading text-[26px] font-semibold text-ink">Chưa biết chọn tour nào?</h2>
          <p className="mx-auto mt-3 max-w-[560px] text-[15px] text-muted">
            Trợ lý ảo VietVoyage gợi ý hành trình phù hợp với ngân sách và sở thích của bạn chỉ trong ít phút.
          </p>
          {/* Nút chưa gắn hành động — nối chatbot ở Tuần 5 */}
          <button type="button" className="btn-teal mt-6">
            Hỏi trợ lý AI
          </button>
        </div>
      </section>
    </div>
  )
}
