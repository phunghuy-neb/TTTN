// ============================================================
//  src/routes/adminRoutes.js
//  Các endpoint /api/admin/* dùng chung (không thuộc users/bookings)
// ============================================================
import { Router } from 'express'
import { getAdminStats } from '../controllers/adminController.js'
import { getAiSettings, patchAiSettings } from '../controllers/settingsController.js'
import { protect } from '../middleware/auth.js'
import requireAdmin from '../middleware/requireAdmin.js'

const router = Router()

// Tất cả route ở đây đều cần đăng nhập + quyền admin
router.use(protect)
router.use(requireAdmin)

// GET /api/admin/stats → Số liệu tổng quan cho Dashboard
router.get('/stats', getAdminStats)

// GET   /api/admin/ai-settings → trạng thái AI service + thống kê chat
// PATCH /api/admin/ai-settings → bật/tắt chat widget toàn site
router.get('/ai-settings', getAiSettings)
router.patch('/ai-settings', patchAiSettings)

export default router
