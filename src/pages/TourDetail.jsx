import { useState, useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getTourBySlug } from '../services/tourService.js'
import { formatPrice } from '../utils/format.js'

// Ngày dạng dd/MM/yyyy theo chuẩn vi-VN (§14) — ép 2 chữ số, mặc định của Intl là 14/8/2026.
// timeZone UTC vì dữ liệu là ngày lịch thuần ('2026-08-21'), new Date() hiểu là nửa đêm UTC:
// để Intl đọc theo giờ máy thì máy ở phía tây UTC sẽ hiển thị lùi một ngày.
const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC'
})
const formatDate = (iso) => dateFormatter.format(new Date(iso))

// Khung xương lúc đang tải
function DetailSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[16/9] w-full rounded-card bg-sand" />
      <div className="mt-3 flex gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="aspect-[16/9] w-[110px] rounded-[12px] bg-sand" />
        ))}
      </div>
      <div className="mt-7 h-4 w-[120px] rounded bg-sand" />
      <div className="mt-3 h-8 w-2/3 rounded bg-sand" />
      <div className="mt-3 h-4 w-1/2 rounded bg-sand" />
      <div className="mt-7 h-[120px] w-full rounded-card bg-sand" />
      <div className="mt-6 h-[220px] w-full rounded-card bg-sand" />
    </div>
  )
}

// Trang chi tiết tour (UC-06) — lấy theo slug qua tầng service
export default function TourDetail() {
  const { slug } = useParams()
  const [tour, setTour] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('') // service trả success:false — tour không xem được
  const [error, setError] = useState('') // lỗi tải, cho phép thử lại
  const [activeImage, setActiveImage] = useState(0)

  // Đánh số mỗi lần gọi: đổi slug nhanh khiến nhiều request cùng bay,
  // request cũ về sau sẽ ghi đè tour mới nếu không bỏ qua kết quả lỗi thời.
  const requestId = useRef(0)

  async function load() {
    const id = ++requestId.current
    setLoading(true)
    setNotice('')
    setError('')
    try {
      const res = await getTourBySlug(slug)
      if (id !== requestId.current) return // đã có request mới hơn — bỏ kết quả này
      if (!res.success) {
        setTour(null)
        // Hiển thị đúng message service/Backend trả về, chỉ fallback khi rỗng (§14)
        setNotice(res.message || 'Không xem được tour này.')
        return
      }
      setTour(res.data)
      setActiveImage(0)
    } catch {
      if (id !== requestId.current) return
      setTour(null)
      setError('Không tải được thông tin tour.')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  return (
    <div className="wrap py-[42px]">
      {/* (a) Quay lại danh sách */}
      <Link to="/tours" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-teal hover:text-teal2">
        ← Về danh sách tour
      </Link>

      {/* Trạng thái 1 — đang tải */}
      {loading && (
        <div className="mt-6">
          <DetailSkeleton />
        </div>
      )}

      {/* Trạng thái 2 — tour không tồn tại hoặc không còn mở bán */}
      {!loading && notice && (
        <div className="card-surface mx-auto mt-10 max-w-[560px] p-8 text-center">
          <p className="font-heading text-[20px] font-semibold text-ink">{notice}</p>
          <p className="mt-2 text-[14.5px] text-muted">
            Bạn có thể quay lại danh sách để chọn hành trình khác.
          </p>
          <Link to="/tours" className="btn-teal mt-5">
            Về danh sách tour
          </Link>
        </div>
      )}

      {/* Trạng thái 3 — lỗi tải, cho thử lại */}
      {!loading && error && (
        <div className="card-surface mx-auto mt-10 max-w-[560px] p-8 text-center">
          <p className="text-coralD">{error}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button type="button" className="btn-teal" onClick={load}>
              Thử lại
            </button>
            <Link to="/tours" className="btn-ghost">
              Về danh sách tour
            </Link>
          </div>
        </div>
      )}

      {/* Trạng thái 4 — có dữ liệu */}
      {!loading && !notice && !error && tour && (
        <div className="mt-6">
          {/* (b) Ảnh lớn 16/9 + thumbnail đổi ảnh */}
          <div className="overflow-hidden rounded-card border border-line bg-sand">
            <img
              src={tour.images?.[activeImage]}
              alt={tour.name}
              className="aspect-[16/9] w-full object-cover"
            />
          </div>
          {tour.images?.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {tour.images.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveImage(i)}
                  aria-label={`Xem ảnh ${i + 1}`}
                  className={`overflow-hidden rounded-[12px] border-2 transition ${
                    i === activeImage ? 'border-teal' : 'border-line hover:border-jade'
                  }`}
                >
                  <img src={src} alt="" className="aspect-[16/9] w-[110px] object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* (c) Tiêu đề + thông tin nhanh */}
          <p className="eyebrow mt-7">{tour.region}</p>
          <h1 className="mt-2 font-heading text-[30px] font-semibold text-ink">{tour.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14.5px] text-muted">
            <span>📍 {tour.location}</span>
            <span>{tour.days} ngày</span>
            <span className="flex items-center gap-1">
              <span className="text-gold">★</span>
              <span className="font-semibold text-ink">{tour.avgRating.toFixed(1)}</span>
              <span>({tour.reviews?.length ?? 0} đánh giá)</span>
            </span>
          </div>

          {/* (d) Giá + nút đặt tour */}
          <div className="card-surface mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-baseline gap-3">
              <span className="font-heading text-[26px] font-semibold text-coralD">
                {formatPrice(tour.basePrice)}
              </span>
              {tour.oldPrice != null && (
                <span className="text-[15px] text-muted line-through">{formatPrice(tour.oldPrice)}</span>
              )}
              <span className="text-[13.5px] text-muted">/ khách</span>
            </div>
            {/* Chưa gắn hành động — luồng đặt tour (UC-08) thuộc Tuần 4 */}
            <button type="button" className="btn-coral">
              Đặt tour ngay
            </button>
          </div>

          {/* (e) Mô tả */}
          <section className="mt-9">
            <h2 className="font-heading text-[21px] font-semibold text-ink">Giới thiệu hành trình</h2>
            <p className="mt-3 text-[15px] leading-[1.75] text-muted">{tour.description}</p>
          </section>

          {/* (f) Lịch trình từng ngày */}
          <section className="mt-9">
            <h2 className="font-heading text-[21px] font-semibold text-ink">Lịch trình chi tiết</h2>
            <div className="mt-4 flex flex-col gap-4">
              {tour.itinerary?.map((day) => (
                <article key={day.dayNumber} className="card-surface p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-pill bg-teal px-3 py-1 text-[13px] font-semibold text-white">
                      Ngày {day.dayNumber}
                    </span>
                    <h3 className="font-heading text-[17px] font-semibold text-ink">{day.title}</h3>
                  </div>
                  <p className="mt-3 text-[14.5px] leading-[1.7] text-muted">{day.description}</p>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13.5px] text-muted">
                    <span>🍽 Bữa ăn: {day.meals?.length ? day.meals.join(', ') : 'Tự túc'}</span>
                    <span>🏨 Nghỉ đêm: {day.accommodation || 'Không lưu trú'}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* (g) Đợt khởi hành */}
          <section className="mt-9">
            <h2 className="font-heading text-[21px] font-semibold text-ink">Đợt khởi hành</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tour.departures?.map((dep) => {
                const soldOut = dep.availableSlots <= 0
                return (
                  <div
                    key={dep.date}
                    className={`card-surface p-5 ${soldOut ? 'opacity-60' : ''}`}
                  >
                    <p className="text-[13px] text-muted">Ngày khởi hành</p>
                    <p className="mt-1 font-heading text-[18px] font-semibold text-ink">
                      {formatDate(dep.date)}
                    </p>
                    <p className="mt-2 font-semibold text-coralD">{formatPrice(dep.price)}</p>
                    {soldOut ? (
                      <span className="mt-3 inline-block rounded-pill bg-sand px-3 py-1 text-[13px] font-semibold text-muted">
                        Hết chỗ
                      </span>
                    ) : (
                      <span className="mt-3 inline-block rounded-pill bg-jade/10 px-3 py-1 text-[13px] font-semibold text-jade">
                        Còn {dep.availableSlots} chỗ
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* (h) Chính sách hủy */}
          <section className="mt-9">
            <h2 className="font-heading text-[21px] font-semibold text-ink">Chính sách hủy tour</h2>
            <p className="mt-3 rounded-card bg-sand p-5 text-[14.5px] leading-[1.75] text-muted">
              {tour.cancellationPolicy}
            </p>
          </section>

          {/* (i) Đánh giá khách hàng — chỉ hiển thị, form đánh giá thuộc Tuần 4–5 (UC-11) */}
          <section className="mt-9">
            <h2 className="font-heading text-[21px] font-semibold text-ink">Đánh giá của khách</h2>
            {tour.reviews?.length > 0 ? (
              <div className="mt-4 flex flex-col gap-4">
                {tour.reviews.map((rv, i) => (
                  <article key={i} className="card-surface p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{rv.user}</span>
                      <span className="text-[13px] text-muted">{formatDate(rv.createdAt)}</span>
                    </div>
                    <div className="mt-1 text-[14px] text-gold">
                      {'★'.repeat(rv.rating)}
                      <span className="text-line">{'★'.repeat(5 - rv.rating)}</span>
                    </div>
                    <p className="mt-2 text-[14.5px] leading-[1.7] text-muted">{rv.comment}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-muted">Tour này chưa có đánh giá nào.</p>
            )}
          </section>

          {/* (j) CTA hỏi trợ lý AI — chưa gắn hành động, chat AI (UC-07) thuộc Tuần 5 */}
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-card bg-teal p-6">
            <div>
              <p className="font-heading text-[19px] font-semibold text-white">
                Còn băn khoăn về hành trình này?
              </p>
              <p className="mt-1 text-[14.5px] text-white/80">
                Trợ lý AI có thể tư vấn thời điểm đi, chi phí và điểm đến tương tự.
              </p>
            </div>
            <button type="button" className="btn-coral">
              Hỏi trợ lý AI về tour này
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
