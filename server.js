import installHorizonRoutes from './horizon-routes.js';// server.js Ã¢â‚¬â€ StreetSmart API
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from './database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const ML_SERVICE = process.env.ML_SERVICE || 'http://localhost:5001';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ==================== MIDDLEWARE ==================== */

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method.padEnd(6)} ${req.url}`);
  next();
});

/* ==================== HELPERS ==================== */

function nextVendorId(){
  const row = db.prepare(`SELECT id FROM vendors WHERE id LIKE 'V%' ORDER BY CAST(SUBSTR(id, 2) AS INTEGER) DESC LIMIT 1`).get();
  if (!row) return 'V0301';
  const num = parseInt(row.id.slice(1)) + 1;
  return 'V' + String(num).padStart(4, '0');
}

function nextSupplierId(){
  const row = db.prepare(`SELECT id FROM suppliers WHERE id LIKE 'SUP%' ORDER BY CAST(SUBSTR(id, 4) AS INTEGER) DESC LIMIT 1`).get();
  if (!row) return 'SUP021';
  const num = parseInt(row.id.slice(3)) + 1;
  return 'SUP' + String(num).padStart(3, '0');
}

function categoriesForVendorType(vendorType){
  const map = {
    'Food Vendor':      ['Street Foods', 'Fast Food'],
    'Drink Vendor':     ['Beverages'],
    'Snack Vendor':     ['Snacks'],
    'Sweet Vendor':     ['Street Sweets'],
    'Fruit Vendor':     ['Fresh Produce'],
    'Accessory Vendor': ['Street Accessories', 'Mobile Accessories'],
    'General Vendor':   ['Beverages', 'Snacks', 'Street Essentials', 'Personal Care']
  };
  return map[vendorType] || ['Street Foods'];
}

function assignStarterCatalog(vendorId, vendorType){
  const cats = categoriesForVendorType(vendorType);
  const placeholders = cats.map(() => '?').join(',');
  const products = db.prepare(`SELECT id FROM products WHERE category IN (${placeholders})`).all(...cats);

  // New vendors start with 0 stock and a reorder level of 20
  const insert = db.prepare(`INSERT OR IGNORE INTO vendor_products (vendor_id, product_id, current_stock, reorder_level) VALUES (?, ?, 0, 20)`);
  const tx = db.transaction(() => {
    products.forEach(p => insert.run(vendorId, p.id));
  });
  tx();
  return products.length;
}

/* ==================== AUTH MIDDLEWARE ==================== */

function requireAuth(role = null){
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')){
      return res.status(401).json({ error: 'Missing token' });
    }
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      if (role && payload.role !== role){
        return res.status(403).json({ error: 'Forbidden Ã¢â‚¬â€ wrong role' });
      }
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

/* ==================== AUTH ==================== */

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'No account found with that email' });

  if (!bcrypt.compareSync(password, user.password_hash)){
    return res.status(401).json({ error: 'Incorrect password' });
  }

  if (user.approved !== 1){
    return res.status(403).json({
      error: 'Your account is pending administrator approval. Please check back soon.'
    });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, supplierId: user.supplier_id, vendorId: user.vendor_id, name: user.name, mode: user.mode || 'live', city: user.city, type: user.type },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: {
      email: user.email,
      role: user.role,
      name: user.name,
      supplierId: user.supplier_id,
      vendorId: user.vendor_id,
      city: user.city || null,
      type: user.type || null,
      mode: user.mode || 'live'
    }
  });
});

app.get('/api/auth/me', requireAuth(), (req, res) => {
  res.json({ user: req.user });
});

/* ==================== REGISTRATION ==================== */

app.post('/api/auth/register', (req, res) => {
  const { email, password, name, role, city, type, supplier_id, mode: signupMode } = req.body;

  if (!email || !password || !name || !role){
    return res.status(400).json({ error: 'Email, password, name, and role are required' });
  }
  if (!['vendor','supplier'].includes(role)){
    return res.status(400).json({ error: 'Role must be vendor or supplier' });
  }
  if (password.length < 6){
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'An account with that email already exists' });

  const hash = bcrypt.hashSync(password, 10);

  try {
    let newVendorId = null;
    let newSupplierId = null;
    let productCount = 0;

    if (role === 'vendor'){
      newVendorId = nextVendorId();
      db.prepare(`
        INSERT INTO vendors (id, city, type, revenue, profit, units, transactions, products)
        VALUES (?, ?, ?, 0, 0, 0, 0, 0)
      `).run(newVendorId, city || 'Unknown', type || 'General Vendor');

      productCount = assignStarterCatalog(newVendorId, type || 'General Vendor');
    } else if (role === 'supplier'){
      newSupplierId = nextSupplierId();
      db.prepare(`
        INSERT INTO suppliers (id, name, city, rating, on_time, quality, status, lead_time, category)
        VALUES (?, ?, ?, 0, 0, 0, 'Active', 3, ?)
      `).run(newSupplierId, name, city || 'Unknown', type || 'Street Foods');
    }

    const info = db.prepare(`
      INSERT INTO users (email, password_hash, role, name, city, type, vendor_id, supplier_id, approved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      email.toLowerCase(),
      hash,
      role,
      name,
      city || null,
      type || null,
      newVendorId,
      newSupplierId
    );

    res.status(201).json({
      success: true,
      message: 'Account created. An administrator will approve it shortly.',
      userId: info.lastInsertRowid,
      vendor_id: newVendorId,
      supplier_id: newSupplierId,
      products_assigned: productCount
    });
  } catch (err){
    res.status(500).json({ error: err.message });
  }
});

/* ==================== PASSWORD RESET ==================== */

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user){
    return res.json({ success: true, message: 'If that email exists, a reset code has been generated.' });
  }

  const token = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare('UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0').run(email.toLowerCase());

  db.prepare(`
    INSERT INTO password_resets (email, token, expires_at, used)
    VALUES (?, ?, ?, 0)
  `).run(email.toLowerCase(), token, expiresAt);

  res.json({
    success: true,
    message: 'Reset code generated. It expires in 15 minutes.',
    code: token
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword){
    return res.status(400).json({ error: 'Email, code, and new password are required' });
  }
  if (newPassword.length < 6){
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const row = db.prepare(`
    SELECT * FROM password_resets
    WHERE email = ? AND token = ? AND used = 0
    ORDER BY id DESC LIMIT 1
  `).get(email.toLowerCase(), code);

  if (!row) return res.status(400).json({ error: 'Invalid code' });
  if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Code has expired. Request a new one.' });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hash, email.toLowerCase());
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);

  res.json({ success: true, message: 'Password updated. You can now sign in with your new password.' });
});

/* ==================== ADMIN: PENDING USERS ==================== */

app.get('/api/admin/users/pending', requireAuth('admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.email, u.role, u.name, u.city, u.type, u.vendor_id, u.supplier_id, u.created_at,
           v.city AS vendor_city, v.type AS vendor_type,
           s.name AS supplier_name, s.city AS supplier_city, s.category AS supplier_category
    FROM users u
    LEFT JOIN vendors v ON v.id = u.vendor_id
    LEFT JOIN suppliers s ON s.id = u.supplier_id
    WHERE u.approved = 0
    ORDER BY u.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/admin/users/:id/approve', requireAuth('admin'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.approved === 1) return res.status(400).json({ error: 'User already approved' });

  if (user.role === 'vendor' && user.vendor_id){
    const existing = db.prepare('SELECT COUNT(*) AS n FROM vendor_products WHERE vendor_id = ?').get(user.vendor_id);
    if (existing.n === 0){
      const vendor = db.prepare('SELECT type FROM vendors WHERE id = ?').get(user.vendor_id);
      if (vendor) assignStarterCatalog(user.vendor_id, vendor.type);
    }
  }

  db.prepare(`
    UPDATE users
    SET approved = 1,
        approved_at = CURRENT_TIMESTAMP,
        approved_by = ?
    WHERE id = ?
  `).run(req.user.email, req.params.id);

  res.json({ success: true, message: `User ${user.email} approved` });
});

// â”€â”€ GET /api/admin/stats â€” mode-aware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/admin/stats', requireAuth('admin'), (req, res) => {
  // DEMO MODE â€” frozen snapshot from data.json
  if (req.user.mode === 'demo') {
    try {
      const data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
      return res.json({
        mode: 'demo',
        vendors:      data.kpis.num_vendors,
        suppliers:    data.suppliers.length,
        products:     data.kpis.num_products,
        transactions: data.kpis.total_transactions,
        pendingUsers: 0,
        revenue:      data.kpis.total_revenue,
        byCity:       data.vendors_by_city.map(c => ({ label: c.city,  value: c.count })),
        byType:       data.vendors_by_type.map(t => ({ label: t.type, value: t.count }))
      });
    } catch (e) {
      return res.status(500).json({ error: 'demo data missing', detail: e.message });
    }
  }

  // LIVE MODE â€” real DB counts
  const vendors      = db.prepare("SELECT COUNT(*) AS n FROM vendors WHERE mode = 'live'").get().n;
  const suppliers    = db.prepare("SELECT COUNT(*) AS n FROM suppliers WHERE mode = 'live'").get().n;
  const products     = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  const transactions = db.prepare('SELECT COUNT(*) AS n FROM sales_log').get().n;
  const pendingUsers = db.prepare('SELECT COUNT(*) AS n FROM users WHERE approved = 0').get().n;
  const revenue      = db.prepare("SELECT COALESCE(SUM(revenue), 0) AS r FROM vendors WHERE mode = 'live'").get().r;
  const byCity       = db.prepare("SELECT city AS label, COUNT(*) AS value FROM vendors WHERE mode = 'live' GROUP BY city ORDER BY value DESC").all();
  const byType       = db.prepare("SELECT type AS label, COUNT(*) AS value FROM vendors WHERE mode = 'live' GROUP BY type ORDER BY value DESC").all();

  res.json({ mode: 'live', vendors, suppliers, products, transactions, pendingUsers, revenue, byCity, byType });
});

app.delete('/api/admin/users/:id', requireAuth('admin'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.vendor_id && user.role === 'vendor'){
    db.prepare('DELETE FROM vendor_products WHERE vendor_id = ?').run(user.vendor_id);
    db.prepare('DELETE FROM vendors WHERE id = ?').run(user.vendor_id);
  }
  if (user.supplier_id && user.role === 'supplier'){
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(user.supplier_id);
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: `User ${user.email} rejected and deleted` });
});

/* ==================== VENDOR'S OWN PRODUCTS ==================== */

app.get('/api/vendors/me/products', requireAuth('vendor'), (req, res) => {
  const vendorId = req.user.vendorId;
  if (!vendorId) return res.status(404).json({ error: 'Not linked to a vendor' });

  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.unit_price,
           vp.current_stock, vp.reorder_level,
           p.predicted_daily_demand,
           s.name AS supplier_name, s.lead_time AS supplier_lead_time
    FROM vendor_products vp
    JOIN products p ON p.id = vp.product_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE vp.vendor_id = ?
    ORDER BY p.name
  `).all(vendorId);

  res.json(rows);
});

app.post('/api/vendors/me/products', requireAuth('vendor'), (req, res) => {
  const vendorId = req.user.vendorId;
  if (!vendorId) return res.status(404).json({ error: 'Not linked to a vendor' });

  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id required' });

  const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
  if (!exists) return res.status(404).json({ error: 'Product not found' });

  db.prepare('INSERT OR IGNORE INTO vendor_products (vendor_id, product_id, current_stock, reorder_level) VALUES (?, ?, 0, 20)').run(vendorId, product_id);
  res.json({ success: true });
});

app.delete('/api/vendors/me/products/:pid', requireAuth('vendor'), (req, res) => {
  const vendorId = req.user.vendorId;
  if (!vendorId) return res.status(404).json({ error: 'Not linked to a vendor' });

  db.prepare('DELETE FROM vendor_products WHERE vendor_id = ? AND product_id = ?').run(vendorId, req.params.pid);
  res.json({ success: true });
});

/* ==================== ML SERVICE PROXY ==================== */

app.post('/api/predict', requireAuth(), async (req, res) => {
  try {
    const response = await fetch(`${ML_SERVICE}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err){
    res.status(503).json({ error: 'ML service unavailable: ' + err.message });
  }
});

/* ==================== KPIs ==================== */

app.get('/api/kpis', (req, res) => {
  const rev = db.prepare('SELECT COALESCE(SUM(revenue),0) AS v FROM monthly_sales').get().v;
  const prof = db.prepare('SELECT COALESCE(SUM(profit),0) AS v FROM monthly_sales').get().v;
  const units = db.prepare('SELECT COALESCE(SUM(units),0) AS v FROM monthly_sales').get().v;
  const vendors = db.prepare('SELECT COUNT(*) AS n FROM vendors').get().n;
  const products = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  const cities = db.prepare('SELECT COUNT(*) AS n FROM cities').get().n;
  const categories = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;

  res.json({
    total_revenue: rev,
    total_profit: prof,
    avg_margin: rev ? parseFloat(((prof / rev) * 100).toFixed(2)) : 0,
    total_units: units,
    num_vendors: vendors,
    num_products: products,
    num_cities: cities,
    num_categories: categories,
    date_start: '2025-01-01',
    date_end: '2025-12-31',
    total_transactions: 15000
  });
});

/* ==================== MONTHLY / CATEGORY ==================== */

app.get('/api/sales/monthly', (req, res) => {
  res.json(db.prepare('SELECT month, revenue, profit, units FROM monthly_sales ORDER BY id').all());
});

app.get('/api/sales/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT category,
           SUM(current_stock * unit_price) AS revenue,
           SUM(current_stock) AS units
    FROM products
    GROUP BY category
    ORDER BY revenue DESC
  `).all();
  res.json(rows);
});

/* ==================== CITIES / VENDOR TYPES ==================== */

app.get('/api/cities', (req, res) => {
  const rows = db.prepare(`
    SELECT city, SUM(revenue) AS revenue, SUM(units) AS units, SUM(transactions) AS transactions
    FROM vendors GROUP BY city ORDER BY revenue DESC
  `).all();
  res.json(rows);
});

app.get('/api/vendor-types', (req, res) => {
  const rows = db.prepare(`
    SELECT type, SUM(revenue) AS revenue, SUM(units) AS units
    FROM vendors GROUP BY type ORDER BY revenue DESC
  `).all();
  res.json(rows);
});

/* ==================== VENDORS ==================== */

app.get('/api/vendors', requireAuth('admin'), (req, res) => {
  const { search } = req.query;
  const mode = req.user.mode || 'live';
  let sql = 'SELECT * FROM vendors WHERE mode = ?';
  const params = [mode];
  if (search){
    sql += ' AND (id LIKE ? OR city LIKE ? OR type LIKE ?)';
    params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
  }
  sql += ' ORDER BY revenue DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/vendors-by-city', (req, res) => {
  res.json(db.prepare('SELECT city, COUNT(*) AS count FROM vendors GROUP BY city ORDER BY count DESC').all());
});

app.get('/api/vendors-by-type', (req, res) => {
  res.json(db.prepare('SELECT type, COUNT(*) AS count FROM vendors GROUP BY type ORDER BY count DESC').all());
});

app.get('/api/vendors/me', requireAuth('vendor'), (req, res) => {
  const vendorId = req.user.vendorId;
  if (!vendorId){
    return res.status(404).json({ error: 'Your account is not linked to a vendor record' });
  }
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
  if (!vendor){
    return res.status(404).json({ error: 'Vendor record not found' });
  }
  res.json(vendor);
});

app.get('/api/vendors/me/stats', requireAuth('vendor'), (req, res) => {
  const vendorId = req.user.vendorId;
  const email = req.user.email;
  if (!vendorId) return res.status(404).json({ error: 'Not linked to a vendor' });

  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
  if (!vendor) return res.status(404).json({ error: 'Vendor record not found' });

  // Compute real activity from sales_log filtered by this vendor's email
  const sales = db.prepare(`
    SELECT
      COALESCE(SUM(total_amount), 0) AS revenue,
      COALESCE(SUM(quantity), 0) AS units,
      COUNT(*) AS transactions
    FROM sales_log
    WHERE sold_by = ?
  `).get(email);

  // Estimate profit: assume 30% margin on revenue
  const profit = Math.round((sales.revenue * 0.30) * 100) / 100;

  // Count products in this vendor's catalog
  const productsRow = db.prepare('SELECT COUNT(*) AS n FROM vendor_products WHERE vendor_id = ?').get(vendorId);

  res.json({
    vendor_id: vendor.id,
    city: vendor.city,
    type: vendor.type,
    revenue: sales.revenue,
    profit,
    units: sales.units,
    transactions: sales.transactions,
    skus_sold: productsRow.n
  });
});

/* ==================== SUPPLIERS ==================== */

app.get('/api/suppliers', requireAuth('admin'), (req, res) => {
  const mode = req.user.mode || 'live';
  res.json(
    db.prepare('SELECT * FROM suppliers WHERE mode = ? ORDER BY rating DESC').all(mode)
  );
});

app.get('/api/suppliers/list', (req, res) => {
  res.json(db.prepare('SELECT id, name, city, category FROM suppliers ORDER BY name').all());
});

app.get('/api/suppliers/:id/name', (req, res) => {
  const s = db.prepare('SELECT id, name, city, mode FROM suppliers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

app.get('/api/suppliers/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const products = db.prepare(`
    SELECT sp.product_id, p.name, p.category, sp.price, sp.moq, sp.lead_time, sp.active
    FROM supplier_products sp
    JOIN products p ON p.id = sp.product_id
    WHERE sp.supplier_id = ?
    ORDER BY p.name
  `).all(req.params.id);
  res.json({ ...s, products });
});

app.get('/api/supplier-status', (req, res) => {
  res.json(db.prepare('SELECT status, COUNT(*) AS count FROM suppliers GROUP BY status').all());
});

app.get('/api/suppliers/:id/demand', (req, res) => {
  const rows = db.prepare(`
    SELECT p.name AS product, p.category, p.current_stock,
           p.predicted_daily_demand, p.unit_price, s.lead_time
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.supplier_id = ?
    ORDER BY p.name
  `).all(req.params.id);

  const result = rows.map(r => {
    let decision = 'NO ORDER NEEDED', priority = 'Low', order_qty = 0;

    if (r.current_stock <= Math.ceil(r.predicted_daily_demand * (r.lead_time || 3) * 0.5)){
      const days = r.current_stock / r.predicted_daily_demand;
      if (days < 2){
        decision = 'ORDER NOW'; priority = 'High';
        order_qty = Math.ceil(r.predicted_daily_demand * ((r.lead_time || 3) + 3));
      } else if (days < 5){
        decision = 'ORDER SOON'; priority = 'Medium';
      }
    }
    return {
      product: r.product,
      category: r.category,
      predicted_demand: r.predicted_daily_demand,
      decision, priority, order_qty,
      est_cost: order_qty * r.unit_price
    };
  });

  res.json(result);
});

/* ==================== PRODUCTS ==================== */

app.get('/api/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY name').all());
});

app.post('/api/products', requireAuth('vendor'), (req, res) => {
  const { id, name, category, unit_price, current_stock, reorder_level, supplier_id } = req.body;
  if (!id || !name || !category || unit_price === undefined){
    return res.status(400).json({ error: 'id, name, category, unit_price required' });
  }
  const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (exists) return res.status(409).json({ error: `Product ID "${id}" already exists` });

  try {
    db.prepare(`
      INSERT INTO products (id, name, category, unit_price, current_stock, reorder_level, supplier_id, predicted_daily_demand)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, name, category, parseFloat(unit_price), 0, parseInt(reorder_level) || 20, supplier_id || null);

    if (req.user.vendorId){
      db.prepare('INSERT OR IGNORE INTO vendor_products (vendor_id, product_id, current_stock, reorder_level) VALUES (?, ?, ?, ?)').run(req.user.vendorId, id, parseInt(current_stock) || 0, parseInt(reorder_level) || 20);
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.status(201).json({ success: true, product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/products/:id/stock', requireAuth('vendor'), (req, res) => {
  const { current_stock } = req.body;
  if (typeof current_stock !== 'number' || current_stock < 0){
    return res.status(400).json({ error: 'current_stock must be a non-negative number' });
  }

  const vendorId = req.user.vendorId;
  if (!vendorId) return res.status(400).json({ error: 'Not linked to a vendor' });

  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  db.prepare('UPDATE vendor_products SET current_stock = ? WHERE vendor_id = ? AND product_id = ?').run(current_stock, vendorId, req.params.id);
  res.json({ success: true, message: `Stock updated for ${product.name}: ${current_stock} units`, product: { id: req.params.id, name: product.name, current_stock } });
});

app.post('/api/products/:id/receive', requireAuth('vendor'), (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity <= 0) return res.status(400).json({ error: 'positive quantity required' });

  const vendorId = req.user.vendorId;
  if (!vendorId) return res.status(400).json({ error: 'Not linked to a vendor' });

  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const vp = db.prepare('SELECT current_stock FROM vendor_products WHERE vendor_id = ? AND product_id = ?').get(vendorId, req.params.id);
  if (!vp) return res.status(404).json({ error: 'This product is not in your catalog' });

  const newStock = (vp.current_stock || 0) + parseInt(quantity);
  db.prepare('UPDATE vendor_products SET current_stock = ? WHERE vendor_id = ? AND product_id = ?').run(newStock, vendorId, req.params.id);
  res.json({ success: true, message: `Received ${quantity} units of ${product.name}. New stock: ${newStock}`, product: { id: req.params.id, name: product.name, current_stock: newStock } });
});

app.patch('/api/products/:id', requireAuth('supplier'), (req, res) => {
  const { unit_price } = req.body;
  if (typeof unit_price !== 'number') return res.status(400).json({ error: 'unit_price required' });
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE products SET unit_price = ? WHERE id = ?').run(unit_price, req.params.id);
  res.json({ success: true, unit_price });
});

app.delete('/api/products/:id', requireAuth('admin'), (req, res) => {
  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  db.prepare('DELETE FROM vendor_products WHERE product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: `Deleted ${product.name}` });
});

/* ==================== REORDER ==================== */

app.get('/api/reorder', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.current_stock, p.reorder_level,
           p.predicted_daily_demand, p.unit_price,
           s.name AS supplier_name, s.lead_time
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    ORDER BY (p.reorder_level - p.current_stock) DESC
  `).all();

  const result = rows.map(r => {
    let decision = 'NO ORDER NEEDED', priority = 'Low', order_qty = 0;
    if (r.current_stock <= r.reorder_level && r.predicted_daily_demand > 0){
      const days = r.current_stock / r.predicted_daily_demand;
      if (days < 2){
        decision = 'ORDER NOW'; priority = 'High';
        order_qty = Math.ceil(r.predicted_daily_demand * ((r.lead_time || 3) + 3));
      } else if (days < 5){
        decision = 'ORDER SOON'; priority = 'Medium';
      }
    }
    return {
      id: r.id, name: r.name, category: r.category,
      current_stock: r.current_stock,
      predicted_daily_demand: r.predicted_daily_demand,
      supplier: r.supplier_name || 'Ã¢â‚¬â€',
      lead_time: r.lead_time || 0,
      unit_price: r.unit_price,
      decision, priority, order_qty,
      est_cost: order_qty * r.unit_price
    };
  });
  res.json(result);
});

app.get('/api/reorder/counts', (req, res) => {
  const all = db.prepare('SELECT id, current_stock, reorder_level, predicted_daily_demand FROM products').all();
  let now = 0, soon = 0, none = 0;
  all.forEach(r => {
    if (r.current_stock <= r.reorder_level && r.predicted_daily_demand > 0){
      const days = r.current_stock / r.predicted_daily_demand;
      if (days < 2) now++;
      else if (days < 5) soon++;
      else none++;
    } else none++;
  });
  res.json([
    { decision: 'ORDER NOW', count: now },
    { decision: 'ORDER SOON', count: soon },
    { decision: 'NO ORDER NEEDED', count: none }
  ]);
});

/* ==================== SALES (WRITE) ==================== */

app.post('/api/sales', requireAuth('vendor'), (req, res) => {
  const { product_id, quantity } = req.body;
  if (!product_id || !quantity || quantity <= 0) return res.status(400).json({ error: 'product_id and positive quantity required' });

  const vendorId = req.user.vendorId;
  if (!vendorId) return res.status(400).json({ error: 'Not linked to a vendor' });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const vp = db.prepare('SELECT * FROM vendor_products WHERE vendor_id = ? AND product_id = ?').get(vendorId, product_id);
  if (!vp) return res.status(404).json({ error: 'This product is not in your catalog' });
  if (vp.current_stock < quantity){
    return res.status(400).json({ error: `Not enough stock. Only ${vp.current_stock} units available.` });
  }

  const recordSale = db.prepare(`
    INSERT INTO sales_log (product_id, quantity, unit_price, total_amount, sold_by, sold_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const updateStock = db.prepare('UPDATE vendor_products SET current_stock = current_stock - ? WHERE vendor_id = ? AND product_id = ?');

  const tx = db.transaction(() => {
    recordSale.run(product_id, quantity, product.unit_price, quantity * product.unit_price, req.user.email);
    updateStock.run(quantity, vendorId, product_id);
  });

  try {
    tx();
    const updated = db.prepare('SELECT current_stock FROM vendor_products WHERE vendor_id = ? AND product_id = ?').get(vendorId, product_id);
    res.status(201).json({ success: true, message: `Sale recorded: ${quantity} Ãƒâ€” ${product.name}`, product: { id: product_id, name: product.name, current_stock: updated.current_stock } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales-log', requireAuth(), (req, res) => {
  const email = req.user.email;
  const rows = db.prepare(`
    SELECT s.id, s.product_id, p.name AS product_name, s.quantity,
           s.unit_price, s.total_amount, s.sold_by, s.sold_at
    FROM sales_log s
    JOIN products p ON p.id = s.product_id
    WHERE s.sold_by = ?
    ORDER BY s.sold_at DESC LIMIT 50
  `).all(email);
  res.json(rows);
});

/* ==================== SUPPLIERS (WRITE) ==================== */

app.patch('/api/suppliers/:id', requireAuth('supplier'), (req, res) => {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

  const allowed = ['name', 'city', 'category', 'lead_time'];
  const updates = {};
  for (const key of allowed){
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), req.params.id];
  db.prepare(`UPDATE suppliers SET ${setClause} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  res.json({ success: true, supplier: updated });
});

app.post('/api/suppliers/:id/products', requireAuth('supplier'), (req, res) => {
  const { product_id, price, moq, lead_time } = req.body;
  if (!product_id || price === undefined){
    return res.status(400).json({ error: 'product_id and price are required' });
  }

  const exists = db.prepare('SELECT id, name FROM products WHERE id = ?').get(product_id);
  if (!exists) return res.status(404).json({ error: 'Product ID not in catalogue.' });

  const already = db.prepare('SELECT 1 FROM supplier_products WHERE supplier_id = ? AND product_id = ?').get(req.params.id, product_id);
  if (already) return res.status(409).json({ error: 'You already supply this product' });

  db.prepare(`
    INSERT INTO supplier_products (supplier_id, product_id, price, moq, lead_time)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, product_id, parseFloat(price), parseInt(moq) || 20, parseInt(lead_time) || 3);

  res.status(201).json({ success: true, message: exists.name + ' added to your catalog' });
});

app.patch('/api/suppliers/:id/products/:pid', requireAuth('supplier'), (req, res) => {
  const link = db.prepare('SELECT * FROM supplier_products WHERE supplier_id = ? AND product_id = ?').get(req.params.id, req.params.pid);
  if (!link) return res.status(404).json({ error: 'You do not supply this product' });

  const updates = {};
  if (req.body.price !== undefined) updates.price = parseFloat(req.body.price);
  if (req.body.unit_price !== undefined) updates.price = parseFloat(req.body.unit_price);
  if (req.body.moq !== undefined) updates.moq = parseInt(req.body.moq);
  if (req.body.lead_time !== undefined) updates.lead_time = parseInt(req.body.lead_time);
  if (req.body.active !== undefined) updates.active = parseInt(req.body.active);

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), req.params.id, req.params.pid];
  db.prepare(`UPDATE supplier_products SET ${setClause} WHERE supplier_id = ? AND product_id = ?`).run(...values);

  res.json({ success: true });
});

app.delete('/api/suppliers/:id/products/:pid', requireAuth('supplier'), (req, res) => {
  const link = db.prepare('SELECT * FROM supplier_products WHERE supplier_id = ? AND product_id = ?').get(req.params.id, req.params.pid);
  if (!link) return res.status(404).json({ error: 'You do not supply this product' });

  db.prepare('DELETE FROM supplier_products WHERE supplier_id = ? AND product_id = ?').run(req.params.id, req.params.pid);
  res.json({ success: true, message: 'Product removed from your catalog' });
});

/* ==================== VENDORS (ADMIN CRUD) ==================== */

app.post('/api/vendors', requireAuth('admin'), (req, res) => {
  const { id, city, type, revenue, profit, units, transactions, products } = req.body;
  if (!id || !city || !type) return res.status(400).json({ error: 'id, city, type required' });

  const exists = db.prepare('SELECT id FROM vendors WHERE id = ?').get(id);
  if (exists) return res.status(409).json({ error: `Vendor ID "${id}" already exists` });

  try {
    db.prepare(`
      INSERT INTO vendors (id, city, type, revenue, profit, units, transactions, products)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, city, type, parseFloat(revenue) || 0, parseFloat(profit) || 0, parseInt(units) || 0, parseInt(transactions) || 0, parseInt(products) || 0);
    const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    res.status(201).json({ success: true, vendor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/vendors/:id', requireAuth('admin'), (req, res) => {
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

  const allowed = ['city', 'type', 'revenue', 'profit', 'units', 'transactions', 'products'];
  const updates = {};
  for (const key of allowed){
    if (req.body[key] !== undefined){
      updates[key] = ['city', 'type'].includes(key) ? req.body[key] : (parseFloat(req.body[key]) || 0);
    }
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), req.params.id];
  db.prepare(`UPDATE vendors SET ${setClause} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  res.json({ success: true, vendor: updated });
});

app.delete('/api/vendors/:id', requireAuth('admin'), (req, res) => {
  const vendor = db.prepare('SELECT id FROM vendors WHERE id = ?').get(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  db.prepare('DELETE FROM vendor_products WHERE vendor_id = ?').run(req.params.id);
  db.prepare('DELETE FROM vendors WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: `Deleted vendor ${req.params.id}` });
});

/* ==================== SUPPLIER DISCOUNTS ==================== */

app.post('/api/discounts', requireAuth('supplier'), (req, res) => {
  const { product_id, discount_percent, min_quantity, valid_until } = req.body;
  if (!product_id || !discount_percent || !min_quantity){
    return res.status(400).json({ error: 'product_id, discount_percent, min_quantity required' });
  }
  if (discount_percent <= 0 || discount_percent > 90){
    return res.status(400).json({ error: 'discount_percent must be 1-90' });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const supplierId = req.user.supplierId || product.supplier_id;

  const info = db.prepare(`
    INSERT INTO discounts (supplier_id, product_id, discount_percent, min_quantity, valid_until, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(supplierId, product_id, parseFloat(discount_percent), parseInt(min_quantity), valid_until || null, req.user.email);

  const discount = db.prepare('SELECT * FROM discounts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ success: true, discount });
});

app.get('/api/discounts', (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, p.name AS product_name, p.category, p.unit_price,
           s.name AS supplier_name
    FROM discounts d
    JOIN products p ON p.id = d.product_id
    JOIN suppliers s ON s.id = d.supplier_id
    WHERE (d.valid_until IS NULL OR d.valid_until >= date('now'))
    ORDER BY d.created_at DESC
  `).all();
  res.json(rows);
});

app.get('/api/suppliers/:id/discounts', requireAuth('supplier'), (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, p.name AS product_name, p.category, p.unit_price
    FROM discounts d
    JOIN products p ON p.id = d.product_id
    WHERE d.supplier_id = ?
    ORDER BY d.created_at DESC
  `).all(req.params.id);
  res.json(rows);
});

app.delete('/api/discounts/:id', requireAuth('supplier'), (req, res) => {
  const discount = db.prepare('SELECT * FROM discounts WHERE id = ?').get(req.params.id);
  if (!discount) return res.status(404).json({ error: 'Discount not found' });
  db.prepare('DELETE FROM discounts WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Discount removed' });
});

/* ==================== ML PREDICTIONS (BATCH FILES) ==================== */

app.get('/api/predictions', (req, res) => {
  const filePath = path.join(__dirname, 'ml-data', 'predictions.json');
  if (!fs.existsSync(filePath)){
    return res.status(404).json({ error: 'predictions.json not found.' });
  }
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
});

app.get('/api/model-metrics', (req, res) => {
  const filePath = path.join(__dirname, 'ml-data', 'model_metrics.json');
  if (!fs.existsSync(filePath)){
    return res.json({ note: 'model_metrics.json not found' });
  }
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
});

/* ==================== ALERTS ==================== */

app.get('/api/alerts', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.current_stock,
           p.reorder_level, p.predicted_daily_demand,
           CASE
             WHEN p.current_stock = 0 THEN 'critical'
             WHEN p.current_stock < p.reorder_level * 0.5 THEN 'urgent'
             WHEN p.current_stock < p.reorder_level THEN 'warning'
             ELSE 'ok'
           END AS severity
    FROM products p
    WHERE p.current_stock < p.reorder_level
    ORDER BY p.current_stock ASC
  `).all();

  res.json({
    count: rows.length,
    critical: rows.filter(r => r.severity === 'critical').length,
    urgent: rows.filter(r => r.severity === 'urgent').length,
    warning: rows.filter(r => r.severity === 'warning').length,
    items: rows.slice(0, 20)
  });
});

/* ==================== GLOBAL SEARCH ==================== */

app.get('/api/search', requireAuth(), (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ products: [], suppliers: [] });

  const like = '%' + q + '%';

  const products = db.prepare(`
    SELECT id, name, category, unit_price
    FROM products
    WHERE LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(id) LIKE ?
    ORDER BY name
    LIMIT 8
  `).all(like, like, like);

  const suppliers = db.prepare(`
    SELECT id, name, city, category, rating
    FROM suppliers
    WHERE LOWER(name) LIKE ? OR LOWER(city) LIKE ? OR LOWER(category) LIKE ? OR LOWER(id) LIKE ?
    ORDER BY rating DESC
    LIMIT 8
  `).all(like, like, like, like);

  res.json({ products, suppliers });
});

/* ==================== WEATHER PROXY ==================== */

app.get('/api/weather/:city', requireAuth(), async (req, res) => {
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'WEATHER_API_KEY not set in .env' });

  const city = req.params.city;
  const url = 'https://api.openweathermap.org/data/2.5/weather?q=' + encodeURIComponent(city) + ',ZA&appid=' + apiKey + '&units=metric';

  try {
    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok){
      // Fallback to a deterministic mock if the city isn't found or the key is invalid
      const hash = Array.from(city).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) & 0xFFFFFF, 0);
      const options = ['Sunny', 'Cloudy', 'Rainy'];
      const mockWeather = options[hash % 3];
      return res.json({
        city,
        weather: mockWeather,
        temperature: 22,
        source: 'fallback',
        note: data.message || 'Weather API returned an error, using mock'
      });
    }

    // Map OpenWeatherMap's "main" field to our 3 categories
    const main = (data.weather && data.weather[0] && data.weather[0].main) || '';
    let mapped = 'Sunny';
    if (main === 'Clouds') mapped = 'Cloudy';
    else if (main === 'Rain' || main === 'Drizzle' || main === 'Thunderstorm') mapped = 'Rainy';
    else if (main === 'Clear') mapped = 'Sunny';
    else mapped = 'Cloudy';

    res.json({
      city,
      weather: mapped,
      temperature: Math.round(data.main.temp),
      description: data.weather[0].description,
      source: 'live'
    });
  } catch (err){
    res.status(503).json({ error: 'Weather fetch failed: ' + err.message });
  }
});

/* ==================== VENDOR PREDICT + HISTORY ==================== */

app.post('/api/vendors/me/predict', requireAuth('vendor'), async (req, res) => {
  const vendorId = req.user.vendorId;
  const { product_id, weather, holiday, payload } = req.body;
  if (!vendorId) return res.status(400).json({ error: 'Not linked to a vendor' });
  if (!product_id || !payload) return res.status(400).json({ error: 'product_id and payload required' });

  try {
    const response = await fetch(ML_SERVICE + '/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || data.error) return res.status(response.status).json(data);

    const insertSql = 'INSERT INTO prediction_history (vendor_id, product_id, predicted_demand, weather, holiday, day_of_week, season) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.prepare(insertSql).run(
      vendorId,
      product_id,
      data.predicted_daily_demand,
      weather || null,
      holiday || null,
      payload.Day_of_Week || null,
      payload.Season || null
    );

    res.json(data);
  } catch (err){
    res.status(503).json({ error: 'ML service unavailable: ' + err.message });
  }
});

app.get('/api/vendors/me/predictions/:pid', requireAuth('vendor'), (req, res) => {
  const vendorId = req.user.vendorId;
  if (!vendorId) return res.status(400).json({ error: 'Not linked to a vendor' });

  const sql = 'SELECT id, predicted_demand, weather, holiday, day_of_week, season, predicted_at FROM prediction_history WHERE vendor_id = ? AND product_id = ? ORDER BY predicted_at DESC LIMIT 5';
  const rows = db.prepare(sql).all(vendorId, req.params.pid);

  res.json(rows);
});
/* ==================== VENDOR SALES TREND ==================== */

app.get('/api/vendors/me/sales-trend', requireAuth('vendor'), (req, res) => {
  const email = req.user.email;
  const days = parseInt(req.query.days) || 7;

  // Build array of date keys (YYYY-MM-DD) for the last N days
  const today = new Date();
  const dateKeys = [];
  for (let i = days - 1; i >= 0; i--){
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dateKeys.push({ date: key, label: d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) });
  }

  // Query sales for this vendor in the range
  const startDate = dateKeys[0].date + ' 00:00:00';
  const rows = db.prepare(`
    SELECT DATE(sold_at) AS day,
           SUM(total_amount) AS revenue,
           SUM(quantity) AS units
    FROM sales_log
    WHERE sold_by = ? AND sold_at >= ?
    GROUP BY DATE(sold_at)
  `).all(email, startDate);

  const byDay = {};
  rows.forEach(r => { byDay[r.day] = r; });

  const result = dateKeys.map(d => ({
    date: d.date,
    label: d.label,
    revenue: byDay[d.date] ? byDay[d.date].revenue : 0,
    units: byDay[d.date] ? byDay[d.date].units : 0
  }));

  const totalRevenue = result.reduce((s, r) => s + r.revenue, 0);
  const totalUnits = result.reduce((s, r) => s + r.units, 0);

  res.json({ days, total_revenue: totalRevenue, total_units: totalUnits, data: result });
});

/* ==================== SUPPLIER'S OWN CATALOG ==================== */

app.get('/api/suppliers/me/products', requireAuth('supplier'), (req, res) => {
  const supplierId = req.user.supplierId;
  if (!supplierId) return res.status(404).json({ error: 'Not linked to a supplier' });

  const rows = db.prepare(`
    SELECT sp.product_id, p.name, p.category, p.unit_price AS retail_price,
           sp.price, sp.moq, sp.lead_time, sp.active
    FROM supplier_products sp
    JOIN products p ON p.id = sp.product_id
    WHERE sp.supplier_id = ?
    ORDER BY p.name
  `).all(supplierId);

  res.json(rows);
});

app.get('/api/suppliers/me/catalog', requireAuth('supplier'), (req, res) => {
  const supplierId = req.user.supplierId;
  if (!supplierId) return res.status(404).json({ error: 'Not linked to a supplier' });

  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.unit_price AS retail_price,
           CASE WHEN sp.product_id IS NOT NULL THEN 1 ELSE 0 END AS i_supply,
           sp.price AS my_price, sp.moq AS my_moq, sp.lead_time AS my_lead_time
    FROM products p
    LEFT JOIN supplier_products sp ON sp.product_id = p.id AND sp.supplier_id = ?
    ORDER BY p.name
  `).all(supplierId);

  res.json(rows);
});

/* ==================== HEALTH ==================== */

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/* ==================== START ==================== */
// ---- Phase 1: multi-day weather-aware prediction ----
installHorizonRoutes(app, db, requireAuth, ML_SERVICE);

app.listen(PORT, () => {
  console.log(`\nÃ°Å¸Å¡â‚¬ StreetSmart API at http://localhost:${PORT}`);
  console.log(`   Test: http://localhost:${PORT}/api/health\n`);
});





