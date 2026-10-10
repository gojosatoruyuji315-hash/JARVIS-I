/**
 * Authentication: scrypt password hashing, HS256 JWT sessions in an httpOnly
 * cookie (also accepted as Bearer), per-device session rows for revocation,
 * API keys for the developer API, and entitlement resolution.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db, now, newId } from './db.js';
import { config, LIMITS } from './config.js';
import { HttpError, parseCookies } from './http.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [, s, k] = stored.split('$');
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(s, 'base64'), 64, SCRYPT);
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.');
  if (pw.length > 200) throw new HttpError(400, 'Password is too long.');
}

/* --------------------------------------------------------------------- JWT */
const b64u = (b) => Buffer.from(b).toString('base64url');
export function signJwt(payload, ttlMs) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: Math.floor(now() / 1000), exp: Math.floor((now() + ttlMs) / 1000) }));
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export function verifyJwt(token) {
  const [head, body, sig] = String(token || '').split('.');
  if (!sig) return null;
  const want = crypto.createHmac('sha256', config.jwtSecret).update(`${head}.${body}`).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp * 1000 > now() ? p : null;
}

/* ---------------------------------------------------------------- sessions */
export function createSession(user, req) {
  const ttl = config.sessionDays * 864e5;
  const sid = newId('s_');
  const ua = String(req.headers['user-agent'] || '');
  const device = `${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'} on ${/Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS'}`;
  db.prepare('INSERT INTO sessions (id, user_id, device, ip, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(sid, user.id, device, req.socket.remoteAddress || '', now(), now(), now() + ttl);
  // Enforce the plan's device limit: drop the oldest sessions beyond it
  const max = LIMITS.devices;
  const extra = db.prepare('SELECT id FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT -1 OFFSET ?').all(user.id, max);
  for (const r of extra) db.prepare('DELETE FROM sessions WHERE id = ?').run(r.id);
  return { token: signJwt({ sub: user.id, sid, ver: user.token_version }, ttl), ttl };
}

/** Resolve the caller from cookie or Bearer token. Returns { user, sid } or null. */
export function authenticate(req) {
  const bearer = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer?.startsWith('jxk_')) return authenticateApiKey(bearer);
  const token = bearer || parseCookies(req).jx_session;
  const p = verifyJwt(token); if (!p) return null;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(p.sub);
  if (!user || user.token_version !== p.ver) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(p.sid, user.id);
  if (!s || s.expires_at < now()) return null;
  if (now() - s.last_seen > 60e3) db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now(), s.id);
  return { user, sid: s.id };
}
export function requireUser(req) {
  const a = req.auth ?? authenticate(req);
  if (!a) throw new HttpError(401, 'Please sign in.');
  return a;
}

/* ---------------------------------------------------------------- API keys */
export function createApiKey(userId, name) {
  const raw = 'jxk_' + crypto.randomBytes(24).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  db.prepare('INSERT INTO api_keys (id, user_id, prefix, hash, name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(newId('k_'), userId, raw.slice(0, 10), hash, name || 'API key', now());
  return raw; // shown once
}
function authenticateApiKey(raw) {
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const k = db.prepare('SELECT * FROM api_keys WHERE hash = ?').get(hash); if (!k) return null;
  db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(now(), k.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(k.user_id);
  return user ? { user, apiKey: k.id } : null;
}

/* ------------------------------------------------------------------ users */
/** JARVIS-X is free: every account has every feature. */
export const entitlement = () => ({ plan: 'free' });
export const requirePlan = () => ({ plan: 'free' });
export function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, emailVerified: !!u.email_verified, created: u.created_at, plan: 'free' };
}
