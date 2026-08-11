import 'dotenv/config';
import mongoose from 'mongoose';
import Tour from '../src/models/Tour.js';

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  const sampleTours = [
    {
      name: 'Khám Phá Vịnh Hạ Long',
      region: 'Miền Bắc',
      location: 'Quảng Ninh',
      summary: 'Du thuyền 5 sao vịnh Hạ Long',
      description: 'Trải nghiệm du thuyền 5 sao đẳng cấp...',
      days: 3,
      basePrice: 2500000,
      oldPrice: 3000000,
      status: 'published',
      tags: ['biển', 'nghỉ dưỡng', 'du thuyền'],
      images: ['https://images.unsplash.com/photo-1528127269322-539801943592'],
      departures: [
        { date: new Date(Date.now() + 86400000 * 5), totalSlots: 20, availableSlots: 20, price: 2500000 }
      ],
      itinerary: [
        { dayNumber: 1, title: 'Đến Hạ Long', meals: ['Sáng', 'Trưa'] },
        { dayNumber: 2, title: 'Khám phá hang động', meals: ['Sáng', 'Trưa', 'Tối'] },
        { dayNumber: 3, title: 'Trở về', meals: ['Sáng'] }
      ]
    },
    {
      name: 'Nghỉ dưỡng Phú Quốc',
      region: 'Miền Nam',
      location: 'Phú Quốc',
      summary: 'Biển xanh cát trắng nắng vàng',
      description: 'Tận hưởng kỳ nghỉ dưỡng tuyệt vời tại Đảo Ngọc Phú Quốc...',
      days: 4,
      basePrice: 4500000,
      oldPrice: 5000000,
      status: 'published',
      tags: ['biển', 'resort', 'gia đình'],
      images: ['https://images.unsplash.com/photo-1576405230985-703c34eb4b50'],
      departures: [
        { date: new Date(Date.now() + 86400000 * 10), totalSlots: 30, availableSlots: 30, price: 4500000 }
      ],
      itinerary: [
        { dayNumber: 1, title: 'Đến Phú Quốc', meals: ['Trưa', 'Tối'] },
        { dayNumber: 2, title: 'VinWonders', meals: ['Sáng', 'Trưa', 'Tối'] },
        { dayNumber: 3, title: 'Lặn ngắm san hô', meals: ['Sáng', 'Trưa', 'Tối'] },
        { dayNumber: 4, title: 'Trở về', meals: ['Sáng'] }
      ]
    }
  ];

  for (const t of sampleTours) {
    const tour = new Tour(t);
    await tour.save();
  }
  
  console.log('Seed 2 tours completed.');
  await mongoose.disconnect();
}
seed().catch(err => console.error(err));
