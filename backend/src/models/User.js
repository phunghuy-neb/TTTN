// ============================================================
//  src/models/User.js
//  Schema người dùng — khớp thiết kế Tuần 1 trong báo cáo
// ============================================================
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const UserSchema = new mongoose.Schema(
  {
    // ── Thông tin cơ bản ────────────────────────────────────
    name: {
      type: String,
      required: [true, 'Vui lòng nhập họ tên'],
      trim: true,
      maxlength: [100, 'Họ tên không được vượt quá 100 ký tự'],
    },

    email: {
      type: String,
      required: [true, 'Vui lòng nhập email'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email không hợp lệ'],
    },

    password: {
      type: String,
      required: [true, 'Vui lòng nhập mật khẩu'],
      minlength: [6, 'Mật khẩu tối thiểu 6 ký tự'],
      select: false, // Mặc định KHÔNG trả password trong query
    },

    phone: {
      type: String,
      trim: true,
      default: '',
    },

    avatar: {
      type: String,
      default: '', // Đường dẫn ảnh đại diện (upload sau)
    },

    // ── Phân quyền ──────────────────────────────────────────
    // customer: khách hàng thông thường
    // admin   : quản trị viên
    role: {
      type: String,
      enum: ['customer', 'admin'],
      default: 'customer',
    },

    // Admin có thể khóa tài khoản (Use Case UC-02 trong báo cáo)
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // Tự động thêm createdAt & updatedAt
  }
)

// ── Hook: Hash password trước khi lưu vào DB ──────────────────
// Chỉ hash nếu password thực sự bị thay đổi (tránh hash 2 lần)
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
  next()
})

// ── Method: So sánh password khi đăng nhập ────────────────────
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password)
}

export default mongoose.model('User', UserSchema)
