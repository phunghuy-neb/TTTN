const fs = require('fs');
const html = fs.readFileSync('ivivu_page.html', 'utf8');
const startStr = '<script id="ng-state" type="application/json">';
const start = html.indexOf(startStr);
const end = html.indexOf('</script>', start);
if(start !== -1) {
  const jsonStr = html.substring(start + startStr.length, end);
  const data = JSON.parse(jsonStr);
  
  // Find something that has 'Bao gồm' or similar
  fs.writeFileSync('ng-state.json', JSON.stringify(data, null, 2));
  console.log('Saved to ng-state.json. Keys:');
  console.log(Object.keys(data));
} else {
  console.log('Not found');
}
