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

export const base = () => (store.get('settings.ai.ollamaUrl') || 'http://localhost:11434').replace(/\/$/, '');
let state = { checked: false, ok: false, version: null, error: null, models: [] };
const noTools = new Set();
export const status = () => state;

/** Is Ollama reachable? Caches the result (call with force to re-check). */
export async function detect(force = false) {
  if (state.checked && !force) return state;
  try {
    const r = await fetch(`${base()}/api/version`, { signal: AbortSignal.timeout?.(2500) });
    if (!r.ok) throw new Error(`Ollama answered ${r.status}`);
    const v = await r.json();
    state = { checked: true, ok: true, version: v.version, error: null, models: await listModels().catch(() => []) };
  } catch (e) {
    state = { checked: true, ok: false, version: null, models: [], error: e.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
  return state;
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
export function corsHelp() {
  const origin = location.origin;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return { origin, local,
    steps: local ? ['Install Ollama from ollama.com and open it (or run: ollama serve).', 'Come back and press Check again.']
      : ['Install Ollama from ollama.com.', `Allow this website to use it — set OLLAMA_ORIGINS to ${origin}:`,
        `Windows (Command Prompt): setx OLLAMA_ORIGINS "${origin}"`, `Mac (Terminal): launchctl setenv OLLAMA_ORIGINS "${origin}"`, `Linux: OLLAMA_ORIGINS="${origin}" ollama serve`,
        'Quit Ollama completely and open it again, then press Check again.', 'Easiest: run JARVIS-X with the launcher on your computer (localhost) — it works with Ollama without any setting.'] };
}
