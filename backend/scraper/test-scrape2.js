import puppeteer from 'puppeteer';
import fs from 'fs';

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  try {
    console.log('Navigating to domestic tours...');
    await page.goto('https://travel.com.vn/du-lich-trong-nuoc.aspx', { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Đợi một chút cho dữ liệu load
    await new Promise(r => setTimeout(r, 5000));
    
    // Lấy toàn bộ thẻ a có href không chứa tags
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return [...new Set(anchors.map(a => a.href))].filter(href => href.includes('travel.com.vn') && !href.includes('/tags/'));
    });
    
    fs.writeFileSync('links_notag.json', JSON.stringify(links, null, 2));
    
    // Thử click vào một nút hoặc xem có elements nào chứa tên địa danh
    const texts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('div, a, span'))
        .map(el => el.innerText)
        .filter(t => t && t.includes('Ngày') && t.includes('Đêm'));
    });
    fs.writeFileSync('texts.json', JSON.stringify(texts, null, 2));
    
    console.log(`Saved to files.`);
    
  } catch (error) {
    console.error('Scrape error:', error);
  } finally {
    await browser.close();
  }
}
run();
