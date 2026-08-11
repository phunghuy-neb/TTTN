import puppeteer from 'puppeteer';
import fs from 'fs';

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  try {
    console.log('Navigating to iVIVU domestic tours...');
    await page.goto('https://www.ivivu.com/du-lich/tour-trong-nuoc', { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Evaluate links
    const tourLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return [...new Set(anchors.map(a => a.href))].filter(href => href.includes('ivivu.com/du-lich/tour-'));
    });
    
    fs.writeFileSync('ivivu_links.json', JSON.stringify(tourLinks, null, 2));
    console.log(`Saved ${tourLinks.length} tour links.`);
    
    if (tourLinks.length > 0) {
      console.log('Visiting first tour:', tourLinks[0]);
      await page.goto(tourLinks[0], { waitUntil: 'networkidle2', timeout: 30000 });
      
      const tourDetails = await page.evaluate(() => {
        const getElText = (selector) => document.querySelector(selector)?.innerText?.trim() || '';
        
        const name = getElText('h1') || getElText('.tour-name') || getElText('.tourName');
        const price = document.querySelector('.price, .tour-price, .price-amount')?.innerText?.trim() || '';
        const images = Array.from(document.querySelectorAll('img')).map(img => img.src).filter(src => src && src.includes('http'));
        
        // Itinerary
        const itineraryEl = Array.from(document.querySelectorAll('.day-item, .itinerary-day, .timeline-item, .panel-group'));
        const itinerary = itineraryEl.map(el => el.innerText.substring(0, 100));
        
        return { name, price, imagesCount: images.length, itinerary };
      });
      
      console.log('Details:', tourDetails);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}
run();
