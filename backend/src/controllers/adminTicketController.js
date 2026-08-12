import mongoose from 'mongoose'
import Ticket from '../models/Ticket.js'

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function getAdminTickets(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15))
    const status = String(req.query.status || '')
    const q = String(req.query.q || '').trim()
    if (status && !['valid', 'used', 'revoked'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái vé không hợp lệ.' })
    }
    const match = {}
    if (status) match.status = status
    if (q) match.ticketCode = new RegExp(escapeRegex(q), 'i')
    const [tickets, total] = await Promise.all([
      Ticket.find(match)
        .sort('-issuedAt').skip((page - 1) * limit).limit(limit)
        .populate('booking', 'bookingCode tourName departureDate guests status contact')
        .populate('user', 'name email')
        .lean(),
      Ticket.countDocuments(match),
    ])
    res.json({ success: true, tickets, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) })
  } catch (error) {
    console.error('[getAdminTickets]', error)
    res.status(500).json({ success: false, message: 'Không tải được danh sách vé.' })
  }
}

export async function updateTicketStatus(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !['valid', 'used'].includes(req.body?.status)) {
      return res.status(400).json({ success: false, message: 'Dữ liệu vé không hợp lệ.' })
    }
    const status = req.body.status
    const current = await Ticket.findById(req.params.id)
      .populate('booking', 'bookingCode tourName departureDate guests status contact')
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy vé.' })
    if (current.booking?.status === 'cancelled') {
      return res.status(409).json({ success: false, message: 'Không thể sử dụng vé của đơn đã hủy.' })
    }
    const ticket = await Ticket.findOneAndUpdate(
      { _id: current._id, status: { $ne: 'revoked' } },
      { $set: status === 'used'
        ? { status, checkedInAt: new Date(), checkedInBy: req.user._id }
        : { status, checkedInAt: null, checkedInBy: null } },
      { new: true }
    ).populate('booking', 'bookingCode tourName departureDate guests status contact')
    if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy vé.' })
    res.json({ success: true, message: status === 'used' ? 'Đã xác nhận khách sử dụng vé.' : 'Đã khôi phục vé về trạng thái hợp lệ.', ticket })
  } catch (error) {
    console.error('[updateTicketStatus]', error)
    res.status(500).json({ success: false, message: 'Không cập nhật được vé.' })
  }
}
