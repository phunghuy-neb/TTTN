// ============================================================
//  src/models/Setting.js
//  Cấu hình hệ thống dạng key-value (Batch 7) — VD: chatEnabled.
//  Đọc/ghi qua upsert, không cần migration khi thêm key mới.
// ============================================================
import mongoose from 'mongoose'

const SettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true, collection: 'settings' }
)

// Helper đọc 1 key với giá trị mặc định
SettingSchema.statics.layGiaTri = async function (key, macDinh) {
  const doc = await this.findOne({ key }).lean()
  return doc ? doc.value : macDinh
}

export default mongoose.model('Setting', SettingSchema)
