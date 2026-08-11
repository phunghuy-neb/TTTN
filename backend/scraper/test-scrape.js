import puppeteer from 'puppeteer';
import fs from 'fs';

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  try {
    console.log('Navigating...');
    await page.goto('https://travel.com.vn/du-lich-trong-nuoc.aspx', { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Cuộn xuống để load
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 5000));
    
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a'));
      return [...new Set(anchors.map(a => a.href))].filter(href => href.includes('travel.com.vn'));
    });
    
    fs.writeFileSync('links.json', JSON.stringify(links, null, 2));
    console.log(`Saved ${links.length} links to links.json`);
    
  } catch (error) {
    console.error('Scrape error:', error);
  } finally {
    await browser.close();
  }
}
run();
