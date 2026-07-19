import { TOURS } from '../data/tours.js'
import TourCard from '../components/TourCard.jsx'

// Trang chủ tĩnh — dữ liệu giả Tuần 2
export default function Home() {
  const featured = TOURS.slice(0, 6)
  const deals = TOURS.filter((t) => t.oldPrice != null)

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

          {/* Khối tìm kiếm — CHỈ giao diện, logic lọc nối ở Tuần 3 */}
          <div className="card-surface mt-8 max-w-[720px] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Bạn muốn đi đâu?"
                className="field-input sm:flex-1"
              />
              <select className="field-input sm:w-[160px]">
                <option>2–3 ngày</option>
                <option>4–5 ngày</option>
                <option>Trên 5 ngày</option>
              </select>
              {/* Nút chỉ hiển thị — chưa gắn logic tìm kiếm */}
              <button type="button" className="btn-coral sm:w-auto">
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
        <div className="mt-7 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((tour) => (
            <TourCard key={tour.id} tour={tour} />
          ))}
        </div>
      </section>

      {/* c. Tour đang ưu đãi */}
      <section id="uudai" className="bg-sand/40">
        <div className="wrap py-[56px]">
          <p className="eyebrow">Giá tốt hôm nay</p>
          <h2 className="mt-2 font-heading text-[30px] font-semibold text-ink">Tour đang ưu đãi</h2>
          {deals.length > 0 ? (
            <div className="mt-7 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {deals.map((tour) => (
                <TourCard key={tour.id} tour={tour} />
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
