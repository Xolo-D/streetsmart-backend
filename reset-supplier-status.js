import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');

const info = db.prepare("UPDATE suppliers SET status = 'Active'").run();
console.log('Suppliers updated:', info.changes);

console.log('\nVerification:');
console.table(db.prepare("SELECT id, name, status FROM suppliers ORDER BY id").all());
