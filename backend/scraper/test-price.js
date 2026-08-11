import puppeteer from 'puppeteer';

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto('https://www.ivivu.com/du-lich/tour-tay-bac-3n2d-ha-noi-kham-pha-mu-cang-chai-sapa-mua-lua-chin/2400', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 5000));
  
  const data = await page.evaluate(() => {
    // 1. Tìm giá
    let priceText = '';
    const elements = Array.from(document.querySelectorAll('div, span, b, strong, p, h3, h2, h1'));
    for (const el of elements) {
      const text = el.innerText?.trim() || '';
      if (text.match(/[\d\.,]+\s*(đ|VND)/i)) {
        priceText = text;
        break;
      }
    }
    
    // 2. Tìm lịch trình (tìm các thẻ h2, h3, h4 hoặc div có text bắt đầu bằng "Ngày")
    const days = [];
    const headers = Array.from(document.querySelectorAll('h2, h3, h4, .day-title, b, strong, .title'));
    let currentDay = null;
    let desc = '';
    
    for (const el of elements) {
      const text = el.innerText?.trim() || '';
      if (/^ng[aà]y\s+\d+/i.test(text) && text.length < 50) {
        if (currentDay) {
          days.push({ title: currentDay, desc });
        }
        currentDay = text;
        desc = '';
      } else if (currentDay && text.length > 50 && !desc.includes(text.substring(0, 50))) {
        desc += text + '\n';
      }
    }
    if (currentDay) days.push({ title: currentDay, desc });
    
    return { priceText, daysCount: days.length, days: days.slice(0,2) };
  });
  
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
}
run();
