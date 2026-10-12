'use strict';
// Pago con retención (Stripe Connect, "separate charges and transfers").
//  1) El cliente paga el presupuesto aceptado a la plataforma (Stripe Checkout). El dinero queda retenido.
//  2) Al confirmar el cliente que el trabajo está hecho, se transfiere el neto al profesional (importe - comisión).
//     Si es el profesional quien lo marca como terminado, se libera solo pasadas RELEASE_HOURS horas salvo reclamación.
//  3) Si hay reclamación el pago queda congelado hasta que un administrador lo reembolse o lo libere.
// Modos: 'stripe' (STRIPE_SECRET_KEY), 'simulated' (flujo completo sin dinero real, para demo) y 'off' (sin pagos).

const FEE_PCT = Number(process.env.PLATFORM_FEE_PCT ?? 10);
const RELEASE_HOURS = Number(process.env.RELEASE_HOURS ?? 72);
const r2 = (n) => Math.round(n * 100) / 100;
const cents = (n) => Math.round(n * 100);

module.exports = function createPayments({ db, now, DEMO_MODE, notify = null }) {
  const key = process.env.STRIPE_SECRET_KEY || '';
  let mode = process.env.PAYMENTS_MODE || (key ? 'stripe' : DEMO_MODE ? 'simulated' : 'off');
  if (mode === 'stripe' && !key) { console.warn('PAYMENTS_MODE=stripe pero falta STRIPE_SECRET_KEY: pagos desactivados.'); mode = DEMO_MODE ? 'simulated' : 'off'; }
  // STRIPE_API_HOST/PORT/PROTOCOL solo sirven para probar contra un Stripe falso en local
  const stripeCfg = process.env.STRIPE_API_HOST ? { host: process.env.STRIPE_API_HOST, port: process.env.STRIPE_API_PORT, protocol: process.env.STRIPE_API_PROTOCOL || 'http' } : {};
  const stripe = mode === 'stripe' ? (require('stripe').default || require('stripe'))(key, stripeCfg) : null;
  const admins = (process.env.ADMIN_EMAILS || (DEMO_MODE ? 'admin@demo.com' : '')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL UNIQUE,
    client_id INTEGER NOT NULL,
    pro_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    fee REAL NOT NULL,
    net REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT NOT NULL,
    checkout_session_id TEXT,
    payment_intent_id TEXT,
    charge_id TEXT,
    transfer_id TEXT,
    refund_id TEXT,
    pro_done_at TEXT,
    release_at TEXT,
    dispute_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    paid_at TEXT,
    released_at TEXT
  );
  CREATE TABLE IF NOT EXISTS pro_payouts (
    user_id INTEGER PRIMARY KEY,
    stripe_account_id TEXT,
    ready INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );`);

  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const sys = (orderId, proId, senderId, body) =>
    run("INSERT INTO order_messages (order_id, pro_id, sender_id, kind, body, created_at) VALUES (?,?,?,'system',?,?)", orderId, proId, senderId, body, now());
  const eur = (n) => `${Number(n).toLocaleString('es-ES')} €`;
  const origin = (req) => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const isAdmin = (u) => !!u && admins.includes(String(u.email).toLowerCase());
  const title = (orderId) => get('SELECT title FROM orders WHERE id = ?', orderId)?.title || `pedido #${orderId}`;
  const tell = (userId, subject, lines, orderId) => { if (notify) notify.notifyUser(userId, subject, lines, '', `/#/pedido/${orderId}`); };

  const getPayment = (orderId) => get('SELECT * FROM payments WHERE order_id = ?', orderId) || null;

  // Crea (si no existe) el registro de pago de un pedido con presupuesto aceptado
  function ensureFor(order) {
    if (mode === 'off' || !order || !order.accepted_quote_id || !['taken', 'done'].includes(order.status)) return getPayment(order?.id);
    const ex = getPayment(order.id);
    if (ex) return ex;
    const q = get('SELECT * FROM quotes WHERE id = ?', order.accepted_quote_id);
    if (!q) return null;
    const amount = r2(q.amount), fee = r2((amount * FEE_PCT) / 100), t = now();
    run(`INSERT INTO payments (order_id, client_id, pro_id, amount, fee, net, status, provider, created_at, updated_at)
      VALUES (?,?,?,?,?,?, 'pending', ?, ?, ?)`, order.id, order.client_id, q.pro_id, amount, fee, r2(amount - fee), mode, t, t);
    return getPayment(order.id);
  }

  // Lo que ve cada parte (el cliente no necesita ver la comisión)
  function view(p, role) {
    if (!p) return null;
    const o = { status: p.status, amount: p.amount, provider: p.provider, paid_at: p.paid_at, released_at: p.released_at,
      pro_done_at: p.pro_done_at, release_at: p.release_at, dispute_reason: role === 'admin' || role === 'client' ? p.dispute_reason : undefined };
    if (role === 'pro' || role === 'admin') { o.fee = p.fee; o.net = p.net; }
    return o;
  }

  function markPaid(orderId, ids = {}) {
    const p = getPayment(orderId);
    if (!p || p.status !== 'pending') return p;
    const t = now();
    run(`UPDATE payments SET status = 'held', paid_at = ?, updated_at = ?, payment_intent_id = COALESCE(?, payment_intent_id) WHERE id = ?`, t, t, ids.payment_intent || null, p.id);
    sys(orderId, p.pro_id, p.client_id, `💳 Pago de ${eur(p.amount)} recibido y retenido. Se liberará al profesional cuando el cliente confirme que el trabajo está hecho.`);
    tell(p.pro_id, `Pago recibido: ya puedes empezar «${title(orderId)}»`, [`El cliente ha pagado ${eur(p.amount)}. Lo retenemos y te transferiremos ${eur(p.net)} cuando confirme que el trabajo está hecho.`], orderId);
    tell(p.client_id, `Pago de ${eur(p.amount)} recibido`, [`Hemos recibido tu pago para «${title(orderId)}». Lo retenemos hasta que confirmes que el trabajo está hecho.`], orderId);
    return getPayment(orderId);
  }

  // ---------- cobro ----------
  async function startCheckout(order, user, req) {
    const p = ensureFor(order);
    if (!p || p.status !== 'pending') throw Object.assign(new Error('Este pedido no tiene un pago pendiente'), { status: 409 });
    if (mode === 'simulated') return { simulated: true };
    const base = origin(req);
    const s = await stripe.checkout.sessions.create({
      mode: 'payment', customer_email: user.email,
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: cents(p.amount), product_data: { name: order.title, description: `Pedido #${order.id} en Oficio Cerca` } } }],
      payment_intent_data: { transfer_group: `order_${order.id}`, metadata: { order_id: String(order.id) } },
      metadata: { order_id: String(order.id) },
      success_url: `${base}/#/pedido/${order.id}?paid=1`, cancel_url: `${base}/#/pedido/${order.id}`,
    });
    run('UPDATE payments SET checkout_session_id = ?, updated_at = ? WHERE id = ?', s.id, now(), p.id);
    return { url: s.url };
  }

  // Sin webhook (p. ej. en local) se consulta a Stripe al abrir el pedido
  async function sync(orderId) {
    const p = getPayment(orderId);
    if (!stripe || !p || p.status !== 'pending' || !p.checkout_session_id) return p;
    try {
      const s = await stripe.checkout.sessions.retrieve(p.checkout_session_id);
      if (s.payment_status === 'paid') return markPaid(orderId, { payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id });
    } catch (e) { console.error('sync pago:', e.message); }
    return p;
  }

  // ---------- liberación, reembolso, reclamación ----------
  const finishOrder = (orderId) => run("UPDATE orders SET status = 'done', finished_at = ?, updated_at = ? WHERE id = ? AND status = 'taken'", now(), now(), orderId);

  async function release(orderId, by) {
    const p = getPayment(orderId);
    if (!p || !['held', 'disputed'].includes(p.status)) throw Object.assign(new Error('No hay un pago retenido que liberar'), { status: 409 });
    if (p.status === 'disputed' && by !== 'admin') throw Object.assign(new Error('El pago está en reclamación'), { status: 409 });
    let transferId = null;
    if (p.provider === 'stripe') {
      const dest = get('SELECT * FROM pro_payouts WHERE user_id = ?', p.pro_id);
      if (!dest?.stripe_account_id) throw Object.assign(new Error('El profesional aún no ha configurado sus cobros'), { status: 409 });
      let chargeId = p.charge_id;
      if (!chargeId) { const pi = await stripe.paymentIntents.retrieve(p.payment_intent_id); chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id; }
      const t = await stripe.transfers.create({ amount: cents(p.net), currency: 'eur', destination: dest.stripe_account_id, source_transaction: chargeId,
        transfer_group: `order_${orderId}`, metadata: { order_id: String(orderId) } }, { idempotencyKey: `release_${orderId}` });
      transferId = t.id;
      run('UPDATE payments SET charge_id = ? WHERE id = ?', chargeId, p.id);
    } else transferId = `sim_tr_${orderId}`;
    const t = now();
    run("UPDATE payments SET status = 'released', transfer_id = ?, released_at = ?, updated_at = ? WHERE id = ?", transferId, t, t, p.id);
    finishOrder(orderId);
    sys(orderId, p.pro_id, p.client_id, `✅ Pago liberado al profesional (${eur(p.net)} tras la comisión de la plataforma). ¡Trabajo finalizado!`);
    tell(p.pro_id, `Te hemos transferido ${eur(p.net)}`, [`El pago de «${title(orderId)}» se ha liberado: ${eur(p.amount)} menos la comisión de ${eur(p.fee)}. Puede tardar unos días en llegar a tu banco.`], orderId);
    if (by !== 'client') tell(p.client_id, `Trabajo finalizado: «${title(orderId)}»`, [by === 'auto' ? 'Ha pasado el plazo sin reclamaciones, así que hemos liberado el pago al profesional.' : 'Hemos resuelto la reclamación liberando el pago al profesional.', '¿Qué tal fue? Puedes dejarle una reseña.'], orderId);
    return getPayment(orderId);
  }

  async function refund(orderId, reason = 'Reembolso') {
    const p = getPayment(orderId);
    if (!p || !['held', 'disputed'].includes(p.status)) throw Object.assign(new Error('No hay un pago que reembolsar'), { status: 409 });
    let refundId = `sim_re_${orderId}`;
    if (p.provider === 'stripe') {
      const r = await stripe.refunds.create({ payment_intent: p.payment_intent_id, metadata: { order_id: String(orderId) } }, { idempotencyKey: `refund_${orderId}` });
      refundId = r.id;
    }
    run("UPDATE payments SET status = 'refunded', refund_id = ?, updated_at = ? WHERE id = ?", refundId, now(), p.id);
    sys(orderId, p.pro_id, p.client_id, `↩️ ${reason}: se han devuelto ${eur(p.amount)} al cliente.`);
    tell(p.client_id, `Reembolso de ${eur(p.amount)}`, [`${reason}: te hemos devuelto ${eur(p.amount)} de «${title(orderId)}». Puede tardar de 5 a 10 días en aparecer en tu cuenta.`], orderId);
    tell(p.pro_id, `Pago reembolsado al cliente: «${title(orderId)}»`, [`${reason}. El pago de ${eur(p.amount)} se ha devuelto al cliente.`], orderId);
    return getPayment(orderId);
  }

  function markProDone(order) {
    const p = getPayment(order.id);
    if (!p || p.status !== 'held') throw Object.assign(new Error('El pago aún no está retenido'), { status: 409 });
    if (p.pro_done_at) throw Object.assign(new Error('Ya has marcado el trabajo como terminado'), { status: 409 });
    const t = now(), at = new Date(Date.now() + RELEASE_HOURS * 3600 * 1000).toISOString();
    run('UPDATE payments SET pro_done_at = ?, release_at = ?, updated_at = ? WHERE id = ?', t, at, t, p.id);
    sys(order.id, p.pro_id, p.pro_id, `🏁 El profesional ha marcado el trabajo como terminado. El cliente puede confirmarlo o reclamar; si no hay reclamación, el pago se liberará automáticamente el ${new Date(at).toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`);
    tell(p.client_id, `¿Está terminado «${order.title}»?`, [`El profesional ha marcado el trabajo como terminado. Confírmalo o abre una reclamación; si no, el pago se liberará automáticamente el ${new Date(at).toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`], order.id);
    return getPayment(order.id);
  }

  function dispute(order, reason) {
    const p = getPayment(order.id);
    if (!p || p.status !== 'held') throw Object.assign(new Error('Solo se puede reclamar sobre un pago retenido'), { status: 409 });
    run("UPDATE payments SET status = 'disputed', dispute_reason = ?, updated_at = ? WHERE id = ?", String(reason).slice(0, 1000), now(), p.id);
    sys(order.id, p.pro_id, p.client_id, '⚠️ El cliente ha abierto una reclamación. El pago queda congelado hasta que lo revise el equipo de Oficio Cerca.');
    tell(p.pro_id, `Reclamación abierta en «${order.title}»`, ['El cliente ha abierto una reclamación y el pago queda congelado hasta que la revisemos. Te contactaremos si necesitamos tu versión.'], order.id);
    for (const a of all(`SELECT id FROM users WHERE lower(email) IN (${admins.map(() => '?').join(',') || "''"})`, ...admins)) {
      if (notify) notify.notifyUser(a.id, `Nueva reclamación: pedido #${order.id}`, [`Motivo: ${String(reason).slice(0, 300)}`], '', '/#/admin');
    }
    return getPayment(order.id);
  }

  async function autoRelease() {
    const due = all("SELECT order_id FROM payments WHERE status = 'held' AND release_at IS NOT NULL AND release_at <= ?", now());
    for (const d of due) { try { await release(d.order_id, 'auto'); } catch (e) { console.error('liberación automática pedido', d.order_id, e.message); } }
  }
  if (mode !== 'off') { setInterval(autoRelease, Number(process.env.AUTO_RELEASE_MINUTES ?? 10) * 60 * 1000).unref(); }

  // ---------- cobros del profesional (Stripe Connect Express) ----------
  async function refreshPayouts(userId) {
    const row = get('SELECT * FROM pro_payouts WHERE user_id = ?', userId);
    if (!stripe || !row?.stripe_account_id) return row;
    const a = await stripe.accounts.retrieve(row.stripe_account_id);
    const ready = a.details_submitted && a.payouts_enabled && a.capabilities?.transfers === 'active' ? 1 : 0;
    run('UPDATE pro_payouts SET ready = ?, updated_at = ? WHERE user_id = ?', ready, now(), userId);
    return get('SELECT * FROM pro_payouts WHERE user_id = ?', userId);
  }
  const payoutsReady = (userId) => mode !== 'stripe' || !!get('SELECT 1 FROM pro_payouts WHERE user_id = ? AND ready = 1', userId);

  // ---------- webhook de Stripe (necesita el cuerpo sin parsear) ----------
  async function webhook(req, res) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) return res.status(501).send('Webhook no configurado');
    let ev;
    try { ev = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret); }
    catch { return res.status(400).send('Firma no válida'); }
    try {
      if (ev.type === 'checkout.session.completed' && ev.data.object.payment_status === 'paid') {
        const s = ev.data.object;
        markPaid(Number(s.metadata?.order_id), { payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id });
      } else if (ev.type === 'account.updated') {
        const row = get('SELECT user_id FROM pro_payouts WHERE stripe_account_id = ?', ev.data.object.id);
        if (row) await refreshPayouts(row.user_id);
      }
    } catch (e) { console.error('webhook:', e.message); return res.status(500).send('error'); }
    res.json({ received: true });
  }

  // ---------- rutas ----------
  function routes(app, auth) {
    const fail = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo completar la operación' });
    const orderOf = (id) => get('SELECT * FROM orders WHERE id = ?', Number(id));
    const adminOnly = (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'Solo para administración' }));

    app.get('/api/pay/status', auth, async (req, res) => {
      try {
        const row = mode === 'stripe' ? await refreshPayouts(req.user.id) : null;
        res.json({ mode, fee_pct: FEE_PCT, release_hours: RELEASE_HOURS, ready: mode !== 'stripe' || !!row?.ready, started: !!row?.stripe_account_id });
      } catch (e) { fail(res, e); }
    });

    app.post('/api/pay/connect', auth, async (req, res) => {
      if (mode !== 'stripe') return res.json({ mode, ready: true });
      try {
        let row = get('SELECT * FROM pro_payouts WHERE user_id = ?', req.user.id);
        if (!row?.stripe_account_id) {
          const a = await stripe.accounts.create({ type: 'express', country: 'ES', email: req.user.email, business_type: 'individual',
            capabilities: { transfers: { requested: true } }, metadata: { user_id: String(req.user.id) } });
          run(`INSERT INTO pro_payouts (user_id, stripe_account_id, ready, updated_at) VALUES (?,?,0,?)
            ON CONFLICT(user_id) DO UPDATE SET stripe_account_id = excluded.stripe_account_id, updated_at = excluded.updated_at`, req.user.id, a.id, now());
          row = get('SELECT * FROM pro_payouts WHERE user_id = ?', req.user.id);
        }
        const base = origin(req);
        const link = await stripe.accountLinks.create({ account: row.stripe_account_id, type: 'account_onboarding',
          refresh_url: `${base}/#/cobros?refresh=1`, return_url: `${base}/#/cobros?return=1` });
        res.json({ url: link.url });
      } catch (e) { console.error('connect:', e.message); fail(res, e); }
    });

    app.post('/api/pay/dashboard', auth, async (req, res) => {
      try {
        const row = get('SELECT * FROM pro_payouts WHERE user_id = ?', req.user.id);
        if (mode !== 'stripe' || !row?.stripe_account_id) return res.status(409).json({ error: 'Aún no has configurado tus cobros' });
        res.json({ url: (await stripe.accounts.createLoginLink(row.stripe_account_id)).url });
      } catch (e) { fail(res, e); }
    });

    app.post('/api/orders/:id/pay', auth, async (req, res) => {
      const o = orderOf(req.params.id);
      if (mode === 'off' || !o || o.client_id !== req.user.id) return res.status(404).json({ error: 'Pedido no encontrado' });
      try { res.json({ mode, ...(await startCheckout(o, req.user, req)) }); } catch (e) { fail(res, e); }
    });

    app.post('/api/orders/:id/pay/confirm-simulated', auth, (req, res) => {
      const o = orderOf(req.params.id);
      if (mode !== 'simulated' || !o || o.client_id !== req.user.id) return res.status(404).json({ error: 'Pedido no encontrado' });
      const p = ensureFor(o);
      if (!p || p.status !== 'pending') return res.status(409).json({ error: 'Este pedido no tiene un pago pendiente' });
      markPaid(o.id); res.json({ ok: true });
    });

    app.post('/api/orders/:id/dispute', auth, (req, res) => {
      const o = orderOf(req.params.id);
      if (!o || o.client_id !== req.user.id) return res.status(404).json({ error: 'Pedido no encontrado' });
      const reason = String(req.body?.reason || '').trim();
      if (reason.length < 10) return res.status(400).json({ error: 'Cuéntanos qué ha pasado (mínimo 10 caracteres)' });
      try { dispute(o, reason); res.json({ ok: true }); } catch (e) { fail(res, e); }
    });

    app.get('/api/admin/payments', auth, adminOnly, (_req, res) => {
      const rows = all(`SELECT p.*, o.title, cu.name AS client_name, pu.name AS pro_name FROM payments p
        JOIN orders o ON o.id = p.order_id JOIN users cu ON cu.id = p.client_id JOIN users pu ON pu.id = p.pro_id
        ORDER BY CASE p.status WHEN 'disputed' THEN 0 WHEN 'held' THEN 1 ELSE 2 END, p.updated_at DESC LIMIT 100`);
      res.json(rows.map((p) => ({ ...view(p, 'admin'), order_id: p.order_id, title: p.title, client_name: p.client_name, pro_name: p.pro_name })));
    });

    app.post('/api/admin/orders/:id/resolve', auth, adminOnly, async (req, res) => {
      const id = Number(req.params.id);
      try {
        if (req.body?.action === 'refund') await refund(id, 'Reclamación resuelta a favor del cliente');
        else if (req.body?.action === 'release') await release(id, 'admin');
        else return res.status(400).json({ error: 'Acción no válida' });
        if (req.body.action === 'refund') run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('taken','done')", now(), id);
        res.json({ ok: true });
      } catch (e) { fail(res, e); }
    });
  }

  return { get mode() { return mode; }, feePct: FEE_PCT, releaseHours: RELEASE_HOURS, isAdmin, getPayment, ensureFor, view, sync, markPaid,
    release, refund, markProDone, dispute, payoutsReady, webhook, routes, autoRelease };
};
