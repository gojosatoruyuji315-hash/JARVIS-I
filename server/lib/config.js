/**
 * Server configuration — read once from environment variables (.env supported).
 * Every secret comes from the environment; nothing sensitive is hard-coded.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(here, '..');
export const PUBLIC_DIR = path.resolve(SERVER_DIR, '..');          // the static app (index.html, js/, css/)

// Load .env (Node ≥ 21.7) — silently skip if absent
for (const f of [path.join(SERVER_DIR, '.env'), path.join(PUBLIC_DIR, '.env')]) {
  if (fs.existsSync(f)) { try { process.loadEnvFile(f); } catch { /* ignore */ } break; }
}

const env = (k, d = '') => (process.env[k] ?? d).trim();
const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const bool = (k, d = false) => (process.env[k] ? /^(1|true|yes|on)$/i.test(process.env[k]) : d);

export const DATA_DIR = path.resolve(SERVER_DIR, env('DATA_DIR', './data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

/** Persisted random secret, generated on first boot when not provided. */
function secret(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(DATA_DIR, `.${name.toLowerCase()}`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, s, { mode: 0o600 });
  console.warn(`[config] ${name} not set — generated one in ${file}. Set it explicitly in production.`);
  return s;
}

export const config = {
  port: num('PORT', 8080),
  host: env('HOST', '0.0.0.0'),
  publicUrl: env('PUBLIC_URL', 'http://localhost:8080').replace(/\/$/, ''),
  production: env('NODE_ENV') === 'production',
  trustProxy: bool('TRUST_PROXY', false),

  jwtSecret: secret('JWT_SECRET'),
  vaultKey: crypto.createHash('sha256').update(secret('VAULT_SECRET')).digest(), // 32-byte AES key
  sessionDays: num('SESSION_DAYS', 30),

  // AI
  ai: {
    provider: env('AI_PROVIDER', process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : ''),
    anthropicKey: env('ANTHROPIC_API_KEY'),
    anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-4-5'),
    openaiKey: env('OPENAI_API_KEY'),
    openaiBase: env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''),
    openaiModel: env('OPENAI_MODEL', 'gpt-4o-mini'),
    maxTokens: num('AI_MAX_TOKENS', 2048),
    /** Live web for the assistant: Anthropic's web search + web fetch tools ('on'), or only the free built-in search ('basic'), or 'off'. */
    web: env('AI_WEB', 'on'),
  },

  // Fair-use cap on server-paid AI requests per user per day (0 = unlimited)
  aiDailyLimit: num('AI_DAILY_LIMIT', 0),

  // Email (password reset). Resend if configured, otherwise the link is logged to the console.
  mail: { resendKey: env('RESEND_API_KEY'), from: env('MAIL_FROM', 'JARVIS-X <no-reply@example.com>') },

  // Code runner: off | docker | local (local = dev only, runs on the host!)
  runner: { mode: env('CODE_RUNNER', 'off'), timeoutMs: num('CODE_TIMEOUT_MS', 8000) },

  // Market data
  data: { finnhubKey: env('FINNHUB_API_KEY') },
};

/** Everyone gets every feature. Only abuse-prevention limits remain. */
export const LIMITS = { devices: num('MAX_DEVICES', 20), apiKeys: 5 };
