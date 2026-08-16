// ============================================================
//  src/controllers/tourController.js
//  CRUD Tour + Upload ảnh
// ============================================================
import Tour from '../models/Tour.js'
import { validateTourNumericQuery } from '../services/tourQueryValidation.js'

// ── Helper: Xây URL ảnh đầy đủ ───────────────────────────────
const buildImageUrl = (req, filename) =>
  `${req.protocol}://${req.get('host')}/uploads/${filename}`

// ============================================================
//  @route   GET /api/tours
//  @desc    Lấy danh sách tour (filter, phân trang, sắp xếp)
//  @access  Public
// ============================================================
export const getTours = async (req, res) => {
  try {
    const numericQuery = validateTourNumericQuery(req.query)
    if (!numericQuery.valid) {
      return res.status(400).json({
        success: false,
        message: numericQuery.message,
        code: 'VALIDATION_ERROR',
      })
    }

    const {
      region,
      days,
      deals,
      status = 'published', // Mặc định chỉ lấy tour published
      sort = '-createdAt',
      search,
    } = req.query
    const {
      page = 1,
      limit = 12,
      minPrice,
      maxPrice,
      minDays,
      maxDays,
    } = numericQuery.values

    // Xây filter
    const filter = {}

    // Admin có thể lấy tất cả status; public chỉ lấy published và chưa bị ẩn
    if (req.user?.role === 'admin') {
      if (status !== 'all') filter.status = status
    } else {
      filter.status = 'published'
      filter.isActive = { $ne: false } // tour soft-delete (Batch 3) ẩn khỏi client
    }

    if (region) filter.region = region

    // days: số chính xác. Query sai kiểu trả 400 thay vì để NaN chui xuống
    // Mongoose gây CastError rồi rơi vào catch chung thành 500.
    if (days) {
      const soNgay = Number(days)
      if (!Number.isInteger(soNgay) || soNgay < 1) {
        return res.status(400).json({
          success: false,
          message: 'Tham so "days" phai la so nguyen duong. Dung minDays/maxDays neu muon loc theo khoang.',
          code: 'VALIDATION_ERROR',
        })
      }
      filter.days = soNgay
    }

    // minDays/maxDays: lọc theo khoảng, phục vụ bộ lọc dải bên Frontend
    if (minDays !== undefined || maxDays !== undefined) {
      filter.days = {}
      if (minDays !== undefined) filter.days.$gte = minDays
      if (maxDays !== undefined) filter.days.$lte = maxDays
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.basePrice = {}
      if (minPrice !== undefined) filter.basePrice.$gte = minPrice
      if (maxPrice !== undefined) filter.basePrice.$lte = maxPrice
    }
    if (search) {
      const tuKhoa = String(search)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
      // Escape ký tự đặc biệt của regex — nếu không, người dùng gõ "(" hoặc "["
      // sẽ tạo pattern không hợp lệ và Mongoose ném lỗi → 500.
      const tuKhoaEscaped = tuKhoa.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter.searchText = { $regex: tuKhoaEscaped, $options: 'i' }
    }

    // deals: chỉ lấy tour đang giảm giá. Lọc ở tầng query để việc phân trang
    // tính trên đúng tập kết quả — nếu lọc phía client sau khi phân trang thì
    // tour ưu đãi ở các trang sau sẽ bị bỏ sót và total/totalPages sai.
    if (deals === 'true' || deals === '1') {
      filter.$expr = { $gt: ['$oldPrice', '$basePrice'] }
    }

    const pageNum = page
    const limitNum = Math.min(50, limit)
    const skip = (pageNum - 1) * limitNum

    const [tours, total] = await Promise.all([
      Tour.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .select('-itinerary -reviews -vectorSync -searchText'), // Bỏ field nặng ở danh sách
      Tour.countDocuments(filter),
    ])

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      tours,
    })
  } catch (error) {
    console.error('[getTours]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   GET /api/tours/:idOrSlug
//  @desc    Xem chi tiết 1 tour (theo id hoặc slug)
//  @access  Public
// ============================================================
export const getTour = async (req, res) => {
  try {
    const { idOrSlug } = req.params

    // Thử tìm theo ObjectId trước, nếu không hợp lệ thì tìm theo slug
    let tour
    if (idOrSlug.match(/^[0-9a-fA-F]{24}$/)) {
      tour = await Tour.findById(idOrSlug)
        .populate('createdBy', 'name email')
        .populate('reviews.user', 'name avatar')
    }
    if (!tour) {
      tour = await Tour.findOne({ slug: idOrSlug })
        .populate('createdBy', 'name email')
        .populate('reviews.user', 'name avatar')
    }

    if (!tour) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tour.' })
    }

    // Khách vãng lai chỉ được xem tour published và chưa bị ẩn (soft delete)
    if ((tour.status !== 'published' || tour.isActive === false) && req.user?.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tour.' })
    }

    const tourData = tour.toObject()
    tourData.reviews = (tourData.reviews || []).filter((review) => review.isVisible !== false)
    res.json({ success: true, tour: tourData })
  } catch (error) {
    console.error('[getTour]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}
// ============================================================
//  @route   POST /api/tours/upload
//  @desc    Upload ảnh đơn lẻ — trả về URL để dùng trong form
//  @access  Private — Admin
// ============================================================
export const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn file ảnh.' })
    }
    const url = buildImageUrl(req, req.file.filename)
    res.json({ success: true, url })
  } catch (error) {
    console.error('[uploadImage]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}
