/**
 * Google Gemini with your own free key (from aistudio.google.com).
 * Uses Gemini's OpenAI-compatible endpoint straight from the browser: streaming replies,
 * and tool use, so Gemini can take JARVIS-X actions and search the live web with
 * JARVIS-X's free search tools. The key is kept encrypted in this browser's vault and never synced.
 * @module core/gemini
 */
import { store } from './store.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const KEY_URL = 'https://aistudio.google.com/apikey';
/** Shown before the live list loads (and if it can't). First = default. */
export const MODELS = [
  ['gemini-3.8-flash', 'Gemini 3.8 Flash — recommended: smart and quick, free tier'],
  ['gemini-3.6-flash', 'Gemini 3.6 Flash — previous Flash, free tier'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite — fastest, most free requests'],
  ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite — light and quick, free tier'],
  ['gemini-4-argon', 'Gemini 4 Argon — most capable (paid tier only)'],
];
export const key = () => store.get('secrets.geminiKey') || '';
export const model = () => store.get('settings.ai.geminiModel') || MODELS[0][0];
export const configured = () => !!key();

/** Chat models this key can use (live from Google), else the built-in list. */
let cached = null;
export async function listModels(force = false) {
  if (cached && !force) return cached;
  try {
    const r = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key()}` } });
    if (!r.ok) throw new Error(String(r.status));
    const ids = ((await r.json()).data || []).map((m) => String(m.id).replace(/^models\//, ''))
      .filter((id) => /^gemini-/.test(id) && !/image|tts|live|transcribe|embed|omni|banana|audio|veo|imagen|robotics|computer-use/i.test(id));
    const known = new Map(MODELS);
    cached = [...MODELS.filter(([id]) => ids.includes(id)), ...ids.filter((id) => !known.has(id)).sort().reverse().map((id) => [id, id])];
    if (!cached.length) cached = MODELS;
  } catch { cached = MODELS; }
  return cached;
}

function explain(status, msg) {
  if (status === 400 && /api key not valid|API_KEY_INVALID/i.test(msg)) return 'Your Gemini key isn\'t valid — copy it again from aistudio.google.com/apikey (Settings → AI).';
  if (status === 401 || status === 403) return `Gemini refused the key (${status}). Check it in Settings → AI${/region|location|country/i.test(msg) ? ' — Gemini may not be available in your region' : ''}.`;
  if (status === 404) return `The model "${model()}" isn't available to your key — pick another in Settings → AI.`;
  if (status === 429) return /quota|free/i.test(msg) ? 'You\'ve used today\'s free Gemini requests for this model. Try a Flash-Lite model in Settings → AI, or wait and try again later.' : 'Gemini is busy — wait a moment and try again.';
  return `Gemini ${status}: ${msg || 'request failed'}`;
}

const text = (c) => (Array.isArray(c) ? c.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('') : c || '');
let effortOk = true; // 'reasoning_effort: low' keeps Gemini 3 quick; dropped if a model refuses it

async function post(body, signal) {
  const res = await fetch(`${BASE}/chat/completions`, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
    body: JSON.stringify({ model: model(), temperature: store.get('settings.ai.temperature') ?? 0.7, ...(effortOk ? { reasoning_effort: 'low' } : {}), ...body }) });
  if (res.ok) return res;
  const t = await res.text().catch(() => ''); let m = t;
  try { const j = JSON.parse(t); m = (Array.isArray(j) ? j[0] : j)?.error?.message || t; } catch { /* */ }
  if (res.status === 400 && effortOk && /reasoning|thinking|effort/i.test(m)) { effortOk = false; return post(body, signal); }
  throw Object.assign(new Error(explain(res.status, m)), { status: res.status, raw: m });
}

/** One streamed round. Returns { content, toolCalls, message } (message = the assistant turn to send back). */
async function round({ messages, tools, signal, onText, prefix }) {
  // Give up if Gemini goes quiet for 90 s (and still honour the Stop button)
  const ctl = new AbortController(); let idle; let timedOut = false;
  const kick = () => { clearTimeout(idle); idle = setTimeout(() => { timedOut = true; ctl.abort(); }, 90_000); };
  const stop = () => ctl.abort(); signal?.addEventListener('abort', stop, { once: true }); kick();
  try {
    const res = await post({ messages, stream: true, ...(tools?.length ? { tools } : {}) }, ctl.signal);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let content = ''; let finish = null;
    const calls = []; // accumulated by index, keeping any extra fields (thought signatures) exactly as sent
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      kick();
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) {
        const s = l.trim(); if (!s.startsWith('data:')) continue;
        const d = s.slice(5).trim(); if (d === '[DONE]') continue;
        let j; try { j = JSON.parse(d); } catch { continue; }
        if (j.error) throw new Error(explain(j.error.code || 500, j.error.message));
        const ch = j.choices?.[0] || {}; const delta = ch.delta || ch.message || {};
        if (ch.finish_reason) finish = ch.finish_reason;
        const piece = text(delta.content);
        if (piece) { content += piece; onText?.(prefix + content); }
        for (const tc of delta.tool_calls || []) {
          const i = tc.index ?? calls.length;
          const cur = calls[i] ||= { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
          for (const [k, v] of Object.entries(tc)) if (!['index', 'function', 'id', 'type'].includes(k)) cur[k] = v;
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.function.name += tc.function.name;
          if (tc.function?.arguments) cur.function.arguments += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
        }
      }
    }
    const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));
    return { content, toolCalls, finish, message: { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } };
  } catch (e) {
    if (timedOut) throw new Error('Gemini didn\'t answer for 90 seconds. Try again, or pick a Flash-Lite model in Settings → AI.');
    if (signal?.aborted || e.name === 'AbortError') throw Object.assign(new Error('Stopped'), { name: 'AbortError', partial: '' });
    if (e instanceof TypeError) throw new Error('Couldn\'t reach Gemini — check your internet connection (some networks and ad-blockers block generativelanguage.googleapis.com).');
    throw e;
  } finally { clearTimeout(idle); signal?.removeEventListener('abort', stop); }
}

/** Same request without streaming (used when a streamed reply comes back empty). */
async function once({ messages, tools, signal }) {
  const res = await post({ messages, stream: false, ...(tools?.length ? { tools } : {}) }, signal);
  const j = await res.json(); const ch = j.choices?.[0] || {}; const m = ch.message || {};
  const toolCalls = (m.tool_calls || []).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}`, function: { name: c.function?.name, arguments: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments || {}) } }));
  const content = text(m.content);
  return { content, toolCalls, finish: ch.finish_reason, message: { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } };
}

/**
 * Chat with optional tools ({ name, description, parameters } in OpenAI function format).
 * runTool(name, args) runs a JARVIS-X tool. onTool(name, args, shownSoFar) reports progress.
 */
export async function chat({ system, messages, tools, runTool, onText, onTool, signal }) {
  if (!key()) throw new Error('Add your free Gemini key in Settings → AI first.');
  const msgs = [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: String(m.content) }))];
  let useTools = tools?.length ? tools : null;
  let shown = '';
  for (let i = 0; i < 8; i++) {
    let r;
    try { r = await round({ messages: msgs, tools: useTools, signal, onText, prefix: shown }); }
    catch (e) {
      // A model that can't use tools (or rejects the schema): carry on as plain chat
      if (useTools && e.status === 400 && /tool|function|schema|thought/i.test(e.raw || '')) { useTools = null; i--; continue; }
      throw e;
    }
    if (!r.content && !r.toolCalls.length) { // empty stream: ask once more without streaming
      r = await once({ messages: msgs, tools: useTools, signal });
      if (r.content) onText?.(shown + r.content);
      if (!r.content && !r.toolCalls.length) {
        if (shown) return shown;
        throw new Error(/safety|content_filter|blocked|prohibited/i.test(r.finish || '') ? 'Gemini declined to answer that (safety filter). Try rephrasing.' : `Gemini sent back an empty answer${r.finish ? ` (${r.finish})` : ''}. Try again, or choose another Gemini model in Settings → AI.`);
      }
    }
    shown += r.content;
    if (!r.toolCalls.length) return shown;
    msgs.push(r.message);
    if (r.content) shown += '\n\n';
    for (const c of r.toolCalls) {
      let args = {}; try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* */ }
      onTool?.(c.function.name, args, shown);
      let out; try { out = await runTool(c.function.name, args); } catch (e) { out = { error: e.message }; }
      msgs.push({ role: 'tool', tool_call_id: c.id, name: c.function.name, content: JSON.stringify(out).slice(0, 20000) });
    }
  }
  return shown;
}
