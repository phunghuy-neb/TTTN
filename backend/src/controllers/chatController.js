// ============================================================
//  src/controllers/chatController.js
//  Trợ lý AI (UC-07) — đường ống đã dựng sẵn, AI thật nối qua
//  src/services/aiAdapter.js (chỉ cần set AI_SERVICE_URL).
// ============================================================
import ChatMessage from '../models/ChatMessage.js'
import Tour from '../models/Tour.js'
import { sinhTraLoi, AiUnavailableError } from '../services/aiAdapter.js'

// ============================================================
//  @route   POST /api/chat
//  @desc    Gửi 1 câu hỏi → nhận { reply, suggestedTours } (shape cố định).
//           Lưu cả câu hỏi lẫn câu trả lời vào chatMessages.
//  @access  Private (cần đăng nhập)
// ============================================================
export const postChat = async (req, res) => {
  try {
    const { message, tourId } = req.body

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập nội dung câu hỏi.',
        code: 'VALIDATION_ERROR',
      })
    }
    if (message.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Câu hỏi tối đa 1000 ký tự.',
        code: 'VALIDATION_ERROR',
      })
    }

    // Bơm context tour đang xem (FE gửi id hoặc slug — chấp nhận cả hai)
    let tourContext = null
    if (tourId) {
      const tour = /^[0-9a-fA-F]{24}$/.test(tourId)
        ? await Tour.findById(tourId).lean()
        : await Tour.findOne({ slug: tourId }).lean()
      if (tour) {
        tourContext = {
          _id: tour._id,
          name: tour.name,
          basePrice: tour.basePrice,
          days: tour.days,
          region: tour.region,
          itinerarySo: tour.itinerary?.length || 0,
        }
      }
    }

    const history = await ChatMessage.find({ userId: req.user._id })
      .sort({ at: -1 })
      .limit(12)
      .select('role content')
      .lean()

    let ketQua
    try {
      ketQua = await sinhTraLoi({
        message: message.trim(),
        userName: req.user.name,
        tourContext,
        history: history.reverse(),
      })
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        // AI thật được cấu hình nhưng chết/timeout — báo lỗi tử tế, KHÔNG crash
        console.error('[postChat] AI service không phản hồi:', err.chiTiet)
        return res.status(503).json({
          success: false,
          message: 'Trợ lý AI đang tạm gián đoạn. Bạn thử lại sau ít phút nhé.',
          code: 'AI_UNAVAILABLE',
        })
      }
      throw err
    }

    // Lưu hội thoại (chỉ khi có trả lời thành công)
    await ChatMessage.insertMany([
      {
        userId: req.user._id,
        role: 'user',
        content: message.trim(),
        tourId: tourContext?._id || null,
      },
      {
        userId: req.user._id,
        role: 'assistant',
        content: ketQua.reply,
        tourId: tourContext?._id || null,
      },
    ])

    res.json({ success: true, reply: ketQua.reply, suggestedTours: ketQua.suggestedTours })
  } catch (error) {
    console.error('[postChat]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   GET /api/chat/history
//  @desc    Hội thoại của user đang đăng nhập — phân trang từ MỚI về CŨ
//           (FE đảo lại khi hiển thị)
//  @access  Private
// ============================================================
export const getChatHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const pageNum = Math.max(1, Number(page))
    const limitNum = Math.min(50, Math.max(1, Number(limit)))
    const skip = (pageNum - 1) * limitNum

    const [messages, total] = await Promise.all([
      ChatMessage.find({ userId: req.user._id })
        .sort({ at: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ChatMessage.countDocuments({ userId: req.user._id }),
    ])

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      messages: messages.map((m) => ({
        _id: m._id,
        role: m.role,
        content: m.content,
        tourId: m.tourId,
        at: m.at,
      })),
    })
  } catch (error) {
    console.error('[getChatHistory]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   DELETE /api/chat/history
//  @desc    Xóa toàn bộ hội thoại của user đang đăng nhập
//  @access  Private
// ============================================================
export const deleteChatHistory = async (req, res) => {
  try {
    const kq = await ChatMessage.deleteMany({ userId: req.user._id })
    res.json({ success: true, message: `Đã xóa ${kq.deletedCount} tin nhắn.` })
  } catch (error) {
    console.error('[deleteChatHistory]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}
