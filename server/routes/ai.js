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
  const t = toOpenAI(system, messages, tools);
  return fetch(`${A.openaiBase}/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${A.openaiKey}` },
    body: JSON.stringify({ model: A.openaiModel, max_tokens: A.maxTokens, messages: t.messages, tools: t.tools, stream: !!stream }) });
}

export function aiRoutes(r) {
  r.get('/api/ai/status', async (req, res) => {
    const a = req.auth;
    return json(res, { configured: !!A.provider, provider: A.provider || null, model: A.provider === 'anthropic' ? A.anthropicModel : A.provider === 'openai' ? A.openaiModel : null, quota: a ? quota(a.user.id) : null });
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
    const up = await upstream({ system: String(body.system || '').slice(0, 60000), messages: body.messages, tools: body.tools, stream: !!body.stream && !body.tools?.length }, ctl.signal);
    if (!up.ok) { const t = await up.text(); throw new HttpError(502, `AI provider error (${up.status}): ${t.slice(0, 300)}`); }

    if (!body.stream || body.tools?.length) {
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
