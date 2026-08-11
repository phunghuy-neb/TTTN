import puppeteer from 'puppeteer';

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  const responses = [];
  
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api') || url.includes('Get') || url.includes('Search') || response.headers()['content-type']?.includes('json')) {
      try {
        const json = await response.json();
        responses.push({ url, json });
        console.log(`Intercepted JSON from: ${url}`);
      } catch (e) {
        // Not JSON
      }
    }
  });
  
  try {
    console.log('Navigating to domestic tours...');
    await page.goto('https://travel.com.vn/du-lich-trong-nuoc.aspx', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
    
    import('fs').then(fs => {
      fs.writeFileSync('api_responses.json', JSON.stringify(responses, null, 2));
      console.log(`Saved ${responses.length} API responses.`);
    });
    
  } catch (error) {
    console.error('Scrape error:', error);
  } finally {
    await browser.close();
  }
}
run();
