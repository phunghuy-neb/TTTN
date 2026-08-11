// ============================================================
//  src/routes/chatRoutes.js
//  Trợ lý AI (UC-07) — tất cả route đều cần đăng nhập
// ============================================================
import { Router } from 'express'
import { postChat, getChatHistory, deleteChatHistory } from '../controllers/chatController.js'
import { protect } from '../middleware/auth.js'

const router = Router()

router.use(protect)

// POST   /api/chat          → hỏi trợ lý, nhận { reply, suggestedTours }
router.post('/', postChat)

// GET    /api/chat/history  → hội thoại của mình (phân trang, mới → cũ)
router.get('/history', getChatHistory)

// DELETE /api/chat/history  → xóa hội thoại của mình
router.delete('/history', deleteChatHistory)

export default router
