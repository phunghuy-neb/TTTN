import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { downloadTicketPdf, getTicketByBooking } from '../services/ticketService.js'
import { formatDate, formatPrice } from '../utils/format.js'
import Button from '../components/ui/Button.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'
import { useToast } from '../components/ui/Toast.jsx'

const STATUS = {
  valid: { label: 'Hợp lệ', className: 'bg-jade/10 text-jade' },
  used: { label: 'Đã sử dụng', className: 'bg-gold/15 text-gold' },
  revoked: { label: 'Đã thu hồi', className: 'bg-coral/10 text-coralD' },
}

export default function Ticket() {
  const { bookingId } = useParams()
  const toast = useToast()
  const [ticket, setTicket] = useState(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let active = true
    getTicketByBooking(bookingId).then((res) => {
      if (!active) return
      if (res.success) setTicket(res.ticket)
      else setError(res.message || 'Không tải được vé điện tử.')
    })
    return () => { active = false }
  }, [bookingId])

  async function download() {
    setDownloading(true)
    const res = await downloadTicketPdf(bookingId)
    setDownloading(false)
    if (!res.success) toast(res.message, 'error')
  }

  if (!ticket && !error) return <div className="wrap py-12"><Skeleton className="mx-auto h-[620px] max-w-[780px] rounded-card" /></div>
  if (error) return <div className="wrap py-16 text-center"><p className="text-coralD">{error}</p><Link className="btn-ghost mt-5" to={`/bookings/${bookingId}`}>Quay lại đơn</Link></div>
  const badge = STATUS[ticket.status] || STATUS.revoked
  const b = ticket.booking

  return (
    <div className="wrap py-10 print:bg-white">
      <div className="mx-auto max-w-[820px]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link to={`/bookings/${bookingId}`} className="text-[14px] font-semibold text-teal hover:text-teal2">← Chi tiết đơn</Link>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => window.print()}>In riêng vé</Button>
            <Button onClick={download} disabled={downloading}>{downloading ? 'Đang tạo PDF…' : 'Tải PDF'}</Button>
          </div>
        </div>
        <article data-ticket-print className="overflow-hidden rounded-card border border-line bg-white shadow-soft print:border-2 print:shadow-none">
          <header className="bg-gradient-to-r from-teal to-jade px-7 py-6 text-white sm:px-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-[12px] font-semibold uppercase tracking-[.2em] text-white/75">VietVoyage</p><h1 className="mt-1 font-heading text-[27px] font-semibold">Vé điện tử</h1></div>
              <span className={`rounded-pill bg-white px-3 py-1 text-[13px] font-bold ${badge.className}`}>{badge.label}</span>
            </div>
          </header>
          <div className="grid gap-7 p-7 sm:grid-cols-[1fr_240px] sm:p-10">
            <div>
              <p className="text-[12px] uppercase tracking-wide text-muted">Mã vé</p>
              <p className="mt-1 break-all font-heading text-[23px] font-semibold text-teal">{ticket.ticketCode}</p>
              <dl className="mt-6 grid gap-4 text-[14px] sm:grid-cols-2">
                <div><dt className="text-muted">Tour</dt><dd className="mt-1 font-semibold text-ink">{b.tourName}</dd></div>
                <div><dt className="text-muted">Ngày khởi hành</dt><dd className="mt-1 font-semibold text-ink">{formatDate(b.departureDate)}</dd></div>
                <div><dt className="text-muted">Mã booking</dt><dd className="mt-1 font-semibold text-ink">{b.bookingCode}</dd></div>
                <div><dt className="text-muted">Số khách</dt><dd className="mt-1 font-semibold text-ink">{b.guests} khách</dd></div>
                <div><dt className="text-muted">Người đại diện</dt><dd className="mt-1 font-semibold text-ink">{b.contact?.name}</dd></div>
                <div><dt className="text-muted">Tổng thanh toán</dt><dd className="mt-1 font-semibold text-ink">{formatPrice(b.totalPrice)}</dd></div>
              </dl>
            </div>
            <div className="text-center">
              <img src={ticket.qrDataUrl} alt={`QR xác minh vé ${ticket.ticketCode}`} className="mx-auto w-[220px] rounded-[10px] border border-line" />
              <p className="mt-2 text-[12px] leading-relaxed text-muted">Quét để xác minh vé. QR này không dùng để thanh toán.</p>
              <a href={ticket.verificationUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12px] font-semibold text-teal hover:underline">Mở trang xác minh →</a>
            </div>
          </div>
          <footer className="border-t border-dashed border-line px-7 py-4 text-center text-[12px] text-muted sm:px-10">Xuất trình vé cùng giấy tờ của người đại diện tại điểm tập trung.</footer>
        </article>
      </div>
    </div>
  )
}
