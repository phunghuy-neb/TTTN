// ============================================================
//  src/controllers/settingsController.js
//  Cài đặt AI (admin) + cài đặt public cho client (Batch 7)
// ============================================================
import Setting from '../models/Setting.js'
import ChatMessage from '../models/ChatMessage.js'

const PING_TIMEOUT_MS = 3000

// Che bớt URL trước khi trả về UI: giữ protocol + 3 ký tự đầu host + 4 ký tự cuối
function cheUrl(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.host
    const duoi = host.length > 7 ? host.slice(-4) : ''
    return `${u.protocol}//${host.slice(0, 3)}•••${duoi}`
  } catch {
    return url.slice(0, 6) + '•••'
  }
}

// Ping AI service THẬT, timeout 3s — bất kỳ HTTP response nào cũng tính là online
// (kể cả 404: server còn sống là được, hợp đồng /chat kiểm sau)
async function pingAi(url) {
  try {
    const controller = new AbortController()
    const henGio = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
    const response = await fetch(`${url.replace(/\/$/, '')}/health`, {
      signal: controller.signal,
      headers: { 'x-internal-api-key': String(process.env.AI_SERVICE_API_KEY || '') },
    })
    if (!response.ok) {
      clearTimeout(henGio)
      return { status: 'offline', health: null }
    }
    let health = null
    try {
      health = await response.json()
    } catch (error) {
      if (error?.name === 'AbortError') throw error
    }
    clearTimeout(henGio)
    return { status: 'online', health }
  } catch {
    return { status: 'offline', health: null }
  }
}

// ============================================================
//  @route   GET /api/admin/ai-settings
//  @desc    Trạng thái AI service + cấu hình chat + thống kê sử dụng
//  @access  Private — Admin
// ============================================================
export const getAiSettings = async (req, res) => {
  try {
    const url = (process.env.AI_SERVICE_URL || '').trim()

    const [serviceHealth, chatEnabled, totalMessages, uniqueUsers] = await Promise.all([
      url ? pingAi(url) : Promise.resolve({ status: 'not_configured', health: null }),
      Setting.layGiaTri('chatEnabled', true),
      ChatMessage.countDocuments(),
      ChatMessage.distinct('userId').then((ds) => ds.length),
    ])

    res.json({
      success: true,
      aiServiceUrl: cheUrl(url),
      status: serviceHealth.status,
      capabilityStatus: serviceHealth.health?.status || null,
      capabilities: serviceHealth.health?.capabilities || null,
      indexReconciliation: serviceHealth.health?.reconciliation || null,
      chatEnabled: chatEnabled !== false,
      totalMessages,
      uniqueUsers,
    })
  } catch (error) {
    console.error('[getAiSettings]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   PATCH /api/admin/ai-settings
//  @desc    Bật/tắt chat widget toàn site — lưu DB (upsert key-value)
//  @access  Private — Admin
// ============================================================
export const patchAiSettings = async (req, res) => {
  try {
    const { chatEnabled } = req.body
    if (typeof chatEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'chatEnabled phải là true/false.',
        code: 'VALIDATION_ERROR',
      })
    }

    await Setting.updateOne({ key: 'chatEnabled' }, { $set: { value: chatEnabled } }, { upsert: true })

    res.json({
      success: true,
      message: chatEnabled ? 'Đã bật chat trợ lý trên toàn site.' : 'Đã tắt chat trợ lý trên toàn site.',
      chatEnabled,
    })
  } catch (error) {
    console.error('[patchAiSettings]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}

// ============================================================
//  @route   GET /api/settings/public
//  @desc    Cài đặt công khai cho client — FE quyết định có render ChatWidget không
//  @access  Public
// ============================================================
export const getPublicSettings = async (req, res) => {
  try {
    const chatEnabled = await Setting.layGiaTri('chatEnabled', true)
    res.json({ success: true, chatEnabled: chatEnabled !== false })
  } catch (error) {
    console.error('[getPublicSettings]', error)
    res.status(500).json({ success: false, message: 'Lỗi máy chủ.', code: 'SERVER_ERROR' })
  }
}
