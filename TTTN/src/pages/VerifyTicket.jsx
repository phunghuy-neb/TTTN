import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { verifyTicket } from '../services/ticketService.js'
import { formatDate } from '../utils/format.js'
import Skeleton from '../components/ui/Skeleton.jsx'

export default function VerifyTicket() {
  const { token } = useParams()
  const [result, setResult] = useState(null)
  useEffect(() => { verifyTicket(token).then(setResult) }, [token])
  if (!result) return <div className="wrap py-16"><Skeleton className="mx-auto h-[380px] max-w-[580px] rounded-card" /></div>
  const ticket = result.ticket
  const valid = result.success && result.valid
  return (
    <div className="wrap py-16">
      <section className="card-surface mx-auto max-w-[580px] overflow-hidden text-center">
        <div className={`px-6 py-8 ${valid ? 'bg-jade/10' : 'bg-coral/10'}`}>
          <span className={`mx-auto grid h-16 w-16 place-items-center rounded-full text-[30px] ${valid ? 'bg-jade text-white' : 'bg-coralD text-white'}`}>{valid ? '✓' : '!'}</span>
          <h1 className="mt-4 font-heading text-[25px] font-semibold text-ink">{valid ? 'Vé hợp lệ' : ticket?.status === 'used' ? 'Vé đã được sử dụng' : 'Vé không hợp lệ'}</h1>
          <p className="mt-2 text-[14px] text-muted">{result.message || 'Thông tin xác minh công khai, không chứa dữ liệu liên hệ của khách.'}</p>
        </div>
        {ticket && <dl className="grid gap-4 p-7 text-left text-[14px] sm:grid-cols-2">
          <div><dt className="text-muted">Mã vé</dt><dd className="mt-1 font-semibold text-teal">{ticket.ticketCode}</dd></div>
          <div><dt className="text-muted">Mã booking</dt><dd className="mt-1 font-semibold text-ink">{ticket.bookingCode}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted">Tour</dt><dd className="mt-1 font-semibold text-ink">{ticket.tourName}</dd></div>
          <div><dt className="text-muted">Ngày đi</dt><dd className="mt-1 font-semibold text-ink">{formatDate(ticket.departureDate)}</dd></div>
          <div><dt className="text-muted">Số khách</dt><dd className="mt-1 font-semibold text-ink">{ticket.guests} khách</dd></div>
        </dl>}
        <div className="border-t border-line p-5"><Link to="/" className="btn-ghost">Về trang chủ</Link></div>
      </section>
    </div>
  )
}
