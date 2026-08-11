import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="mt-10 bg-[#0B3E3A] text-[#B7CFC9]">
      <div className="wrap grid grid-cols-1 gap-9 pb-7 pt-[52px] sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        {/* Cột thương hiệu */}
        <div>
          <Link to="/" className="flex items-center gap-2.5 font-heading text-[22px] font-semibold text-white">
            <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-gradient-to-br from-jade to-[#7FD9C4] text-[18px] text-white">
              ✦
            </span>
            VietVoyage
          </Link>
          <p className="mt-3.5 max-w-[280px] text-sm text-[#93B4AE]">
            Nền tảng đặt tour du lịch tích hợp Trợ lý AI, mang lại trải nghiệm tra cứu và thanh toán
            liền mạch, thông minh.
          </p>
        </div>

        {/* Khám phá */}
        <div>
          <h4 className="mb-4 text-sm font-semibold text-white">Khám phá</h4>
          <ul className="flex list-none flex-col gap-2.5 text-sm">
            <li><Link to="/" className="hover:text-white">Tour miền Bắc</Link></li>
            <li><Link to="/" className="hover:text-white">Tour miền Trung</Link></li>
            <li><Link to="/" className="hover:text-white">Tour miền Nam</Link></li>
          </ul>
        </div>

        {/* Hỗ trợ */}
        <div>
          <h4 className="mb-4 text-sm font-semibold text-white">Hỗ trợ</h4>
          <ul className="flex list-none flex-col gap-2.5 text-sm">
            <li><Link to="/" className="hover:text-white">Trợ lý AI</Link></li>
            <li><Link to="/bookings" className="hover:text-white">Lịch sử đặt tour</Link></li>
            <li><Link to="/" className="hover:text-white">Chính sách hủy</Link></li>
          </ul>
        </div>

        {/* Liên hệ */}
        <div id="lienhe">
          <h4 className="mb-4 text-sm font-semibold text-white">Liên hệ</h4>
          <ul className="flex list-none flex-col gap-2.5 text-sm">
            <li><a href="tel:19001234" className="hover:text-white">☎ Hotline: 1900 1234</a></li>
            <li><a href="mailto:hotro@vietvoyage.vn" className="hover:text-white">✉ hotro@vietvoyage.vn</a></li>
            <li><span>📍 123 Nguyễn Trãi, Hà Nội</span></li>
            <li><span>🕐 8:00 – 21:00 (T2 – CN)</span></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-[18px] text-center text-[13px] text-[#7DA39C]">
        © 2025 VietVoyage — Đồ án Thực tập tốt nghiệp, Nhóm 1.
      </div>
    </footer>
  )
}
