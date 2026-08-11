import fs from 'fs';
const html = fs.readFileSync('dlv.html', 'utf8');
const links = html.match(/href="([^"]+)"/g);
console.log(links ? links.slice(0, 50) : 'None');
