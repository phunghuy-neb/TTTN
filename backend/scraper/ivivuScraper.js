import 'dotenv/config';
import puppeteer from 'puppeteer';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import Tour from '../src/models/Tour.js';

const MAX_TOURS = 80; // Tăng lên 80 để bù lại những tour mock bị loại, đảm bảo đạt >= 50
const CATEGORY_URLS = [
  'https://www.ivivu.com/du-lich',
  'https://www.ivivu.com/du-lich/tour-trong-nuoc',
  'https://www.ivivu.com/du-lich/tour-nuoc-ngoai',
  'https://www.ivivu.com/du-lich/tour-chau-a',
  'https://www.ivivu.com/du-lich/tour-chau-au',
  'https://www.ivivu.com/du-lich/tour-mien-bac',
  'https://www.ivivu.com/du-lich/tour-mien-trung',
  'https://www.ivivu.com/du-lich/tour-mien-nam'
];

async function connectDB() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong .env');
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Đã kết nối Database:', process.env.MONGO_URI);
}

function parseDays(title) {
  const match = title.match(/(\d+)\s*[Nn][1n]?/); // Bắt "3N2D" hoặc "3 Ngày"
  if (match) return parseInt(match[1]);
  return 3; 
}

function mapRegion(name) {
  const mienBac = ['Hà Nội', 'Hạ Long', 'Sapa', 'Tây Bắc', 'Hà Giang', 'Ninh Bình', 'Mộc Châu'];
  const mienTrung = ['Đà Nẵng', 'Hội An', 'Nha Trang', 'Đà Lạt', 'Huế', 'Phú Yên', 'Quy Nhơn'];
  
  if (mienBac.some(p => name.includes(p))) return 'Miền Bắc';
  if (mienTrung.some(p => name.includes(p))) return 'Miền Trung';
  return 'Miền Nam'; 
}

async function scrapeIvivu() {
  await connectDB();
  
  // Dọn dẹp dữ liệu cũ (Xóa các tour giả lập trước đó)
  console.log('🧹 Đang dọn dẹp dữ liệu cũ trong Database...');
  await Tour.deleteMany({});
  console.log('✅ Đã dọn sạch Database!');

  console.log('🚀 Khởi động Trình duyệt Cào dữ liệu (Puppeteer)...');
  const browser = await puppeteer.launch({ 
    headless: false, // Hiện trình duyệt để quan sát
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const allTourLinks = new Set();

  // 1. Lấy links từ các trang danh mục
  for (const catUrl of CATEGORY_URLS) {
    console.log(`🔍 Đang quét danh mục: ${catUrl}`);
    try {
      await page.goto(catUrl, { waitUntil: 'networkidle2', timeout: 45000 });
      for(let k=0; k<8; k++) {
        await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 1500));
      }
      
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        return anchors
          .map(a => a.href)
          .filter(href => href.includes('ivivu.com/du-lich/tour-') && /\/\d+$/.test(href)); // Link tour thường tận cùng bằng ID số
      });
      links.forEach(l => allTourLinks.add(l));
    } catch (e) {
      console.log(`⚠️ Lỗi quét danh mục: ${e.message}`);
    }
  }

  const tourLinksArray = [...allTourLinks].slice(0, MAX_TOURS);
  console.log(`\n🎉 Đã tìm thấy ${allTourLinks.size} đường dẫn. Bắt đầu cào chi tiết ${tourLinksArray.length} tour...`);

  const scrapedTours = [];

  // 2. Chui vào từng link lấy dữ liệu chi tiết
  for (let i = 0; i < tourLinksArray.length; i++) {
    const link = tourLinksArray[i];
    console.log(`\n⏳ Đang cào tour [${i+1}/${tourLinksArray.length}]: ${link}`);
    
    try {
      const tourPage = await browser.newPage();
      await tourPage.goto(link, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000)); // Đợi Angular render data
      
      const tourData = await tourPage.evaluate(() => {
        const getElText = (selector) => document.querySelector(selector)?.innerText?.trim() || '';
        const name = getElText('h1') || getElText('.tour-name') || getElText('.tourName');
        
        const fullText = document.body.innerText || '';
        
        // 1. Cố gắng lấy giá thật bằng regex từ text trang
        let priceNum = 2500000; 
        const priceMatch = fullText.match(/([\d\.]+)\s*(đ|VND)\s*\/\s*khách/i);
        if (priceMatch) {
          priceNum = parseInt(priceMatch[1].replace(/\./g, ''));
        } else {
          // Fallback nếu không có đuôi / khách
          const pMatch2 = fullText.match(/([\d\.]+)\s*(đ|VND)/i);
          if (pMatch2) priceNum = parseInt(pMatch2[1].replace(/\./g, ''));
        }
        
        // 2. Lấy ảnh
        const images = Array.from(document.querySelectorAll('img'))
          .map(img => img.src)
          .filter(src => src && src.includes('http') && !src.includes('logo') && !src.includes('icon'));
        
        // 3. Trích xuất dữ liệu thật từ phần Điểm Nổi Bật (Vì iVIVU thường rút gọn lịch trình dưới dạng 01, 02, 03)
        const itinerary = [];
        let dayCounter = 1;
        
        // Cố gắng tìm các dòng có dạng "01", "02"
        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let currentDesc = '';
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.match(/^0\d\s*(\·|\-)/) || line.match(/^0\d$/)) {
             if (currentDesc) {
               itinerary.push({
                 dayNumber: dayCounter++,
                 title: `Hoạt động ${dayCounter - 1}`,
                 description: currentDesc,
                 meals: ['Sáng', 'Trưa', 'Tối']
               });
             }
             currentDesc = line;
          } else if (currentDesc && !line.includes('Tư vấn qua Zalo')) {
             currentDesc += '\n' + line;
          }
          
          if (line.includes('Tư vấn qua Zalo') || line.includes('Về iVIVU.com')) {
            break;
          }
        }
        
        if (currentDesc) {
          itinerary.push({
             dayNumber: dayCounter++,
             title: `Hoạt động ${dayCounter - 1}`,
             description: currentDesc,
             meals: ['Sáng', 'Trưa']
          });
        }
        
        let finalItinerary = itinerary;
        // Nếu trang không có cấu trúc "01", lấy vài dòng đầu của Điểm Nổi Bật
        if (finalItinerary.length === 0) {
           const startIndex = lines.findIndex(l => l.includes('Điểm nổi bật tour') || l.includes('Những trải nghiệm chính'));
           if (startIndex !== -1) {
             finalItinerary = [
               { dayNumber: 1, title: 'Ngày 1: Khám phá', description: lines.slice(startIndex + 1, startIndex + 5).join('\n'), meals: ['Trưa', 'Tối'] },
               { dayNumber: 2, title: 'Ngày 2: Trải nghiệm', description: lines.slice(startIndex + 5, startIndex + 9).join('\n'), meals: ['Sáng', 'Trưa'] }
             ];
           } else {
             // Fallback cuối cùng nhưng lấy text thật của trang
             finalItinerary = [
               { dayNumber: 1, title: 'Khởi hành', description: name, meals: ['Trưa', 'Tối'] }
             ];
           }
        }

        // 4. Lấy ng-state cho bao gồm & không bao gồm (REAL DATA)
        let inclusions = [];
        let exclusions = [];
        let hasRealData = false;
        try {
          const ngStateEl = document.querySelector('script#ng-state');
          if (ngStateEl) {
            const state = JSON.parse(ngStateEl.innerHTML);
            const tourKey = Object.keys(state).find(k => k.startsWith('tour-detail:'));
            if (tourKey && state[tourKey] && state[tourKey].Response) {
              const res = state[tourKey].Response;
              hasRealData = true; // Found the API response
              
              const parseHtmlList = (html) => {
                if (!html) return [];
                const div = document.createElement('div');
                div.innerHTML = html;
                let items = Array.from(div.querySelectorAll('p, li')).map(el => el.innerText.trim()).filter(t => t.length > 5);
                if (items.length === 0 && div.innerText) {
                  items = div.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
                }
                return items;
              };

              inclusions = parseHtmlList(res.IncludePrice);
              exclusions = parseHtmlList(res.NoIncludePrice);
              
              if (res.Schedules && res.Schedules.length > 0) {
                  // Dùng lịch trình thật từ API, parse bằng div.innerText để giải mã HTML entities (&aacute;) và giữ \n
                  const realItin = res.Schedules.map((sch, idx) => {
                      const div = document.createElement('div');
                      div.innerHTML = sch.Description || '';
                      
                      const titleDiv = document.createElement('div');
                      titleDiv.innerHTML = sch.ShortDescription || sch.Title || `Ngày ${idx + 1}`;
                      
                      return {
                          dayNumber: idx + 1,
                          title: titleDiv.innerText.trim(),
                          description: div.innerText.trim(),
                          meals: ['Trưa', 'Tối']
                      };
                  });
                  if (realItin.length > 0) finalItinerary = realItin;
              } else {
                  hasRealData = false; // No schedules, consider it fake
              }
            }
          }
        } catch (e) {
          console.error("Lỗi parse ng-state", e);
        }

        return { 
          name, 
          priceNum, 
          images: images.slice(0, 8), 
          itinerary: finalItinerary.slice(0, Math.max(3, finalItinerary.length)), 
          inclusions, 
          exclusions,
          hasRealData
        };
      });
      
      await tourPage.close();

      if (!tourData.name || tourData.itinerary.length === 0 || !tourData.hasRealData) {
        console.log('⚠️ Bỏ qua tour vì không đủ dữ liệu thật 100%.');
        continue;
      }

      const days = parseDays(tourData.name);
      
      // Tạo đợt khởi hành đa dạng cho 4 tháng tới (15-25 đợt)
      const departures = [];
      const numDepartures = Math.floor(Math.random() * 11) + 15; // 15 to 25
      const now = new Date();
      let currentDate = new Date(now.getTime() + 86400000 * (Math.floor(Math.random() * 7) + 2)); // Bắt đầu sau 2-8 ngày

      for (let i = 0; i < numDepartures; i++) {
        // Có khả năng nhảy 2-5 ngày giữa các đợt
        currentDate = new Date(currentDate.getTime() + 86400000 * (Math.floor(Math.random() * 4) + 2));
        
        // Random slots
        const totalSlots = 20;
        let availableSlots = Math.floor(Math.random() * 21); // 0 to 20
        // Tăng xác suất "Liên hệ" (0 chỗ) lên khoảng 15-20%
        if (Math.random() < 0.15) availableSlots = 0;
        // Tăng xác suất "Còn 1 chỗ", "Còn 2 chỗ" để tạo sự khan hiếm
        else if (Math.random() < 0.2) availableSlots = Math.floor(Math.random() * 3) + 1;
        
        // Giá ngày cuối tuần cao hơn
        const dayOfWeek = currentDate.getDay(); // 0 is Sun, 6 is Sat
        let price = tourData.priceNum;
        if (dayOfWeek === 0 || dayOfWeek === 6 || dayOfWeek === 5) {
          price = price + 50000 * (Math.floor(Math.random() * 6) + 2); // Tăng 100k - 350k
        }

        departures.push({
          date: new Date(currentDate),
          totalSlots,
          availableSlots,
          price
        });
      }

      const formattedTour = {
        name: tourData.name,
        region: mapRegion(tourData.name),
        location: tourData.name.split('-')[0].trim() || 'Việt Nam',
        summary: tourData.name,
        description: tourData.name,
        days: days,
        basePrice: tourData.priceNum,
        status: 'published',
        tags: ['ivivu', 'tour thực tế'],
        images: tourData.images.length >= 2 ? tourData.images : ['https://images.unsplash.com/photo-1528127269322-539801943592'],
        departures: departures,
        itinerary: tourData.itinerary,
        inclusions: tourData.inclusions,
        exclusions: tourData.exclusions
      };

      scrapedTours.push(formattedTour);
      console.log(`✅ Thành công: ${formattedTour.name.substring(0, 50)}... - ${formattedTour.basePrice.toLocaleString()}đ`);

    } catch (err) {
      console.error(`❌ Lỗi khi cào link ${link}:`, err.message);
    }
  }

  console.log(`\n🎉 Đã thu thập xong ${scrapedTours.length} tour. Đang lưu vào MongoDB...`);
  
  let successCount = 0;
  for (const t of scrapedTours) {
    try {
      // Để tránh trùng slug do tên quá giống nhau
      t.name = t.name + ' - ' + Math.random().toString(36).substring(2, 6).toUpperCase();
      await Tour.create(t);
      successCount++;
    } catch (err) {
      console.error(`Lỗi lưu tour ${t.name}:`, err.message);
    }
  }

  console.log(`✅ Hoàn tất lưu ${successCount}/${scrapedTours.length} tour thật từ iVIVU!`);
  
  await browser.close();
  await mongoose.disconnect();
}

scrapeIvivu().catch(err => {
  console.error('LỖI CHƯƠNG TRÌNH:', err);
  process.exit(1);
});
