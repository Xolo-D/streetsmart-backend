// server.js — StreetSmart API
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ==================== MIDDLEWARE ==================== */

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method.padEnd(6)} ${req.url}`);
  next();
});

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
        return res.status(403).json({ error: 'Forbidden — wrong role' });
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
    { id: user.id, email: user.email, role: user.role, supplierId: user.supplier_id, vendorId: user.vendor_id, name: user.name },
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
      vendorId: user.vendor_id
    }
  });
});

app.get('/api/auth/me', requireAuth(), (req, res) => {
  res.json({ user: req.user });
});

/* ==================== REGISTRATION ==================== */

app.post('/api/auth/register', (req, res) => {
  const { email, password, name, role, city, type } = req.body;

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
    const info = db.prepare(`
      INSERT INTO users (email, password_hash, role, name, city, type, approved)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(email.toLowerCase(), hash, role, name, city || null, type || null);

    res.status(201).json({
      success: true,
      message: 'Account created. An administrator will approve it shortly.',
      userId: info.lastInsertRowid
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
    SELECT id, email, role, name, city, type, created_at
    FROM users
    WHERE approved = 0
    ORDER BY created_at DESC
  `).all();
  res.json(rows);
});

app.get('/api/admin/vendors/unassigned', requireAuth('admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT v.id, v.city, v.type, v.revenue, v.transactions
    FROM vendors v
    LEFT JOIN users u ON u.vendor_id = v.id
    WHERE u.id IS NULL
    ORDER BY v.id
    LIMIT 50
  `).all();
  res.json(rows);
});

app.get('/api/admin/suppliers/unassigned', requireAuth('admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.name, s.city, s.category
    FROM suppliers s
    LEFT JOIN users u ON u.supplier_id = s.id
    WHERE u.id IS NULL
    ORDER BY s.name
    LIMIT 50
  `).all();
  res.json(rows);
});

app.post('/api/admin/users/:id/approve', requireAuth('admin'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.approved === 1) return res.status(400).json({ error: 'User already approved' });

  const { vendor_id, supplier_id } = req.body;

  if (user.role === 'vendor' && !vendor_id){
    return res.status(400).json({ error: 'Vendor must be assigned a vendor record before approval' });
  }
  if (user.role === 'supplier' && !supplier_id){
    return res.status(400).json({ error: 'Supplier must be assigned a supplier record before approval' });
  }

  if (user.role === 'vendor'){
    const vendor = db.prepare('SELECT id FROM vendors WHERE id = ?').get(vendor_id);
    if (!vendor) return res.status(404).json({ error: 'Vendor record not found' });
    const taken = db.prepare('SELECT id FROM users WHERE vendor_id = ?').get(vendor_id);
    if (taken) return res.status(409).json({ error: 'That vendor record is already linked to another user' });
  }
  if (user.role === 'supplier'){
    const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplier_id);
    if (!sup) return res.status(404).json({ error: 'Supplier record not found' });
    const taken = db.prepare('SELECT id FROM users WHERE supplier_id = ?').get(supplier_id);
    if (taken) return res.status(409).json({ error: 'That supplier record is already linked to another user' });
  }

  db.prepare(`
    UPDATE users
    SET approved = 1,
        approved_at = CURRENT_TIMESTAMP,
        approved_by = ?,
        vendor_id = COALESCE(?, vendor_id),
        supplier_id = COALESCE(?, supplier_id)
    WHERE id = ?
  `).run(req.user.email, vendor_id || null, supplier_id || null, req.params.id);

  res.json({ success: true, message: `User ${user.email} approved` });
});

app.delete('/api/admin/users/:id', requireAuth('admin'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: `User ${user.email} rejected and deleted` });
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

app.get('/api/vendors', (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM vendors';
  const params = [];
  if (search){
    sql += ' WHERE id LIKE ? OR city LIKE ? OR type LIKE ?';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY revenue DESC LIMIT 200';
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
  if (!vendorId) return res.status(404).json({ error: 'Not linked to a vendor' });

  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
  if (!vendor) return res.status(404).json({ error: 'Not found' });

  res.json({
    vendor_id: vendor.id,
    city: vendor.city,
    type: vendor.type,
    revenue: vendor.revenue,
    profit: vendor.profit,
    units: vendor.units,
    transactions: vendor.transactions,
    skus_sold: vendor.products
  });
});

/* ==================== SUPPLIERS ==================== */

app.get('/api/suppliers', (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers ORDER BY rating DESC').all());
});

app.get('/api/suppliers/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const products = db.prepare('SELECT * FROM products WHERE supplier_id = ?').all(req.params.id);
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
    `).run(id, name, category, parseFloat(unit_price), parseInt(current_stock) || 0, parseInt(reorder_level) || 20, supplier_id || null);
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
  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  db.prepare('UPDATE products SET current_stock = ? WHERE id = ?').run(current_stock, req.params.id);
  res.json({ success: true, message: `Stock updated for ${product.name}: ${current_stock} units`, product: { id: req.params.id, name: product.name, current_stock } });
});

app.post('/api/products/:id/receive', requireAuth('vendor'), (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity <= 0) return res.status(400).json({ error: 'positive quantity required' });

  const product = db.prepare('SELECT id, name, current_stock FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const newStock = product.current_stock + parseInt(quantity);
  db.prepare('UPDATE products SET current_stock = ? WHERE id = ?').run(newStock, req.params.id);
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
      supplier: r.supplier_name || '—',
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

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.current_stock < quantity){
    return res.status(400).json({ error: `Not enough stock. Only ${product.current_stock} units available.` });
  }

  const recordSale = db.prepare(`
    INSERT INTO sales_log (product_id, quantity, unit_price, total_amount, sold_by, sold_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const updateStock = db.prepare('UPDATE products SET current_stock = current_stock - ? WHERE id = ?');

  const tx = db.transaction(() => {
    recordSale.run(product_id, quantity, product.unit_price, quantity * product.unit_price, req.user.email);
    updateStock.run(quantity, product_id);
  });

  try {
    tx();
    const updated = db.prepare('SELECT id, name, current_stock FROM products WHERE id = ?').get(product_id);
    res.status(201).json({ success: true, message: `Sale recorded: ${quantity} × ${product.name}`, product: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales-log', requireAuth(), (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.product_id, p.name AS product_name, s.quantity,
           s.unit_price, s.total_amount, s.sold_by, s.sold_at
    FROM sales_log s
    JOIN products p ON p.id = s.product_id
    ORDER BY s.sold_at DESC LIMIT 50
  `).all();
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
  const { product_id, product, category, price, moq, lead_time } = req.body;
  if (!product_id || !product || !category || price === undefined){
    return res.status(400).json({ error: 'product_id, product, category, price required' });
  }

  const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
  if (!exists) return res.status(404).json({ error: 'Product ID not in catalogue.' });

  db.prepare('UPDATE products SET supplier_id = ?, unit_price = ? WHERE id = ?')
    .run(req.params.id, parseFloat(price), product_id);

  res.status(201).json({ success: true, message: `Product ${product} assigned`, product: { product_id, product, category, price, moq, lead_time } });
});

app.patch('/api/suppliers/:id/products/:pid', requireAuth('supplier'), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.pid);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const updates = {};
  if (req.body.price !== undefined) updates.unit_price = parseFloat(req.body.price);
  if (req.body.unit_price !== undefined) updates.unit_price = parseFloat(req.body.unit_price);
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), req.params.pid];
  db.prepare(`UPDATE products SET ${setClause} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.pid);
  res.json({ success: true, product: updated });
});

app.delete('/api/suppliers/:id/products/:pid', requireAuth('supplier'), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.pid);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  db.prepare('UPDATE products SET supplier_id = NULL WHERE id = ?').run(req.params.pid);
  res.json({ success: true, message: 'Product removed from catalogue' });
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

/* ==================== ML PREDICTIONS ==================== */

app.get('/api/predictions', (req, res) => {
  const filePath = path.join(__dirname, '..', 'streetsmart-ml', 'predictions.json');
  if (!fs.existsSync(filePath)){
    return res.status(404).json({ error: 'predictions.json not found. Run: cd ../streetsmart-ml && python3 predict.py' });
  }
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
});

app.get('/api/model-metrics', (req, res) => {
  const filePath = path.join(__dirname, '..', 'streetsmart-ml', 'model_metrics.json');
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

/* ==================== HEALTH ==================== */

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/* ==================== START ==================== */

app.listen(PORT, () => {
  console.log(`\n🚀 StreetSmart API at http://localhost:${PORT}`);
  console.log(`   Test: http://localhost:${PORT}/api/health\n`);
});