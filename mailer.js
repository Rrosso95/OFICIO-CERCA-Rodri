'use strict';
// Envío de emails por SMTP genérico (Resend, Brevo, Mailgun, Gmail...). Sin SMTP_HOST los emails no se envían:
// se guardan en la tabla email_log para poder verlos en desarrollo (GET /api/admin/emails).
const nodemailer = require('nodemailer');

module.exports = function createMailer({ db, now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);`);

  const host = process.env.SMTP_HOST || '';
  const from = process.env.SMTP_FROM || 'Oficio Cerca <no-reply@localhost>';
  const transport = host ? nodemailer.createTransport({
    host, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  }) : null;

  const log = (to, subject, body, status, error = null) =>
    db.prepare('INSERT INTO email_log (to_addr, subject, body, status, error, created_at) VALUES (?,?,?,?,?,?)').run(to, subject, body, status, error, now());

  // Nunca lanza: un fallo de email no debe romper la operación que lo origina
  async function send({ to, subject, text }) {
    try {
      if (!transport) { log(to, subject, text, 'logged'); return false; }
      await transport.sendMail({ from, to, subject, text });
      log(to, subject, text, 'sent');
      return true;
    } catch (e) {
      console.error('email:', e.message);
      try { log(to, subject, text, 'error', e.message); } catch { /* sin registro */ }
      return false;
    }
  }
  return { send, get mode() { return transport ? 'smtp' : 'log'; } };
};
