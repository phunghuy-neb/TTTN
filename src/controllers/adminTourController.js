// ============================================================
//  src/controllers/adminTourController.js
//  CRUD Tour cho Admin (Batch 3) — trọng tâm: KHÔNG BAO GIỜ gán đè
//  cả mảng departures. Mọi thay đổi đợt đi qua merge theo _id để
//  booking.departureId không bao giờ thành mồ côi.
// ============================================================
import mongoose from 'mongoose'
import Tour from '../models/Tour.js'
import Booking from '../models/Booking.js'

// Trạng thái đơn đang giữ chỗ — đơn cancelled không tính
const TRANG_THAI_GIU_CHO = ['pending_payment', 'paid', 'completed']

// Bỏ dấu — cùng logic với hook pre('save') của Tour (slug/searchText)
const boDau = (chuoi) =>
  String(chuoi)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')

const sinhSlug = (ten) =>
  boDau(ten)
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

const buildImageUrl = (req, filename) => `${req.protocol}://${req.get('host')}/uploads/${filename}`

// Parse các field gửi dạng JSON string khi đi qua multipart/form-data
function parseJsonFields(body) {
  const b = { ...body }
  for (const key of ['itinerary', 'departures', 'tags', 'images']) {
    if (typeof b[key] === 'string') {
      try {
        b[key] = JSON.parse(b[key])
      } catch {
        throw Object.assign(new Error(`Trường ${key} không phải JSON hợp lệ.`), { statusCode: 400 })
      }
    }
  }
  return b
}

// Validate một đợt trong payload (dùng cho cả tạo mới lẫn cập nhật)
function validateDeparture(d, { choPhepQuaKhu = false } = {}) {
  const ngay = new Date(d.date)
  if (!d.date || Number.isNaN(ngay.getTime())) return 'Ngày khởi hành không hợp lệ.'
  if (!choPhepQuaKhu) {
    const dauHomNay = new Date()
    dauHomNay.setHours(0, 0, 0, 0)
    if (ngay < dauHomNay) return `Ngày khởi hành ${d.date} đã ở quá khứ.`
  }
  const tong = Number(d.totalSlots)
  if (!Number.isInteger(tong) || tong <= 0) return 'totalSlots phải là số nguyên > 0.'
  const gia = Number(d.price)
  if (!Number.isFinite(gia) || gia <= 0) return 'Giá đợt khởi hành phải > 0.'
  return null
}

// ============================================================
//  @route   GET /api/admin/tours
//  @desc    Danh sách tour cho admin — phân trang, tìm kiếm, lọc isActive,
//           kèm số đơn active mỗi tour để FE cảnh báo trước khi xóa
//  @access  Private — Admin
// ============================================================
export const getAdminTours = async (req, res) => {
  try {
    const { search, isActive, status, sort = '-createdAt', page = 1, limit = 10 } = req.query

    const filter = {}
    if (search) filter.searchText = { $regex: boDau(search), $options: 'i' }
    if (isActive === 'true') filter.isActive = { $ne: false }
    if (isActive === 'false') filter.isActive = false
    if (status) filter.status = status

    const pageNum = Math.max(1, Number(page))
    const limitNum = Math.min(50, Math.max(1, Number(limit)))
    const skip = (pageNum - 1) * limitNum

    const [tours, total] = await Promise.all([
      Tour.find(filter).sort(sort).skip(skip).limit(limitNum).lean(),
      Tour.countDocuments(filter),
    ])

    // Đếm đơn active theo tour trong MỘT aggregate
    const demDon = await Booking.aggregate([
      {
        $match: {
          tour: { $in: tours.map((t) => t._id) },
          status: { $in: TRANG_THAI_GIU_CHO },
        },
      },
      { $group: { _id: '$tour', soDon: { $sum: 1 } } },
    ])
    const banDoDon = new Map(demDon.map((d) => [String(d._id), d.soDon]))

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      tours: tours.map((t) => ({ ...t, activeBookings: banDoDon.get(String(t._id)) || 0 })),
    })
  } catch (error) {
    console.error('[getAdminTours]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   GET /api/admin/tours/:id
//  @desc    Chi tiết tour cho form sửa — kèm số đơn active theo TỪNG ĐỢT
//           để FE hiện badge và chặn nút xóa đợt
//  @access  Private — Admin
// ============================================================
export const getAdminTour = async (req, res) => {
  try {
    const tour = await Tour.findById(req.params.id).lean()
    if (!tour) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tour.', code: 'NOT_FOUND' })
    }

    const demTheoDot = await Booking.aggregate([
      { $match: { tour: tour._id, status: { $in: TRANG_THAI_GIU_CHO } } },
      { $group: { _id: '$departureId', soDon: { $sum: 1 } } },
    ])
    const bookingsByDeparture = {}
    let activeBookings = 0
    for (const d of demTheoDot) {
      activeBookings += d.soDon
      if (d._id) bookingsByDeparture[String(d._id)] = d.soDon
    }

    res.json({ success: true, tour, bookingsByDeparture, activeBookings })
  } catch (error) {
    console.error('[getAdminTour]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   POST /api/admin/tours
//  @desc    Tạo tour mới — ít nhất 1 đợt, ngày không quá khứ,
//           totalSlots > 0, giá > 0. availableSlots = totalSlots.
//  @access  Private — Admin
// ============================================================
export const createAdminTour = async (req, res) => {
  try {
    const body = parseJsonFields(req.body)

    if (!Array.isArray(body.departures) || body.departures.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tour phải có ít nhất 1 đợt khởi hành.',
        code: 'VALIDATION_ERROR',
      })
    }
    for (const d of body.departures) {
      const loi = validateDeparture(d)
      if (loi) {
        return res.status(400).json({ success: false, message: loi, code: 'VALIDATION_ERROR' })
      }
    }

    if (req.files && req.files.length > 0) {
      body.images = [...(body.images || []), ...req.files.map((f) => buildImageUrl(req, f.filename))]
    }

    const tour = await Tour.create({
      ...body,
      // Tour mới chưa có đơn nào → chỗ trống = tổng chỗ, bỏ qua availableSlots client gửi
      departures: body.departures.map((d) => ({
        date: d.date,
        price: Number(d.price),
        totalSlots: Number(d.totalSlots),
        availableSlots: Number(d.totalSlots),
      })),
      isActive: true,
      createdBy: req.user._id,
    })

    res.status(201).json({ success: true, message: 'Tạo tour thành công!', tour })
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message, code: 'VALIDATION_ERROR' })
    }
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message)[0]
      return res.status(400).json({ success: false, message: msg, code: 'VALIDATION_ERROR' })
    }
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Tên tour bị trùng slug. Hãy đặt tên khác.', code: 'VALIDATION_ERROR' })
    }
    console.error('[createAdminTour]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   PUT /api/admin/tours/:id
//  @desc    Cập nhật tour — KHÔNG TIN payload FE về departures:
//           merge theo _id, không bao giờ gán đè cả mảng.
//           - có _id  → update tại chỗ (giữ nguyên _id)
//           - không _id → đợt mới
//           - vắng mặt → xóa, NHƯNG còn đơn active → 409 từ chối CẢ request
//           Toàn bộ validate chạy xong mới ghi — dính 409/400 là DB không đổi.
//  @access  Private — Admin
// ============================================================
export const updateAdminTour = async (req, res) => {
  try {
    const tour = await Tour.findById(req.params.id)
    if (!tour) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tour.', code: 'NOT_FOUND' })
    }

    const body = parseJsonFields(req.body)

    // ── Giai đoạn 1: LẬP KẾ HOẠCH cho departures (chưa ghi gì) ──
    const capNhatDot = [] // { id, $set..., chenh }
    const themDot = []
    let xoaDotIds = []

    if (body.departures !== undefined) {
      if (!Array.isArray(body.departures) || body.departures.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Tour phải có ít nhất 1 đợt khởi hành.',
          code: 'VALIDATION_ERROR',
        })
      }

      const hienCo = new Map(tour.departures.map((d) => [String(d._id), d]))

      for (const p of body.departures) {
        // Đợt đã tồn tại: cho phép giữ ngày quá khứ (đợt cũ), đợt mới thì không
        const loi = validateDeparture(p, { choPhepQuaKhu: !!p._id })
        if (loi) {
          return res.status(400).json({ success: false, message: loi, code: 'VALIDATION_ERROR' })
        }

        if (p._id) {
          const cu = hienCo.get(String(p._id))
          if (!cu) {
            return res.status(400).json({
              success: false,
              message: `departureId ${p._id} không thuộc tour này.`,
              code: 'VALIDATION_ERROR',
            })
          }
          const tongMoi = Number(p.totalSlots)
          const dangGiu = cu.totalSlots - cu.availableSlots
          // Guard: không hạ tổng chỗ xuống dưới số đang được giữ
          if (tongMoi < dangGiu) {
            return res.status(409).json({
              success: false,
              message: `Đợt ${new Date(cu.date).toLocaleDateString('vi-VN')} đang có ${dangGiu} chỗ đã đặt — totalSlots không thể nhỏ hơn ${dangGiu}.`,
              code: 'SLOTS_BELOW_BOOKED',
              departureId: String(cu._id),
              dangGiu,
            })
          }
          capNhatDot.push({
            id: cu._id,
            date: new Date(p.date),
            price: Number(p.price),
            totalSlots: tongMoi,
            chenh: tongMoi - cu.totalSlots, // availableSlots đi theo phần chênh, qua $inc
            khacNgay: new Date(p.date).getTime() !== new Date(cu.date).getTime(),
            khacGia: Number(p.price) !== cu.price,
          })
        } else {
          themDot.push({
            date: new Date(p.date),
            price: Number(p.price),
            totalSlots: Number(p.totalSlots),
            availableSlots: Number(p.totalSlots),
          })
        }
      }

      // Đợt cũ vắng mặt trong payload = yêu cầu xóa
      const idsTrongPayload = new Set(body.departures.filter((p) => p._id).map((p) => String(p._id)))
      const dotVangMat = tour.departures.filter((d) => !idsTrongPayload.has(String(d._id)))
      if (dotVangMat.length > 0) {
        const demDon = await Booking.aggregate([
          {
            $match: {
              departureId: { $in: dotVangMat.map((d) => d._id) },
              status: { $in: TRANG_THAI_GIU_CHO },
            },
          },
          { $group: { _id: '$departureId', soDon: { $sum: 1 } } },
        ])
        if (demDon.length > 0) {
          // TỪ CHỐI CẢ REQUEST — không xóa "phần được phép", không ghi gì hết
          return res.status(409).json({
            success: false,
            message: `Không thể xóa ${demDon.length} đợt khởi hành vì còn đơn active. Hủy/hoàn tất các đơn trước, hoặc giữ nguyên đợt trong danh sách.`,
            code: 'DEPARTURE_HAS_BOOKINGS',
            departures: demDon.map((d) => ({ departureId: String(d._id), soDon: d.soDon })),
          })
        }
        xoaDotIds = dotVangMat.map((d) => d._id)
      }
    }

    // ── Giai đoạn 2: ÁP DỤNG (mọi validate đã qua) ─────────────
    // 2a. Update từng đợt tại chỗ — availableSlots qua $inc phần chênh, có điều kiện
    //     $gte chặn race với booking đồng thời khi giảm totalSlots.
    for (const c of capNhatDot) {
      if (!c.khacNgay && !c.khacGia && c.chenh === 0) continue // không có gì đổi
      const dieuKienDot = { 'd._id': c.id }
      if (c.chenh < 0) dieuKienDot['d.availableSlots'] = { $gte: -c.chenh }
      const kq = await Tour.updateOne(
        { _id: tour._id },
        {
          $set: {
            'departures.$[d].date': c.date,
            'departures.$[d].price': c.price,
            'departures.$[d].totalSlots': c.totalSlots,
          },
          $inc: { 'departures.$[d].availableSlots': c.chenh },
        },
        { arrayFilters: [dieuKienDot] }
      )
      if (kq.modifiedCount === 0) {
        // Booking đồng thời vừa lấy nốt chỗ trống trong lúc admin giảm totalSlots
        return res.status(409).json({
          success: false,
          message: 'Số chỗ trống vừa thay đổi bởi một đơn đặt đồng thời. Vui lòng tải lại và thử lại.',
          code: 'SLOTS_BELOW_BOOKED',
          departureId: String(c.id),
        })
      }
    }

    // 2b. Xóa các đợt được phép xóa (đã kiểm không còn đơn active)
    if (xoaDotIds.length > 0) {
      await Tour.updateOne({ _id: tour._id }, { $pull: { departures: { _id: { $in: xoaDotIds } } } })
    }

    // 2c. Thêm đợt mới
    if (themDot.length > 0) {
      await Tour.updateOne({ _id: tour._id }, { $push: { departures: { $each: themDot } } })
    }

    // 2d. Các field vô hướng — $set trực tiếp, KHÔNG .save() để không ghi đè
    //     departures bằng bản đã cũ trong bộ nhớ.
    const setVoHuong = {}
    for (const key of ['region', 'location', 'summary', 'description', 'cancellationPolicy', 'status']) {
      if (body[key] !== undefined) setVoHuong[key] = body[key]
    }
    if (body.days !== undefined) setVoHuong.days = Number(body.days)
    if (body.basePrice !== undefined) setVoHuong.basePrice = Number(body.basePrice)
    if (body.oldPrice !== undefined) setVoHuong.oldPrice = body.oldPrice === null || body.oldPrice === '' ? null : Number(body.oldPrice)
    if (body.tags !== undefined) setVoHuong.tags = body.tags
    if (body.isActive !== undefined) setVoHuong.isActive = body.isActive === true || body.isActive === 'true'
    if (body.images !== undefined) setVoHuong.images = body.images
    if (req.files && req.files.length > 0) {
      setVoHuong.images = [...(setVoHuong.images ?? tour.images ?? []), ...req.files.map((f) => buildImageUrl(req, f.filename))]
    }
    if (body.name !== undefined && body.name !== tour.name) {
      setVoHuong.name = body.name
      setVoHuong.slug = sinhSlug(body.name)
      setVoHuong.vectorSync = { isSynced: false, lastSyncedAt: null, chromaId: '' }
    }
    // searchText tính lại từ giá trị SAU cập nhật (hook pre-save không chạy với updateOne)
    setVoHuong.searchText = boDau(
      [setVoHuong.name ?? tour.name, setVoHuong.location ?? tour.location, ...(setVoHuong.tags ?? tour.tags ?? [])].join(' ')
    )

    await Tour.updateOne({ _id: tour._id }, { $set: setVoHuong }, { runValidators: true })

    const tourMoi = await Tour.findById(tour._id).lean()
    res.json({ success: true, message: 'Cập nhật tour thành công!', tour: tourMoi })
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message, code: 'VALIDATION_ERROR' })
    }
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message)[0]
      return res.status(400).json({ success: false, message: msg, code: 'VALIDATION_ERROR' })
    }
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Tên tour bị trùng slug. Hãy đặt tên khác.', code: 'VALIDATION_ERROR' })
    }
    console.error('[updateAdminTour]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   DELETE /api/admin/tours/:id
//  @desc    Soft delete: isActive=false. Còn đơn active → 409.
//           Không hard delete — đơn cũ vẫn cần tham chiếu tour.
//  @access  Private — Admin
// ============================================================
export const deleteAdminTour = async (req, res) => {
  try {
    const tour = await Tour.findById(req.params.id)
    if (!tour) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tour.', code: 'NOT_FOUND' })
    }

    const soDon = await Booking.countDocuments({
      tour: tour._id,
      status: { $in: TRANG_THAI_GIU_CHO },
    })
    if (soDon > 0) {
      return res.status(409).json({
        success: false,
        message: `Tour còn ${soDon} đơn active (chờ thanh toán/đã thanh toán/hoàn thành) — không thể ẩn. Xử lý các đơn trước.`,
        code: 'TOUR_HAS_BOOKINGS',
        soDon,
      })
    }

    await Tour.updateOne({ _id: tour._id }, { $set: { isActive: false } })
    res.json({ success: true, message: `Đã ẩn tour "${tour.name}" khỏi trang khách.` })
  } catch (error) {
    console.error('[deleteAdminTour]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}
