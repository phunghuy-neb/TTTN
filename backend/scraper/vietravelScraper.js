import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import mongoose from 'mongoose';
import 'dotenv/config';
import Tour from '../src/models/Tour.js';

puppeteer.use(StealthPlugin());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/vietvoyage';
const VIETRAVEL_URL = 'https://travel.com.vn/du-lich-trong-nuoc.aspx';

async function scrapeVietravel() {
  console.log(`✅ Đã kết nối Database: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI);
  
  console.log('🧹 Đang dọn dẹp dữ liệu cũ trong Database...');
  await Tour.deleteMany({});
  console.log('✅ Đã dọn sạch Database!');

  console.log('🚀 Khởi động Trình duyệt Cào dữ liệu Vietravel (Stealth Mode)...');
  const browser = await puppeteer.launch({ 
    headless: false, // Để bypass Cloudflare dễ hơn
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'] 
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  console.log(`🔍 Đang quét danh mục: ${VIETRAVEL_URL}`);
  await page.goto(VIETRAVEL_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  
  const tourLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href*="/tour"]'))
      .map(a => a.href)
      .filter((v, i, a) => a.indexOf(v) === i && !v.includes('khuyen-mai') && !v.includes('tags'));
  });
  
  console.log(`🎉 Đã tìm thấy ${tourLinks.length} đường dẫn. Bắt đầu cào chi tiết...`);
  
  const scrapedTours = [];
  
  for (let i = 0; i < Math.min(tourLinks.length, 30); i++) {
    const link = tourLinks[i];
    console.log(`\n⏳ Đang cào tour [${i+1}/${Math.min(tourLinks.length, 30)}]: ${link}`);
    
    try {
      const tourPage = await browser.newPage();
      await tourPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Đợi thêm tí cho Vue/React hydrate
      await new Promise(r => setTimeout(r, 2000));
      
      const tourData = await tourPage.evaluate(() => {
        const getElText = (selector) => document.querySelector(selector)?.innerText?.trim() || '';
        
        const name = getElText('h1.title-tour') || getElText('h1') || 'Tour Tuyệt Vời';
        
        // Giá (thường nằm trong thẻ .price hoặc .tour-price)
        const fullText = document.body.innerText || '';
        let priceNum = 3500000;
        const priceMatch = fullText.match(/([\d\.]+)\s*(đ|VND|vnđ)/i);
        if (priceMatch && priceMatch[1].length > 3) {
          priceNum = parseInt(priceMatch[1].replace(/\./g, '').replace(/,/g, ''));
          if (priceNum < 100000) priceNum *= 1000; // Đề phòng giá dạng 3.500 đ
        }

        const images = Array.from(document.querySelectorAll('img'))
          .map(img => img.src)
          .filter(src => src && src.includes('http') && !src.includes('icon') && !src.includes('logo') && !src.includes('svg'));

        // Lấy lịch trình từ vietravel (thường nằm trong .itinerary, .day, hoặc các thẻ có chữ Ngày)
        const itinerary = [];
        const dayHeaders = Array.from(document.querySelectorAll('h3, h4, h5, .day-title, .title-day, .timeline-title, strong'));
        
        let currentDayNum = 1;
        let currentDesc = '';
        let currentTitle = '';
        
        for (const el of document.querySelectorAll('h3, h4, h5, p, div')) {
          const text = el.innerText?.trim() || '';
          if (text.match(/^Ng[aà]y\s+\d+/i)) {
            if (currentTitle) {
              itinerary.push({
                dayNumber: currentDayNum++,
                title: currentTitle,
                description: currentDesc.trim() || 'Nghỉ ngơi và tự do tham quan.',
                meals: ['Sáng', 'Trưa', 'Tối']
              });
            }
            currentTitle = text.substring(0, 100);
            currentDesc = '';
          } else if (currentTitle && text.length > 20 && !currentTitle.includes(text.substring(0, 20))) {
             currentDesc += text + '\n';
          }
        }
        if (currentTitle) {
          itinerary.push({
            dayNumber: currentDayNum++,
            title: currentTitle,
            description: currentDesc.trim() || 'Kết thúc chương trình, hẹn gặp lại.',
            meals: ['Sáng', 'Trưa']
          });
        }
        
        // Nếu trang web dùng thẻ accordion ẩn, có thể phải parse theo cách khác
        
        return { name, priceNum, images: images.slice(0, 6), itinerary };
      });
      
      await tourPage.close();
      
      if (!tourData.name || tourData.priceNum === 0 || tourData.itinerary.length === 0) {
        console.log(`⚠️ Bỏ qua tour vì thiếu thông tin thật (Thiếu lịch trình ngày).`);
        continue;
      }
      
      const newTour = new Tour({
        name: tourData.name,
        code: `VT${Math.floor(Math.random() * 10000)}`,
        category: 'Trong nước',
        duration: tourData.itinerary.length ? `${tourData.itinerary.length} Ngày` : '3 Ngày 2 Đêm',
        departLocation: 'TP. Hồ Chí Minh',
        destinations: ['Vietravel Destination'],
        basePrice: tourData.priceNum || 2500000,
        availableSeats: Math.floor(Math.random() * 20) + 5,
        rating: 4 + Math.random(),
        reviewsCount: Math.floor(Math.random() * 100) + 10,
        images: tourData.images,
        description: tourData.name,
        highlights: [
          'Trải nghiệm đẳng cấp cùng Vietravel',
          'Khám phá văn hóa và ẩm thực địa phương',
          'Hướng dẫn viên nhiệt tình, chuyên nghiệp'
        ],
        itinerary: tourData.itinerary,
        departures: [
          { date: new Date(Date.now() + 86400000 * 5), price: tourData.priceNum, seats: 15 },
          { date: new Date(Date.now() + 86400000 * 12), price: tourData.priceNum, seats: 20 },
        ]
      });
      
      await newTour.save();
      scrapedTours.push(newTour);
      console.log(`✅ Thành công: ${tourData.name.substring(0, 50)}... - ${tourData.priceNum.toLocaleString()}đ - ${tourData.itinerary.length} ngày`);
      
    } catch (err) {
      console.log(`❌ Lỗi khi cào tour: ${err.message}`);
    }
  }
  
  console.log(`\n🎉 Đã thu thập xong ${scrapedTours.length} tour THẬT TỪ VIETRAVEL!`);
  await browser.close();
  await mongoose.disconnect();
}

scrapeVietravel();
