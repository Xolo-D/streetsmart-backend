// database.js â€” SQLite schema
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
dotenv.config();

const db = new Database(process.env.DB_PATH || './db.sqlite');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('vendor','supplier','admin')),
    name TEXT,
    city TEXT,
    type TEXT,
    supplier_id TEXT,
    vendor_id TEXT,
    approved INTEGER DEFAULT 0,
    approved_at TEXT,
    approved_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT,
    rating REAL DEFAULT 0,
    on_time REAL DEFAULT 0,
    quality REAL DEFAULT 0,
    status TEXT,
    lead_time INTEGER,
    category TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    current_stock INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 0,
    supplier_id TEXT,
    predicted_daily_demand REAL DEFAULT 0,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    city TEXT,
    type TEXT,
    revenue REAL DEFAULT 0,
    profit REAL DEFAULT 0,
    units INTEGER DEFAULT 0,
    transactions INTEGER DEFAULT 0,
    products INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS vendor_products (
    vendor_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (vendor_id, product_id),
    FOREIGN KEY (vendor_id) REFERENCES vendors(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS supplier_products (
    supplier_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    price REAL DEFAULT 0,
    moq INTEGER DEFAULT 20,
    lead_time INTEGER DEFAULT 3,
    active INTEGER DEFAULT 1,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (supplier_id, product_id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier ON supplier_products(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_supplier_products_product ON supplier_products(product_id);

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

  CREATE TABLE IF NOT EXISTS monthly_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    revenue REAL NOT NULL,
    profit REAL NOT NULL,
    units INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','shipped','delivered','cancelled')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sales_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total_amount REAL NOT NULL,
    sold_by TEXT,
    sold_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS discounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    discount_percent REAL NOT NULL,
    min_quantity INTEGER NOT NULL,
    valid_from TEXT,
    valid_until TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE INDEX IF NOT EXISTS idx_vendors_city ON vendors(city);
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
  CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor ON vendor_products(vendor_id);
  CREATE INDEX IF NOT EXISTS idx_orders_vendor ON orders(vendor_id);
  CREATE INDEX IF NOT EXISTS idx_sales_log_product ON sales_log(product_id);
  CREATE INDEX IF NOT EXISTS idx_sales_log_date ON sales_log(sold_at);
  CREATE INDEX IF NOT EXISTS idx_discounts_supplier ON discounts(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_discounts_product ON discounts(product_id);
  CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
  CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
`);

console.log('âœ“ Database schema ready');
export default db;
