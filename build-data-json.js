// build-data-json.js — rebuild data.json from frontend/js/data.js
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const frontendDataPath = path.join(
  process.env.USERPROFILE || process.env.HOME,
  'Documents', 'streetsmart', 'streetsmart-frontend', 'js', 'data.js'
);

console.log('Reading:', frontendDataPath);
const src = fs.readFileSync(frontendDataPath, 'utf8');

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(src + '\n;globalThis.__DATA__ = DATA;', sandbox, { timeout: 5000 });

const DATA = sandbox.__DATA__ || sandbox.DATA;
if (!DATA) {
  console.error('DATA object was not found');
  process.exit(1);
}

// seed.js expects these keys:
//   cities, categories, suppliers, reorder_all, vendors, monthly, kpis
// data.js already has all of them — just pass them through.

const out = {
  kpis:       DATA.kpis       || {},
  cities:     DATA.cities     || [],
  categories: DATA.categories || [],
  suppliers:  DATA.suppliers  || [],
  vendors:    DATA.vendors    || [],
  monthly:    DATA.monthly    || [],
  reorder_all: DATA.reorder_all || []   // ← THIS is what products come from
};

fs.writeFileSync('./data.json', JSON.stringify(out, null, 2));

console.log('Wrote data.json:');
console.log('  cities:     ', out.cities.length);
console.log('  categories: ', out.categories.length);
console.log('  suppliers:  ', out.suppliers.length);
console.log('  vendors:    ', out.vendors.length);
console.log('  monthly:    ', out.monthly.length);
console.log('  reorder_all:', out.reorder_all.length);
if (out.reorder_all[0]) {
  console.log('  first item: ', JSON.stringify(out.reorder_all[0], null, 2));
}