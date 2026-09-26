import Database from 'better-sqlite3';
const db = new Database('./db.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS prediction_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    predicted_demand REAL NOT NULL,
    weather TEXT,
    holiday TEXT,
    day_of_week TEXT,
    season TEXT,
    predicted_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_pred_history_vendor ON prediction_history(vendor_id);
  CREATE INDEX IF NOT EXISTS idx_pred_history_product ON prediction_history(product_id);
  CREATE INDEX IF NOT EXISTS idx_pred_history_date ON prediction_history(predicted_at);
`);

console.log('Table created.');
console.log('');
console.log('Columns in prediction_history:');
console.table(db.prepare('PRAGMA table_info(prediction_history)').all());
