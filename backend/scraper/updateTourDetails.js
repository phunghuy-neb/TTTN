import 'dotenv/config';
import mongoose from 'mongoose';
import Tour from '../src/models/Tour.js';

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong .env');
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Đã kết nối Database:', process.env.MONGO_URI);

  const tours = await Tour.find({});
  let count = 0;

  for (const tour of tours) {
    // Generate highlights based on itinerary titles
    let highlights = [];
    if (tour.itinerary && tour.itinerary.length > 0) {
      highlights = tour.itinerary.map((day, index) => {
        return `0${index + 1} · ${day.title}\nKhám phá và trải nghiệm những địa điểm độc đáo nhất.`;
      });
    } else {
      highlights = [
        '01 · Tận hưởng phong cảnh thiên nhiên tuyệt đẹp',
        '02 · Thưởng thức ẩm thực địa phương đặc sắc',
        '03 · Giao lưu với người dân bản địa thân thiện'
      ];
    }

    const inclusions = [
      '- Vé máy bay khứ hồi (nếu đi máy bay) hoặc xe di chuyển.',
      '- Xe máy lạnh phục vụ suốt tuyến.',
      '- Khách sạn tiêu chuẩn 3-4* địa phương.',
      '- Vé tham quan như chương trình.',
      '- Các bữa ăn tiêu chuẩn theo lịch trình.',
      '- Nước suối 01 chai/khách/ngày.',
      '- Bảo hiểm du lịch.',
      '- Trưởng đoàn và HDV địa phương phục vụ suốt hành trình.'
    ];

    const exclusions = [
      '- Phụ thu phòng đơn.',
      '- Chi phí cá nhân: hành lý quá cước, điện thoại, giặt ủi, tham quan ngoài chương trình.',
      '- Tiền TIP cho hướng dẫn viên và tài xế.',
      '- Thuế VAT (nếu xuất hóa đơn).'
    ];

    tour.highlights = highlights;
    tour.inclusions = inclusions;
    tour.exclusions = exclusions;

    await tour.save();
    count++;
  }

  console.log(`✅ Đã cập nhật thành công ${count} tour với highlights, inclusions và exclusions!`);
  await mongoose.disconnect();
}

run().catch(console.error);
