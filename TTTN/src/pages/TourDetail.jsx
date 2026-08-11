import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { getTourBySlug, getTours } from '../services/tourService.js'
import { formatPrice, formatDate } from '../utils/format.js'
import { useAuth } from '../context/AuthContext.jsx'
import Button from '../components/ui/Button.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'
import TourCard from '../components/TourCard.jsx'
import { useRequestGuard } from '../hooks/useRequestGuard.js'
import { emitOpenChat } from '../components/chat/chatEvents.js'

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
  const [relatedTours, setRelatedTours] = useState([])
  const [recentTours, setRecentTours] = useState([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('') // service trả success:false — tour không xem được
  const [error, setError] = useState('') // lỗi tải, cho phép thử lại
  const [activeImage, setActiveImage] = useState(0)

  // Hộp đặt tour (UC-08): đợt khởi hành đang chọn theo departure._id (khóa ổn định
  // từ Backend — không khớp chuỗi ngày nữa) + số khách đang gõ.
  // Giữ số khách dạng chuỗi để ô nhập không nhảy giá trị khi người dùng xóa tạm.
  const [dotChonId, setDotChonId] = useState('')
  const [soKhachText, setSoKhachText] = useState('1')
  const [selectedMonthTab, setSelectedMonthTab] = useState('all')
  const [limitDepartures, setLimitDepartures] = useState(5) // Hiển thị ban đầu 5 đợt

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
      // Đổi tour → tự động chọn đợt khởi hành đầu tiên còn chỗ
      const availableDep = res.data.departures?.find(d => d.availableSlots > 0)
      setDotChonId(availableDep ? availableDep._id : '')
      setSoKhachText('1')

      // Lấy tour liên quan
      try {
        const relatedRes = await getTours({ region: res.data.region, limit: 5 })
        if (relatedRes.success && isCurrent()) {
          // Bỏ tour hiện tại ra
          setRelatedTours(relatedRes.data.filter(t => t._id !== res.data._id).slice(0, 4))
        }
      } catch (e) {
        console.error('Failed to load related tours', e)
      }

      // Xử lý localStorage cho tour đã xem
      try {
        const stored = localStorage.getItem('vietvoyage_recent_tours')
        let recents = stored ? JSON.parse(stored) : []
        
        // Lấy danh sách để hiển thị (chưa có tour hiện tại nếu load lần đầu)
        setRecentTours(recents.filter(t => t._id !== res.data._id))
        
        // Cập nhật lại localStorage với tour hiện tại lên đầu
        const simpleTour = {
          _id: res.data._id,
          slug: res.data.slug,
          name: res.data.name,
          location: res.data.location,
          days: res.data.days,
          basePrice: res.data.basePrice,
          oldPrice: res.data.oldPrice,
          images: [res.data.images?.[0]],
          avgRating: res.data.avgRating,
        }
        recents = [simpleTour, ...recents.filter(t => t._id !== res.data._id)].slice(0, 4)
        localStorage.setItem('vietvoyage_recent_tours', JSON.stringify(recents))
      } catch (e) {
        console.error('Failed to load recent tours', e)
      }
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

  // Logic hiển thị lịch khởi hành đa dạng dạng tab
  const availableMonths = []
  if (tour?.departures?.length > 0) {
    const monthSet = new Set()
    tour.departures.forEach(dep => {
      const d = new Date(dep.date)
      const mStr = `${d.getMonth() + 1}/${d.getFullYear()}`
      monthSet.add(mStr)
    })
    availableMonths.push(...Array.from(monthSet))
  }

  const filteredDepartures = tour?.departures?.filter(dep => {
    if (selectedMonthTab === 'all') return true
    const d = new Date(dep.date)
    return `${d.getMonth() + 1}/${d.getFullYear()}` === selectedMonthTab
  }) || []

  // Hàm tính ngày kết thúc
  const getEndDate = (startDateStr, days) => {
    const start = new Date(startDateStr)
    const end = new Date(start.getTime() + (days - 1) * 86400000)
    return formatDate(end.toISOString())
  }
  
  // Hàm hiển thị thứ
  const getDayOfWeek = (dateStr) => {
    const d = new Date(dateStr)
    const days = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
    return days[d.getDay()]
  }

  // Gom tất cả ảnh từ các đánh giá
  const allReviewImages = tour?.reviews?.reduce((acc, rv) => {
    if (rv.images && rv.images.length > 0) {
      acc.push(...rv.images)
    }
    return acc
  }, []) || []

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

            {/* Danh sách đợt khởi hành — giao diện Tab giống iVIVU */}
            <div className="mt-8 flex items-center justify-between border-b-[1.5px] border-line pb-4">
              <div>
                <h3 className="font-heading text-[22px] font-semibold text-ink">Lịch khởi hành</h3>
                <p className="mt-1 text-[14.5px] text-muted">Chọn ngày và số khách để xem tổng giá chính xác</p>
              </div>
            </div>

            {tour.departures?.length > 0 ? (
              <div className="mt-5">
                {/* Thanh Tabs */}
                <div className="flex flex-wrap gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
                  <button
                    onClick={() => { setSelectedMonthTab('all'); setLimitDepartures(5); }}
                    className={`whitespace-nowrap rounded-full px-5 py-2 text-[14.5px] font-medium transition ${
                      selectedMonthTab === 'all' ? 'border border-teal bg-teal/5 text-teal' : 'text-ink hover:bg-sand'
                    }`}
                  >
                    Tất cả
                  </button>
                  {availableMonths.map((mStr, idx) => (
                    <button
                      key={idx}
                      onClick={() => { setSelectedMonthTab(mStr); setLimitDepartures(5); }}
                      className={`whitespace-nowrap rounded-full px-5 py-2 text-[14.5px] font-medium transition ${
                        selectedMonthTab === mStr ? 'border border-teal bg-teal/5 text-teal' : 'text-ink hover:bg-sand'
                      }`}
                    >
                      Tháng {mStr.split('/')[0]} {mStr.split('/')[1]}
                    </button>
                  ))}
                </div>

                {/* Danh sách List dọc */}
                <div className="flex flex-col gap-3">
                  {filteredDepartures.slice(0, limitDepartures).map((dep) => {
                    const hetCho = dep.availableSlots <= 0
                    const dangChon = dep._id === dotChonId
                    const dObj = new Date(dep.date)
                    const dateFormatted = `${String(dObj.getDate()).padStart(2, '0')}/${String(dObj.getMonth() + 1).padStart(2, '0')}`
                    
                    return (
                      <div
                        key={dep._id}
                        onClick={() => !hetCho && setDotChonId(dep._id)}
                        className={`group flex flex-col items-center justify-between gap-4 rounded-[12px] border-[1.5px] p-4 transition md:flex-row ${
                          dangChon ? 'border-teal bg-teal/5' : 'border-line bg-white'
                        } ${hetCho ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-teal/50 hover:shadow-sm'}`}
                      >
                        {/* Cột 1: Thứ + Ngày */}
                        <div className="flex w-full min-w-[80px] flex-col items-center text-center md:w-auto">
                          <span className="text-[13.5px] text-muted">{getDayOfWeek(dep.date)}</span>
                          <span className="font-heading text-[18px] font-bold text-ink">{dateFormatted}</span>
                        </div>
                        
                        {/* Cột 2: Thời gian + Số chỗ */}
                        <div className="flex w-full flex-1 flex-col justify-center text-center md:px-4 md:text-left">
                          <span className="font-medium text-ink">
                            {formatDate(dep.date)} - {getEndDate(dep.date, tour.days)}
                          </span>
                          {hetCho ? (
                            <span className="mt-1 text-[13.5px] font-medium text-coralD">Liên hệ</span>
                          ) : (
                            <span className="mt-1 text-[13.5px] font-medium text-jade">Còn {dep.availableSlots} chỗ</span>
                          )}
                        </div>

                        {/* Cột 3: Giá */}
                        <div className="flex w-full flex-col items-center justify-center md:w-auto md:items-end">
                          <span className="font-heading text-[18px] font-bold text-coralD">
                            {formatPrice(dep.price)}
                          </span>
                          <span className="text-[13.5px] text-muted">/ khách</span>
                        </div>

                        {/* Cột 4: Nút Chọn */}
                        <div className="w-full shrink-0 md:w-auto">
                          <button
                            type="button"
                            disabled={hetCho}
                            onClick={(e) => {
                              e.stopPropagation();
                              if(!hetCho) setDotChonId(dep._id);
                            }}
                            className={`w-full rounded-full border px-6 py-2 text-[14.5px] font-medium transition md:w-[120px] ${
                              dangChon ? 'border-teal bg-teal text-white' : 
                              hetCho ? 'border-line bg-sand text-muted' : 
                              'border-teal text-teal group-hover:bg-teal group-hover:text-white'
                            }`}
                          >
                            {dangChon ? 'Đang chọn' : 'Chọn'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  
                  {filteredDepartures.length === 0 && (
                    <p className="py-4 text-center text-muted">Không có đợt khởi hành nào trong tháng này.</p>
                  )}
                  
                  {limitDepartures < filteredDepartures.length && (
                    <button
                      type="button"
                      onClick={() => setLimitDepartures(filteredDepartures.length)}
                      className="mt-2 w-full rounded-[12px] bg-sand py-3 text-[14.5px] font-semibold text-teal transition hover:bg-teal/10"
                    >
                      Xem thêm {filteredDepartures.length - limitDepartures} ngày khởi hành ∨
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-[14.5px] text-muted">Tour chưa mở đợt khởi hành nào.</p>
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

          {/* (e) Điểm nổi bật */}
          {tour.highlights && tour.highlights.length > 0 && (
            <section className="mt-9">
              <h2 className="font-heading text-[21px] font-semibold text-ink">Điểm nổi bật tour</h2>
              <p className="mt-1 text-[14.5px] text-muted mb-4">Những trải nghiệm chính trong hành trình.</p>
              <div className="flex flex-col gap-3">
                {tour.highlights.map((hl, i) => (
                  <div key={i} className="text-[14.5px] leading-[1.6] text-ink">
                    <span className="font-semibold text-teal mr-2">{hl.substring(0, 2)}</span>
                    <span className="font-semibold">{hl.substring(4).split('\n')[0]}</span>
                    {hl.split('\n')[1] && <p className="text-muted mt-1 ml-6">{hl.split('\n').slice(1).join('\n')}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* (f) Lịch trình từng ngày (Flat) */}
          <section className="mt-9">
            <h2 className="font-heading text-[21px] font-semibold text-ink">Lịch trình chi tiết</h2>
            <p className="mt-1 text-[14.5px] text-muted mb-4">Hoạt động chính từng ngày.</p>
            <div className="mt-4 flex flex-col gap-3">
              {tour.itinerary?.map((day) => (
                <div key={day.dayNumber} className="group card-surface">
                  <div className="flex items-center justify-between p-5 font-heading text-[17px] font-semibold text-ink">
                    <div className="flex items-center gap-3">
                      <span className="rounded-pill bg-teal px-3 py-1 text-[13px] font-semibold text-white">
                        Ngày {day.dayNumber}
                      </span>
                      <span>{day.title}</span>
                    </div>
                  </div>
                  <div className="p-5 pt-0 border-t border-line mt-1">
                    <p className="mt-4 text-[14.5px] leading-[1.7] text-muted whitespace-pre-line">{day.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* (h) Bao gồm & Chưa bao gồm */}
          {(tour.inclusions?.length > 0 || tour.exclusions?.length > 0) && (
            <section className="mt-9">
              <h2 className="font-heading text-[21px] font-semibold text-ink">Bao gồm & chưa bao gồm</h2>
              <p className="mt-1 text-[14.5px] text-muted mb-4">Các dịch vụ chính trong giá tour.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {tour.inclusions?.length > 0 && (
                  <div className="card-surface p-5">
                    <h3 className="font-heading text-[17px] font-semibold text-teal flex items-center gap-2">
                      <span className="text-xl">✓</span> Giá tour bao gồm
                    </h3>
                    <ul className="mt-4 flex flex-col gap-3">
                      {tour.inclusions.map((item, i) => (
                        <li key={i} className="text-[14.5px] text-muted">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {tour.exclusions?.length > 0 && (
                  <div className="card-surface p-5">
                    <h3 className="font-heading text-[17px] font-semibold text-coralD flex items-center gap-2">
                      <span className="text-xl">✕</span> Chưa bao gồm
                    </h3>
                    <ul className="mt-4 flex flex-col gap-3">
                      {tour.exclusions.map((item, i) => (
                        <li key={i} className="text-[14.5px] text-muted">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* (g) Đợt khởi hành — đã gộp vào hộp đặt tour (d) để chọn trực tiếp, không hiển thị trùng */}

          {/* (h) Lưu ý quan trọng */}
          <section className="mt-9">
            <h2 className="font-heading text-[21px] font-semibold text-ink">Lưu ý quan trọng</h2>
            <p className="mt-1 text-[14.5px] text-muted mb-4">Thông tin cần biết trước khi đặt tour.</p>
            <div className="flex flex-col gap-3">
              
              {/* 1. Chính sách trẻ em */}
              <details className="group border border-line rounded-[8px] bg-white overflow-hidden transition-all duration-300">
                <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold text-ink hover:bg-teal/5 transition-colors list-none [&::-webkit-details-marker]:hidden">
                  <span className="font-heading text-[16px]">Chính sách trẻ em</span>
                  <span className="text-teal text-xl font-light group-open:hidden">+</span>
                  <span className="text-teal text-xl font-light hidden group-open:inline">-</span>
                </summary>
                <div className="p-4 pt-0 text-[14.5px] text-muted leading-[1.8] whitespace-pre-line border-t border-line/50 mt-1">
                  <p className="font-semibold text-ink mb-1 mt-2">1. Quy định chung:</p>
                  <ul className="list-disc pl-5 mb-3 flex flex-col gap-1">
                    <li>Mỗi 02 người lớn được kèm 01 trẻ em.</li>
                    <li>Từ trẻ thứ 02 trở đi, áp dụng mức giá theo quy định của từng nhóm tuổi (nêu bên dưới).</li>
                    <li>Trẻ em ngủ chung giường với bố mẹ. (Nếu cần giường riêng tính như người lớn).</li>
                    <li>Chi phí ngoài chương trình (nếu có) gia đình tự chi trả.</li>
                  </ul>
                  <p className="font-semibold text-ink mb-1 mt-4">2. Quy định theo độ tuổi:</p>
                  <ul className="list-disc pl-5 mb-3 flex flex-col gap-1">
                    <li>Dưới 2 tuổi: Giá theo website. Sử dụng dịch vụ và ngủ chung giường với bố mẹ.</li>
                    <li>Từ 2 - 10 tuổi: Giá theo website. Bao gồm đầy đủ dịch vụ trong chương trình. Ngủ chung giường với bố mẹ. Từ trẻ thứ 02 trở đi: tính 100% giá người lớn.</li>
                    <li>Trẻ em từ 11 tuổi trở lên: Tính 100% giá người lớn.</li>
                    <li>Trong trường hợp chỉ có 01 khách (người lớn) đi với 01 bé (dưới 11 tuổi), bé được tính giá vé người lớn để đảm bảo dịch vụ theo quy định.</li>
                  </ul>
                  <p className="font-semibold text-ink mb-1 mt-4">3. Giấy tờ tùy thân khi tham gia tour:</p>
                  <ul className="list-disc pl-5 flex flex-col gap-1">
                    <li>Hộ chiếu bản chính và các giấy tờ cần thiết.</li>
                    <li>Trẻ em dưới 16 tuổi bắt buộc mang theo giấy khai sinh.</li>
                    <li>Trẻ em cần có bố mẹ hoặc người thân trên 18 tuổi đi cùng; trường hợp đi cùng người thân cần có giấy ủy quyền hợp lệ.</li>
                    <li>Trẻ em có hộ chiếu ghép với bố/mẹ không đủ điều kiện xin visa đoàn.</li>
                  </ul>
                </div>
              </details>

              {/* 2. Chính sách hủy & thay đổi */}
              <details className="group border border-line rounded-[8px] bg-white overflow-hidden transition-all duration-300">
                <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold text-ink hover:bg-teal/5 transition-colors list-none [&::-webkit-details-marker]:hidden">
                  <span className="font-heading text-[16px]">Chính sách hủy & thay đổi</span>
                  <span className="text-teal text-xl font-light group-open:hidden">+</span>
                  <span className="text-teal text-xl font-light hidden group-open:inline">-</span>
                </summary>
                <div className="p-4 pt-0 text-[14.5px] text-muted leading-[1.8] border-t border-line/50 mt-1">
                  <ul className="list-disc pl-5 flex flex-col gap-2 mt-2">
                    <li>Hủy từ thời điểm đăng ký đến trước 30 ngày khởi hành: 100% tiền cọc.</li>
                    <li>Hủy trước 30 ngày trước khởi hành: 50% tổng giá tour.</li>
                    <li>Hủy trước 20 ngày trước khởi hành: 75% tổng giá tour.</li>
                    <li>Sau thời gian trên: 100% tổng giá tour.</li>
                    <li>Thời gian hủy tour được ghi nhận trong giờ làm việc và tính theo ngày làm việc (không bao gồm Thứ Bảy, Chủ Nhật và Lễ/Tết). Các yêu cầu gửi ngoài giờ làm việc sẽ được tính từ đầu giờ làm việc của ngày kế tiếp.</li>
                    <li>Quý khách vui lòng gửi yêu cầu hủy qua email hoặc kênh liên hệ chính thức của công ty để được ghi nhận. Thông báo qua điện thoại sẽ chưa được xem là căn cứ áp dụng chính sách hủy.</li>
                    <li>Trường hợp khách đặt tour theo nhóm: Nếu một thành viên không đạt visa và gia đình yêu cầu hủy toàn bộ tour, công ty chỉ hỗ trợ hủy đối với khách không đậu visa. Các thành viên đã được cấp visa vẫn áp dụng điều khoản phí hủy tour theo quy định chung.</li>
                  </ul>
                </div>
              </details>

              {/* 3. Thông tin Visa */}
              <details className="group border border-line rounded-[8px] bg-white overflow-hidden transition-all duration-300">
                <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold text-ink hover:bg-teal/5 transition-colors list-none [&::-webkit-details-marker]:hidden">
                  <span className="font-heading text-[16px]">Thông tin Visa</span>
                  <span className="text-teal text-xl font-light group-open:hidden">+</span>
                  <span className="text-teal text-xl font-light hidden group-open:inline">-</span>
                </summary>
                <div className="p-4 pt-0 text-[14.5px] text-muted leading-[1.8] border-t border-line/50 mt-1">
                  <p className="font-semibold text-ink mb-1 mt-2">Giấy tờ cần chuẩn bị:</p>
                  <ul className="list-disc pl-5 mb-3 flex flex-col gap-1">
                    <li>Hộ chiếu còn hạn trên 6 tháng tính từ ngày kết thúc tour. Scan hoặc chụp hình: để dẹt 180 độ, không được mất góc, không dính ngón tay.</li>
                    <li>Ảnh 4x6 nền trắng, chụp trong vòng 6 tháng: nền trắng, chụp rõ ngũ quan, không cười, không đeo trang sức, không dùng phần mềm chỉnh sửa. (Chỉ nhận file hình, không nhận hình gốc).</li>
                  </ul>
                  <p className="font-semibold text-ink mb-1 mt-4">Lưu ý về tình trạng cư trú & giấy tờ:</p>
                  <ul className="list-disc pl-5 flex flex-col gap-1">
                    <li>Quý khách mang 2 quốc tịch, Travel Document hoặc tình trạng cư trú đặc biệt vui lòng thông báo khi đăng ký và cung cấp đầy đủ giấy tờ liên quan.</li>
                    <li>Khách chỉ có thẻ xanh nhưng không còn hộ chiếu Việt Nam còn hiệu lực sẽ không đủ điều kiện đăng ký tour sang nước thứ ba.</li>
                    <li>Khách là Việt Kiều hoặc quốc tịch nước ngoài có visa rời nhập cảnh Việt Nam cần mang theo khi tham gia tour.</li>
                    <li>Trường hợp sử dụng ABTC (APEC), hộ chiếu công vụ, ngoại giao hoặc tự xin visa, vui lòng thông báo trước để được tư vấn phù hợp.</li>
                    <li>Hồ sơ visa có thể bị từ chối hoặc kéo dài bởi cơ quan có thẩm quyền; chi phí phát sinh sẽ xử lý theo quy định tour. Trường hợp thay đổi chính sách hoặc phí visa, chi phí sẽ được cập nhật theo quy định mới.</li>
                  </ul>
                </div>
              </details>

              {/* 4. Điều kiện tham gia tour */}
              <details className="group border border-line rounded-[8px] bg-white overflow-hidden transition-all duration-300">
                <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold text-ink hover:bg-teal/5 transition-colors list-none [&::-webkit-details-marker]:hidden">
                  <span className="font-heading text-[16px]">Điều kiện tham gia tour</span>
                  <span className="text-teal text-xl font-light group-open:hidden">+</span>
                  <span className="text-teal text-xl font-light hidden group-open:inline">-</span>
                </summary>
                <div className="p-4 pt-0 text-[14.5px] text-muted leading-[1.8] border-t border-line/50 mt-1">
                  <p className="font-semibold text-ink mb-1 mt-2">Độ tuổi & sức khỏe:</p>
                  <ul className="list-disc pl-5 mb-3 flex flex-col gap-1">
                    <li>Tour áp dụng cho khách dưới 70 tuổi.</li>
                    <li>Khách từ 70 tuổi trở lên cần đóng thêm phí bảo hiểm cao cấp theo quy định. Nếu Quý khách có bệnh nền, thể trạng không tốt, cần cung cấp giấy xác nhận đủ sức khỏe do cơ sở y tế có thẩm quyền cấp và có người thân dưới 60 tuổi đi cùng.</li>
                    <li>Khách mang thai vui lòng thông báo khi đăng ký, cần có ý kiến bác sĩ trước khi tham gia tour. Vì lý do an toàn không nhận khách mang thai từ 5 tháng trở lên.</li>
                    <li>Quý khách cần đảm bảo sức khỏe phù hợp để tham gia các hoạt động trong tour. Nếu có điều kiện sức khỏe đặc biệt, vui lòng thông báo cho nhân viên tư vấn trước khi đặt tour. Quý khách có thể được yêu cầu cung cấp chứng nhận sức khỏe hoặc ký cam kết trong một số trường hợp cần thiết.</li>
                  </ul>
                  <p className="font-semibold text-ink mb-1 mt-4">Quy định theo đoàn:</p>
                  <ul className="list-disc pl-5 mb-3 flex flex-col gap-1">
                    <li>Chương trình có thể điều chỉnh thứ tự tham quan theo tình hình thực tế nhưng vẫn đảm bảo đầy đủ điểm.</li>
                    <li>Tour khởi hành khi đủ từ 10 khách người lớn; nếu chưa đủ số lượng, công ty sẽ thông báo và thỏa thuận lại ngày khởi hành hoặc hoàn tiền.</li>
                    <li>Do tính chất tour ghép, Quý khách cần đi theo đoàn suốt hành trình và về đúng ngày kết thúc tour.</li>
                    <li>Các dịch vụ trong chương trình đã được sắp xếp trước, trường hợp không sử dụng vì lý do cá nhân sẽ không được hoàn lại tiền.</li>
                  </ul>
                  <p className="font-semibold text-ink mb-1 mt-4">Xuất nhập cảnh:</p>
                  <ul className="list-disc pl-5 mb-3 flex flex-col gap-1">
                    <li>Quý khách cần đảm bảo giấy tờ cá nhân hợp lệ theo quy định xuất/nhập cảnh. Trường hợp không được xuất/nhập cảnh do cơ quan chức năng không chấp thuận (vì bất kỳ lý do gì), chi phí tour sẽ không được hoàn trả. Công ty sẽ hỗ trợ hướng dẫn trong phạm vi có thể để giải quyết cho Quý khách. Mọi chi phí phát sinh Quý khách tự chủ động sắp xếp.</li>
                    <li>Đối với Quý khách có thay đổi đáng kể về đặc điểm nhận dạng trên khuôn mặt, ví dụ: phẫu thuật thẩm mỹ, vui lòng làm lại hộ chiếu theo quy định trước khi khởi hành. Trường hợp sử dụng hộ chiếu không còn phù hợp với diện mạo hiện tại và phát sinh vấn đề khi xuất nhập cảnh, Quý khách vui lòng tự chịu trách nhiệm. Các chi phí hủy đổi dịch vụ (nếu có) sẽ được áp dụng theo quy định.</li>
                  </ul>
                  <p className="font-semibold text-ink mb-1 mt-4">Bất khả kháng:</p>
                  <ul className="list-disc pl-5 flex flex-col gap-1">
                    <li>Giờ bay có thể thay đổi theo hãng hàng không.</li>
                    <li>Trong các tình huống ngoài khả năng kiểm soát như thời tiết, thiên tai, dịch bệnh, sự cố an ninh, chiến tranh, sân bay đóng cửa hoặc thay đổi từ đơn vị vận chuyển, … lịch trình có thể được điều chỉnh để đảm bảo an toàn và quyền lợi cho Quý khách. Công ty sẽ nỗ lực tối đa để hỗ trợ và phối hợp cùng Quý khách xử lý phát sinh. Tuy nhiên, các chi phí liên quan như ăn uống, đi lại, lưu trú, đổi/đặt lại vé … (nếu có) Quý khách vui lòng thanh toán theo thực tế. Công ty sẽ đồng hành và hỗ trợ để Quý khách có phương án phù hợp và thuận tiện nhất.</li>
                  </ul>
                </div>
              </details>

              {/* 5. Hướng dẫn viên */}
              <details className="group border border-line rounded-[8px] bg-white overflow-hidden transition-all duration-300">
                <summary className="flex cursor-pointer items-center justify-between p-4 font-semibold text-ink hover:bg-teal/5 transition-colors list-none [&::-webkit-details-marker]:hidden">
                  <span className="font-heading text-[16px]">Hướng dẫn viên</span>
                  <span className="text-teal text-xl font-light group-open:hidden">+</span>
                  <span className="text-teal text-xl font-light hidden group-open:inline">-</span>
                </summary>
                <div className="p-4 pt-0 text-[14.5px] text-muted leading-[1.8] border-t border-line/50 mt-1">
                  <ul className="list-disc pl-5 flex flex-col gap-2 mt-2">
                    <li>Hướng Dẫn Viên (HDV) sẽ liên lạc với Quý Khách 2 ngày trước khi khởi hành để sắp xếp giờ đón và cung cấp các thông tin cần thiết cho chuyến đi.</li>
                  </ul>
                </div>
              </details>

            </div>
          </section>

          {/* (i) Đánh giá khách hàng — chỉ hiển thị, form đánh giá thuộc Tuần 4–5 (UC-11) */}
          <section className="mt-12 bg-white p-6 rounded-card border-[1.5px] border-line">
            <h2 className="font-heading text-[22px] font-semibold text-ink">Đánh giá của khách hàng</h2>
            <p className="mt-1 text-[14.5px] text-muted mb-6">Trải nghiệm thực tế từ khách đã đi tour cùng iVIVU.</p>
            
            {tour.reviews?.length > 0 ? (
              <>
                {/* Điểm số */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-[#5cb85c] text-white px-3 py-1.5 rounded-[8px] font-bold text-[18px]">
                    {(tour.avgRating || 0).toFixed(1)} /10
                  </div>
                  <div className="text-[15px]">
                    <span className="font-semibold text-[#5cb85c]">Rất tốt</span> <span className="text-muted">| {tour.reviews.length} đánh giá</span>
                  </div>
                </div>

                {/* Thư viện ảnh chung */}
                {allReviewImages.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-4 mb-2 scrollbar-hide">
                    {allReviewImages.map((img, idx) => (
                      <img 
                        key={idx} 
                        src={img} 
                        alt="Hình ảnh đánh giá" 
                        className="w-[90px] h-[90px] object-cover rounded-[8px] flex-shrink-0 cursor-pointer hover:opacity-90"
                      />
                    ))}
                  </div>
                )}

                <h3 className="font-heading text-[17px] font-semibold text-ink border-b-[1.5px] border-line pb-3 mb-4">Đánh giá gần đây</h3>
                
                <div className="flex flex-col gap-6">
                  {tour.reviews.map((rv, i) => {
                    const tenKhach = (tenNguoiDanhGia(rv.user) || 'Khách hàng').trim();
                    const words = tenKhach.split(' ').filter(w => w.length > 0);
                    const avatar = words.length > 1 
                      ? (words[0][0] + words[words.length-1][0]).toUpperCase()
                      : tenKhach.substring(0, 2).toUpperCase();
                      
                    return (
                      <article key={i} className="pb-6 border-b border-line last:border-0 last:pb-0">
                        <div className="flex gap-3 mb-3">
                          <div className="w-[42px] h-[42px] rounded-full bg-[#5bc0de] text-white flex items-center justify-center font-bold text-[16px] flex-shrink-0">
                            {avatar}
                          </div>
                          <div>
                            <div className="font-semibold text-ink text-[16px]">{tenKhach}</div>
                            <div className="text-[13.5px] text-muted">{formatDate(rv.createdAt)}</div>
                          </div>
                        </div>
                        <p className="text-[14.5px] leading-[1.6] text-ink mb-3">{rv.comment}</p>
                        
                        {/* Hình ảnh của riêng đánh giá này */}
                        {rv.images && rv.images.length > 0 && (
                          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                            {rv.images.map((img, idx) => (
                              <img 
                                key={idx} 
                                src={img} 
                                alt="Hình ảnh đánh giá" 
                                className="w-[80px] h-[80px] object-cover rounded-[8px] flex-shrink-0"
                              />
                            ))}
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              </>
            ) : (
              <p className="mt-3 text-muted">Tour này chưa có đánh giá nào.</p>
            )}
          </section>

          {/* Tour liên quan */}
          {relatedTours.length > 0 && (
            <section className="mt-10">
              <h2 className="font-heading text-[22px] font-semibold text-ink">Tour liên quan</h2>
              <p className="mt-1 text-[14.5px] text-muted mb-5">Gợi ý hành trình tương tự để bạn dễ so sánh và lựa chọn.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {relatedTours.map((t) => (
                  <TourCard key={t._id} tour={t} />
                ))}
              </div>
            </section>
          )}

          {/* Tour đã xem gần đây */}
          {recentTours.length > 0 && (
            <section className="mt-10 mb-6 bg-white p-6 rounded-card border-[1.5px] border-line">
              <h2 className="font-heading text-[22px] font-semibold text-ink mb-5">Tours du lịch bạn đã xem gần đây</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {recentTours.map((t) => (
                  <TourCard key={t._id} tour={t} />
                ))}
              </div>
            </section>
          )}

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
            <Button variant="coral" onClick={emitOpenChat}>
              Hỏi trợ lý AI về tour này
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
