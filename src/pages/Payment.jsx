import { Link, useLocation } from 'react-router-dom'
import { formatPrice, formatDate } from '../utils/format.js'

// Trang kết quả sau khi tạo đơn (UC-08) — nhận booking qua location.state từ Checkout.
// Đơn vừa tạo luôn ở trạng thái pending_payment; thanh toán online thật thuộc Tuần 5.
export default function Payment() {
  const { state } = useLocation()
  const booking = state?.booking

  // Vào thẳng /payment không qua bước đặt tour → không có dữ liệu đơn để hiển thị
  if (!booking) {
    return (
      <div className="wrap py-[56px]">
        <div className="card-surface mx-auto max-w-[560px] p-8 text-center">
          <p className="font-heading text-[20px] font-semibold text-ink">Không có đơn nào để hiển thị</p>
          <p className="mt-2 text-[14.5px] text-muted">
            Bạn có thể xem lại các đơn đã đặt trong lịch sử đặt tour.
          </p>
          <Link to="/bookings" className="btn-teal mt-5">
            Xem lịch sử đặt tour
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="wrap py-[56px]">
      <div className="card-surface mx-auto max-w-[640px] p-8">
        <div className="mx-auto grid h-[56px] w-[56px] place-items-center rounded-full bg-jade/10 text-[26px] text-jade">
          ✓
        </div>
        <h1 className="mt-4 text-center font-heading text-[26px] font-semibold text-ink">
          Đặt tour thành công!
        </h1>
        <p className="mt-2 text-center text-[14.5px] text-muted">
          Đơn của bạn đã được ghi nhận và đang ở trạng thái{' '}
          <span className="inline-block rounded-pill bg-gold/15 px-3 py-0.5 font-semibold text-gold">
            Chờ thanh toán
          </span>
        </p>

        {/* Chi tiết đơn vừa tạo */}
        <dl className="mt-6 divide-y divide-line rounded-card border border-line">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-[14.5px] text-muted">Mã đơn</dt>
            <dd className="font-semibold text-teal">{booking.bookingCode}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-[14.5px] text-muted">Tour</dt>
            <dd className="text-right font-semibold text-ink">{booking.tourName}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-[14.5px] text-muted">Ngày khởi hành</dt>
            <dd className="font-semibold text-ink">{formatDate(booking.departureDate)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-[14.5px] text-muted">Số khách</dt>
            <dd className="font-semibold text-ink">{booking.guests} khách</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-[14.5px] text-muted">Tổng tiền</dt>
            <dd className="font-heading text-[20px] font-semibold text-coralD">
              {formatPrice(booking.totalPrice)}
            </dd>
          </div>
        </dl>

        {/* Bước tiếp theo */}
        <p className="mt-5 rounded-[11px] bg-sand px-4 py-3 text-[13.5px] leading-[1.7] text-muted">
          Cổng thanh toán trực tuyến (VNPay/MoMo) sẽ được hoàn thiện ở giai đoạn sau. Công ty sẽ liên hệ
          qua số điện thoại/email bạn đã cung cấp để xác nhận và hướng dẫn thanh toán. Bạn có thể theo
          dõi hoặc hủy đơn trong lịch sử đặt tour khi đơn còn chờ thanh toán.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link to="/bookings" className="btn-teal">
            Xem lịch sử đặt tour
          </Link>
          <Link to="/tours" className="btn-ghost">
            Tiếp tục khám phá tour
          </Link>
        </div>
      </div>
    </div>
  )
}
