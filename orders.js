'use strict';
// Pedidos: el cliente describe un problema (con ayuda de la IA), los profesionales de su zona envían
// presupuestos, el cliente elige y hablan por un chat interno ligado al pedido.
const { chat: aiChat, aiEnabled } = require('./ai');

module.exports = function ordersModule(app, { db, auth, TRADES, now, num, str, parse, haversineKm, PRO_SELECT, proOut, pay, mailer }) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trade TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    urgency TEXT NOT NULL DEFAULT 'semana',
    when_text TEXT DEFAULT '',
    est_min REAL, est_max REAL,
    address_label TEXT DEFAULT '',
    address_detail TEXT DEFAULT '',
    lat REAL NOT NULL, lng REAL NOT NULL,
    photos TEXT DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'open',
    accepted_quote_id INTEGER,
    accepted_pro_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    message TEXT DEFAULT '',
    materials_included INTEGER DEFAULT 0,
    visit_when TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    client_seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(order_id, pro_id)
  );
  CREATE TABLE IF NOT EXISTS order_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'text',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_reads (
    order_id INTEGER NOT NULL, pro_id INTEGER NOT NULL, user_id INTEGER NOT NULL, read_at TEXT NOT NULL,
    PRIMARY KEY (order_id, pro_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_quotes_order ON quotes(order_id);
  CREATE INDEX IF NOT EXISTS idx_omsg_order ON order_messages(order_id, pro_id);
  `);

  const URGENCIES = ['hoy', 'semana', 'flexible'];
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const fail = (res, code, error) => res.status(code).json({ error });
  const firstName = (n) => String(n || '').split(' ')[0];
  const areaOf = (label) => {
    const p = String(label || '').split(',').map((s) => s.trim()).filter(Boolean);
    return (p.length > 1 ? p.slice(1) : p).join(', ') || 'Zona sin especificar';
  };
  const coarse = (v) => Math.round(v * 100) / 100; // ~1 km: no revela el portal hasta que el cliente elige
  const round1 = (v) => Math.round(v * 10) / 10;

  const proMatches = (p, o) =>
    p && p.active && p.base_lat != null &&
    (p.trade === o.trade || parse(p.trades_extra).includes(o.trade)) &&
    haversineKm(o.lat, o.lng, p.base_lat, p.base_lng) <= p.radius_km;

  const involved = (orderId, proId) =>
    !!get('SELECT 1 FROM quotes WHERE order_id = ? AND pro_id = ?', orderId, proId) ||
    !!get('SELECT 1 FROM order_messages WHERE order_id = ? AND pro_id = ?', orderId, proId);

  function matchingProCount(o) {
    return all('SELECT * FROM pros WHERE active = 1 AND user_id != ?', o.client_id).filter((p) => proMatches(p, o)).length;
  }

  // ---------- IA ----------
  const hits = new Map();
  const limited = (ip) => {
    const t = Date.now(), list = (hits.get(ip) || []).filter((x) => t - x < 10 * 60 * 1000);
    list.push(t); hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    return list.length > 20;
  };
  app.get('/api/ai/status', (_req, res) => res.json({ ai: aiEnabled() ? 'claude' : 'basic' }));
  app.post('/api/ai/chat', async (req, res) => {
    if (limited(req.ip)) return fail(res, 429, 'Demasiadas consultas seguidas. Espera unos minutos.');
    try { res.json(await aiChat(req.body?.messages, TRADES)); }
    catch (e) { fail(res, e.status || 500, e.status ? e.message : 'No se pudo procesar tu mensaje'); }
  });

  // ---------- avisos por email a los profesionales de la zona ----------
  const URG_TXT = { hoy: 'Hoy mismo', semana: 'Esta semana', flexible: 'Sin prisa' };
  async function notifyNewOrder(orderId, base) {
    const o = get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) return;
    const pros = all(`SELECT p.*, u.email, u.name FROM pros p JOIN users u ON u.id = p.user_id
      WHERE p.active = 1 AND p.email_alerts = 1 AND p.user_id != ?`, o.client_id).filter((p) => proMatches(p, o)).slice(0, 50);
    for (const p of pros) {
      const km = Math.round(haversineKm(o.lat, o.lng, p.base_lat, p.base_lng) * 10) / 10;
      const desc = o.description.length > 300 ? `${o.description.slice(0, 300)}…` : o.description;
      await mailer.send({
        to: p.email, subject: `Nuevo pedido en tu zona: ${o.title}`,
        text: [`Hola ${firstName(p.name)},`, '', `Hay un pedido nuevo de ${o.trade.toLowerCase()} cerca de ti:`, '', o.title,
          `Zona: ${areaOf(o.address_label)} (a ${km} km de tu base)`, `Cuándo: ${URG_TXT[o.urgency]}${o.when_text ? ` · ${o.when_text}` : ''}`,
          ...(o.est_min ? [`Precio orientativo de mano de obra: ${o.est_min} – ${o.est_max} €`] : []), '', desc, '',
          `Ver el pedido y enviar tu presupuesto: ${base}/#/pedido/${o.id}`, '',
          `Recibes este aviso porque tienes activadas las alertas de pedidos nuevos. Puedes desactivarlas en tu perfil profesional: ${base}/#/panel`, 'Oficio Cerca'].join('\n'),
      });
    }
  }

  // ---------- crear pedido ----------
  app.post('/api/orders', auth, (req, res) => {
    const b = req.body || {};
    if (!TRADES.includes(b.trade)) return fail(res, 400, 'Elige el tipo de profesional');
    const title = str(b.title, 100).trim();
    if (title.length < 3) return fail(res, 400, 'Escribe un título para el pedido');
    const lat = num(b.lat), lng = num(b.lng);
    if (lat == null || lng == null) return fail(res, 400, 'Indica dónde necesitas el servicio');
    const photos = (Array.isArray(b.photos) ? b.photos : []).filter((p) => typeof p === 'string' && p.startsWith('data:image/') && p.length < 700000).slice(0, 3);
    const t = now();
    const est_min = num(b.est_min), est_max = num(b.est_max);
    const r = run(`INSERT INTO orders (client_id, trade, title, description, urgency, when_text, est_min, est_max,
      address_label, address_detail, lat, lng, photos, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`,
      req.user.id, b.trade, title, str(b.description, 2000).trim(), URGENCIES.includes(b.urgency) ? b.urgency : 'semana',
      str(b.when_text, 200).trim(), est_min && est_max && est_max >= est_min ? est_min : null, est_min && est_max && est_max >= est_min ? est_max : null,
      str(b.address_label, 200), str(b.address_detail, 200).trim(), lat, lng, JSON.stringify(photos), t, t);
    const base = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    notifyNewOrder(Number(r.lastInsertRowid), base).catch((e) => console.error('avisos:', e.message));
    res.json({ id: Number(r.lastInsertRowid) });
  });

  // ---------- listados ----------
  app.get('/api/orders/mine', auth, (req, res) => {
    const rows = all('SELECT * FROM orders WHERE client_id = ? ORDER BY created_at DESC', req.user.id);
    res.json(rows.map((o) => {
      const q = get(`SELECT COUNT(*) AS n, SUM(client_seen = 0) AS fresh, MIN(amount) AS lowest FROM quotes
        WHERE order_id = ? AND status IN ('pending','accepted')`, o.id);
      const pro = o.accepted_pro_id && get('SELECT name FROM users WHERE id = ?', o.accepted_pro_id);
      return {
        id: o.id, title: o.title, trade: o.trade, status: o.status, urgency: o.urgency, created_at: o.created_at,
        area: areaOf(o.address_label), quote_count: q.n || 0, new_quotes: q.fresh || 0, lowest: q.lowest,
        accepted_pro: pro ? pro.name : null,
      };
    }));
  });

  app.get('/api/pro/orders', auth, (req, res) => {
    const pro = get('SELECT * FROM pros WHERE user_id = ?', req.user.id);
    if (!pro) return res.json({ new: [], quoted: [], has_profile: false });
    const lite = (o, extra = {}) => ({
      id: o.id, title: o.title, trade: o.trade, status: o.status, urgency: o.urgency, when_text: o.when_text,
      created_at: o.created_at, area: areaOf(o.address_label), est_min: o.est_min, est_max: o.est_max,
      distance_km: pro.base_lat != null ? round1(haversineKm(o.lat, o.lng, pro.base_lat, pro.base_lng)) : null,
      quote_count: get("SELECT COUNT(*) AS n FROM quotes WHERE order_id = ? AND status != 'withdrawn'", o.id).n, ...extra,
    });
    const fresh = all("SELECT * FROM orders WHERE status = 'open' AND client_id != ? ORDER BY created_at DESC LIMIT 200", req.user.id)
      .filter((o) => proMatches(pro, o) && !get('SELECT 1 FROM quotes WHERE order_id = ? AND pro_id = ?', o.id, req.user.id))
      .map((o) => lite(o));
    const quoted = all(`SELECT o.*, q.amount AS my_amount, q.status AS my_status FROM quotes q JOIN orders o ON o.id = q.order_id
      WHERE q.pro_id = ? ORDER BY q.updated_at DESC`, req.user.id)
      .map((o) => lite(o, { my_amount: o.my_amount, my_status: o.my_status, mine_won: o.accepted_pro_id === req.user.id }));
    res.json({ new: fresh, quoted, has_profile: true });
  });

  // Contadores para la barra de navegación
  function badges(userId) {
    const quotes = get(`SELECT COUNT(*) AS n FROM quotes q JOIN orders o ON o.id = q.order_id
      WHERE o.client_id = ? AND o.status = 'open' AND q.status = 'pending' AND q.client_seen = 0`, userId).n;
    const chat = get(`SELECT COUNT(*) AS n FROM order_messages m JOIN orders o ON o.id = m.order_id
      LEFT JOIN order_reads r ON r.order_id = m.order_id AND r.pro_id = m.pro_id AND r.user_id = ?
      WHERE m.sender_id != ? AND m.kind = 'text' AND (o.client_id = ? OR m.pro_id = ?) AND m.created_at > COALESCE(r.read_at, '')`,
      userId, userId, userId, userId).n;
    let new_orders = 0;
    const pro = get('SELECT * FROM pros WHERE user_id = ?', userId);
    if (pro && pro.active) {
      new_orders = all("SELECT * FROM orders WHERE status = 'open' AND client_id != ?", userId)
        .filter((o) => proMatches(pro, o) && !get('SELECT 1 FROM quotes WHERE order_id = ? AND pro_id = ?', o.id, userId)).length;
    }
    return { quotes, chat, new_orders, total: quotes + chat + new_orders };
  }

  // ---------- detalle ----------
  const fullOrder = (o) => ({
    id: o.id, client_id: o.client_id, trade: o.trade, title: o.title, description: o.description, urgency: o.urgency,
    when_text: o.when_text, est_min: o.est_min, est_max: o.est_max, status: o.status, photos: parse(o.photos),
    created_at: o.created_at, updated_at: o.updated_at, finished_at: o.finished_at, accepted_pro_id: o.accepted_pro_id,
  });
  const proLite = (row, o) => {
    const p = proOut(row);
    return { id: p.id, name: p.name, trade: p.trade, photo: p.photo, avg_rating: p.avg_rating, review_count: p.review_count,
      verified: p.verified, years_exp: p.years_exp, price_hour: p.price_hour, insured: p.insured, invoice: p.invoice,
      distance_km: p.base_lat != null ? round1(haversineKm(o.lat, o.lng, p.base_lat, p.base_lng)) : null };
  };
  const unreadFor = (orderId, proId, userId) => get(`SELECT COUNT(*) AS n FROM order_messages m
    LEFT JOIN order_reads r ON r.order_id = m.order_id AND r.pro_id = m.pro_id AND r.user_id = ?
    WHERE m.order_id = ? AND m.pro_id = ? AND m.sender_id != ? AND m.kind = 'text' AND m.created_at > COALESCE(r.read_at, '')`,
    userId, orderId, proId, userId).n;

  app.get('/api/orders/:id', auth, async (req, res) => {
    const o = get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
    if (!o) return fail(res, 404, 'Pedido no encontrado');
    if (pay.mode !== 'off' && (o.client_id === req.user.id || o.accepted_pro_id === req.user.id)) { pay.ensureFor(o); await pay.sync(o.id); }

    if (o.client_id === req.user.id) {
      run("UPDATE quotes SET client_seen = 1 WHERE order_id = ? AND status = 'pending'", o.id);
      const proIds = [...new Set([
        ...all("SELECT pro_id FROM quotes WHERE order_id = ? AND status != 'withdrawn'", o.id).map((r) => r.pro_id),
        ...all('SELECT DISTINCT pro_id FROM order_messages WHERE order_id = ?', o.id).map((r) => r.pro_id),
      ])];
      const participants = proIds.map((pid) => {
        const row = get(`${PRO_SELECT} WHERE p.user_id = ?`, pid);
        if (!row) return null;
        const quote = get("SELECT * FROM quotes WHERE order_id = ? AND pro_id = ? AND status != 'withdrawn'", o.id, pid) || null;
        const last = get('SELECT body, created_at FROM order_messages WHERE order_id = ? AND pro_id = ? ORDER BY id DESC LIMIT 1', o.id, pid);
        return { pro: proLite(row, o), quote, unread: unreadFor(o.id, pid, req.user.id), last_message: last || null };
      }).filter(Boolean);
      return res.json({
        role: 'client',
        order: { ...fullOrder(o), address_label: o.address_label, address_detail: o.address_detail, lat: o.lat, lng: o.lng },
        participants,
        matching_pros: o.status === 'open' ? matchingProCount(o) : null,
        payment: pay.view(pay.getPayment(o.id), 'client'), pay_mode: pay.mode,
      });
    }

    const pro = get('SELECT * FROM pros WHERE user_id = ?', req.user.id);
    if (!pro || !(involved(o.id, req.user.id) || (o.status === 'open' && proMatches(pro, o))))
      return fail(res, 404, 'Pedido no encontrado');
    const mine = get('SELECT * FROM quotes WHERE order_id = ? AND pro_id = ?', o.id, req.user.id);
    const won = o.accepted_pro_id === req.user.id;
    const client = get('SELECT name FROM users WHERE id = ?', o.client_id);
    res.json({
      role: 'pro',
      order: {
        ...fullOrder(o), client_id: undefined, area: areaOf(o.address_label),
        lat: won ? o.lat : coarse(o.lat), lng: won ? o.lng : coarse(o.lng),
        address_label: won ? o.address_label : '', address_detail: won ? o.address_detail : '',
      },
      client_name: firstName(client?.name),
      distance_km: round1(haversineKm(o.lat, o.lng, pro.base_lat, pro.base_lng)),
      my_quote: mine && mine.status !== 'withdrawn' ? mine : null,
      withdrawn: !!mine && mine.status === 'withdrawn',
      can_quote: o.status === 'open' && (!mine || ['pending', 'withdrawn'].includes(mine.status)),
      won, unread: unreadFor(o.id, req.user.id, req.user.id),
      payment: won ? pay.view(pay.getPayment(o.id), 'pro') : null, pay_mode: pay.mode,
      payouts_ready: pay.payoutsReady(req.user.id), fee_pct: pay.feePct,
    });
  });

  // ---------- presupuestos ----------
  app.post('/api/orders/:id/quotes', auth, (req, res) => {
    const o = get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
    const pro = get('SELECT * FROM pros WHERE user_id = ?', req.user.id);
    if (!o || !pro || o.client_id === req.user.id) return fail(res, 404, 'Pedido no encontrado');
    if (o.status !== 'open') return fail(res, 409, 'Este pedido ya no admite presupuestos');
    if (!involved(o.id, req.user.id) && !proMatches(pro, o)) return fail(res, 403, 'Este pedido queda fuera de tu zona u oficio');
    if (!pay.payoutsReady(req.user.id)) return fail(res, 403, 'Configura tus cobros antes de enviar presupuestos');
    const amount = num(req.body.amount);
    if (amount == null || amount <= 0 || amount > 100000) return fail(res, 400, 'Indica un importe válido en euros');
    const prev = get('SELECT * FROM quotes WHERE order_id = ? AND pro_id = ?', o.id, req.user.id);
    if (prev && !['pending', 'withdrawn'].includes(prev.status)) return fail(res, 409, 'Tu presupuesto ya fue resuelto');
    const t = now();
    run(`INSERT INTO quotes (order_id, pro_id, amount, message, materials_included, visit_when, status, client_seen, created_at, updated_at)
      VALUES (?,?,?,?,?,?,'pending',0,?,?)
      ON CONFLICT(order_id, pro_id) DO UPDATE SET amount=excluded.amount, message=excluded.message,
        materials_included=excluded.materials_included, visit_when=excluded.visit_when, status='pending', client_seen=0, updated_at=excluded.updated_at`,
      o.id, req.user.id, Math.round(amount * 100) / 100, str(req.body.message, 1000).trim(), req.body.materials_included ? 1 : 0,
      str(req.body.visit_when, 120).trim(), t, t);
    run('UPDATE orders SET updated_at = ? WHERE id = ?', t, o.id);
    res.json({ ok: true });
  });

  app.post('/api/orders/:id/quotes/withdraw', auth, (req, res) => {
    const o = get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
    const q = o && get('SELECT * FROM quotes WHERE order_id = ? AND pro_id = ?', o.id, req.user.id);
    if (!q) return fail(res, 404, 'No tienes presupuesto en este pedido');
    if (o.status !== 'open' || q.status !== 'pending') return fail(res, 409, 'Ya no puedes retirar este presupuesto');
    run("UPDATE quotes SET status = 'withdrawn', updated_at = ? WHERE id = ?", now(), q.id);
    res.json({ ok: true });
  });

  function system(orderId, proId, senderId, body) {
    run("INSERT INTO order_messages (order_id, pro_id, sender_id, kind, body, created_at) VALUES (?,?,?,'system',?,?)",
      orderId, proId, senderId, body, now());
  }
  const ownOrder = (req, res) => {
    const o = get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
    if (!o || o.client_id !== req.user.id) { fail(res, 404, 'Pedido no encontrado'); return null; }
    return o;
  };

  app.post('/api/orders/:id/accept', auth, (req, res) => {
    const o = ownOrder(req, res); if (!o) return;
    if (o.status !== 'open') return fail(res, 409, 'Este pedido ya no está abierto');
    const q = get("SELECT * FROM quotes WHERE id = ? AND order_id = ? AND status = 'pending'", Number(req.body.quoteId), o.id);
    if (!q) return fail(res, 404, 'Presupuesto no disponible');
    const t = now();
    run("UPDATE quotes SET status = 'accepted', updated_at = ? WHERE id = ?", t, q.id);
    run("UPDATE quotes SET status = 'rejected', updated_at = ? WHERE order_id = ? AND id != ? AND status = 'pending'", t, o.id, q.id);
    run("UPDATE orders SET status = 'taken', accepted_quote_id = ?, accepted_pro_id = ?, updated_at = ? WHERE id = ?", q.id, q.pro_id, t, o.id);
    system(o.id, q.pro_id, req.user.id, `✅ Presupuesto de ${q.amount} € aceptado. Ya podéis coordinar el día y la hora por aquí.`);
    if (pay.mode !== 'off') pay.ensureFor(get('SELECT * FROM orders WHERE id = ?', o.id));
    res.json({ ok: true });
  });

  app.post('/api/orders/:id/cancel', auth, async (req, res) => {
    const o = ownOrder(req, res); if (!o) return;
    if (!['open', 'taken'].includes(o.status)) return fail(res, 409, 'Este pedido ya no se puede cancelar');
    const p = pay.getPayment(o.id);
    if (p && p.status === 'disputed') return fail(res, 409, 'El pedido tiene una reclamación abierta');
    if (p && p.status === 'held') {
      if (p.pro_done_at) return fail(res, 409, 'El profesional ya ha terminado: confirma el trabajo o abre una reclamación');
      try { await pay.refund(o.id, 'Pedido cancelado por el cliente'); } catch (e) { return fail(res, e.status || 500, e.status ? e.message : 'No se pudo reembolsar el pago'); }
    }
    run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", now(), o.id);
    if (o.accepted_pro_id) system(o.id, o.accepted_pro_id, req.user.id, '❌ El cliente ha cancelado el pedido.');
    res.json({ ok: true });
  });

  app.post('/api/orders/:id/finish', auth, async (req, res) => {
    const o = get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
    if (!o || (o.client_id !== req.user.id && o.accepted_pro_id !== req.user.id)) return fail(res, 404, 'Pedido no encontrado');
    if (o.status !== 'taken') return fail(res, 409, 'Solo se pueden finalizar los pedidos en curso');
    const p = pay.mode === 'off' ? null : pay.ensureFor(o);
    if (p) {
      try {
        await pay.sync(o.id);
        const cur = pay.getPayment(o.id);
        if (cur.status === 'pending') return fail(res, 409, 'Primero hay que pagar el pedido');
        if (cur.status === 'disputed') return fail(res, 409, 'El pedido tiene una reclamación abierta');
        if (cur.status !== 'held') return fail(res, 409, 'El pago ya no está retenido');
        if (o.client_id === req.user.id) await pay.release(o.id, 'client');
        else pay.markProDone(o);
        return res.json({ ok: true });
      } catch (e) { return fail(res, e.status || 500, e.status ? e.message : 'No se pudo completar la operación'); }
    }
    const t = now();
    run("UPDATE orders SET status = 'done', finished_at = ?, updated_at = ? WHERE id = ?", t, t, o.id);
    system(o.id, o.accepted_pro_id, req.user.id, '🏁 Trabajo marcado como finalizado.');
    res.json({ ok: true });
  });

  // ---------- chat del pedido (cliente ↔ profesional) ----------
  function thread(req, res) {
    const o = get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
    if (!o) { fail(res, 404, 'Pedido no encontrado'); return null; }
    let proId;
    if (o.client_id === req.user.id) {
      proId = Number(req.query.pro ?? req.body?.pro);
      if (!proId || !involved(o.id, proId)) { fail(res, 404, 'Conversación no encontrada'); return null; }
    } else {
      proId = req.user.id;
      const pro = get('SELECT * FROM pros WHERE user_id = ?', proId);
      if (!pro || !(involved(o.id, proId) || (o.status === 'open' && proMatches(pro, o)))) { fail(res, 404, 'Pedido no encontrado'); return null; }
    }
    const closed = o.status === 'cancelled' || (o.status !== 'open' && o.accepted_pro_id !== proId);
    return { o, proId, closed };
  }

  app.get('/api/orders/:id/chat', auth, (req, res) => {
    const th = thread(req, res); if (!th) return;
    const messages = all('SELECT id, sender_id, kind, body, created_at FROM order_messages WHERE order_id = ? AND pro_id = ? ORDER BY id', th.o.id, th.proId);
    run(`INSERT INTO order_reads (order_id, pro_id, user_id, read_at) VALUES (?,?,?,?)
      ON CONFLICT(order_id, pro_id, user_id) DO UPDATE SET read_at = excluded.read_at`, th.o.id, th.proId, req.user.id, now());
    res.json({ messages, closed: th.closed });
  });

  app.post('/api/orders/:id/chat', auth, (req, res) => {
    const th = thread(req, res); if (!th) return;
    if (th.closed) return fail(res, 409, 'Esta conversación está cerrada');
    const body = str(req.body.body, 2000).trim();
    if (!body) return fail(res, 400, 'Escribe un mensaje');
    run("INSERT INTO order_messages (order_id, pro_id, sender_id, kind, body, created_at) VALUES (?,?,?,'text',?,?)", th.o.id, th.proId, req.user.id, body, now());
    res.json({ ok: true });
  });

  return { badges };
};
