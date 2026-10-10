/** Account routes: register, login, logout, profile, password reset/change, sessions, API keys, deletion. */
import crypto from 'node:crypto';
import { db, now, newId } from '../lib/db.js';
import { config, LIMITS } from '../lib/config.js';
import { HttpError, json, jsonBody, setCookie, rateLimit, clientIp } from '../lib/http.js';
import { hashPassword, verifyPassword, validatePassword, createSession, requireUser, publicUser, createApiKey } from '../lib/auth.js';
import { sendMail } from '../lib/mail.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const login = (req, res, user) => {
  const { token, ttl } = createSession(user, req);
  setCookie(res, 'jx_session', token, { maxAge: ttl });
  return json(res, { user: publicUser(user) });
};

export function authRoutes(r) {
  r.post('/api/auth/register', async (req, res) => {
    rateLimit(`reg:${clientIp(req)}`, 10, 3600e3);
    const { email, password, name } = await jsonBody(req);
    const e = String(email || '').trim().toLowerCase();
    if (!EMAIL.test(e)) throw new HttpError(400, 'Enter a valid email address.');
    validatePassword(password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(e)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    const user = { id: newId('u_'), email: e, name: String(name || e.split('@')[0]).slice(0, 80), pass_hash: await hashPassword(password), token_version: 0, created_at: now() };
    db.prepare('INSERT INTO users (id, email, name, pass_hash, token_version, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, user.email, user.name, user.pass_hash, 0, user.created_at);
    return login(req, res, db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  });

  r.post('/api/auth/login', async (req, res) => {
    const { email, password } = await jsonBody(req);
    const e = String(email || '').trim().toLowerCase();
    rateLimit(`login:${clientIp(req)}`, 20, 900e3); rateLimit(`login:${e}`, 8, 900e3);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(e);
    // Same message either way: don't reveal which emails are registered
    if (!user || !(await verifyPassword(String(password || ''), user.pass_hash))) throw new HttpError(401, 'Email or password is incorrect.');
    return login(req, res, user);
  });

  r.post('/api/auth/logout', async (req, res) => {
    const a = requireUser(req);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(a.sid);
    setCookie(res, 'jx_session', '', { maxAge: 0 });
    return json(res, { ok: true });
  });

  r.get('/api/auth/me', async (req, res) => {
    const a = req.auth; if (!a) return json(res, { user: null });
    return json(res, { user: publicUser(a.user) });
  });

  r.patch('/api/auth/me', async (req, res) => {
    const { user } = requireUser(req); const { name } = await jsonBody(req);
    if (name != null) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).slice(0, 80), user.id);
    return json(res, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
  });

  r.post('/api/auth/password', async (req, res) => {
    const { user, sid } = requireUser(req); const { current, next } = await jsonBody(req);
    if (!(await verifyPassword(String(current || ''), user.pass_hash))) throw new HttpError(401, 'Your current password is incorrect.');
    validatePassword(next);
    db.prepare('UPDATE users SET pass_hash = ?, token_version = token_version + 1 WHERE id = ?').run(await hashPassword(next), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, sid);
    return login(req, res, db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)); // fresh token for this device
  });

  r.post('/api/auth/forgot', async (req, res) => {
    rateLimit(`forgot:${clientIp(req)}`, 5, 3600e3);
    const { email } = await jsonBody(req);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(crypto.createHash('sha256').update(token).digest('hex'), user.id, now() + 3600e3);
      const link = `${config.publicUrl}/#reset-${token}`;
      await sendMail({ to: user.email, subject: 'Reset your JARVIS-X password', text: `Use this link within one hour to choose a new password:\n\n${link}\n\nIf you didn't ask for this, ignore this email.` }).catch((e) => console.error(e));
    }
    return json(res, { ok: true }); // always OK: no account enumeration
  });

  r.post('/api/auth/reset', async (req, res) => {
    const { token, password } = await jsonBody(req);
    validatePassword(password);
    const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
    const row = db.prepare('SELECT * FROM resets WHERE token_hash = ?').get(hash);
    if (!row || row.expires_at < now()) throw new HttpError(400, 'This reset link is invalid or has expired.');
    db.prepare('DELETE FROM resets WHERE user_id = ?').run(row.user_id);
    db.prepare('UPDATE users SET pass_hash = ?, token_version = token_version + 1 WHERE id = ?').run(await hashPassword(password), row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    return login(req, res, db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id));
  });

  // Sessions / devices
  r.get('/api/auth/sessions', async (req, res) => {
    const { user, sid } = requireUser(req);
    const rows = db.prepare('SELECT id, device, ip, created_at, last_seen FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC').all(user.id, now());
    return json(res, { sessions: rows.map((s) => ({ ...s, current: s.id === sid })), limit: LIMITS.devices });
  });
  r.delete('/api/auth/sessions/:id', async (req, res) => {
    const { user } = requireUser(req);
    db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
    return json(res, { ok: true });
  });
  r.post('/api/auth/sessions/revoke-others', async (req, res) => {
    const { user, sid } = requireUser(req);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, sid);
    return json(res, { ok: true });
  });

  // Account deletion (GDPR-style): removes user and all owned rows (FK cascade)
  r.post('/api/auth/delete', async (req, res) => {
    const { user } = requireUser(req); const { password } = await jsonBody(req);
    if (!(await verifyPassword(String(password || ''), user.pass_hash))) throw new HttpError(401, 'Password is incorrect.');
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    setCookie(res, 'jx_session', '', { maxAge: 0 });
    return json(res, { ok: true });
  });

  // Developer API keys (Master)
  r.get('/api/keys', async (req, res) => {
    const { user } = requireUser(req);
    return json(res, { keys: db.prepare('SELECT id, prefix, name, created_at, last_used FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(user.id) });
  });
  r.post('/api/keys', async (req, res) => {
    const { user } = requireUser(req);
    const n = db.prepare('SELECT COUNT(*) c FROM api_keys WHERE user_id = ?').get(user.id).c;
    if (n >= LIMITS.apiKeys) throw new HttpError(400, `You can have up to ${LIMITS.apiKeys} API keys. Revoke one first.`);
    const { name } = await jsonBody(req);
    return json(res, { key: createApiKey(user.id, String(name || 'API key').slice(0, 60)) }, 201);
  });
  r.delete('/api/keys/:id', async (req, res) => {
    const { user } = requireUser(req);
    db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
    return json(res, { ok: true });
  });
}
