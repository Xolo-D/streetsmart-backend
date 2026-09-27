// add-mode-columns.js — add `mode` to users and suppliers tables
import db from './database.js';

const migrations = [
  { name: 'users.mode',      sql: "ALTER TABLE users ADD COLUMN mode TEXT DEFAULT 'live'" },
  { name: 'suppliers.mode',  sql: "ALTER TABLE suppliers ADD COLUMN mode TEXT DEFAULT 'live'" }
];

for (const m of migrations) {
  try {
    db.exec(m.sql);
    console.log('✓ added', m.name);
  } catch (e) {
    if (/duplicate column/i.test(e.message)) {
      console.log('· already exists:', m.name);
    } else {
      console.error('✗ failed', m.name, '-', e.message);
    }
  }
}

// Show final state
console.log('\n--- users ---');
console.table(db.prepare('SELECT id, email, role, mode, approved FROM users').all());