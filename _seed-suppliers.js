import Database from 'better-sqlite3';
import fs from 'fs';
const db = new Database('./db.sqlite');
const data = JSON.parse(fs.readFileSync('./data.json','utf8'));
const stmt = db.prepare(`
  INSERT OR IGNORE INTO suppliers (id, name, city, rating, on_time, quality, status, lead_time, category, mode)
  VALUES (?,?,?,?,?,?,?,?,?, 'demo')
`);
let added = 0;
for (const s of (data.suppliers || [])) {
  const r = stmt.run(s.id, s.name, s.city || '', s.rating || 0, s.on_time || 0, s.quality || 0, s.status || 'Active', s.lead_time || 3, s.category || 'Street Foods');
  if (r.changes) added++;
}
console.log(`Seeded ${added} new suppliers (total now ${db.prepare('SELECT COUNT(*) AS n FROM suppliers').get().n})`);
db.close();
process.exit(0);
