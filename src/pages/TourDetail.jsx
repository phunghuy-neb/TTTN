import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { getTourBySlug } from '../services/tourService.js'
import { formatPrice, formatDate } from '../utils/format.js'
import { useAuth } from '../context/AuthContext.jsx'
import Button from '../components/ui/Button.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'
import { useRequestGuard } from '../hooks/useRequestGuard.js'

// Khung xương lúc đang tải
function DetailSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[16/9] w-full rounded-card" />
      <div className="mt-3 flex gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[16/9] w-[110px] rounded-[12px]" />
        ))}
      </div>
      <Skeleton className="mt-7 h-4 w-[120px] rounded" />
      <Skeleton className="mt-3 h-8 w-2/3 rounded" />
      <Skeleton className="mt-3 h-4 w-1/2 rounded" />
      <Skeleton className="mt-7 h-[120px] w-full rounded-card" />
      <Skeleton className="mt-6 h-[220px] w-full rounded-card" />
    </div>
  )
}

// Tên người đánh giá chịu được 3 dạng dữ liệu:
//  - object đã populate  → lấy .name
//  - chuỗi 24 ký tự hex  → ObjectId thô chưa populate, không có tên để hiện
//  - chuỗi thường        → tên người (dữ liệu mock thời Tuần 2)
function tenNguoiDanhGia(user) {
  if (user && typeof user === 'object') return user.name || 'Khách hàng'
  if (typeof user === 'string' && /^[0-9a-fA-F]{24}$/.test(user)) return 'Khách hàng'
  return user || 'Khách hàng'
}

// Trang chi tiết tour (UC-06) — lấy theo slug qua tầng service
export default function TourDetail() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [tour, setTour] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('') // service trả success:false — tour không xem được
  const [error, setError] = useState('') // lỗi tải, cho phép thử lại
  const [activeImage, setActiveImage] = useState(0)

  // Hộp đặt tour (UC-08): đợt khởi hành đang chọn theo departure._id (khóa ổn định
  // từ Backend — không khớp chuỗi ngày nữa) + số khách đang gõ.
  // Giữ số khách dạng chuỗi để ô nhập không nhảy giá trị khi người dùng xóa tạm.
  const [dotChonId, setDotChonId] = useState('')
  const [soKhachText, setSoKhachText] = useState('1')

  // Chống race condition khi đổi slug nhanh — xem hooks/useRequestGuard.js
  const beginRequest = useRequestGuard()

  async function load() {
    const isCurrent = beginRequest()
    setLoading(true)
    setNotice('')
    setError('')
    try {
      const res = await getTourBySlug(slug)
      if (!isCurrent()) return // đã có request mới hơn — bỏ kết quả này
      if (!res.success) {
        setTour(null)
        // Hiển thị đúng message service/Backend trả về, chỉ fallback khi rỗng (§14)
        setNotice(res.message || 'Không xem được tour này.')
        return
      }
      setTour(res.data)
      setActiveImage(0)
      // Đổi tour → bỏ lựa chọn cũ của hộp đặt tour
      setDotChonId('')
      setSoKhachText('1')
    } catch {
      if (!isCurrent()) return
      setTour(null)
      setError('Không tải được thông tin tour.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // Đợt khởi hành đang chọn (theo _id) + kiểm tra số khách so với số chỗ còn của đợt đó
  const dotChon = tour?.departures?.find((d) => d._id === dotChonId) || null
  const soKhach = Number(soKhachText)
  let loiSoKhach = ''
  if (!Number.isInteger(soKhach) || soKhach < 1) {
    loiSoKhach = 'Số khách phải là số nguyên từ 1 trở lên.'
  } else if (dotChon && soKhach > dotChon.availableSlots) {
    loiSoKhach = `Đợt này chỉ còn ${dotChon.availableSlots} chỗ. Vui lòng giảm số khách hoặc chọn đợt khác.`
  }
  // Tổng tiền = giá đợt × số khách — chỉ tính khi đã chọn đợt và số khách hợp lệ
  const tongTien = dotChon && !loiSoKhach ? dotChon.price * soKhach : null

  // Bấm "Đặt tour ngay": chưa đăng nhập → sang /login kèm from để quay lại trang này;
  // đã đăng nhập → mang dữ liệu đơn sang trang xác nhận /checkout
  function datTour() {
    if (!dotChon || loiSoKhach) return
    if (!user) {
      navigate('/login', { state: { from: location } })
      return
    }
    navigate('/checkout', {
      state: {
        tourId: tour._id,
        slug: tour.slug,
        tourName: tour.name,
        // Định danh đợt bằng _id — Backend trừ/hoàn chỗ theo departureId,
        // date chỉ còn là dữ liệu hiển thị
        departureId: dotChon._id,
        departureDate: dotChon.date,
        guests: soKhach,
        unitPrice: dotChon.price,
        totalPrice: dotChon.price * soKhach,
        image: tour.images?.[0] || '',
      },
    })
  }

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
        <EmptyState
          className="mx-auto mt-10 max-w-[560px]"
          title={notice}
          description="Bạn có thể quay lại danh sách để chọn hành trình khác."
          action={
            <Link to="/tours" className="btn-teal">
              Về danh sách tour
            </Link>
          }
        />
      )}

      {/* Trạng thái 3 — lỗi tải, cho thử lại */}
      {!loading && error && (
        <div className="card-surface mx-auto mt-10 max-w-[560px] p-8 text-center">
          <p className="text-coralD">{error}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={load}>Thử lại</Button>
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

          {/* (d) Hộp đặt tour (UC-08) — chọn đợt khởi hành, nhập số khách, tổng tiền tự cập nhật */}
          <div className="card-surface mt-6 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <span className="font-heading text-[26px] font-semibold text-coralD">
                  {formatPrice(dotChon ? dotChon.price : tour.basePrice)}
                </span>
                {!dotChon && tour.oldPrice != null && (
                  <span className="text-[15px] text-muted line-through">{formatPrice(tour.oldPrice)}</span>
                )}
                <span className="text-[13.5px] text-muted">/ khách</span>
              </div>
              <span className="text-[13.5px] text-muted">
                {dotChon ? `Đợt khởi hành ${formatDate(dotChon.date)}` : 'Giá thay đổi theo đợt khởi hành'}
              </span>
            </div>

            {/* Danh sách đợt khởi hành — đợt hết chỗ bị vô hiệu hóa */}
            <p className="field-label">Chọn đợt khởi hành</p>
            {tour.departures?.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tour.departures.map((dep) => {
                  const hetCho = dep.availableSlots <= 0
                  const dangChon = dep._id === dotChonId
                  return (
                    <button
                      key={dep._id}
                      type="button"
                      disabled={hetCho}
                      onClick={() => setDotChonId(dep._id)}
                      className={`rounded-card border-[1.5px] p-4 text-left transition ${
                        dangChon ? 'border-teal bg-teal/5' : 'border-line bg-white hover:border-jade'
                      } ${hetCho ? 'cursor-not-allowed opacity-60 hover:border-line' : ''}`}
                    >
                      <span className="block font-heading text-[16px] font-semibold text-ink">
                        {formatDate(dep.date)}
                      </span>
                      <span className="mt-1 block font-semibold text-coralD">{formatPrice(dep.price)}</span>
                      {hetCho ? (
                        <span className="mt-2 inline-block rounded-pill bg-sand px-3 py-1 text-[13px] font-semibold text-muted">
                          Hết chỗ
                        </span>
                      ) : (
                        <span className="mt-2 inline-block rounded-pill bg-jade/10 px-3 py-1 text-[13px] font-semibold text-jade">
                          Còn {dep.availableSlots} chỗ
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-[14.5px] text-muted">Tour chưa mở đợt khởi hành nào.</p>
            )}

            {/* Số khách + tổng tiền + nút đặt */}
            <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="w-full max-w-[180px]">
                <label htmlFor="soKhach" className="field-label !mt-0">Số khách</label>
                <input
                  id="soKhach"
                  type="number"
                  min="1"
                  max={dotChon ? dotChon.availableSlots : undefined}
                  value={soKhachText}
                  onChange={(e) => setSoKhachText(e.target.value)}
                  className={`field-input ${loiSoKhach ? 'field-input--error' : ''}`}
                />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-semibold text-muted">Tổng tiền</p>
                <p className="font-heading text-[24px] font-semibold text-coralD">
                  {tongTien != null ? formatPrice(tongTien) : '—'}
                </p>
              </div>
              <Button variant="coral" disabled={!dotChon || !!loiSoKhach} onClick={datTour}>
                Đặt tour ngay
              </Button>
            </div>
            {loiSoKhach && <div className="field-error">{loiSoKhach}</div>}
            {!dotChon && tour.departures?.length > 0 && (
              <p className="mt-2 text-[13px] text-muted">Chọn một đợt khởi hành để đặt tour.</p>
            )}
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

          {/* (g) Đợt khởi hành — đã gộp vào hộp đặt tour (d) để chọn trực tiếp, không hiển thị trùng */}

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
                      <span className="font-semibold text-ink">{tenNguoiDanhGia(rv.user)}</span>
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
            <Button variant="coral">Hỏi trợ lý AI về tour này</Button>
          </div>
        </div>
      )}
    </div>
  )
}
