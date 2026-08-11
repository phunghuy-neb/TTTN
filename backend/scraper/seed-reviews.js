import { MongoClient, ObjectId } from 'mongodb';

const uri = 'mongodb://localhost:27017/vietvoyage';

async function seed() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const toursCollection = db.collection('tours');
    const tours = await toursCollection.find({}).toArray();
    
    const mockNames = ['Phạm Thị Bích Hằng', 'Bùi Kim Xa', 'Phan Thúy Anh', 'Nguyễn Văn A', 'Lê Tuấn Tú', 'Trần Thị Thu', 'Hoàng Minh Ngọc', 'Đỗ Đức Anh', 'Vũ Thu Phương', 'Lý Hải Yến'];
    const mockContents = [
      'Tour ok. Khách sạn cũng ok sạch sẽ. Ăn uống trong tour ngon, đầy đủ. Hdv nhiệt tình. Nên đi. Đáng tiền.',
      'Tour đi đúng hài, vui gần chết, có cái đi hơi mệt chút',
      'Cảnh quan tuyệt đẹp, lịch trình bố trí hợp lý. Hướng dẫn viên rất am hiểu kiến thức và chu đáo.',
      'Trải nghiệm tuyệt vời. Đồ ăn đặc sản cực kỳ ngon. Sẽ ủng hộ công ty trong những chuyến đi tới.',
      'Giá cả hợp lý so với dịch vụ. Mọi thứ từ xe cộ đến chỗ ở đều khiến mình hài lòng.',
      'Dịch vụ tốt, tuy nhiên ngày đầu hơi tắc đường nên mất chút thời gian. Chấm 9/10.'
    ];
    const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    
    let count = 0;
    for (const tour of tours) {
      const numReviews = randomInt(5, 12);
      const reviews = [];
      let sum = 0;
      
      for (let i = 0; i < numReviews; i++) {
        const rating = randomInt(8, 10);
        sum += rating;
        const images = [];
        if (tour.images && tour.images.length > 0) {
          const numImages = randomInt(0, Math.min(4, tour.images.length));
          const shuffled = [...tour.images].sort(() => 0.5 - Math.random());
          images.push(...shuffled.slice(0, numImages));
        }
        
        reviews.push({
          _id: new ObjectId(),
          user: mockNames[randomInt(0, mockNames.length - 1)],
          rating: rating,
          comment: mockContents[randomInt(0, mockContents.length - 1)],
          images: images,
          createdAt: new Date(Date.now() - randomInt(1, 700) * 24 * 60 * 60 * 1000)
        });
      }
      
      reviews.sort((a, b) => b.createdAt - a.createdAt);
      const avgRating = Number((sum / numReviews).toFixed(1));
      
      await toursCollection.updateOne(
        { _id: tour._id }, 
        { $set: { reviews: reviews, avgRating: avgRating } }
      );
      count++;
    }
    
    console.log('Seeded reviews for ' + count + ' tours.');
  } finally {
    await client.close();
  }
}

seed().catch(console.dir);
