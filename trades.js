'use strict';
// Oficios: la lista base más los que proponen los profesionales. Un oficio propuesto queda «pendiente» hasta que un
// administrador lo aprueba (y decide si exige carné); al aprobarlo entra en la lista común y se añade al perfil de quien
// lo propuso. También detecta oficios a partir del texto del perfil y marca qué oficios son regulados (piden carné).

const BASE_REGULATED = ['Gasista', 'Electricista', 'Climatización'];
const plain = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

module.exports = function tradesModule(app, { db, auth, TRADES, now, parse, isAdmin, notify, detectTrades }) {
  db.exec(`CREATE TABLE IF NOT EXISTS custom_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    status TEXT NOT NULL DEFAULT 'pending',
    regulated INTEGER NOT NULL DEFAULT 0,
    requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );`);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const fail = (res, code, error) => res.status(code).json({ error });

  // Migración: oficios ya verificados (para no pedir otra vez el carné a quien ya pasó la revisión)
  if (!db.prepare('PRAGMA table_info(pros)').all().some((c) => c.name === 'verified_trades')) {
    db.exec("ALTER TABLE pros ADD COLUMN verified_trades TEXT NOT NULL DEFAULT '[]'");
    for (const p of all('SELECT user_id, trade, trades_extra FROM pros WHERE verified = 1')) {
      run('UPDATE pros SET verified_trades = ? WHERE user_id = ?', JSON.stringify([p.trade, ...parse(p.trades_extra)]), p.user_id);
    }
  }
  // Los oficios aprobados se suman a la lista común (TRADES es la misma lista que usan pedidos, búsqueda y asistente)
  for (const t of all("SELECT name FROM custom_trades WHERE status = 'approved'")) if (!TRADES.includes(t.name)) TRADES.push(t.name);

  const isRegulated = (t) => BASE_REGULATED.includes(t) || !!get("SELECT 1 FROM custom_trades WHERE name = ? AND status = 'approved' AND regulated = 1", t);
  const admins = () => all('SELECT id, email FROM users').filter(isAdmin);

  // «Fontanero» o «Plomero» ya existen como «Plomero / Fontanero»: se reutiliza el existente
  function existing(name) {
    const n = plain(name);
    return TRADES.find((t) => plain(t) === n || plain(t).split(/[\s/]+/).filter(Boolean).includes(n)) || null;
  }
  const clean = (v) => {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  };

  app.get('/api/trades/info', auth, (req, res) => {
    res.json({
      trades: TRADES, regulated: TRADES.filter(isRegulated),
      mine: all('SELECT name, status, review_note FROM custom_trades WHERE requested_by = ? AND status != ? ORDER BY id DESC LIMIT 10', req.user.id, 'approved'),
    });
  });

  app.post('/api/trades/detect', auth, (req, res) => {
    const text = String(req.body?.text || '').slice(0, 4000);
    res.json({ trades: text.length < 8 ? [] : detectTrades(text, TRADES) });
  });

  app.post('/api/trades/propose', auth, (req, res) => {
    const name = clean(req.body?.name);
    if (!/^[\p{L}][\p{L}\s/.-]{2,39}$/u.test(name)) return fail(res, 400, 'Escribe el nombre del oficio (3 a 40 letras)');
    const known = existing(name);
    if (known) return res.json({ ok: true, exists: true, trade: known });
    const dup = get('SELECT * FROM custom_trades WHERE name = ?', name);
    if (dup) {
      if (dup.status === 'rejected') return fail(res, 409, 'Este oficio ya se revisó y no se ha aceptado');
      return res.json({ ok: true, pending: true, already: true, name: dup.name });
    }
    if (get("SELECT COUNT(*) AS n FROM custom_trades WHERE requested_by = ? AND status = 'pending'", req.user.id).n >= 3)
      return fail(res, 429, 'Ya tienes 3 oficios pendientes de revisión. Espera a que los revisemos');
    run('INSERT INTO custom_trades (name, requested_by, created_at) VALUES (?,?,?)', name, req.user.id, now());
    for (const a of admins()) notify.notifyUser(a.id, `Nuevo oficio propuesto: ${name}`, [`${req.user.name} propone añadir el oficio «${name}». Revísalo en Administración → Oficios.`], '', '/#/admin?tab=oficios');
    res.json({ ok: true, pending: true, name });
  });

  // ---------- administración ----------
  const adminOnly = (req, res, next) => (isAdmin(req.user) ? next() : fail(res, 403, 'Solo para administración'));
  app.get('/api/admin/trades', auth, adminOnly, (_req, res) => {
    res.json(all(`SELECT c.id, c.name, c.status, c.regulated, c.review_note, c.created_at, u.name AS requester, u.email
      FROM custom_trades c JOIN users u ON u.id = c.requested_by
      ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.id DESC LIMIT 100`));
  });

  app.post('/api/admin/trades/:id/review', auth, adminOnly, (req, res) => {
    const c = get('SELECT * FROM custom_trades WHERE id = ?', Number(req.params.id));
    if (!c || c.status !== 'pending') return fail(res, 409, 'Este oficio ya está revisado');
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (req.body?.action === 'reject') {
      if (note.length < 5) return fail(res, 400, 'Indica el motivo para avisar al profesional');
      run("UPDATE custom_trades SET status = 'rejected', review_note = ?, reviewed_at = ? WHERE id = ?", note, now(), c.id);
      notify.notifyUser(c.requested_by, `No hemos podido añadir el oficio «${c.name}»`, [`Motivo: ${note}`, 'Puedes elegir uno de la lista o proponer otro.'], '', '/#/panel');
      return res.json({ ok: true });
    }
    if (req.body?.action !== 'approve') return fail(res, 400, 'Acción no válida');
    const regulated = req.body.regulated ? 1 : 0;
    run("UPDATE custom_trades SET status = 'approved', regulated = ?, reviewed_at = ? WHERE id = ?", regulated, now(), c.id);
    if (!TRADES.includes(c.name)) TRADES.push(c.name);
    const pro = get('SELECT * FROM pros WHERE user_id = ?', c.requested_by);
    if (pro && pro.trade !== c.name && !parse(pro.trades_extra).includes(c.name)) {
      run('UPDATE pros SET trades_extra = ? WHERE user_id = ?', JSON.stringify([...parse(pro.trades_extra), c.name]), c.requested_by);
      // Si el oficio exige carné y su perfil ya estaba verificado, hay que verificarlo de nuevo con ese carné
      if (regulated && pro.verified) run('UPDATE pros SET verified = 0 WHERE user_id = ?', c.requested_by);
    }
    notify.notifyUser(c.requested_by, `Ya puedes usar el oficio «${c.name}»`, [
      `Hemos añadido «${c.name}» a la lista de oficios${pro ? ' y a tu perfil' : ''}.`,
      ...(regulated ? ['Este oficio requiere carné o habilitación: súbelo en «Verificación» para que tu perfil aparezca como verificado.'] : [])], '', '/#/panel');
    res.json({ ok: true });
  });

  // Perfiles verificados sin oficios revisados registrados (p. ej. los de demostración recién sembrados)
  const backfill = () => {
    for (const p of all("SELECT user_id, trade, trades_extra FROM pros WHERE verified = 1 AND verified_trades = '[]'"))
      run('UPDATE pros SET verified_trades = ? WHERE user_id = ?', JSON.stringify([p.trade, ...parse(p.trades_extra)]), p.user_id);
  };
  backfill();

  return { isRegulated, BASE_REGULATED, backfill };
};
