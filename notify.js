'use strict';
// Notificaciones a usuarios: email (respeta users.email_notifs) y notificaciones push web (si el usuario las activó
// en algún dispositivo). Nunca lanza: un fallo de aviso no debe romper la operación que lo origina.
// Claves VAPID: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT, o se generan y se guardan en la base de datos
// (en producción fíjalas por variable de entorno para que no cambien si la base de datos se recrea).

module.exports = function createNotifier({ db, mailer, now, webpush = require('web-push') }) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const firstName = (n) => String(n || '').split(' ')[0];

  // ---- claves VAPID ----
  const setting = (k) => get('SELECT value FROM app_settings WHERE key = ?', k)?.value;
  let pub = process.env.VAPID_PUBLIC_KEY || setting('vapid_public'), priv = process.env.VAPID_PRIVATE_KEY || setting('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey;
    run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_public', ?), ('vapid_private', ?)", pub, priv);
  }
  const subject = process.env.VAPID_SUBJECT || (process.env.PUBLIC_URL?.startsWith('https') ? process.env.PUBLIC_URL : 'mailto:avisos@oficiocerca.local');
  webpush.setVapidDetails(subject, pub, priv);

  const baseUrl = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const clip = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));

  async function push(userId, { title, body = '', url = '/' }) {
    for (const s of all('SELECT * FROM push_subs WHERE user_id = ?', userId)) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: clip(title, 80), body: clip(body, 140), url }), { TTL: 60 * 60 * 24 });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) run('DELETE FROM push_subs WHERE id = ?', s.id); // suscripción caducada
        else console.error('push:', e.statusCode || '', e.message);
      }
    }
  }

  // lines: texto del email (el primer párrafo se reutiliza en el push). url: ruta interna, p. ej. '/#/pedido/3'
  async function notifyUser(userId, subject, lines, base = '', url = '/') {
    try {
      const u = get('SELECT email, name, email_notifs FROM users WHERE id = ?', userId);
      if (!u) return;
      const b = (base || baseUrl()).replace(/\/$/, '');
      if (u.email_notifs !== 0) {
        await mailer.send({ to: u.email, subject, text: [`Hola ${firstName(u.name)},`, '', ...lines, '',
          `Ver en Oficio Cerca: ${b}${url}`, `Puedes desactivar estos avisos en tu cuenta: ${b}/#/panel`, 'Oficio Cerca'].join('\n') });
      }
      await push(userId, { title: subject, body: lines.find((l) => l && l.trim()) || '', url });
    } catch (e) { console.error('aviso:', e.message); }
  }

  function routes(app, auth) {
    app.get('/api/push/key', (_req, res) => res.json({ key: pub }));
    app.post('/api/push/subscribe', auth, (req, res) => {
      const s = req.body?.subscription;
      if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth || !/^https:\/\//.test(s.endpoint)) return res.status(400).json({ error: 'Suscripción no válida' });
      run(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
        req.user.id, String(s.endpoint).slice(0, 1000), String(s.keys.p256dh).slice(0, 200), String(s.keys.auth).slice(0, 100), now());
      res.json({ ok: true });
    });
    app.post('/api/push/unsubscribe', auth, (req, res) => {
      run('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?', String(req.body?.endpoint || ''), req.user.id);
      res.json({ ok: true });
    });
    app.get('/api/push/status', auth, (req, res) => res.json({ subscriptions: get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', req.user.id).n }));
  }

  return { notifyUser, push, routes, baseUrl, publicKey: pub };
};
