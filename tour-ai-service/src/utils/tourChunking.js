/**
 * Tách một document Tour (MongoDB) thành các chunk văn bản
 * theo từng khía cạnh nội dung, phục vụ embedding riêng biệt.
 * (Thiết kế đã thống nhất ở báo cáo Tuần 1)
 */
function buildChunksFromTour(tour) {
  const chunks = [];

  chunks.push({
    id: `${tour._id}_overview`,
    type: 'overview',
    text: [
      `Tour: ${tour.name}`,
      `Địa điểm: ${tour.destination.location}, ${tour.destination.region}`,
      `Thời gian: ${tour.duration.days} ngày ${tour.duration.nights} đêm`,
      `Giá từ: ${tour.basePrice} VNĐ`,
      `Mô tả: ${tour.description}`,
      `Phân loại: ${(tour.category || []).join(', ')}`,
    ].join('\n'),
  });

  if (tour.itinerary?.length) {
    const itineraryText = tour.itinerary
      .map((d) => `Ngày ${d.dayNumber}: ${d.title}. ${d.description}`)
      .join('\n');
    chunks.push({ id: `${tour._id}_itinerary`, type: 'itinerary', text: itineraryText });
  }

  if (tour.cancellationPolicy) {
    chunks.push({
      id: `${tour._id}_policy`,
      type: 'policy',
      text: `Chính sách hủy tour: ${tour.cancellationPolicy}`,
    });
  }

  return chunks;
}

function buildMetadata(tour, chunkType) {
  return {
    tourId: tour._id.toString(),
    chunkType,
    region: tour.destination.region,
    location: tour.destination.location,
    basePrice: tour.basePrice,
    days: tour.duration.days,
    category: (tour.category || []).join(','),
    status: tour.status,
  };
}

module.exports = { buildChunksFromTour, buildMetadata };
