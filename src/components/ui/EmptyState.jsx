// Khối trạng thái rỗng / thông báo giữa trang — trích xuất từ các card lặp ở
// Bookings (chưa có đơn), TourDetail (tour không xem được), Checkout (thiếu dữ liệu đơn).
//
//   <EmptyState title="Bạn chưa đặt tour nào." description="..." action={<Link .../>} />
export default function EmptyState({ title, description, action, className = '' }) {
  return (
    <div className={`card-surface p-8 text-center ${className}`.trim()}>
      <p className="font-heading text-[20px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-2 text-[14.5px] text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  )
}
