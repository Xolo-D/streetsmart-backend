// export-data.js — reads ../streetsmart-fresh/js/data.js and writes data.json
import fs from 'fs';
import path from 'path';

const FRONTEND_DATA = path.resolve('../streetsmart-fresh/js/data.js');

if (!fs.existsSync(FRONTEND_DATA)){
  console.error(`❌ Cannot find ${FRONTEND_DATA}`);
  console.error('   Make sure the frontend folder is named "streetsmart-fresh"');
  console.error('   and sits next to "streetsmart-backend".');
  process.exit(1);
}

console.log('Reading frontend data from:', FRONTEND_DATA);

const src = fs.readFileSync(FRONTEND_DATA, 'utf8');

const cleaned = src
  .replace(/\/\/.*$/gm, '')
  .replace(/^[\s\S]*?const\s+DATA\s*=\s*/, '')
  .replace(/;\s*$/, '')
  .trim();

let obj;
try {
  obj = new Function('return (' + cleaned + ')')();
} catch (err) {
  console.error('❌ Failed to parse data.js:', err.message);
  process.exit(1);
}

fs.writeFileSync('./data.json', JSON.stringify(obj, null, 2));

console.log('✓ Wrote data.json');
console.log(`   Vendors:    ${obj.vendors?.length || 0}`);
console.log(`   Products:   ${obj.reorder_all?.length || 0}`);
console.log(`   Suppliers:  ${obj.suppliers?.length || 0}`);
console.log(`   Categories: ${obj.categories?.length || 0}`);
console.log(`   Cities:     ${obj.cities?.length || 0}`);
console.log(`   Monthly:    ${obj.monthly?.length || 0}`);
