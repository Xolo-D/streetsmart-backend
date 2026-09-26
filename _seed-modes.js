import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');
const hash = (pw) => bcrypt.hashSync(pw, 10);
db.prepare("UPDATE users SET mode='demo' WHERE email IN ('admin@streetsmart.co.za','supplier@streetsmart.co.za')").run();
console.log('Marked admin@ and supplier@ as DEMO');
if (!db.prepare("SELECT 1 FROM users WHERE email=?").get('live-admin@streetsmart.co.za')) {
  db.prepare(`INSERT INTO users (email,password_hash,role,name,approved,mode) VALUES (?,?,'admin','Live Admin',1,'live')`).run('live-admin@streetsmart.co.za', hash('live123'));
  console.log('Created live-admin@streetsmart.co.za / live123');
}
if (!db.prepare("SELECT 1 FROM users WHERE email=?").get('live-supplier@streetsmart.co.za')) {
  db.prepare(`INSERT INTO users (email,password_hash,role,name,approved,mode,supplier_id) VALUES (?,?,'supplier','Live Supplier',1,'live','SUP003')`).run('live-supplier@streetsmart.co.za', hash('live123'));
  console.log('Created live-supplier@streetsmart.co.za / live123');
}
console.table(db.prepare("SELECT email, role, mode FROM users ORDER BY role, mode").all());
db.close();
