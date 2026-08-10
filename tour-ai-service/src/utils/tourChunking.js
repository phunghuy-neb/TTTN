/**
 * Chiến lược chunking (thiết kế Tuần 1):
 * Một tour KHÔNG được embedding thành một khối duy nhất, mà tách thành nhiều
 * chunk nhỏ theo khía cạnh nội dung, giúp AI truy vấn chính xác hơn khi câu hỏi
 * chỉ liên quan tới một phần thông tin (VD: hỏi lịch trình ngày 2, không phải cả tour).
 *
 *   - overview  : name, description, category/tags, giá, địa điểm
 *   - itinerary : nội dung ghép từ itinerary[]
 *   - policy    : cancellationPolicy
 */

function formatCurrency(n) {
  if (typeof n !== "number") return "";
  return n.toLocaleString("vi-VN") + "đ";
}

function buildOverviewChunk(tour) {
  const parts = [
    `Tour: ${tour.name}`,
    `Địa điểm: ${tour.location} (${tour.region})`,
    `Số ngày: ${tour.days}`,
    `Giá cơ bản: ${formatCurrency(tour.basePrice)}`,
    tour.tags?.length ? `Thể loại: ${tour.tags.join(", ")}` : null,
    tour.summary ? `Tóm tắt: ${tour.summary}` : null,
    tour.description ? `Mô tả: ${tour.description}` : null,
  ].filter(Boolean);

  return {
    chunkType: "overview",
    text: parts.join(". "),
  };
}

function buildItineraryChunk(tour) {
  if (!tour.itinerary?.length) return null;

  const text = tour.itinerary
    .slice()
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .map((day) => {
      const meals = day.meals?.length ? ` Bữa ăn: ${day.meals.join(", ")}.` : "";
      const stay = day.accommodation ? ` Lưu trú: ${day.accommodation}.` : "";
      return `Ngày ${day.dayNumber} - ${day.title}: ${day.description || ""}.${meals}${stay}`;
    })
    .join(" ");

  return {
    chunkType: "itinerary",
    text: `Lịch trình tour ${tour.name}. ${text}`,
  };
}

function buildPolicyChunk(tour) {
  if (!tour.cancellationPolicy) return null;
  return {
    chunkType: "policy",
    text: `Chính sách hủy tour ${tour.name}: ${tour.cancellationPolicy}`,
  };
}

/**
 * Tách một tour thành danh sách chunk sẵn sàng đưa vào embedding.
 * @param {object} tour - Document Tour (đã .lean() hoặc plain object)
 * @returns {Array<{chunkType: string, text: string, id: string, metadata: object}>}
 */
function chunkTour(tour) {
  const rawChunks = [
    buildOverviewChunk(tour),
    buildItineraryChunk(tour),
    buildPolicyChunk(tour),
  ].filter(Boolean);

  return rawChunks.map((chunk) => ({
    id: `${tour._id}_${chunk.chunkType}`,
    text: chunk.text,
    chunkType: chunk.chunkType,
    metadata: {
      tourId: String(tour._id),
      chunkType: chunk.chunkType,
      region: tour.region,
      location: tour.location,
      basePrice: tour.basePrice,
      days: tour.days,
      category: (tour.tags || []).join(","),
      status: tour.status,
    },
  }));
}

module.exports = { chunkTour };
