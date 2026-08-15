// ============================================================
//  src/routes/chatRoutes.js
//  Trợ lý AI (UC-07) — tất cả route đều cần đăng nhập
// ============================================================
import { Router } from 'express'
import {
  postChat,
  createConversation,
  listConversations,
  getConversationMessages,
  getChatHistory,
  deleteChatHistory,
} from '../controllers/chatController.js'
import { protect } from '../middleware/auth.js'
import { rateLimit } from '../middleware/security.js'

const router = Router()

router.use(protect)

// POST   /api/chat          → hỏi trợ lý, nhận { reply, decision, suggestedTours }
router.post('/', rateLimit({
  windowMs: 60_000,
  max: Number(process.env.AI_USER_RATE_LIMIT_PER_MINUTE) || 30,
  prefix: 'chat-user',
  keyGenerator: (req) => `user:${req.user._id}`,
  code: 'RATE_LIMIT',
}), postChat)

router.post('/conversations', createConversation)
router.get('/conversations', listConversations)
router.get('/conversations/:conversationId/messages', getConversationMessages)

// GET    /api/chat/history  → hội thoại của mình (phân trang, mới → cũ)
router.get('/history', getChatHistory)

// DELETE /api/chat/history  → xóa hội thoại của mình
router.delete('/history', deleteChatHistory)

export default router
