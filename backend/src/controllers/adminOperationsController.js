import ExcelJS from 'exceljs'
import Tour from '../models/Tour.js'
import Booking from '../models/Booking.js'

function parseRange(query, defaultDays = 90) {
  const now = new Date()
  const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1)
  const to = query.to ? new Date(query.to) : new Date(from.getTime() + defaultDays * 86400000)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw Object.assign(new Error('Khoảng ngày không hợp lệ.'), { statusCode: 400 })
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

export async function getDepartureCalendar(req, res) {
  try {
    const { from, to } = parseRange(req.query)
    const rows = await Tour.aggregate([
      { $match: { isActive: { $ne: false } } },
      { $unwind: '$departures' },
      { $match: { 'departures.date': { $gte: from, $lte: to } } },
      { $lookup: { from: 'bookings', let: { tourId: '$_id', departureId: '$departures._id' }, pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$tour', '$$tourId'] }, { $eq: ['$departureId', '$$departureId'] }, { $in: ['$status', ['pending_payment', 'paid', 'completed']] }] } } },
        { $group: { _id: '$status', bookings: { $sum: 1 }, guests: { $sum: '$guests' }, revenue: { $sum: { $cond: [{ $in: ['$status', ['paid', 'completed']] }, '$totalPrice', 0] } } } },
      ], as: 'bookingStats' } },
      { $project: { _id: 0, tourId: '$_id', tourName: '$name', slug: 1, location: 1, departureId: '$departures._id', date: '$departures.date', price: '$departures.price', totalSlots: '$departures.totalSlots', availableSlots: '$departures.availableSlots', bookingStats: 1 } },
      { $sort: { date: 1, tourName: 1 } },
    ])
    res.json({ success: true, departures: rows, from, to })
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Không tải được lịch khởi hành.' })
  }
}

function reportFilter(query) {
  const filter = {}
  if (query.from || query.to) {
    filter.createdAt = {}
    if (query.from) {
      const d = new Date(query.from)
      if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Ngày bắt đầu không hợp lệ.'), { statusCode: 400 })
      filter.createdAt.$gte = d
    }
    if (query.to) {
      const d = new Date(query.to)
      if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Ngày kết thúc không hợp lệ.'), { statusCode: 400 })
      d.setHours(23, 59, 59, 999); filter.createdAt.$lte = d
    }
  }
  if (query.status) {
    if (!['pending_payment', 'paid', 'completed', 'cancelled'].includes(query.status)) throw Object.assign(new Error('Trạng thái booking không hợp lệ.'), { statusCode: 400 })
    filter.status = query.status
  }
  if (filter.createdAt?.$gte && filter.createdAt?.$lte && filter.createdAt.$lte < filter.createdAt.$gte) {
    throw Object.assign(new Error('Ngày kết thúc phải từ ngày bắt đầu trở đi.'), { statusCode: 400 })
  }
  return filter
}

function safeCsv(value) {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

async function sendWorkbook(res, { name, sheetName, columns, rows, format }) {
  if (format === 'csv') {
    const csv = [columns.map((c) => safeCsv(c.header)).join(','), ...rows.map((row) => columns.map((c) => safeCsv(row[c.key])).join(','))].join('\r\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`)
    return res.send(`\uFEFF${csv}`)
  }
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'VietVoyage'
  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = columns.map((column) => ({ ...column, width: column.width || 18 }))
  sheet.addRows(rows)
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12645C' } }
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + columns.length)}1` }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  const buffer = await workbook.xlsx.writeBuffer()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`)
  res.send(Buffer.from(buffer))
}

export async function exportBookings(req, res) {
  try {
    const bookings = await Booking.find(reportFilter(req.query)).sort('-createdAt').populate('user', 'name email').lean()
    const rows = bookings.map((b) => ({ code: b.bookingCode, customer: b.user?.name || b.contact?.name || '', email: b.user?.email || b.contact?.email || '', tour: b.tourName, departure: new Date(b.departureDate).toLocaleDateString('vi-VN'), guests: b.guests, originalPrice: b.originalPrice || b.unitPrice * b.guests, discount: b.discountAmount || 0, total: b.totalPrice, voucher: b.voucher?.code || '', payment: b.paymentMethod || '', status: b.status, created: new Date(b.createdAt).toLocaleString('vi-VN') }))
    await sendWorkbook(res, { name: `vietvoyage-bookings-${Date.now()}`, sheetName: 'Bookings', format: req.query.format, columns: [
      { header: 'Mã đơn', key: 'code' }, { header: 'Khách hàng', key: 'customer', width: 24 }, { header: 'Email', key: 'email', width: 28 }, { header: 'Tour', key: 'tour', width: 35 }, { header: 'Ngày đi', key: 'departure' }, { header: 'Số khách', key: 'guests' }, { header: 'Giá gốc', key: 'originalPrice' }, { header: 'Giảm giá', key: 'discount' }, { header: 'Thành tiền', key: 'total' }, { header: 'Voucher', key: 'voucher' }, { header: 'Thanh toán', key: 'payment' }, { header: 'Trạng thái', key: 'status' }, { header: 'Ngày đặt', key: 'created', width: 22 },
    ], rows })
  } catch (error) {
    console.error('[exportBookings]', error)
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Không xuất được báo cáo booking.' })
  }
}

export async function exportRevenue(req, res) {
  try {
    const match = { ...reportFilter(req.query), status: { $in: ['paid', 'completed'] } }
    const data = await Booking.aggregate([{ $match: match }, { $group: { _id: { tour: '$tour', tourName: '$tourName' }, bookings: { $sum: 1 }, guests: { $sum: '$guests' }, gross: { $sum: { $ifNull: ['$originalPrice', '$totalPrice'] } }, discounts: { $sum: { $ifNull: ['$discountAmount', 0] } }, revenue: { $sum: '$totalPrice' } } }, { $sort: { revenue: -1 } }])
    const rows = data.map((r) => ({ tour: r._id.tourName, bookings: r.bookings, guests: r.guests, gross: r.gross, discounts: r.discounts, revenue: r.revenue }))
    await sendWorkbook(res, { name: `vietvoyage-revenue-${Date.now()}`, sheetName: 'Doanh thu', format: req.query.format, columns: [{ header: 'Tour', key: 'tour', width: 40 }, { header: 'Số đơn', key: 'bookings' }, { header: 'Số khách', key: 'guests' }, { header: 'Doanh thu gộp', key: 'gross' }, { header: 'Giảm giá', key: 'discounts' }, { header: 'Doanh thu thực', key: 'revenue' }], rows })
  } catch (error) {
    console.error('[exportRevenue]', error)
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Không xuất được báo cáo doanh thu.' })
  }
}
