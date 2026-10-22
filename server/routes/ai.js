/**
 * AI proxy. Keys stay on the server; quotas are enforced per plan here.
 *
 * Client contract (Anthropic Messages shape, whichever upstream is used):
 *   POST /api/ai/chat { system, messages, tools?, stream? }
 *     stream:true  → text/event-stream of  data: {"text":"…"}  …  data: {"done":true}
 *     otherwise    → { content:[{type:'text',text}|{type:'tool_use',id,name,input}], stop_reason }
 */
import { db, today } from '../lib/db.js';
import { config } from '../lib/config.js';
import { HttpError, json, jsonBody, rateLimit } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';

const A = config.ai;

/** Anthropic server tools that give the model real, live web access (search + read pages). */
let nativeWebOk = true; // flips off if the account has web search disabled (400), then the free search is used
const webTools = (loc) => [
  { type: 'web_search_20250305', name: 'web_search', max_uses: 5, ...(loc ? { user_location: loc } : {}) },
  { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 4, citations: { enabled: true }, max_content_tokens: 20000 },
];
function userLocation(l) {
  if (!l || typeof l !== 'object') return null;
  const out = { type: 'approximate' };
  if (typeof l.timezone === 'string' && /^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(l.timezone)) out.timezone = l.timezone;
  if (typeof l.country === 'string' && /^[A-Z]{2}$/.test(l.country)) out.country = l.country;
  if (typeof l.city === 'string' && l.city.length < 60) out.city = l.city;
  return Object.keys(out).length > 1 ? out : null;
}

function quota(userId) {
  const max = config.aiDailyLimit || null;
  const used = db.prepare('SELECT ai FROM usage WHERE user_id = ? AND day = ?').get(userId, today())?.ai ?? 0;
  return { used, max, left: max ? Math.max(0, max - used) : null };
}
const count = (userId) => db.prepare('INSERT INTO usage (user_id, day, ai) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET ai = ai + 1').run(userId, today());

/* ---------------------------------------------------- OpenAI translation */
function toOpenAI(system, messages, tools) {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const uses = m.content.filter((b) => b.type === 'tool_use');
    const results = m.content.filter((b) => b.type === 'tool_result');
    if (m.role === 'assistant') out.push({ role: 'assistant', content: text || null, ...(uses.length ? { tool_calls: uses.map((u) => ({ id: u.id, type: 'function', function: { name: u.name, arguments: JSON.stringify(u.input || {}) } })) } : {}) });
    else { for (const r of results) out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content) }); if (text) out.push({ role: 'user', content: text }); }
  }
  return { messages: out, tools: tools?.length ? tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema || { type: 'object', properties: {} } } })) : undefined };
}
function fromOpenAI(j) {
  const msg = j.choices?.[0]?.message || {};
  const content = [];
  if (msg.content) content.push({ type: 'text', text: msg.content });
  for (const c of msg.tool_calls || []) { let input = {}; try { input = JSON.parse(c.function.arguments || '{}'); } catch { /* */ } content.push({ type: 'tool_use', id: c.id, name: c.function.name, input }); }
  return { content, stop_reason: msg.tool_calls?.length ? 'tool_use' : 'end_turn' };
}

async function upstream({ system, messages, tools, stream }, signal) {
  if (A.provider === 'anthropic') {
    return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-api-key': A.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: A.anthropicModel, max_tokens: A.maxTokens, system, messages, ...(tools?.length ? { tools } : {}), stream: !!stream }) });
  }
  const t = toOpenAI(system, messages, (tools || []).filter((x) => !x.type));
  return fetch(`${A.openaiBase}/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${A.openaiKey}` },
    body: JSON.stringify({ model: A.openaiModel, max_tokens: A.maxTokens, messages: t.messages, tools: t.tools, stream: !!stream }) });
}

export function aiRoutes(r) {
  r.get('/api/ai/status', async (req, res) => {
    const a = req.auth;
    return json(res, { web: A.web === 'off' ? 'off' : A.provider === 'anthropic' && A.web === 'on' && nativeWebOk ? 'native' : 'basic', configured: !!A.provider, provider: A.provider || null, model: A.provider === 'anthropic' ? A.anthropicModel : (A.provider === 'openai' || A.provider === 'ollama') ? A.openaiModel : null, quota: a ? quota(a.user.id) : null });
  });

  r.post('/api/ai/chat', async (req, res) => {
    const { user } = requireUser(req);
    if (!A.provider) throw new HttpError(503, 'No AI provider is configured on this server (set ANTHROPIC_API_KEY or OPENAI_API_KEY).');
    rateLimit(`ai:${user.id}`, 40, 60e3);
    const body = await jsonBody(req, 1024 * 1024);
    if (!Array.isArray(body.messages) || !body.messages.length) throw new HttpError(400, 'messages is required');
    // Tool-loop follow-up rounds (`continuation: true`) don't count as a new request
    const q = quota(user.id);
    if (!body.continuation && q.left === 0) throw new HttpError(429, `You've reached today's fair-use limit of ${q.max} AI requests. It resets at midnight (UTC).`, { code: 'quota', quota: q });
    if (!body.continuation) count(user.id);

    const ctl = new AbortController(); req.on('close', () => ctl.abort());
    const clientTools = Array.isArray(body.tools) ? body.tools.filter((t) => t && !t.type) : [];
    const wantNative = body.web && A.web === 'on' && A.provider === 'anthropic' && nativeWebOk;
    const tools = wantNative ? [...clientTools.filter((t) => !['web_search', 'web_fetch', 'search_web', 'read_webpage'].includes(t.name)), ...webTools(userLocation(body.location))] : clientTools;
    const args = { system: String(body.system || '').slice(0, 60000), messages: body.messages, tools, stream: !!body.stream && !tools.length };
    let up = await upstream(args, ctl.signal);
    if (!up.ok && wantNative && up.status === 400) {
      const t = await up.text();
      if (/web_search|web_fetch|server tool|not enabled/i.test(t)) { nativeWebOk = false; up = await upstream({ ...args, tools: clientTools }, ctl.signal); res.setHeader('X-JX-Web', 'basic'); }
      else throw new HttpError(502, `AI provider error (400): ${t.slice(0, 300)}`);
    }
    if (!up.ok) { const t = await up.text(); throw new HttpError(502, `AI provider error (${up.status}): ${t.slice(0, 300)}`); }

    if (!args.stream) {
      const j = await up.json();
      return json(res, A.provider === 'anthropic' ? { content: j.content, stop_reason: j.stop_reason } : fromOpenAI(j));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const reader = up.body.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          const l = line.trim(); if (!l.startsWith('data:')) continue;
          const d = l.slice(5).trim(); if (d === '[DONE]') continue;
          let text; try { const j = JSON.parse(d); text = A.provider === 'anthropic' ? (j.type === 'content_block_delta' ? j.delta?.text : null) : j.choices?.[0]?.delta?.content; } catch { /* partial */ }
          if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }
    } catch (e) { if (e.name !== 'AbortError') res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); }
    res.end(`data: ${JSON.stringify({ done: true })}\n\n`);
  });
}
