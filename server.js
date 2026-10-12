'use strict';
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const PORT = process.env.PORT || 3000;
// DEMO_MODE=true: carga datos de ejemplo, muestra cuentas demo y un aviso en la web. Ponlo a false en producción.
const DEMO_MODE = process.env.DEMO_MODE !== 'false';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'oficios.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pros (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trade TEXT NOT NULL,
  trades_extra TEXT DEFAULT '[]',
  headline TEXT DEFAULT '',
  description TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  contact_email TEXT DEFAULT '',
  photo TEXT DEFAULT '',
  years_exp INTEGER DEFAULT 0,
  price_hour REAL,
  callout_fee REAL,
  free_quote INTEGER DEFAULT 0,
  emergency INTEGER DEFAULT 0,
  license TEXT DEFAULT '',
  insured INTEGER DEFAULT 0,
  invoice INTEGER DEFAULT 0,
  hours TEXT DEFAULT '',
  payment_methods TEXT DEFAULT '[]',
  languages TEXT DEFAULT '[]',
  gallery TEXT DEFAULT '[]',
  base_lat REAL,
  base_lng REAL,
  base_label TEXT DEFAULT '',
  radius_km REAL DEFAULT 10,
  verified INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pro_id INTEGER NOT NULL REFERENCES pros(user_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  comment TEXT DEFAULT '',
  reply TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(pro_id, user_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pro_read_at TEXT DEFAULT '',
  client_read_at TEXT DEFAULT '',
  UNIQUE(pro_id, client_id)
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  trade TEXT DEFAULT '',
  lat REAL, lng REAL, label TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  offer_amount REAL,
  offer_status TEXT,
  created_at TEXT NOT NULL
);
`);

const TRADES = [
  'Plomero / Fontanero', 'Gasista', 'Electricista', 'Cerrajero', 'Pintor', 'Albañil',
  'Carpintero', 'Climatización', 'Jardinero', 'Limpieza', 'Mudanzas', 'Manitas',
  'Cristalero', 'Techador', 'Herrero', 'Instalador de suelos'
];

// ---------- helpers ----------
const now = () => new Date().toISOString();
const n = (v) => (v === undefined || v === '' ? null : v);
const num = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v));
const bool = (v) => (v ? 1 : 0);
const str = (v, max = 2000) => (v == null ? '' : String(v).slice(0, max));
const arr = (v, maxItems = 20, maxLen = 200) =>
  JSON.stringify(Array.isArray(v) ? v.slice(0, maxItems).map((x) => String(x).slice(0, maxLen)) : []);
const parse = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const PRO_SELECT = `
  SELECT p.*, u.name, u.created_at AS member_since,
    (SELECT ROUND(AVG(rating), 2) FROM reviews r WHERE r.pro_id = p.user_id) AS avg_rating,
    (SELECT COUNT(*) FROM reviews r WHERE r.pro_id = p.user_id) AS review_count,
    (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.pro_id = p.user_id AND m.offer_status = 'accepted') AS jobs_agreed
  FROM pros p JOIN users u ON u.id = p.user_id`;

function proOut(row, { full = false } = {}) {
  if (!row) return null;
  const o = {
    id: row.user_id, name: row.name, trade: row.trade, trades_extra: parse(row.trades_extra),
    headline: row.headline, photo: row.photo, years_exp: row.years_exp,
    price_hour: row.price_hour, callout_fee: row.callout_fee,
    free_quote: !!row.free_quote, emergency: !!row.emergency, insured: !!row.insured,
    invoice: !!row.invoice, verified: !!row.verified, active: !!row.active,
    base_lat: row.base_lat, base_lng: row.base_lng, base_label: row.base_label, radius_km: row.radius_km,
    avg_rating: row.avg_rating, review_count: row.review_count, jobs_agreed: row.jobs_agreed,
    member_since: row.member_since,
  };
  if (full) {
    Object.assign(o, {
      description: row.description, phone: row.phone, whatsapp: row.whatsapp,
      contact_email: row.contact_email, license: row.license, hours: row.hours,
      payment_methods: parse(row.payment_methods), languages: parse(row.languages),
      gallery: parse(row.gallery), updated_at: row.updated_at, email_alerts: row.email_alerts !== 0,
    });
  }
  return o;
}

function userOut(u) {
  return u && { id: u.id, email: u.email, name: u.name, role: u.role, created_at: u.created_at, email_notifs: u.email_notifs !== 0 };
}

function unreadCount(userId) {
  const r = db.prepare(`
    SELECT COUNT(*) AS c FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.sender_id != ? AND (
      (c.pro_id = ? AND m.created_at > c.pro_read_at) OR
      (c.client_id = ? AND m.created_at > c.client_read_at))`).get(userId, userId, userId);
  return r.c;
}

// ---------- app ----------
let orders = null; // se inicializa más abajo (orders.js)
const app = express();
// Pagos (Stripe Connect o simulado). El webhook necesita el cuerpo sin parsear, así que va antes de express.json.
const mailer = require('./mailer')({ db, now });
const notify = require('./notify')({ db, mailer, now });
const pay = require('./payments')({ db, now, DEMO_MODE, notify });
// Migración: alertas por email de pedidos nuevos (activadas por defecto)
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'email_notifs')) db.exec('ALTER TABLE users ADD COLUMN email_notifs INTEGER NOT NULL DEFAULT 1');
if (!db.prepare('PRAGMA table_info(pros)').all().some((c) => c.name === 'email_alerts')) db.exec('ALTER TABLE pros ADD COLUMN email_alerts INTEGER NOT NULL DEFAULT 1');
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), pay.webhook);
// Los documentos de verificación pueden pesar más que el resto de peticiones
app.use('/api/verification', express.json({ limit: '20mb' }));
app.use(express.json({ limit: '8mb' }));
app.set('trust proxy', true);
// index.html con la URL pública para Open Graph / canonical
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const sendIndex = (req, res) => {
  const origin = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  res.type('html').send(INDEX.replaceAll('__ORIGIN__', origin.replace(/\/$/, '')));
};
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));

app.use((req, _res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    req.user = db.prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
    ).get(token);
    req.token = token;
  }
  next();
});
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Necesitas iniciar sesión' }));

function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now());
  return token;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/trades', (_req, res) => res.json(TRADES));
app.get('/api/config', (_req, res) => res.json({ demo: DEMO_MODE, pay: { mode: pay.mode, fee_pct: pay.feePct, release_hours: pay.releaseHours }, order_expiry_days: Number(process.env.ORDER_EXPIRY_DAYS ?? 7) }));

app.get('/api/stats', (_req, res) => {
  const pros = db.prepare('SELECT COUNT(*) AS c FROM pros WHERE active = 1').get().c;
  const r = db.prepare('SELECT COUNT(*) AS c, ROUND(AVG(rating), 1) AS avg FROM reviews').get();
  const recent = db.prepare(`
    SELECT r.rating, r.comment, r.created_at, u.name AS author, p.user_id AS pro_id, pu.name AS pro_name, p.trade
    FROM reviews r JOIN users u ON u.id = r.user_id JOIN pros p ON p.user_id = r.pro_id JOIN users pu ON pu.id = p.user_id
    WHERE r.rating = 5 AND LENGTH(r.comment) > 20 AND p.active = 1
      AND r.id = (SELECT MAX(r2.id) FROM reviews r2 WHERE r2.comment = r.comment AND r2.rating = 5)
    ORDER BY r.created_at DESC LIMIT 3`).all();
  res.json({ pros, reviews: r.c, avg_rating: r.avg, recent_reviews: recent });
});

// Destacados: mejor valorados (mín. 3 reseñas) que llegan a la ubicación indicada
app.get('/api/featured', (req, res) => {
  const lat = num(req.query.lat), lng = num(req.query.lng);
  const rows = db.prepare(`${PRO_SELECT} WHERE p.active = 1 AND p.base_lat IS NOT NULL`).all()
    .filter((r) => r.review_count >= 3)
    .map((r) => ({ r, d: lat != null ? haversineKm(lat, lng, r.base_lat, r.base_lng) : null }))
    .filter(({ r, d }) => d == null || d <= r.radius_km)
    .sort((a, b) => b.r.avg_rating - a.r.avg_rating || b.r.review_count - a.r.review_count)
    .slice(0, 4)
    .map(({ r, d }) => ({ ...proOut(r), distance_km: d == null ? null : Math.round(d * 10) / 10 }));
  res.json(rows);
});

// "Avísame cuando haya profesionales en mi zona"
app.post('/api/alerts', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Email no válido' });
  db.prepare('INSERT INTO alerts (email, trade, lat, lng, label, created_at) VALUES (?,?,?,?,?,?)')
    .run(email, str(req.body.trade, 60), num(req.body.lat), num(req.body.lng), str(req.body.label, 200), now());
  res.json({ ok: true });
});

// --- auth ---
app.post('/api/auth/register', (req, res) => {
  const { email, password, name, role } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Email no válido' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Indica tu nombre' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
  const r = db.prepare('INSERT INTO users (email, pass_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(email.toLowerCase(), hashPassword(password), str(name, 80).trim(), role === 'pro' ? 'pro' : 'client', now());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  res.json({ token: newSession(user.id), user: userOut(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = email && db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user || !password || !verifyPassword(password, user.pass_hash))
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  res.json({ token: newSession(user.id), user: userOut(user) });
});

app.post('/api/auth/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const pro = db.prepare(`${PRO_SELECT} WHERE p.user_id = ?`).get(req.user.id);
  res.json({ user: userOut(req.user), pro: proOut(pro, { full: true }), unread: unreadCount(req.user.id), pending: orders.badges(req.user.id), is_admin: pay.isAdmin(req.user), pay_mode: pay.mode });
});

app.post('/api/me/become-pro', auth, (req, res) => {
  db.prepare("UPDATE users SET role = 'pro' WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});

// --- pros ---
app.put('/api/pros/me', auth, (req, res) => {
  if (req.user.role !== 'pro') return res.status(403).json({ error: 'Solo para profesionales' });
  const b = req.body || {};
  if (!TRADES.includes(b.trade)) return res.status(400).json({ error: 'Elige un oficio principal' });
  const lat = num(b.base_lat), lng = num(b.base_lng);
  if (lat == null || lng == null) return res.status(400).json({ error: 'Marca tu ubicación base en el mapa' });
  const radius = Math.min(Math.max(num(b.radius_km) || 10, 1), 300);
  const extras = (Array.isArray(b.trades_extra) ? b.trades_extra : []).filter((t) => TRADES.includes(t) && t !== b.trade);
  const gallery = (Array.isArray(b.gallery) ? b.gallery : []).filter((g) => typeof g === 'string').slice(0, 8);
  const photo = typeof b.photo === 'string' ? b.photo.slice(0, 600000) : '';

  db.prepare(`
    INSERT INTO pros (user_id, trade, trades_extra, headline, description, phone, whatsapp, contact_email, photo,
      years_exp, price_hour, callout_fee, free_quote, emergency, license, insured, invoice, hours,
      payment_methods, languages, gallery, base_lat, base_lng, base_label, radius_km, active, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      trade=excluded.trade, trades_extra=excluded.trades_extra, headline=excluded.headline,
      description=excluded.description, phone=excluded.phone, whatsapp=excluded.whatsapp,
      contact_email=excluded.contact_email, photo=excluded.photo, years_exp=excluded.years_exp,
      price_hour=excluded.price_hour, callout_fee=excluded.callout_fee, free_quote=excluded.free_quote,
      emergency=excluded.emergency, license=excluded.license, insured=excluded.insured, invoice=excluded.invoice,
      hours=excluded.hours, payment_methods=excluded.payment_methods, languages=excluded.languages,
      gallery=excluded.gallery, base_lat=excluded.base_lat, base_lng=excluded.base_lng,
      base_label=excluded.base_label, radius_km=excluded.radius_km, active=excluded.active, updated_at=excluded.updated_at
  `).run(
    req.user.id, b.trade, JSON.stringify(extras), str(b.headline, 120), str(b.description, 4000),
    str(b.phone, 30), str(b.whatsapp, 30), str(b.contact_email, 120), photo,
    Math.max(0, Math.min(70, num(b.years_exp) || 0)), num(b.price_hour), num(b.callout_fee),
    bool(b.free_quote), bool(b.emergency), str(b.license, 120), bool(b.insured), bool(b.invoice),
    str(b.hours, 300), arr(b.payment_methods), arr(b.languages), JSON.stringify(gallery),
    lat, lng, str(b.base_label, 200), radius, b.active === false ? 0 : 1, now()
  );
  if (b.name && String(b.name).trim()) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(str(b.name, 80).trim(), req.user.id);
  const row = db.prepare(`${PRO_SELECT} WHERE p.user_id = ?`).get(req.user.id);
  res.json(proOut(row, { full: true }));
});

app.get('/api/pros/:id', (req, res) => {
  const row = db.prepare(`${PRO_SELECT} WHERE p.user_id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Profesional no encontrado' });
  const reviews = db.prepare(`
    SELECT r.id, r.rating, r.comment, r.reply, r.created_at, r.user_id, u.name AS author
    FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.pro_id = ? ORDER BY r.created_at DESC`).all(row.user_id);
  const dist = db.prepare('SELECT rating, COUNT(*) AS c FROM reviews WHERE pro_id = ? GROUP BY rating').all(row.user_id);
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  dist.forEach((d) => (breakdown[d.rating] = d.c));
  const out = { ...proOut(row, { full: true }), reviews, breakdown };
  // El contacto directo solo se muestra a usuarios registrados
  out.has_phone = !!row.phone; out.has_whatsapp = !!row.whatsapp; out.has_email = !!row.contact_email;
  if (!req.user) { out.phone = ''; out.whatsapp = ''; out.contact_email = ''; out.contact_locked = true; }
  res.json(out);
});

// Búsqueda: profesionales cuyo radio de desplazamiento cubre la ubicación del cliente
app.get('/api/search', (req, res) => {
  const lat = num(req.query.lat), lng = num(req.query.lng);
  if (lat == null || lng == null) return res.status(400).json({ error: 'Falta la ubicación' });
  const trade = req.query.trade || '';
  const minRating = num(req.query.minRating) || 0;
  const q = String(req.query.q || '').toLowerCase().trim();
  const sort = req.query.sort || 'distance';

  const rows = db.prepare(`${PRO_SELECT} WHERE p.active = 1 AND p.base_lat IS NOT NULL`).all();
  let results = rows
    .map((r) => ({ row: r, distance_km: haversineKm(lat, lng, r.base_lat, r.base_lng) }))
    .filter(({ row, distance_km }) => distance_km <= row.radius_km)
    .filter(({ row }) => !trade || row.trade === trade || parse(row.trades_extra).includes(trade))
    .filter(({ row }) => (row.avg_rating || 0) >= minRating)
    .filter(({ row }) => req.query.emergency !== '1' || row.emergency)
    .filter(({ row }) => req.query.freeQuote !== '1' || row.free_quote)
    .filter(({ row }) => req.query.insured !== '1' || row.insured)
    .filter(({ row }) => !q || `${row.name} ${row.headline} ${row.description}`.toLowerCase().includes(q))
    .map(({ row, distance_km }) => ({ ...proOut(row), distance_km: Math.round(distance_km * 10) / 10 }));

  const sorters = {
    distance: (a, b) => a.distance_km - b.distance_km,
    rating: (a, b) => (b.avg_rating || 0) - (a.avg_rating || 0) || b.review_count - a.review_count,
    reviews: (a, b) => b.review_count - a.review_count,
    price: (a, b) => (a.price_hour ?? 1e9) - (b.price_hour ?? 1e9),
  };
  results.sort(sorters[sort] || sorters.distance);
  res.json({ count: results.length, results });
});

// --- reviews ---
app.post('/api/pros/:id/reviews', auth, (req, res) => {
  const proId = Number(req.params.id);
  if (proId === req.user.id) return res.status(400).json({ error: 'No puedes reseñarte a ti mismo' });
  if (!db.prepare('SELECT 1 FROM pros WHERE user_id = ?').get(proId)) return res.status(404).json({ error: 'No existe' });
  const rating = Math.round(num(req.body.rating) || 0);
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'La valoración debe ser de 1 a 5' });
  db.prepare(`INSERT INTO reviews (pro_id, user_id, rating, comment, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(pro_id, user_id) DO UPDATE SET rating=excluded.rating, comment=excluded.comment, created_at=excluded.created_at`)
    .run(proId, req.user.id, rating, str(req.body.comment, 2000), now());
  res.json({ ok: true });
});

app.post('/api/reviews/:id/reply', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(req.params.id));
  if (!r || r.pro_id !== req.user.id) return res.status(403).json({ error: 'Solo el profesional puede responder' });
  db.prepare('UPDATE reviews SET reply = ? WHERE id = ?').run(str(req.body.reply, 1000) || null, r.id);
  res.json({ ok: true });
});

// --- conversations / messages ---
function addMessage(convId, senderId, body, offer) {
  const t = now();
  const amount = num(offer);
  db.prepare('INSERT INTO messages (conversation_id, sender_id, body, offer_amount, offer_status, created_at) VALUES (?,?,?,?,?,?)')
    .run(convId, senderId, str(body, 4000), amount, amount != null ? 'pending' : null, t);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(t, convId);
}
function getConvForUser(id, userId) {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!c || (c.pro_id !== userId && c.client_id !== userId)) return null;
  return c;
}

app.post('/api/conversations', auth, (req, res) => {
  const proId = Number(req.body.proId);
  if (proId === req.user.id) return res.status(400).json({ error: 'No puedes escribirte a ti mismo' });
  if (!db.prepare('SELECT 1 FROM pros WHERE user_id = ?').get(proId)) return res.status(404).json({ error: 'Profesional no encontrado' });
  if (!String(req.body.body || '').trim() && num(req.body.offer) == null) return res.status(400).json({ error: 'Escribe un mensaje' });
  let c = db.prepare('SELECT * FROM conversations WHERE pro_id = ? AND client_id = ?').get(proId, req.user.id);
  if (!c) {
    const t = now();
    const r = db.prepare('INSERT INTO conversations (pro_id, client_id, created_at, updated_at) VALUES (?,?,?,?)').run(proId, req.user.id, t, t);
    c = { id: Number(r.lastInsertRowid) };
  }
  addMessage(c.id, req.user.id, req.body.body, req.body.offer);
  res.json({ id: c.id });
});

app.get('/api/conversations', auth, (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(`
    SELECT c.*, pu.name AS pro_name, cu.name AS client_name, p.trade, p.photo AS pro_photo,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT offer_amount FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_offer,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ?
         AND m.created_at > CASE WHEN c.pro_id = ? THEN c.pro_read_at ELSE c.client_read_at END) AS unread
    FROM conversations c
    JOIN users pu ON pu.id = c.pro_id JOIN users cu ON cu.id = c.client_id
    LEFT JOIN pros p ON p.user_id = c.pro_id
    WHERE c.pro_id = ? OR c.client_id = ? ORDER BY c.updated_at DESC`).all(me, me, me, me);
  res.json(rows.map((c) => ({
    id: c.id, updated_at: c.updated_at, unread: c.unread, trade: c.trade,
    i_am_pro: c.pro_id === me,
    other: c.pro_id === me ? { id: c.client_id, name: c.client_name } : { id: c.pro_id, name: c.pro_name, photo: c.pro_photo },
    last_body: c.last_body, last_offer: c.last_offer,
  })));
});

app.get('/api/conversations/:id', auth, (req, res) => {
  const c = getConvForUser(Number(req.params.id), req.user.id);
  if (!c) return res.status(404).json({ error: 'Conversación no encontrada' });
  const iAmPro = c.pro_id === req.user.id;
  db.prepare(`UPDATE conversations SET ${iAmPro ? 'pro_read_at' : 'client_read_at'} = ? WHERE id = ?`).run(now(), c.id);
  const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id').all(c.id);
  const pro = db.prepare(`${PRO_SELECT} WHERE p.user_id = ?`).get(c.pro_id);
  const client = db.prepare('SELECT id, name FROM users WHERE id = ?').get(c.client_id);
  res.json({ id: c.id, i_am_pro: iAmPro, pro: proOut(pro), client, messages: msgs });
});

app.post('/api/conversations/:id/messages', auth, (req, res) => {
  const c = getConvForUser(Number(req.params.id), req.user.id);
  if (!c) return res.status(404).json({ error: 'Conversación no encontrada' });
  if (!String(req.body.body || '').trim() && num(req.body.offer) == null) return res.status(400).json({ error: 'Escribe un mensaje' });
  addMessage(c.id, req.user.id, req.body.body, req.body.offer);
  res.json({ ok: true });
});

app.post('/api/messages/:id/offer', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(req.params.id));
  if (!m || m.offer_status !== 'pending') return res.status(400).json({ error: 'Propuesta no disponible' });
  const c = getConvForUser(m.conversation_id, req.user.id);
  if (!c || m.sender_id === req.user.id) return res.status(403).json({ error: 'Solo la otra parte puede responder la propuesta' });
  const status = req.body.status === 'accepted' ? 'accepted' : 'rejected';
  db.prepare('UPDATE messages SET offer_status = ? WHERE id = ?').run(status, m.id);
  addMessage(c.id, req.user.id, status === 'accepted'
    ? `✅ Propuesta de ${m.offer_amount} € aceptada.`
    : `❌ Propuesta de ${m.offer_amount} € rechazada.`);
  res.json({ ok: true });
});

// --- pedidos, presupuestos e IA ---
orders = require('./orders')(app, { db, auth, TRADES, now, num, str, parse, haversineKm, PRO_SELECT, proOut, pay, mailer, notify });
pay.routes(app, auth);
notify.routes(app, auth);
require('./verification')(app, { db, auth, now, parse, dataDir: path.dirname(DB_PATH), isAdmin: pay.isAdmin, notify });

app.put('/api/me/notifs', auth, (req, res) => {
  db.prepare('UPDATE users SET email_notifs = ? WHERE id = ?').run(req.body?.email_notifs === false ? 0 : 1, req.user.id);
  res.json({ ok: true });
});
app.put('/api/pros/me/alerts', auth, (req, res) => {
  const r = db.prepare('UPDATE pros SET email_alerts = ? WHERE user_id = ?').run(req.body?.email_alerts === false ? 0 : 1, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Primero crea tu perfil profesional' });
  res.json({ ok: true });
});
app.get('/api/admin/emails', auth, (req, res) => {
  if (!pay.isAdmin(req.user)) return res.status(403).json({ error: 'Solo para administración' });
  res.json({ mode: mailer.mode, emails: db.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT 30').all() });
});

// --- precios, páginas por oficio/ciudad (SEO) y herramientas gratuitas ---
require('./seo')(app, { db, PRO_SELECT, proOut, haversineKm, parse, TRADES });

app.use('/api', (_req, res) => res.status(404).json({ error: 'No encontrado' }));

// ---------- seed ----------
if (DEMO_MODE) {
  const seed = require('./seed');
  seed(db, { hashPassword, TRADES });
  seed.orders(db, { payMode: pay.mode });
  if (pay.isAdmin({ email: 'admin@demo.com' }) && !db.prepare("SELECT 1 FROM users WHERE email = 'admin@demo.com'").get())
    db.prepare("INSERT INTO users (email, pass_hash, name, role, created_at) VALUES ('admin@demo.com', ?, 'Administración', 'client', ?)").run(hashPassword('demo1234'), now());
}

// Keep-alive para Render gratis: se pide a sí mismo por la URL pública cada 10 min para no dormirse.
// Render define RENDER_EXTERNAL_URL automáticamente. Desactivar con KEEP_ALIVE=false.
if (process.env.RENDER_EXTERNAL_URL && process.env.KEEP_ALIVE !== 'false') {
  const url = `${process.env.RENDER_EXTERNAL_URL}/api/health`;
  setInterval(() => fetch(url).catch(() => {}), 10 * 60 * 1000);
  console.log('Keep-alive activo contra', url);
}

app.listen(PORT, () => console.log(`Oficio Cerca escuchando en http://localhost:${PORT}`));
