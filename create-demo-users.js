// create-demo-users.js — creates the 3 demo users
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

const db = new Database('./db.sqlite');
const hash = (p) => bcrypt.hashSync(p, 10);

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (email, password_hash, role, name, supplier_id, vendor_id, approved)
  VALUES (?, ?, ?, ?, ?, ?, 1)
`);

insertUser.run('vendor@streetsmart.co.za',   hash('vendor123'),   'vendor',   'Demo Vendor',    null,     'V0071');
insertUser.run('supplier@streetsmart.co.za', hash('supplier123'), 'supplier', 'KZN Beverages',  'SUP003', null);
insertUser.run('admin@streetsmart.co.za',    hash('admin123'),    'admin',    'System Admin',   null,     null);

console.log('Demo users created.');
console.table(db.prepare('SELECT id, email, role, approved FROM users').all());
