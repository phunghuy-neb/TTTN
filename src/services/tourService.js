// Tầng service tour — gọi API Tour THẬT của Backend (`/api/tours`) qua services/api.js.
// Nhiệm vụ của tầng này: đổi tên tham số FE → tham số Backend khi gửi đi, và đổi cấu trúc
// response Backend → cấu trúc §7 khi trả về, để component (TourList/Home/TourDetail) không
// phải sửa một dòng nào khi nguồn dữ liệu đổi từ mock sang API thật.
// Cấu trúc trả về giữ nguyên: { success, data, pagination } / { success, data } / { success: false, message }.
//
// HAI HẠN CHẾ ĐÃ BIẾT sau khi nối API thật (chi tiết ở comment trong từng hàm bên dưới):
// 1. Tham số `deals` — Backend chưa có tham số lọc tour ưu đãi, FE tạm lọc phía client nên
//    chỉ lọc được trong phạm vi trang đã phân trang, số liệu phân trang không chính xác.
// 2. Tìm kiếm không dấu — Backend dùng $regex MongoDB (so khớp CÓ dấu) nên gõ không dấu
//    không còn ra kết quả có dấu như thời mock.
import { request } from './api.js'

// Giả lập độ trễ mạng — giữ lại cho các nhánh còn mock ở tuần sau
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Bỏ dấu tiếng Việt + viết thường để so khớp không phân biệt dấu/hoa thường.
// KHÔNG còn dùng để lọc: việc tìm kiếm đã chuyển hẳn sang Backend ($regex trên name/location/tags).
// HẠN CHẾ ĐÃ BIẾT: vì $regex của MongoDB so khớp CÓ dấu, hành vi "gõ không dấu vẫn ra kết quả
// có dấu" (chạy đúng ở bản mock nhờ hàm này) HIỆN KHÔNG CÒN ĐÚNG sau khi nối API thật.
// Muốn khôi phục cần một trong hai: (a) Backend đổi sang tìm kiếm full-text không phân biệt dấu
// (collation strength 1 hoặc trường phụ đã bỏ dấu), hoặc (b) FE tải toàn bộ tour rồi tự lọc —
// không làm ở phiên này vì tốn hiệu năng khi dữ liệu lớn.
function boDau(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

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

  if (days) params.set('days', days)

  const sortBE = SORT_MAP[sort]
  if (sortBE) params.set('sort', sortBE)

  // KHÔNG gửi `status`: Backend tự lọc `status: 'published'` cho khách vãng lai (UC-04 §13).
  // KHÔNG gửi `deals`: Backend không có tham số này — xử lý phía client bên dưới.

  const res = await request(`/tours?${params.toString()}`)
  if (res.success === false) return res

  let data = res.tours
  let total = res.total
  let totalPages = res.totalPages

  if (deals) {
    // HẠN CHẾ ĐÃ BIẾT — Backend chưa hỗ trợ lọc tour ưu đãi (`oldPrice > basePrice`) ở tầng
    // query, nên tạm lọc phía client. Cách này CHỈ ĐÚNG khi số tour ưu đãi nhỏ và nằm gọn
    // trong trang đầu: ta chỉ lọc trên các bản ghi của MỘT trang đã được Backend phân trang,
    // nên tour ưu đãi ở những trang sau sẽ bị bỏ sót, và `total`/`totalPages` tính lại dưới
    // đây cũng chỉ phản ánh trang hiện tại chứ không phải toàn bộ dữ liệu.
    // Muốn chính xác trên toàn bộ dữ liệu: cần Backend bổ sung tham số `deals`/`onSale` ở
    // query string để việc lọc diễn ra trước khi phân trang.
    data = data.filter((t) => t.oldPrice != null && t.oldPrice > t.basePrice)
    total = data.length
    totalPages = Math.ceil(total / limit)
  }

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
