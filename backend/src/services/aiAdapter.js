// ============================================================
//  src/services/aiAdapter.js — Đường ống nối AI service (UC-07)
//
//  ĐÂY LÀ FILE DUY NHẤT cần sửa khi nối AI thật.
//  TODO(ai): thay bằng service của Tuấn Anh — chỉ cần set AI_SERVICE_URL
//  trong .env. Hợp đồng đã chốt:
//    POST {AI_SERVICE_URL}/chat
//    body    : { prompt, userName, tourContext | null, history }
//    response: { reply: string, suggestedTours: [{ _id, title, price, image }] }
//
//  Hành vi:
//    - AI_SERVICE_URL TRỐNG  → dùng stub nội bộ (chế độ dev, không cần AI)
//    - AI_SERVICE_URL CÓ mà gọi lỗi/timeout 30s → ném AiUnavailableError
//      (controller trả 503 AI_UNAVAILABLE — khi đã cấu hình AI thật thì phải
//       biết nó chết, không âm thầm rơi về stub)
// ============================================================
import Tour from '../models/Tour.js'

const TIMEOUT_MS = 30_000

export class AiUnavailableError extends Error {
  constructor(chiTiet) {
    super('AI service không phản hồi')
    this.name = 'AiUnavailableError'
    this.chiTiet = chiTiet
  }
}

// Bỏ dấu — dùng khớp từ khóa với searchText của Tour
const boDau = (chuoi) =>
  String(chuoi)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')

const formatGia = (v) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`

// Chuẩn hóa 1 tour Mongo → phần tử suggestedTours theo shape cố định
const veShapeGoiY = (t) => ({
  _id: t._id,
  title: t.name,
  price: t.basePrice,
  image: t.images?.[0] || '',
})

// Gợi ý 1-2 tour THẬT từ MongoDB: ưu tiên khớp từ khóa qua searchText,
// thiếu thì bù bằng tour điểm cao nhất. Không bao giờ bịa tour.
async function goiYTourThat(message, tourContext) {
  const dieuKienChung = { status: 'published', isActive: { $ne: false } }
  const loaiTruContext = tourContext ? { _id: { $ne: tourContext._id } } : {}

  // Lấy các từ có nghĩa (≥3 ký tự) trong câu hỏi để khớp searchText
  const tuKhoa = boDau(message)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)

  let khop = []
  if (tuKhoa.length > 0) {
    khop = await Tour.find({
      ...dieuKienChung,
      ...loaiTruContext,
      searchText: { $regex: tuKhoa.join('|'), $options: 'i' },
    })
      .sort('-avgRating')
      .limit(2)
      .lean()
  }
  if (khop.length < 2) {
    // Loại các tour đã gợi ý + tour đang xem khỏi phần bù
    const loaiTru = [...khop.map((t) => t._id), ...(tourContext ? [tourContext._id] : [])]
    const bu = await Tour.find({ ...dieuKienChung, _id: { $nin: loaiTru } })
      .sort('-avgRating')
      .limit(2 - khop.length)
      .lean()
    khop = [...khop, ...bu]
  }
  return khop.map(veShapeGoiY)
}

// ── Stub nội bộ: trả lời mẫu tiếng Việt theo từ khóa ─────────
// TODO(ai): toàn bộ hàm này sẽ bị bỏ qua khi AI_SERVICE_URL được set.
async function stubTraLoi({ message, userName, tourContext }) {
  const msg = boDau(message)
  const xungHo = userName ? `${userName} ơi, ` : ''
  let reply

  if (/\bgia\b|bao nhieu|chi phi|dat tien/.test(msg)) {
    reply = tourContext
      ? `${xungHo}tour "${tourContext.name}" có giá từ ${formatGia(tourContext.basePrice)}/khách — giá chính xác tùy đợt khởi hành bạn chọn (mỗi đợt hiển thị giá riêng ngay trên trang tour). Bạn muốn mình gợi ý thêm lựa chọn tầm giá tương tự không?`
      : `${xungHo}giá tour bên mình dao động theo điểm đến và đợt khởi hành — bạn xem giá từng đợt ngay trên trang chi tiết tour nhé. Dưới đây là vài hành trình được đánh giá cao để bạn tham khảo.`
  } else if (/lich trinh|hanh trinh|di dau|tham quan|ngay nao/.test(msg)) {
    reply = tourContext
      ? `${xungHo}"${tourContext.name}" kéo dài ${tourContext.days} ngày${tourContext.itinerarySo ? ` với ${tourContext.itinerarySo} chặng được mô tả chi tiết trong mục "Lịch trình chi tiết"` : ''}. Bạn cuộn xuống phần lịch trình trên trang tour để xem từng ngày nhé.`
      : `${xungHo}mỗi tour đều có mục "Lịch trình chi tiết" mô tả từng ngày (điểm tham quan, bữa ăn, nơi nghỉ). Bạn mở một tour bên dưới để xem thử nhé.`
  } else if (/\bdat\b|booking|giu cho|thanh toan/.test(msg)) {
    reply = `${xungHo}để đặt tour bạn chỉ cần: mở trang tour → chọn đợt khởi hành còn chỗ → nhập số khách → bấm "Đặt tour ngay" và xác nhận thông tin liên hệ. Đơn sẽ ở trạng thái chờ thanh toán, công ty sẽ liên hệ xác nhận.`
  } else if (/\bhuy\b|hoan tien|doi lich/.test(msg)) {
    reply = `${xungHo}bạn có thể tự hủy đơn khi đơn còn ở trạng thái "Chờ thanh toán" trong mục Lịch sử đặt tour — chỗ sẽ được hoàn về đợt ngay lập tức. Chính sách hủy chi tiết nằm ở cuối mỗi trang tour.`
  } else {
    reply = tourContext
      ? `${xungHo}mình đang ở đây để tư vấn về "${tourContext.name}" — bạn có thể hỏi về giá, lịch trình, cách đặt chỗ hay chính sách hủy. Ngoài ra đây là vài hành trình tương tự đáng cân nhắc.`
      : `Chào ${userName || 'bạn'}! Mình là trợ lý VietVoyage — bạn có thể hỏi về giá, lịch trình, cách đặt tour hay chính sách hủy. Dưới đây là vài hành trình nổi bật để bắt đầu.`
  }

  const suggestedTours = await goiYTourThat(message, tourContext)
  return { reply, suggestedTours }
}

// ── Cổng duy nhất controller gọi ─────────────────────────────
export async function sinhTraLoi({ message, userName, tourContext, history = [] }) {
  const url = (process.env.AI_SERVICE_URL || '').trim()

  // Chưa cấu hình AI → stub nội bộ
  if (!url) {
    return stubTraLoi({ message, userName, tourContext })
  }

  // TODO(ai): nhánh dưới đây gọi service của Tuấn Anh — hợp đồng ở đầu file.
  try {
    const controller = new AbortController()
    const henGio = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(`${url.replace(/\/$/, '')}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': String(process.env.AI_SERVICE_API_KEY || ''),
      },
      body: JSON.stringify({ prompt: message, userName, tourContext, history }),
      signal: controller.signal,
    })
    clearTimeout(henGio)
    if (!res.ok) throw new Error(`AI service trả HTTP ${res.status}`)
    const data = await res.json()

    // Ép về đúng shape cố định — không tin shape ngoài
    const returnedTours = data.tours || data.suggestedTours || []
    const suggested = Array.isArray(returnedTours)
      ? returnedTours.filter((tour) => {
          if (tourContext?._id && String(tour._id) === String(tourContext._id)) return false
          if (!Array.isArray(tour.departures)) return true
          return tour.departures.some(
            (departure) => new Date(departure.date) > new Date() && Number(departure.availableSlots) > 0
          )
        })
      : []
    return {
      reply: String(data.reply || ''),
      suggestedTours: suggested.length
        ? suggested.slice(0, 4).map((t) => ({
            _id: t._id,
            title: String(t.title || t.name || ''),
            price: Number(t.price || t.basePrice) || 0,
            image: String(t.image || t.images?.[0] || ''),
          }))
        : [],
    }
  } catch (err) {
    throw new AiUnavailableError(err.message)
  }
}
