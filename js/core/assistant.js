/**
 * Assistant service — the single entry point for "ask JARVIS-X something".
 * Used by the home command bar, the chat module, voice input, study, dev and automations.
 *
 * Pipeline: instant command layer → provider choice (Claude / server / your key / offline)
 * → standing instructions (persona, memory, knowledge base, app context) → tool-using
 * model run with live streaming → persistence → events.
 * @module core/assistant
 */
import { store } from './store.js';
import { bus } from './bus.js';
import { uid, todayKey } from './dom.js';
import { runCommand } from './commands.js';
import { providers, buildSystemPrompt, activeProviderId } from './ai.js';
import { license } from './license.js';
import { platform } from './platform.js';
import { limit, can } from './plans.js';

/* ------------------------------------------------------------ conversations */
export function activeConversation(create = true) {
  const chat = store.get('chat');
  let c = chat.conversations.find((x) => x.id === chat.activeId);
  if (!c && create) c = newConversation();
  return c;
}
export function newConversation() {
  const c = { id: uid('cv'), title: 'New conversation', created: Date.now(), messages: [] };
  const max = limit('conversations', license.plan());
  let list = [c, ...store.get('chat.conversations')];
  if (list.length > max) list = list.slice(0, max);
  store.set('chat.conversations', list);
  store.set('chat.activeId', c.id);
  return c;
}
function appendMessage(cid, msg) {
  store.update('chat.conversations', (list) => list.map((c) => {
    if (c.id !== cid) return c;
    const title = c.title === 'New conversation' && msg.role === 'user' ? msg.content.slice(0, 60) : c.title;
    return { ...c, messages: [...c.messages, msg], title, updated: Date.now() };
  }));
}
function replaceLast(cid, patch) {
  store.update('chat.conversations', (list) => list.map((c) => (c.id !== cid ? c : { ...c, messages: c.messages.map((m, i) => (i === c.messages.length - 1 ? { ...m, ...patch } : m)) })));
}

/* -------------------------------------------------------------------- usage */
/** Local usage counter (display + analytics). The server enforces real quotas in server mode. */
export function quota() {
  const u = store.get('usage'); const t = todayKey();
  if (u.aiDay !== t) { store.set('usage.aiDay', t); store.set('usage.aiCount', 0); }
  const serverMode = activeProviderId() === 'server';
  const max = serverMode ? (platform.server?.features?.aiDailyLimit || Infinity) : Infinity;
  return { used: store.get('usage.aiCount'), max, left: max - store.get('usage.aiCount') };
}
function countUsage() {
  const t = todayKey();
  store.set('usage.aiCount', store.get('usage.aiCount') + 1);
  store.set(['usage', 'byDay', t], (store.get(['usage', 'byDay', t]) || 0) + 1);
  store.set('usage.totals.messages', store.get('usage.totals.messages') + 1);
  bus.emit('ai:usage', quota());
}

/* ------------------------------------------------------- knowledge retrieval */
export function retrieveKB(query, k = 3) {
  if (!can('kb.personal', license.plan())) return [];
  const terms = new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const chunks = [];
  for (const d of store.get('kb.docs')) {
    for (const part of d.text.match(/[\s\S]{1,600}(?:\s|$)/g) || []) {
      const words = part.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
      const score = words.reduce((a, w) => a + (terms.has(w) ? 1 : 0), 0) / Math.sqrt(words.length + 1);
      if (score > 0) chunks.push({ title: d.title, text: part.trim(), score });
    }
  }
  return chunks.sort((a, b) => b.score - a.score).slice(0, k);
}

/* ---------------------------------------------------------------------- ask */
/**
 * @param {string} text
 * @param {{ onChunk?:(full:string)=>void, signal?:AbortSignal, conversation?:boolean, system?:string,
 *           provider?:string, history?:Array, tools?:boolean, tier?:'quick'|'default'|'complex', commands?:boolean }} opts
 * @returns {Promise<{ text:string, command?:boolean, error?:string, provider?:string }>}
 */
export async function ask(text, opts = {}) {
  const { onChunk, signal, conversation = true, commands = true } = opts;
  text = text.trim(); if (!text) return { text: '' };
  const conv = conversation ? activeConversation() : null;
  if (conv) appendMessage(conv.id, { role: 'user', content: text, ts: Date.now() });

  // 1) Instant commands (free, offline, no model round-trip)
  const cmd = commands && text.length < 160 ? runCommand(text) : null;
  if (cmd) {
    cmd.reply = await cmd.reply;
    if (conv) appendMessage(conv.id, { role: 'assistant', content: cmd.reply, ts: Date.now(), command: true });
    onChunk?.(cmd.reply);
    bus.emit('assistant:reply', { text: cmd.reply });
    return { text: cmd.reply, command: true };
  }

  // 2) Provider + local quota display (server enforces the real limit)
  const providerId = opts.provider || activeProviderId();
  const provider = providers[providerId] || providers.local;
  const q = quota();
  if (q.left <= 0) {
    const msg = `You've reached today's fair-use limit of ${q.max} AI requests on this server. It resets at midnight.`;
    if (conv) appendMessage(conv.id, { role: 'assistant', content: msg, ts: Date.now() });
    onChunk?.(msg);
    return { text: msg, error: 'quota' };
  }

  // 3) Context
  const cfg = store.get('settings.ai');
  const plan = license.plan();
  const history = opts.history ?? (conv ? store.findById('chat.conversations', conv.id).messages : [{ role: 'user', content: text }]);
  const messages = history.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content).slice(-cfg.maxContext).map(({ role, content }) => ({ role, content }));
  const tools = opts.tools ?? true;
  const system = opts.system ?? buildSystemPrompt({ memoryLimit: 300, kbSnippets: retrieveKB(text), tools });

  // 4) Run
  bus.emit('hud:state', { state: 'thinking' });
  if (conv) appendMessage(conv.id, { role: 'assistant', content: '', ts: Date.now(), provider: providerId });
  let full = ''; let error;
  // Until the first words arrive, show that JARVIS-X is working (with a seconds counter)
  const started = Date.now(); let got = false;
  const wait = () => { if (!got) opts.onStatus?.(`_Thinking… ${Math.round((Date.now() - started) / 1000)}s_`); };
  wait(); const ticker = setInterval(wait, 1000);
  try {
    full = await provider.run(messages, { system, signal, tools, tier: opts.tier, onText: (t) => { if (!t) return; got = true; full = t; onChunk?.(t); bus.emit('assistant:chunk', { full: t }); } });
    clearInterval(ticker);
    if (!String(full || '').trim()) { full = `> The AI sent back an empty answer. Try again${providerId === 'browser' ? ', or pick a different built-in model' : providerId === 'gemini' ? ', or pick a different Gemini model' : ''} in Settings → AI.`; onChunk?.(full); }
  } catch (e) {
    clearInterval(ticker);
    if (e.name === 'AbortError') { full = (e.partial || (got ? full : '') || '') + '\n\n_(stopped)_'; onChunk?.(full); }
    else {
      error = e.message;
      if (e.status === 429 || e.data?.code === 'quota') { full = e.message; }
      else if (providerId !== 'local') {
        const kept = e.partial || '';
        full = `${kept ? kept + '\n\n' : ''}> ${e.message}\n\n`;
        full = await providers.local.run(messages, { signal, onText: (t) => onChunk?.(full + t) }).then((t) => full + t);
      } else full = `> ${e.message}`;
      onChunk?.(full);
    }
  }
  clearInterval(ticker);
  if (conv) replaceLast(conv.id, { content: full || '_(no answer)_' });
  if (!error || providerId === 'local') countUsage();
  bus.emit('hud:state', { state: 'idle' });
  bus.emit('assistant:reply', { text: full });
  return { text: full, error, provider: providerId };
}
