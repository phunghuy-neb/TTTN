// ============================================================
//  src/routes/settingsRoutes.js
//  Cài đặt công khai — client đọc không cần đăng nhập
// ============================================================
import { Router } from 'express'
import { getPublicSettings } from '../controllers/settingsController.js'

const router = Router()

// GET /api/settings/public → { chatEnabled }
router.get('/public', getPublicSettings)

export default router
