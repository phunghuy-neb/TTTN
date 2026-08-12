import { createRequire } from 'module'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import mongoose from 'mongoose'
import Booking from '../models/Booking.js'
import Ticket from '../models/Ticket.js'
import { ensureTicketForBooking, ticketVerifyUrl } from '../services/ticketService.js'

const require = createRequire(import.meta.url)
const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf')

function fullTicket(ticket) {
  const booking = ticket.booking
  return {
    _id: ticket._id,
    ticketCode: ticket.ticketCode,
    status: booking?.status === 'cancelled' ? 'revoked' : ticket.status,
    issuedAt: ticket.issuedAt,
    checkedInAt: ticket.checkedInAt,
    verificationUrl: ticketVerifyUrl(ticket),
    booking: booking ? {
      _id: booking._id,
      bookingCode: booking.bookingCode,
      tourName: booking.tourName,
      departureDate: booking.departureDate,
      guests: booking.guests,
      contact: booking.contact,
      status: booking.status,
      totalPrice: booking.totalPrice,
      tour: booking.tour,
    } : null,
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character])
}

function verificationPageHtml({ valid, ticket, message }) {
  const used = ticket?.status === 'used'
  const title = valid ? 'Vé hợp lệ' : used ? 'Vé đã được sử dụng' : 'Vé không hợp lệ'
  const color = valid ? '#1e8a6e' : used ? '#b07a15' : '#d9542f'
  const rows = ticket ? [
    ['Mã vé', ticket.ticketCode],
    ['Mã booking', ticket.bookingCode],
    ['Tour', ticket.tourName],
    ['Ngày khởi hành', formatDate(ticket.departureDate)],
    ['Số khách', `${ticket.guests} khách`],
  ] : []
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} - VietVoyage</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fbfaf6;color:#152623;font-family:Arial,sans-serif;line-height:1.55}
main{width:min(92%,580px);margin:40px auto;background:#fff;border:1px solid #e6e0d4;border-radius:18px;overflow:hidden;box-shadow:0 14px 42px #15262312}
.head{padding:30px 24px;text-align:center;background:${color}12}.icon{display:grid;place-items:center;width:64px;height:64px;margin:auto;border-radius:50%;background:${color};color:#fff;font-size:30px;font-weight:800}
h1{margin:14px 0 4px;font-size:25px}.note{margin:0;color:#5e6f6a;font-size:14px}.brand{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${color}}
dl{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:26px;margin:0}div.row{min-width:0}.wide{grid-column:1/-1}dt{color:#5e6f6a;font-size:13px}dd{margin:4px 0 0;font-size:14px;font-weight:700;overflow-wrap:anywhere}.code{color:#12645c}
footer{border-top:1px solid #e6e0d4;padding:16px 24px;text-align:center;color:#5e6f6a;font-size:12px}@media(max-width:480px){dl{grid-template-columns:1fr}.wide{grid-column:auto}main{margin:18px auto}}
</style></head><body><main>
<section class="head"><p class="brand">VietVoyage · Xác minh vé điện tử</p><div class="icon">${valid ? '✓' : '!'}</div><h1>${escapeHtml(title)}</h1><p class="note">${escapeHtml(message || 'Thông tin công khai không chứa dữ liệu liên hệ của khách.')}</p></section>
${rows.length ? `<dl>${rows.map(([label, value], index) => `<div class="row ${index === 2 ? 'wide' : ''}"><dt>${escapeHtml(label)}</dt><dd class="${index === 0 ? 'code' : ''}">${escapeHtml(value)}</dd></div>`).join('')}</dl>` : ''}
<footer>QR này chỉ dùng xác minh booking, không dùng để thanh toán.</footer>
</main></body></html>`
}

async function findTicketForBooking(bookingId) {
  let ticket = await Ticket.findOne({ booking: bookingId })
  if (!ticket) ticket = await ensureTicketForBooking(bookingId)
  if (!ticket) return null
  return Ticket.findById(ticket._id)
    .populate({ path: 'booking', populate: { path: 'tour', select: 'name slug location days images highlights' } })
}

export async function getTicketByBooking(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.bookingId)) {
      return res.status(400).json({ success: false, message: 'Mã đơn không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    const booking = await Booking.findById(req.params.bookingId).select('user status')
    if (!booking) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt.', code: 'NOT_FOUND' })
    if (String(booking.user) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền xem vé này.', code: 'FORBIDDEN' })
    }
    if (!['paid', 'completed'].includes(booking.status)) {
      return res.status(409).json({ success: false, message: 'Vé chỉ được phát hành sau khi đơn đã thanh toán.', code: 'TICKET_NOT_AVAILABLE' })
    }
    const ticket = await findTicketForBooking(booking._id)
    const data = fullTicket(ticket)
    data.qrDataUrl = await QRCode.toDataURL(data.verificationUrl, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
    res.json({ success: true, ticket: data })
  } catch (error) {
    console.error('[getTicketByBooking]', error)
    res.status(500).json({ success: false, message: 'Không tải được vé điện tử.' })
  }
}

export async function verifyTicket(req, res) {
  try {
    if (!/^[a-f0-9]{48}$/.test(req.params.token)) {
      return res.status(404).json({ success: false, valid: false, message: 'Vé không hợp lệ hoặc không tồn tại.' })
    }
    const ticket = await Ticket.findOne({ verificationToken: req.params.token })
      .populate('booking', 'bookingCode tourName departureDate guests status')
      .lean()
    if (!ticket?.booking) return res.status(404).json({ success: false, valid: false, message: 'Vé không hợp lệ hoặc không tồn tại.' })
    const status = ticket.booking.status === 'cancelled' ? 'revoked' : ticket.status
    res.json({
      success: true,
      valid: status === 'valid',
      ticket: {
        ticketCode: ticket.ticketCode,
        status,
        tourName: ticket.booking.tourName,
        departureDate: ticket.booking.departureDate,
        guests: ticket.booking.guests,
        bookingCode: ticket.booking.bookingCode,
        issuedAt: ticket.issuedAt,
        checkedInAt: ticket.checkedInAt,
      },
    })
  } catch (error) {
    console.error('[verifyTicket]', error)
    res.status(500).json({ success: false, valid: false, message: 'Không xác minh được vé.' })
  }
}

export async function verifyTicketPage(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
    if (!/^[a-f0-9]{48}$/.test(req.params.token)) {
      return res.status(404).type('html').send(verificationPageHtml({ valid: false, message: 'Mã xác minh không đúng định dạng.' }))
    }
    const row = await Ticket.findOne({ verificationToken: req.params.token })
      .populate('booking', 'bookingCode tourName departureDate guests status')
      .lean()
    if (!row?.booking) {
      return res.status(404).type('html').send(verificationPageHtml({ valid: false, message: 'Vé không tồn tại hoặc đã bị thu hồi.' }))
    }
    const status = row.booking.status === 'cancelled' ? 'revoked' : row.status
    const ticket = {
      ticketCode: row.ticketCode,
      status,
      tourName: row.booking.tourName,
      departureDate: row.booking.departureDate,
      guests: row.booking.guests,
      bookingCode: row.booking.bookingCode,
    }
    return res.type('html').send(verificationPageHtml({
      valid: status === 'valid',
      ticket,
      message: status === 'valid' ? 'Vé do hệ thống VietVoyage phát hành và đang còn hiệu lực.' : status === 'used' ? 'Vé này đã được ghi nhận check-in.' : 'Vé đã bị thu hồi hoặc không còn hiệu lực.',
    }))
  } catch (error) {
    console.error('[verifyTicketPage]', error)
    return res.status(500).type('html').send(verificationPageHtml({ valid: false, message: 'Hệ thống chưa thể xác minh vé. Vui lòng thử lại.' }))
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'long' }).format(new Date(value))
}

async function createTicketPdf(ticket) {
  const qr = await QRCode.toBuffer(ticketVerifyUrl(ticket), { width: 360, margin: 1, errorCorrectionLevel: 'M' })
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Vé ${ticket.ticketCode}` } })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.registerFont('NotoSans', FONT_REGULAR)
    doc.registerFont('NotoSansBold', FONT_BOLD)
    doc.font('NotoSansBold').fontSize(24).fillColor('#12645C').text('VIETVOYAGE', { align: 'center' })
    doc.moveDown(0.2).fontSize(18).fillColor('#152623').text('VÉ ĐIỆN TỬ', { align: 'center' })
    doc.moveDown(0.5).font('NotoSans').fontSize(11).fillColor('#5E6F6A').text('Dùng mã QR để xác minh vé tại điểm tập trung', { align: 'center' })
    doc.moveDown(1.2)
    const booking = ticket.booking
    const rows = [
      ['Mã vé', ticket.ticketCode],
      ['Mã đặt tour', booking.bookingCode],
      ['Tour', booking.tourName],
      ['Ngày khởi hành', formatDate(booking.departureDate)],
      ['Số khách', `${booking.guests} khách`],
      ['Người đại diện', booking.contact.name],
      ['Điện thoại', booking.contact.phone],
      ['Trạng thái', ticket.status === 'used' ? 'Đã sử dụng' : 'Hợp lệ'],
    ]
    for (const [label, value] of rows) {
      const y = doc.y
      doc.font('NotoSans').fontSize(10).fillColor('#5E6F6A').text(label, 58, y, { width: 130 })
      doc.font('NotoSansBold').fontSize(11).fillColor('#152623').text(String(value), 190, y, { width: 345 })
      doc.moveDown(0.9)
      doc.moveTo(58, doc.y).lineTo(535, doc.y).strokeColor('#E6E0D4').stroke()
      doc.moveDown(0.45)
    }
    doc.image(qr, 207, doc.y + 8, { width: 180 })
    doc.y += 198
    doc.font('NotoSans').fontSize(9).fillColor('#5E6F6A').text(ticketVerifyUrl(ticket), 60, doc.y, { width: 475, align: 'center' })
    doc.moveDown(1.5).fontSize(9).text('Vé này không phải mã QR thanh toán. Vui lòng xuất trình cùng giấy tờ của người đại diện.', { align: 'center' })
    doc.end()
  })
}

export async function downloadTicketPdf(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.bookingId)) {
      return res.status(400).json({ success: false, message: 'Mã đơn không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    const booking = await Booking.findById(req.params.bookingId).select('user status')
    if (!booking) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt.' })
    if (String(booking.user) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền tải vé này.' })
    }
    if (!['paid', 'completed'].includes(booking.status)) {
      return res.status(409).json({ success: false, message: 'Vé chỉ khả dụng cho đơn đã thanh toán.', code: 'TICKET_NOT_AVAILABLE' })
    }
    const ticket = await findTicketForBooking(booking._id)
    if (!ticket) return res.status(409).json({ success: false, message: 'Vé chưa được phát hành.' })
    const pdf = await createTicketPdf(ticket)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${ticket.ticketCode}.pdf"`)
    res.setHeader('Content-Length', pdf.length)
    res.send(pdf)
  } catch (error) {
    console.error('[downloadTicketPdf]', error)
    res.status(500).json({ success: false, message: 'Không tạo được file PDF của vé.' })
  }
}
