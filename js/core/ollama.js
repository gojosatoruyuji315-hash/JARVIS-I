/**
 * Ollama — run AI models on your own computer, free and private.
 *
 *  • Detects Ollama at http://localhost:11434 (or your own address) and lists installed models.
 *  • Downloads (pulls) and deletes models from inside JARVIS-X with live progress.
 *  • Chats with streaming, and lets tool-capable models (Llama 3.1+, Qwen 2.5/3, Mistral…) use
 *    JARVIS-X actions and the live-web tools. Models without tool support fall back to plain
 *    chat, with live search results handed to them when the question needs the web.
 *  • Strips <think>…</think> reasoning from thinking models.
 *
 * Browsers only let a page talk to Ollama if Ollama allows that page's address. Pages served
 * from localhost (the JARVIS-X launcher) are allowed by default; for a website such as GitHub
 * Pages, set OLLAMA_ORIGINS to that address (see corsHelp()).
 * @module core/ollama
 */
import { store } from './store.js';

export const RECOMMENDED = [
  ['llama3.2:3b', 'Llama 3.2 · 3B — fast on most laptops, uses tools', '2.0 GB'],
  ['qwen2.5:7b', 'Qwen 2.5 · 7B — smart all-rounder, great with tools', '4.7 GB'],
  ['llama3.1:8b', 'Llama 3.1 · 8B — strong general model, uses tools', '4.9 GB'],
  ['gemma3:4b', 'Gemma 3 · 4B — good writing, understands images', '3.3 GB'],
  ['qwen3:8b', 'Qwen 3 · 8B — thinks step by step, uses tools', '5.2 GB'],
  ['mistral:7b', 'Mistral · 7B — quick and capable, uses tools', '4.1 GB'],
  ['phi4-mini', 'Phi-4 mini · 3.8B — small and clever at maths/code', '2.5 GB'],
];

// Ollama listens on 127.0.0.1 by default; "localhost" can resolve to IPv6 (::1) on some computers and miss it.
const CANDIDATES = ['http://127.0.0.1:11434', 'http://localhost:11434'];
let found = null;
export const base = () => (store.get('settings.ai.ollamaUrl') || found || CANDIDATES[0]).replace(/\/$/, '');
let state = { checked: false, ok: false, version: null, error: null, models: [] };
const noTools = new Set();
export const status = () => state;

/** Is Ollama reachable? Caches the result (call with force to re-check). */
export async function detect(force = false) {
  if (state.checked && !force) return state;
  const custom = store.get('settings.ai.ollamaUrl');
  const tries = custom ? [custom.replace(/\/$/, '')] : CANDIDATES;
  let lastErr = null;
  for (const b of tries) {
    try {
      const r = await fetch(`${b}/api/version`, { signal: AbortSignal.timeout?.(4000), cache: 'no-store' });
      if (r.status === 403) { lastErr = 'forbidden'; continue; } // Ollama refused this website's address
      if (!r.ok) { lastErr = `status ${r.status}`; continue; }
      const v = await r.json();
      found = b;
      state = { checked: true, ok: true, version: v.version, error: null, base: b, models: await listModels().catch(() => []) };
      return state;
    } catch (e) {
      if (e.name === 'TimeoutError') { lastErr = lastErr || 'timeout'; continue; }
      // Is something answering at all? A no-cors probe succeeds if Ollama runs but refuses this website.
      const alive = await fetch(`${b}/api/version`, { mode: 'no-cors', signal: AbortSignal.timeout?.(3000), cache: 'no-store' }).then(() => true, () => false);
      lastErr = alive ? 'forbidden' : lastErr === 'forbidden' ? 'forbidden' : 'blocked';
    }
  }
  state = { checked: true, ok: false, version: null, models: [], error: lastErr, reason: diagnose(lastErr) };
  return state;
}

/** Explain in plain words why the browser couldn't reach Ollama. */
export function diagnose(err) {
  const origin = location.origin;
  const localPage = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  if (window.claude?.use) return { code: 'viewer', text: 'You are inside the Claude viewer, which can\'t reach programs on your computer. Open JARVIS-X with the launcher or your website instead.' };
  if (err === 'forbidden') return { code: 'origin', text: `Ollama is running but refused this website (${origin}). Allow it with OLLAMA_ORIGINS (steps below) and restart Ollama.` };
  if (err === 'timeout') return { code: 'timeout', text: 'Ollama didn\'t answer in time — it may still be starting. Wait a few seconds and press Check again.' };
  if (!localPage && safari) return { code: 'safari', text: 'Safari doesn\'t let websites talk to programs on your computer. Use the JARVIS-X launcher, or open your site in Chrome or Edge.' };
  if (!localPage) return { code: 'website', text: `Either Ollama isn't running, or it doesn't allow this website yet. When Chrome or Edge asks "Allow access to devices on your local network?", choose Allow. Then allow ${origin} in Ollama (steps below).` };
  return { code: 'notrunning', text: 'Ollama isn\'t running on this computer (or isn\'t installed). Open the Ollama app — you should see its llama icon in the menu bar / system tray — then press Check again.' };
}

export async function listModels() {
  const r = await fetch(`${base()}/api/tags`); if (!r.ok) throw new Error(`Ollama ${r.status}`);
  const j = await r.json();
  return (j.models || []).map((m) => ({ name: m.name, size: m.size, family: m.details?.family, params: m.details?.parameter_size, quant: m.details?.quantization_level }));
}

/** Download a model. onProgress({ status, completed, total }). */
export async function pull(name, onProgress, signal) {
  const r = await fetch(`${base()}/api/pull`, { method: 'POST', signal, body: JSON.stringify({ model: name, stream: true }) });
  if (!r.ok) throw new Error(`Ollama could not download ${name} (${r.status})`);
  for await (const j of ndjson(r)) { if (j.error) throw new Error(j.error); onProgress?.(j); }
  state.models = await listModels().catch(() => state.models);
}
export async function remove(name) {
  const r = await fetch(`${base()}/api/delete`, { method: 'DELETE', body: JSON.stringify({ model: name }) });
  if (!r.ok) throw new Error(`Could not delete ${name}`);
  state.models = await listModels().catch(() => state.models);
}

/** The model to use: the chosen one, else the first installed. */
export async function currentModel() {
  const chosen = store.get('settings.ai.ollamaModel');
  if (chosen) return chosen;
  if (!state.models.length) await detect(true);
  if (!state.models.length) throw new Error('No Ollama models installed yet — download one in Settings → AI.');
  return state.models[0].name;
}

async function* ndjson(res) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { yield JSON.parse(line); } catch { /* partial */ } } }
  }
  if (buf.trim()) { try { yield JSON.parse(buf); } catch { /* */ } }
}
const stripThink = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');

/**
 * One streamed chat round. Returns { content, toolCalls }.
 * onText receives the visible text so far.
 */
async function chatRound({ model, messages, tools, signal, onText, prefix = '' }) {
  const cfg = store.get('settings.ai');
  const r = await fetch(`${base()}/api/chat`, { method: 'POST', signal, body: JSON.stringify({ model, messages, stream: true, ...(tools?.length ? { tools } : {}), options: { temperature: cfg.temperature ?? 0.7 }, keep_alive: '15m' }) });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let msg = t; try { msg = JSON.parse(t).error || t; } catch { /* */ }
    throw Object.assign(new Error(msg || `Ollama ${r.status}`), { status: r.status });
  }
  let content = ''; const toolCalls = [];
  for await (const j of ndjson(r)) {
    if (j.error) throw new Error(j.error);
    const m = j.message || {};
    if (m.content) { content += m.content; onText?.(prefix + stripThink(content)); }
    if (m.tool_calls?.length) toolCalls.push(...m.tool_calls);
  }
  return { content: stripThink(content), toolCalls };
}

/**
 * Full chat with optional tool use.
 * runTool(name, args) executes a JARVIS-X tool; tools are given in Ollama/OpenAI function format.
 */
export async function chat({ system, messages, tools, runTool, onText, signal, onTool }) {
  const model = await currentModel();
  const msgs = [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
  const useTools = tools?.length && !noTools.has(model) && store.get('settings.ai.ollamaTools') !== false;
  let shown = '';
  for (let round = 0; round < 6; round++) {
    let res;
    try { res = await chatRound({ model, messages: msgs, tools: useTools ? tools : undefined, signal, onText, prefix: shown }); }
    catch (e) {
      if (useTools && /does not support tools|tools? (are|is) not supported/i.test(e.message)) { noTools.add(model); return chat({ system, messages, tools, runTool, onText, signal, onTool }); }
      if (/not found/i.test(e.message)) throw new Error(`The model "${model}" isn't installed in Ollama — pick or download one in Settings → AI.`);
      throw e;
    }
    shown += res.content;
    if (!res.toolCalls.length) return { text: shown, model, toolsUsed: useTools };
    msgs.push({ role: 'assistant', content: res.content, tool_calls: res.toolCalls });
    if (res.content) shown += '\n\n';
    for (const c of res.toolCalls) {
      const name = c.function?.name; let args = c.function?.arguments ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      onTool?.(name, args, shown);
      let out;
      try { out = await runTool(name, args); } catch (e) { out = { error: e.message }; }
      msgs.push({ role: 'tool', tool_name: name, content: JSON.stringify(out).slice(0, 20000) });
    }
  }
  return { text: shown, model, toolsUsed: useTools };
}
export const supportsTools = (model) => !noTools.has(model);

/** Setup help shown when the page can't reach Ollama. */
export function corsHelp(code) {
  const origin = location.origin;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return { origin, local,
    steps: local && code !== 'origin' ? ['Install Ollama from ollama.com and open it (or run: ollama serve in a terminal).', 'Check it works: open http://127.0.0.1:11434 in a new tab — it should say "Ollama is running".', 'Download at least one model (in this panel once connected, or run: ollama pull llama3.2).', 'Come back and press Check again.']
      : ['Install Ollama from ollama.com and make sure it is running — http://127.0.0.1:11434 in a new tab should say "Ollama is running".',
        `Allow this website in Ollama by setting OLLAMA_ORIGINS to ${origin}:`,
        `Windows (Command Prompt): setx OLLAMA_ORIGINS "${origin}"`, `Mac (Terminal): launchctl setenv OLLAMA_ORIGINS "${origin}"`, `Linux: sudo systemctl edit ollama → add Environment="OLLAMA_ORIGINS=${origin}" → sudo systemctl restart ollama`,
        'Quit Ollama completely (right-click its tray / menu-bar icon → Quit) and open it again.',
        'Press Check again. If Chrome or Edge asks to allow access to your local network, choose Allow.',
        'Easiest of all: use the JARVIS-X launcher on your computer (http://localhost:8765) — it works with Ollama without any setting.'] };
}
