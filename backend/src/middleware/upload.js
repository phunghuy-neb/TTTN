// ============================================================
//  src/middleware/upload.js
//  Cấu hình multer để nhận file upload ảnh từ client
// ============================================================
import multer from 'multer'
import path from 'path'
import fs from 'fs'

// Đảm bảo thư mục uploads/ tồn tại khi server khởi động
const UPLOAD_DIR = 'uploads'
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

// ── Cấu hình nơi lưu file ─────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR)
  },
  // Đặt tên file: timestamp + tên gốc (tránh trùng)
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const ext = path.extname(file.originalname)
    const prefix = req.originalUrl.includes('/reviews') ? 'review' : 'tour'
    cb(null, `${prefix}-${uniqueSuffix}${ext}`)
  },
})

// ── Kiểm tra định dạng file ───────────────────────────────────
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
  const mimetype = allowedTypes.test(file.mimetype)

  if (extname && mimetype) {
    return cb(null, true)
  }
  cb(new Error('Chỉ chấp nhận file ảnh: .jpg, .jpeg, .png, .webp'))
}

// ── Tạo instance multer ───────────────────────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // Tối đa 5MB mỗi file
  },
})

export default upload
