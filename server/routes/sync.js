/**
 * Cloud sync + Developer API.
 *
 * /api/sync         GET → { state, version } · PUT { state, baseVersion } → { version } | 409 { current }
 * /v1/*             Master-only REST API over the same vault (API key or session):
 *                   tasks, notes, memory, events, chat
 */
import { getVault, putVault, now, newId } from '../lib/db.js';
import { config } from '../lib/config.js';
import { HttpError, json, jsonBody, rateLimit } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';

const SECTIONS_FROM_API = { tasks: 'tasks', notes: 'notes', memory: 'memory', events: 'events' };

/** Read-modify-write a user's vault with optimistic retries. */
function mutateVault(userId, fn) {
  for (let i = 0; i < 5; i++) {
    const cur = getVault(userId) || { state: {}, version: null };
    const state = cur.state || {};
    const result = fn(state);
    state.meta = state.meta || {}; state.meta.ts = state.meta.ts || {};
    for (const s of result.touched || []) state.meta.ts[s] = now();
    const w = putVault(userId, state, cur.version);
    if (w.ok) return result.value;
  }
  throw new HttpError(409, 'The data changed while saving. Try again.');
}
const todayKey = () => new Date().toISOString().slice(0, 10);

export function syncRoutes(r) {
  r.get('/api/sync', async (req, res) => {
    const { user } = requireUser(req);
    const v = getVault(user.id);
    return json(res, v ? { state: v.state, version: v.version, updatedAt: v.updatedAt } : { state: null, version: 0 });
  });
  r.put('/api/sync', async (req, res) => {
    const { user } = requireUser(req);
    rateLimit(`sync:${user.id}`, 120, 60e3);
    const { state, baseVersion } = await jsonBody(req, 8 * 1024 * 1024);
    if (!state || typeof state !== 'object') throw new HttpError(400, 'state is required');
    delete state.secrets; // never stored server-side
    const w = putVault(user.id, state, baseVersion ?? null);
    if (!w.ok) return json(res, { conflict: true, current: w.current }, 409);
    return json(res, { version: w.version });
  });

  /* ---------------------------------------------------------- Developer API */
  const api = (handler) => async (req, res) => {
    const a = requireUser(req);
    rateLimit(`v1:${a.user.id}`, 120, 60e3);
    return handler(req, res, a.user);
  };
  r.get('/v1', api(async (req, res) => json(res, { name: 'JARVIS-X API', version: 1, resources: ['/v1/tasks', '/v1/notes', '/v1/memory', '/v1/events', '/v1/chat'] })));

  for (const [res_, section] of Object.entries(SECTIONS_FROM_API)) {
    r.get(`/v1/${res_}`, api(async (req, res, user) => {
      const st = getVault(user.id)?.state || {};
      const data = section === 'memory' ? st.memory?.facts || [] : st[section] || [];
      return json(res, { data });
    }));
  }
  r.post('/v1/tasks', api(async (req, res, user) => {
    const b = await jsonBody(req); if (!b.title) throw new HttpError(400, 'title is required');
    const task = { id: newId('t'), title: String(b.title).slice(0, 500), done: false, priority: ['low', 'med', 'hi'].includes(b.priority) ? b.priority : 'med', due: b.due || null, list: b.list || 'Personal', created: now(), source: 'api' };
    return json(res, { data: mutateVault(user.id, (s) => { s.tasks = [task, ...(s.tasks || [])]; return { value: task, touched: ['tasks'] }; }) }, 201);
  }));
  r.patch('/v1/tasks/:id', api(async (req, res, user) => {
    const b = await jsonBody(req);
    const t = mutateVault(user.id, (s) => {
      const t = (s.tasks || []).find((x) => x.id === req.params.id); if (!t) throw new HttpError(404, 'Task not found');
      for (const k of ['title', 'done', 'priority', 'due', 'list']) if (k in b) t[k] = b[k];
      if (b.done) t.doneAt = now();
      return { value: t, touched: ['tasks'] };
    });
    return json(res, { data: t });
  }));
  r.post('/v1/notes', api(async (req, res, user) => {
    const b = await jsonBody(req); if (!b.body && !b.title) throw new HttpError(400, 'title or body is required');
    const note = { id: newId('n'), title: String(b.title || String(b.body).slice(0, 48)), body: String(b.body || ''), format: 'md', pinned: false, updated: now(), source: 'api' };
    return json(res, { data: mutateVault(user.id, (s) => { s.notes = [note, ...(s.notes || [])]; return { value: note, touched: ['notes'] }; }) }, 201);
  }));
  r.post('/v1/memory', api(async (req, res, user) => {
    const b = await jsonBody(req); if (!b.text) throw new HttpError(400, 'text is required');
    const fact = { id: newId('m'), text: String(b.text).slice(0, 1000), tags: Array.isArray(b.tags) ? b.tags.slice(0, 5) : [], ts: now() };
    return json(res, { data: mutateVault(user.id, (s) => { s.memory = s.memory || {}; s.memory.facts = [...(s.memory.facts || []), fact]; return { value: fact, touched: ['memory'] }; }) }, 201);
  }));
  r.post('/v1/events', api(async (req, res, user) => {
    const b = await jsonBody(req); if (!b.title || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw new HttpError(400, 'title and date (YYYY-MM-DD) are required');
    const ev = { id: newId('e'), title: String(b.title), date: b.date, time: /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '', notes: String(b.notes || '') };
    return json(res, { data: mutateVault(user.id, (s) => { s.events = [...(s.events || []), ev]; return { value: ev, touched: ['events'] }; }) }, 201);
  }));
  r.post('/v1/chat', api(async (req, res, user) => {
    const b = await jsonBody(req); if (!b.message) throw new HttpError(400, 'message is required');
    if (!config.ai.provider) throw new HttpError(503, 'No AI provider configured.');
    const st = getVault(user.id)?.state || {};
    const facts = (st.memory?.facts || []).slice(-50).map((f) => `- ${f.text}`).join('\n');
    const open = (st.tasks || []).filter((t) => !t.done).slice(0, 20).map((t) => `- ${t.title}${t.due ? ` (due ${t.due})` : ''}`).join('\n');
    const system = `You are JARVIS-X answering through its API. Today is ${todayKey()}.\nUser memory:\n${facts || '(none)'}\nOpen tasks:\n${open || '(none)'}`;
    const A = config.ai;
    const up = A.provider === 'anthropic'
      ? await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': A.anthropicKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: A.anthropicModel, max_tokens: A.maxTokens, system, messages: [{ role: 'user', content: String(b.message) }] }) })
      : await fetch(`${A.openaiBase}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${A.openaiKey}` }, body: JSON.stringify({ model: A.openaiModel, messages: [{ role: 'system', content: system }, { role: 'user', content: String(b.message) }] }) });
    const j = await up.json(); if (!up.ok) throw new HttpError(502, 'AI provider error');
    const reply = A.provider === 'anthropic' ? j.content?.map((c) => c.text || '').join('') : j.choices?.[0]?.message?.content;
    return json(res, { reply });
  }));
}
