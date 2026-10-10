/**
 * SQLite persistence (node:sqlite, built into Node ≥ 22.13).
 * Schema migrations are applied idempotently at startup.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, config } from './config.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'jarvis-x.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL, token_version INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  trial_used INTEGER NOT NULL DEFAULT 0, customer_id TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT NOT NULL DEFAULT '', ip TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free', cycle TEXT, status TEXT NOT NULL DEFAULT 'active',
  provider TEXT, provider_sub_id TEXT, current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subs_provider ON subscriptions(provider_sub_id);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, provider_ref TEXT, amount INTEGER, currency TEXT, plan TEXT, cycle TEXT,
  status TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_ref ON payments(provider, provider_ref);
CREATE TABLE IF NOT EXISTS events (           -- processed webhook ids (idempotency) + audit
  id TEXT PRIMARY KEY, provider TEXT, type TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vaults (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data BLOB NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  user_id TEXT NOT NULL, day TEXT NOT NULL, ai INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, name TEXT, created_at INTEGER NOT NULL, last_used INTEGER
);
CREATE TABLE IF NOT EXISTS resets (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
`);

export const now = () => Date.now();
export const newId = (p = '') => p + crypto.randomBytes(12).toString('base64url');
export const today = () => new Date().toISOString().slice(0, 10);

/* ----------------------------------------------------------- vault crypto */
/** Vault contents are encrypted at rest with AES-256-GCM (key from VAULT_SECRET). */
export function sealVault(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', config.vaultKey, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
export function openVault(buf) {
  const b = Buffer.from(buf);
  const d = crypto.createDecipheriv('aes-256-gcm', config.vaultKey, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}
export function getVault(userId) {
  const row = db.prepare('SELECT data, version, updated_at FROM vaults WHERE user_id = ?').get(userId);
  return row ? { state: openVault(row.data), version: row.version, updatedAt: row.updated_at } : null;
}
/** Optimistic write. Returns { ok, version } or { ok:false, current } on conflict. */
export function putVault(userId, state, expectVersion) {
  const cur = db.prepare('SELECT version FROM vaults WHERE user_id = ?').get(userId);
  if (cur && expectVersion != null && cur.version !== expectVersion) return { ok: false, current: getVault(userId) };
  const version = (cur?.version ?? 0) + 1;
  db.prepare(`INSERT INTO vaults (user_id, data, version, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at`)
    .run(userId, sealVault(state), version, now());
  return { ok: true, version };
}
