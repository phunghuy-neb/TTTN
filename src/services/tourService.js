// Tầng service tour — TẠM đọc từ dữ liệu mock trong ../data/tours.js.
// Phiên sau chỉ thay phần THÂN hàm bằng lời gọi API thật qua api.js:
// các tham số lọc/sắp/phân trang sẽ được truyền thẳng thành query string,
// cấu trúc trả về { success, data, pagination } giữ nguyên để component không phải sửa.
import { TOURS } from '../data/tours.js'

// Giả lập độ trễ mạng
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Bỏ dấu tiếng Việt + viết thường để so khớp không phân biệt dấu/hoa thường
function boDau(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

// Lấy danh sách tour: lọc → sắp xếp → phân trang (tất cả trên mock)
export async function getTours({
  page = 1,
  limit = 6,
  q = '',
  region = '',
  minPrice = 0,
  maxPrice = 0,
  days = '',
  sort = '',
  deals = false,
} = {}) {
  await delay(300)

  // Chỉ hiển thị tour đang mở bán — lọc TRƯỚC mọi bộ lọc khác (UC-04 §13)
  let list = TOURS.filter((t) => t.status === 'published')

  // deals: chỉ giữ tour đang giảm giá (oldPrice > basePrice) — điều kiện ưu đãi UC-04 §13.
  // Đặt ngay sau bước lọc published, trước các bộ lọc còn lại.
  // Khi nối API thật, `deals` sẽ được truyền thành query param —
  // cần thống nhất tên tham số này với Backend.
  if (deals) list = list.filter((t) => t.oldPrice != null && t.oldPrice > t.basePrice)

  // q: tìm không dấu trong name và location
  if (q) {
    const key = boDau(q)
    list = list.filter((t) => boDau(t.name).includes(key) || boDau(t.location).includes(key))
  }

  // region: khớp chính xác
  if (region) list = list.filter((t) => t.region === region)

  // khoảng giá trên basePrice — 0 nghĩa là không giới hạn
  const min = Number(minPrice) || 0
  const max = Number(maxPrice) || 0
  if (min > 0) list = list.filter((t) => t.basePrice >= min)
  if (max > 0) list = list.filter((t) => t.basePrice <= max)

  // days: '2-3' | '4-5' | '6+'
  if (days === '2-3') list = list.filter((t) => t.days >= 2 && t.days <= 3)
  else if (days === '4-5') list = list.filter((t) => t.days >= 4 && t.days <= 5)
  else if (days === '6+') list = list.filter((t) => t.days >= 6)

  // sắp xếp — rỗng hoặc lạ thì giữ nguyên thứ tự gốc
  if (sort === 'price-asc') list.sort((a, b) => a.basePrice - b.basePrice)
  else if (sort === 'price-desc') list.sort((a, b) => b.basePrice - a.basePrice)
  else if (sort === 'rating-desc') list.sort((a, b) => b.avgRating - a.avgRating)

  // phân trang tính TRÊN KẾT QUẢ ĐÃ LỌC
  const total = list.length
  const totalPages = Math.ceil(total / limit)
  const start = (page - 1) * limit
  const data = list.slice(start, start + limit)

  return {
    success: true,
    data,
    pagination: { page, limit, total, totalPages },
  }
}

// Lấy chi tiết một tour theo slug (định danh URL — D-01, §12.1)
export async function getTourBySlug(slug) {
  await delay(300)

  const tour = TOURS.find((t) => t.slug === slug)
  // Không tồn tại → không tìm thấy
  if (!tour) return { success: false, message: 'Không tìm thấy tour.' }
  // Tồn tại nhưng không mở bán (archived/draft) → hiển thị như không còn bán (UC-06)
  if (tour.status !== 'published') return { success: false, message: 'Tour này hiện không còn được mở bán.' }
  return { success: true, data: tour }
}
