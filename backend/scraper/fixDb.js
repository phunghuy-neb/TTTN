import mongoose from 'mongoose';
import 'dotenv/config';
import Tour from '../src/models/Tour.js';

async function fixTours() {
  await mongoose.connect(process.env.MONGO_URI);
  const tours = await Tour.find({});
  
  for (const tour of tours) {
    // 1. Random giá từ 2tr5 đến 8tr9
    const randomPrice = Math.floor(Math.random() * 65 + 25) * 100000;
    tour.basePrice = randomPrice;
    tour.departures.forEach(d => {
      d.price = randomPrice;
    });

    // 2. Fix lịch trình (dynamic theo tên tour)
    const shortName = tour.name.split('-')[0].replace('Tour', '').replace('tour', '').trim() || 'Tuyệt vời';
    
    tour.itinerary = [
      { 
        dayNumber: 1, 
        title: `Ngày 1: Đón khách và Khám phá ${shortName}`, 
        description: `Sáng: Xe và HDV đón quý khách tại điểm hẹn, khởi hành đi ${shortName}. Trên đường đi, quý khách sẽ được nghe giới thiệu về những nét văn hóa đặc sắc. \nTrưa: Dùng bữa tại nhà hàng địa phương với các món đặc sản.\nChiều: Tham quan các địa danh nổi tiếng đầu tiên trong hành trình. Tự do chụp ảnh và nhận phòng nghỉ ngơi.`, 
        meals: ['Trưa', 'Tối'] 
      },
      { 
        dayNumber: 2, 
        title: `Ngày 2: Trải nghiệm chuyên sâu cảnh đẹp ${shortName}`, 
        description: `Sáng: Quý khách dùng điểm tâm buffet. Bắt đầu một ngày dài khám phá thiên nhiên và con người nơi đây. Tham gia các hoạt động nổi bật nhất của chuyến đi.\nTrưa: Nghỉ ngơi và dùng bữa trưa.\nChiều: Tiếp tục hành trình tham quan. Tự do tắm biển/ngắm cảnh tùy theo địa hình của ${shortName}. \nTối: Tự do khám phá thành phố về đêm.`, 
        meals: ['Sáng', 'Trưa', 'Tối'] 
      },
      { 
        dayNumber: 3, 
        title: `Ngày 3: Mua sắm đặc sản - Tạm biệt ${shortName}`, 
        description: `Sáng: Dùng điểm tâm. Tự do đi chợ địa phương mua sắm quà lưu niệm, đặc sản vùng miền cho người thân.\nTrưa: Trả phòng khách sạn, dùng bữa trưa.\nChiều: Lên xe trở về điểm đón ban đầu. Kết thúc chương trình khám phá ${shortName} ngập tràn niềm vui. Hẹn gặp lại quý khách!`, 
        meals: ['Sáng', 'Trưa'] 
      }
    ];

    await tour.save();
    console.log(`Đã fix: ${shortName} - Giá mới: ${randomPrice.toLocaleString()}đ`);
  }
  
  console.log(`Hoàn tất sửa ${tours.length} tours!`);
  await mongoose.disconnect();
}
fixTours();
