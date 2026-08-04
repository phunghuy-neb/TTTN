// Khối phân trang — trích xuất từ hai bản copy giống hệt nhau ở TourList và Bookings.
// Tự ẩn khi chỉ có 1 trang.
export default function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null

  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)

  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        className="btn-ghost disabled:cursor-not-allowed disabled:opacity-40"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Trước
      </button>

      {pageNumbers.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPageChange(p)}
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
        onClick={() => onPageChange(page + 1)}
      >
        Sau
      </button>
    </div>
  )
}
