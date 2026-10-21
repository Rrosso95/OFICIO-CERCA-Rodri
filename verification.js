'use strict';
// Verificación documental de profesionales: el profesional sube su documento de identidad, su seguro de
// responsabilidad civil y, en los oficios regulados, su carné o habilitación. Un administrador los revisa y, si
// aprueba, el perfil pasa a «Verificado». Los archivos se guardan fuera de /public (DATA_DIR/private), solo los ve
// un administrador y se borran al revisarlos (VERIF_KEEP_DOCS=true para conservarlos).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const KINDS = {
  identity: 'Documento de identidad (DNI o NIE)',
  insurance: 'Seguro de responsabilidad civil',
  license: 'Carné o habilitación profesional',
};
const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_BYTES = 4 * 1024 * 1024;
const magicOk = (buf, mime) => ({
  'image/jpeg': () => buf[0] === 0xff && buf[1] === 0xd8,
  'image/png': () => buf.subarray(0, 4).toString('hex') === '89504e47',
  'image/webp': () => buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP',
  'application/pdf': () => buf.subarray(0, 4).toString() === '%PDF',
}[mime]?.() ?? false);

module.exports = function verificationModule(app, { db, auth, now, parse, dataDir, isAdmin, notify, isRegulated }) {
  const dir = path.join(dataDir, 'private', 'verificaciones');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  db.exec(`CREATE TABLE IF NOT EXISTS verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    docs TEXT NOT NULL DEFAULT '[]',
    note TEXT DEFAULT '',
    review_note TEXT DEFAULT '',
    reviewer_id INTEGER,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );`);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const fail = (res, code, error) => res.status(code).json({ error });
  // Identidad y seguro, más un carné por cada oficio regulado que haga el profesional
  const tradesOf = (pro) => [pro.trade, ...parse(pro.trades_extra)];
  const required = (pro) => [
    { kind: 'identity', label: KINDS.identity },
    { kind: 'insurance', label: KINDS.insurance },
    ...tradesOf(pro).filter(isRegulated).map((t) => ({ kind: `license:${t}`, label: `Carné o habilitación: ${t}` })),
  ];
  const removeFiles = (docs) => docs.forEach((d) => { if (d.file) fs.rm(path.join(dir, d.file), { force: true }, () => {}); });
  const latest = (userId) => get('SELECT * FROM verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1', userId);

  app.get('/api/verification/me', auth, (req, res) => {
    const pro = get('SELECT * FROM pros WHERE user_id = ?', req.user.id);
    if (!pro) return fail(res, 404, 'Primero crea tu perfil profesional');
    const v = latest(req.user.id);
    res.json({
      verified: !!pro.verified, trades: tradesOf(pro), required: required(pro),
      unverified_trades: tradesOf(pro).filter((t) => isRegulated(t) && !parse(pro.verified_trades).includes(t)),
      status: v?.status || null, review_note: v?.review_note || '', submitted_at: v?.created_at || null,
    });
  });

  app.post('/api/verification', auth, (req, res) => {
    const pro = get('SELECT * FROM pros WHERE user_id = ?', req.user.id);
    if (!pro) return fail(res, 404, 'Primero crea tu perfil profesional');
    const docs = Array.isArray(req.body?.docs) ? req.body.docs : [];
    const need = required(pro);
    const saved = [];
    try {
      for (const { kind, label } of need) {
        const d = docs.find((x) => x?.kind === kind);
        if (!d) throw Object.assign(new Error(`Falta: ${label}`), { code: 400 });
        const mime = String(d.mime || '');
        if (!MIME[mime]) throw Object.assign(new Error(`${label}: usa una foto (JPG, PNG, WEBP) o un PDF`), { code: 400 });
        const buf = Buffer.from(String(d.data || '').replace(/^data:[^,]*,/, ''), 'base64');
        if (!buf.length || buf.length > MAX_BYTES) throw Object.assign(new Error(`${label}: el archivo debe ocupar menos de 4 MB`), { code: 400 });
        if (!magicOk(buf, mime)) throw Object.assign(new Error(`${label}: el archivo no es válido`), { code: 400 });
        const file = `${req.user.id}-${crypto.randomBytes(16).toString('hex')}.${MIME[mime]}`;
        fs.writeFileSync(path.join(dir, file), buf, { mode: 0o600 });
        saved.push({ kind, label, name: String(d.name || label).slice(0, 120), mime, size: buf.length, file });
      }
    } catch (e) {
      removeFiles(saved);
      return fail(res, e.code || 500, e.code ? e.message : 'No se pudieron guardar los documentos');
    }
    const prev = get("SELECT * FROM verifications WHERE user_id = ? AND status = 'pending'", req.user.id);
    if (prev) { removeFiles(parse(prev.docs)); run('DELETE FROM verifications WHERE id = ?', prev.id); }
    run('INSERT INTO verifications (user_id, status, docs, note, created_at) VALUES (?,?,?,?,?)',
      req.user.id, 'pending', JSON.stringify(saved), String(req.body?.note || '').slice(0, 500), now());
    res.json({ ok: true });
  });

  // ---------- administración ----------
  const adminOnly = (req, res, next) => (isAdmin(req.user) ? next() : fail(res, 403, 'Solo para administración'));
  app.get('/api/admin/verifications', auth, adminOnly, (_req, res) => {
    const rows = all(`SELECT v.*, u.name, u.email, p.trade, p.trades_extra, p.license, p.verified FROM verifications v
      JOIN users u ON u.id = v.user_id LEFT JOIN pros p ON p.user_id = v.user_id
      ORDER BY CASE v.status WHEN 'pending' THEN 0 ELSE 1 END, v.id DESC LIMIT 100`);
    res.json(rows.map((v) => ({
      id: v.id, user_id: v.user_id, name: v.name, email: v.email, trade: v.trade, trades: [v.trade, ...parse(v.trades_extra)], license: v.license, status: v.status,
      note: v.note, review_note: v.review_note, created_at: v.created_at, reviewed_at: v.reviewed_at,
      docs: parse(v.docs).map((d, i) => ({ i, kind: d.kind, label: d.label || KINDS[d.kind] || d.kind, name: d.name, mime: d.mime, size: d.size, available: !!d.file })),
    })));
  });

  app.get('/api/admin/verifications/:id/doc/:i', auth, adminOnly, (req, res) => {
    const v = get('SELECT * FROM verifications WHERE id = ?', Number(req.params.id));
    const d = v && parse(v.docs)[Number(req.params.i)];
    if (!d?.file) return fail(res, 404, 'Documento no disponible');
    res.set({ 'Content-Type': d.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    fs.createReadStream(path.join(dir, d.file)).on('error', () => res.status(404).end()).pipe(res);
  });

  app.post('/api/admin/verifications/:id/review', auth, adminOnly, (req, res) => {
    const v = get('SELECT * FROM verifications WHERE id = ?', Number(req.params.id));
    if (!v || v.status !== 'pending') return fail(res, 409, 'Esta verificación ya está revisada');
    const action = req.body?.action, note = String(req.body?.note || '').trim().slice(0, 500);
    if (!['approve', 'reject'].includes(action)) return fail(res, 400, 'Acción no válida');
    if (action === 'reject' && note.length < 5) return fail(res, 400, 'Indica al profesional qué falta o qué está mal');
    let docs = parse(v.docs);
    if (process.env.VERIF_KEEP_DOCS !== 'true') { removeFiles(docs); docs = docs.map(({ file, ...d }) => d); }
    run('UPDATE verifications SET status = ?, review_note = ?, reviewer_id = ?, reviewed_at = ?, docs = ? WHERE id = ?',
      action === 'approve' ? 'approved' : 'rejected', note, req.user.id, now(), JSON.stringify(docs), v.id);
    if (action === 'approve') {
      const pro = get('SELECT trade, trades_extra FROM pros WHERE user_id = ?', v.user_id);
      run('UPDATE pros SET verified = 1, verified_trades = ? WHERE user_id = ?', JSON.stringify(pro ? tradesOf(pro) : []), v.user_id);
    }
    notify.notifyUser(v.user_id, action === 'approve' ? 'Tu perfil ya está verificado' : 'Revisa tu verificación',
      action === 'approve'
        ? ['Hemos revisado tus documentos y tu perfil ya muestra la insignia «Verificado».']
        : ['No hemos podido verificar tu perfil con los documentos enviados.', '', `Motivo: ${note}`, '', 'Puedes volver a enviarlos desde tu panel.'],
      '', '/#/panel');
    res.json({ ok: true });
  });

  return { KINDS };
};
