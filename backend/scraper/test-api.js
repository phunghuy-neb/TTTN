import puppeteer from 'puppeteer';
import fs from 'fs';

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  const apiResponses = [];
  
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api') || response.headers()['content-type']?.includes('json')) {
      try {
        const json = await response.json();
        apiResponses.push({ url, json });
      } catch(e) {}
    }
  });

  try {
    await page.goto('https://www.ivivu.com/du-lich/tour-tay-bac-3n2d-ha-noi-kham-pha-mu-cang-chai-sapa-mua-lua-chin/2400', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
    fs.writeFileSync('ivivu_api.json', JSON.stringify(apiResponses, null, 2));
    console.log('Saved API responses');
  } finally {
    await browser.close();
  }
}
run();
