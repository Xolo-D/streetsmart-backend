import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');
console.log('Total vendor_products rows:', db.prepare('SELECT COUNT(*) AS n FROM vendor_products').get().n);
console.log('');
console.log('New vendors (V0300+):');
console.table(db.prepare("SELECT v.id, v.city, v.type, COUNT(vp.product_id) AS products FROM vendors v LEFT JOIN vendor_products vp ON vp.vendor_id = v.id WHERE v.id >= 'V0300' GROUP BY v.id ORDER BY v.id").all());
console.log('');
console.log('Sample demo vendors (first 5):');
console.table(db.prepare("SELECT v.id, v.city, v.type, COUNT(vp.product_id) AS products FROM vendors v LEFT JOIN vendor_products vp ON vp.vendor_id = v.id WHERE v.id < 'V0010' GROUP BY v.id ORDER BY v.id").all());
