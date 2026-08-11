import puppeteer from 'puppeteer';
import fs from 'fs';

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto('https://www.ivivu.com/du-lich/tour-tay-bac-3n2d-ha-noi-kham-pha-mu-cang-chai-sapa-mua-lua-chin/2400', { waitUntil: 'networkidle2' });
  
  // Chờ nút Lịch trình
  await page.waitForFunction(() => {
    const els = Array.from(document.querySelectorAll('a, div, span, button, li'));
    return els.find(e => e.innerText?.trim() === 'Lịch trình');
  }, { timeout: 10000 }).catch(() => {});
  
  // Click nút Lịch trình
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('a, div, span, button, li'));
    const btn = els.find(e => e.innerText?.trim() === 'Lịch trình');
    if (btn) btn.click();
  });
  
  await new Promise(r => setTimeout(r, 3000)); // Đợi load nội dung
  
  const text = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync('ivivu_tab.txt', text);
  console.log('Saved clicked tab to ivivu_tab.txt');
  
  await browser.close();
}
run();
