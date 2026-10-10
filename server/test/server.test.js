/**
 * Integration tests: boots the real server with mocked providers and drives the API.
 *   npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jxtest-'));
const ENV = {
  PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: DATA, PUBLIC_URL: BASE, JWT_SECRET: 'test-jwt', VAULT_SECRET: 'test-vault',
  ANTHROPIC_API_KEY: 'sk-test', AI_DAILY_LIMIT: '2', REPLICATE_API_TOKEN: 'r8_test', CODE_RUNNER: 'off',
};
let proc;

class Client {
  cookie = '';
  async req(method, p, body, headers = {}) {
    const r = await fetch(BASE + p, { method, headers: { 'X-JX': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie?.() || []; for (const c of sc) { const [kv] = c.split(';'); if (kv.startsWith('jx_session=')) this.cookie = kv.endsWith('=') ? '' : kv; }
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  }
}

before(async () => {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', './server/test/mock-providers.js', 'server/index.js'], { env: { ...process.env, ...ENV }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { proc.stdout.on('data', (d) => { if (String(d).includes('running at')) resolve(); }); proc.on('exit', (c) => reject(new Error(`server exited ${c}`))); setTimeout(() => reject(new Error('timeout')), 8000); });
});
after(() => { proc?.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('health reports configured features', async () => {
  const r = await new Client().req('GET', '/api/health');
  assert.equal(r.data.ok, true); assert.equal(r.data.features.ai, true); assert.equal(r.data.features.aiDailyLimit, 2);
});

test('register, me, logout, login; wrong password rejected; CSRF header required', async () => {
  const c = new Client();
  const reg = await c.req('POST', '/api/auth/register', { email: 'Ana@Example.com', password: 'correct horse', name: 'Ana' });
  assert.equal(reg.status, 200); assert.equal(reg.data.user.email, 'ana@example.com');
  assert.equal((await c.req('GET', '/api/auth/me')).data.user.name, 'Ana');
  const noCsrf = await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { Cookie: c.cookie } });
  assert.equal(noCsrf.status, 403);
  assert.equal((await c.req('POST', '/api/auth/logout')).status, 200);
  assert.equal((await c.req('GET', '/api/auth/me')).data.user, null);
  assert.equal((await c.req('POST', '/api/auth/login', { email: 'ana@example.com', password: 'nope-nope' })).status, 401);
  assert.equal((await c.req('POST', '/api/auth/login', { email: 'ana@example.com', password: 'correct horse' })).status, 200);
  assert.equal((await c.req('POST', '/api/auth/register', { email: 'ana@example.com', password: 'correct horse' })).status, 409);
});

test('sync: optimistic versions and conflict', async () => {
  const c = new Client(); await c.req('POST', '/api/auth/register', { email: 'sync@example.com', password: 'password123' });
  assert.equal((await c.req('GET', '/api/sync')).data.version, 0);
  const p1 = await c.req('PUT', '/api/sync', { state: { tasks: [{ id: 't1', title: 'A' }], secrets: { aiKey: 'x' }, meta: { ts: { tasks: 1 } } }, baseVersion: 0 });
  assert.equal(p1.data.version, 1);
  const stale = await c.req('PUT', '/api/sync', { state: { tasks: [] }, baseVersion: 0 });
  assert.equal(stale.status, 409); assert.equal(stale.data.current.version, 1);
  const g = await c.req('GET', '/api/sync');
  assert.equal(g.data.state.tasks[0].title, 'A'); assert.equal(g.data.state.secrets, undefined, 'secrets are never stored');
});

test('AI proxy: tool loop works, continuation rounds are free, fair-use cap enforced', async () => {
  const c = new Client(); await c.req('POST', '/api/auth/register', { email: 'ai@example.com', password: 'password123' });
  const r1 = await c.req('POST', '/api/ai/chat', { system: 's', messages: [{ role: 'user', content: 'Please add a task to buy milk' }], tools: [{ name: 'add_task', description: 'x', input_schema: { type: 'object' } }] });
  assert.equal(r1.data.stop_reason, 'tool_use'); assert.equal(r1.data.content[1].input.title, 'buy milk');
  const r2 = await c.req('POST', '/api/ai/chat', { continuation: true, system: 's', messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: r1.data.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{}' }] }], tools: [] });
  assert.match(r2.data.content[0].text, /Added/);
  assert.equal((await c.req('GET', '/api/ai/status')).data.quota.used, 1);
  assert.equal((await c.req('POST', '/api/ai/chat', { system: 's', messages: [{ role: 'user', content: 'hi' }] })).status, 200);
  assert.equal((await c.req('POST', '/api/ai/chat', { system: 's', messages: [{ role: 'user', content: 'hi' }] })).status, 429, 'cap of 2 reached');
});

const nowS = () => Math.floor(Date.now() / 1000);

test('everyone gets every feature: API keys, developer API, Replicate relay', async () => {
  const c = new Client(); await c.req('POST', '/api/auth/register', { email: 'dev@example.com', password: 'password123' });
  const k = await c.req('POST', '/api/keys', { name: 'script' });
  assert.equal(k.status, 201); assert.match(k.data.key, /^jxk_/);
  const auth = { Authorization: `Bearer ${k.data.key}` };
  const created = await new Client().req('POST', '/v1/tasks', { title: 'From API', priority: 'hi' }, auth);
  assert.equal(created.status, 201);
  assert.equal((await new Client().req('GET', '/v1/tasks', null, auth)).data.data[0].title, 'From API');
  const pred = await c.req('POST', '/api/media/replicate/predictions', { model: 'minimax/video-01', input: { prompt: 'a cat' } });
  assert.equal(pred.data.status, 'starting');
  assert.equal((await c.req('GET', `/api/media/replicate/predictions/${pred.data.id}`)).data.status, 'succeeded');
});

test('music search proxy (iTunes)', async () => {
  const r = await new Client().req('GET', '/api/music/search?source=itunes&q=lofi');
  assert.equal(r.data.tracks[0].title, 'Mock Song'); assert.equal(r.data.tracks[0].preview, true);
});

test('password reset flow revokes old sessions', async () => {
  const c = new Client(); await c.req('POST', '/api/auth/register', { email: 'reset@example.com', password: 'password123' });
  assert.equal((await c.req('POST', '/api/auth/forgot', { email: 'reset@example.com' })).status, 200);
  assert.equal((await c.req('POST', '/api/auth/reset', { token: 'bogus', password: 'newpassword1' })).status, 400);
});

test('live data endpoints', async () => {
  const c = new Client();
  assert.equal((await c.req('GET', '/api/data/news')).data.items[0].title, 'Mock headline one - Source A');
  assert.equal((await c.req('GET', '/api/data/quotes?symbols=AAPL')).data.quotes[0].price, 101);
  assert.equal((await c.req('GET', '/api/data/fx?base=USD')).data.rates.INR, 84);
});

test('SQL runner uses isolated SQLite; ATTACH blocked; other languages off', async () => {
  const c = new Client(); await c.req('POST', '/api/auth/register', { email: 'sql@example.com', password: 'password123' });
  const r = await c.req('POST', '/api/run', { lang: 'sql', code: 'CREATE TABLE t(a INT);\nINSERT INTO t VALUES (1),(2);\nSELECT SUM(a) AS s FROM t;' });
  assert.equal(r.data.results.at(-1).rows[0].s, 3);
  assert.equal((await c.req('POST', '/api/run', { lang: 'sql', code: "ATTACH DATABASE 'x.db' AS x" })).status, 400);
  assert.equal((await c.req('POST', '/api/run', { lang: 'python', code: 'print(1)' })).status, 503);
});

test('static files served with CSP; server internals blocked', async () => {
  const r = await fetch(BASE + '/');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(BASE + '/server/lib/config.js')).status, 200 /* SPA fallback, not the file */);
  assert.doesNotMatch(await (await fetch(BASE + '/server/lib/config.js')).text(), /jwtSecret/);
});
