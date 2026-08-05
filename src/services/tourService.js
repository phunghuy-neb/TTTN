// Tầng service tour — gọi API Tour THẬT của Backend (`/api/tours`) qua services/api.js.
// Nhiệm vụ của tầng này: đổi tên tham số FE → tham số Backend khi gửi đi, và đổi cấu trúc
// response Backend → cấu trúc §7 khi trả về, để component (TourList/Home/TourDetail) không
// phải sửa một dòng nào khi nguồn dữ liệu đổi từ mock sang API thật.
// Cấu trúc trả về giữ nguyên: { success, data, pagination } / { success, data } / { success: false, message }.
import { request } from './api.js'

// Map giá trị sắp xếp của FE → cú pháp sort của Mongoose mà Backend nhận.
// Giá trị rỗng/không khớp → không gửi `sort`, để Backend dùng mặc định `-createdAt`.
const SORT_MAP = {
  'price-asc': 'basePrice',
  'price-desc': '-basePrice',
  'rating-desc': '-avgRating',
}

// Lấy danh sách tour từ Backend: dựng query string → gọi API → chuyển đổi về cấu trúc §7
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
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('limit', String(limit))

  // q (tên FE) → search (tên Backend). Chỉ thêm khi có giá trị để không gửi tham số rỗng.
  if (q) params.set('search', q)
  if (region) params.set('region', region)

  // 0 nghĩa là không giới hạn — không gửi lên Backend
  const min = Number(minPrice) || 0
  const max = Number(maxPrice) || 0
  if (min > 0) params.set('minPrice', String(min))
  if (max > 0) params.set('maxPrice', String(max))

  // Backend nhận khoảng qua minDays/maxDays; số thuần vẫn dùng days.
  if (days) {
    if (/^\d+$/.test(days)) {
      params.set('days', days)
    } else if (days === '6+') {
      params.set('minDays', '6')
    } else {
      const [tu, den] = days.split('-')
      if (tu) params.set('minDays', tu)
      if (den) params.set('maxDays', den)
    }
  }

  const sortBE = SORT_MAP[sort]
  if (sortBE) params.set('sort', sortBE)

  if (deals) params.set('deals', 'true')

  // KHÔNG gửi `status`: Backend tự lọc `status: 'published'` cho khách vãng lai (UC-04 §13).

  const res = await request(`/tours?${params.toString()}`)
  if (res.success === false) return res

  const data = res.tours
  const total = res.total
  const totalPages = res.totalPages

  // Backend trả `tours` + total/page/totalPages phẳng → gộp về cấu trúc §7.
  // `limit` lấy từ tham số đầu vào vì response Backend không có trường này.
  return {
    success: true,
    data,
    pagination: { page: res.page, limit, total, totalPages },
  }
}

// Lấy chi tiết một tour theo slug (định danh URL — D-01, §12.1).
// Backend nhận cả ObjectId lẫn slug, và tự trả 404 kèm { success: false, message } cho tour
// không tồn tại hoặc archived → FE không cần kiểm `status` bằng tay nữa.
export async function getTourBySlug(slug) {
  const res = await request(`/tours/${slug}`)
  if (res.success === false) return res

  return { success: true, data: res.tour }
}
