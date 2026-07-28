// ============================================================
//  src/controllers/tourController.js
//  CRUD Tour + Upload ảnh
// ============================================================
import Tour from '../models/Tour.js'

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
    const {
      region,
      minPrice,
      maxPrice,
      days,
      minDays,
      maxDays,
      deals,
      status = 'published', // Mặc định chỉ lấy tour published
      sort = '-createdAt',
      page = 1,
      limit = 12,
      search,
    } = req.query

    // Xây filter
    const filter = {}

    // Admin có thể lấy tất cả status; public chỉ lấy published
    if (req.user?.role === 'admin') {
      if (status !== 'all') filter.status = status
    } else {
      filter.status = 'published'
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
        })
      }
      filter.days = soNgay
    }

    // minDays/maxDays: lọc theo khoảng, phục vụ bộ lọc dải bên Frontend
    if (minDays || maxDays) {
      filter.days = {}
      if (minDays) filter.days.$gte = Number(minDays)
      if (maxDays) filter.days.$lte = Number(maxDays)
    }

    if (minPrice || maxPrice) {
      filter.basePrice = {}
      if (minPrice) filter.basePrice.$gte = Number(minPrice)
      if (maxPrice) filter.basePrice.$lte = Number(maxPrice)
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

    const pageNum = Math.max(1, Number(page))
    const limitNum = Math.min(50, Math.max(1, Number(limit)))
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

    // Khách vãng lai chỉ được xem tour published
    if (tour.status !== 'published' && req.user?.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tour.' })
    }

    res.json({ success: true, tour })
  } catch (error) {
    console.error('[getTour]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   POST /api/tours
//  @desc    Tạo tour mới (Admin only)
//  @access  Private — Admin
// ============================================================
export const createTour = async (req, res) => {
  try {
    const body = { ...req.body, createdBy: req.user._id }

    // Nếu có file upload, thêm URL ảnh vào mảng images
    if (req.files && req.files.length > 0) {
      body.images = req.files.map((f) => buildImageUrl(req, f.filename))
    }

    // Chuyển kiểu dữ liệu JSON string sang object (khi gửi qua form-data)
    if (typeof body.itinerary === 'string') body.itinerary = JSON.parse(body.itinerary)
    if (typeof body.departures === 'string') body.departures = JSON.parse(body.departures)
    if (typeof body.tags === 'string') body.tags = JSON.parse(body.tags)

    const tour = await Tour.create(body)

    res.status(201).json({
      success: true,
      message: 'Tạo tour thành công!',
      tour,
    })
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message)[0]
      return res.status(400).json({ success: false, message: msg })
    }
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Tên tour bị trùng slug. Hãy đặt tên khác.' })
    }
    console.error('[createTour]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   PUT /api/tours/:id
//  @desc    Cập nhật tour (Admin only)
//  @access  Private — Admin
// ============================================================
export const updateTour = async (req, res) => {
  try {
    const tour = await Tour.findById(req.params.id)
    if (!tour) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tour.' })
    }

    const body = { ...req.body }

    // Nếu có ảnh upload mới → thêm vào mảng images hiện có
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((f) => buildImageUrl(req, f.filename))
      body.images = [...(tour.images || []), ...newImages]
    }

    if (typeof body.itinerary === 'string') body.itinerary = JSON.parse(body.itinerary)
    if (typeof body.departures === 'string') body.departures = JSON.parse(body.departures)
    if (typeof body.tags === 'string') body.tags = JSON.parse(body.tags)

    // Nếu tên thay đổi → cần cập nhật slug
    if (body.name && body.name !== tour.name) {
      body.slug = body.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')

      // Đánh dấu cần đồng bộ lại AI khi nội dung thay đổi
      body.vectorSync = { isSynced: false }
    }

    const updated = await Tour.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    })

    // findByIdAndUpdate KHÔNG kích hoạt hook pre('save'), nên searchText sẽ giữ
    // giá trị cũ. Lưu lại một lần để hook chạy và tính lại searchText từ dữ liệu mới.
    await updated.save()

    res.json({ success: true, message: 'Cập nhật tour thành công!', tour: updated })
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message)[0]
      return res.status(400).json({ success: false, message: msg })
    }
    console.error('[updateTour]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.' })
  }
}

// ============================================================
//  @route   DELETE /api/tours/:id
//  @desc    Xóa mềm tour (đổi status → archived) — Admin only
//  @access  Private — Admin
// ============================================================
export const deleteTour = async (req, res) => {
  try {
    const tour = await Tour.findById(req.params.id)
    if (!tour) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tour.' })
    }

    // Xóa mềm: chuyển sang archived thay vì xóa hẳn khỏi DB
    tour.status = 'archived'
    await tour.save()

    res.json({ success: true, message: 'Tour đã được ẩn (archived) thành công.' })
  } catch (error) {
    console.error('[deleteTour]', error)
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
