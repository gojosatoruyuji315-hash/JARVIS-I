/**
 * AI provider layer.
 *
 * Every provider implements:
 *   async run(messages, { system, signal, onText(fullText), tools, tier }) → final text
 * `messages` are plain {role:'user'|'assistant', content:string} turns.
 *
 *  claude     Claude inside a Claude viewer (`sample` capability) — real model,
 *             with the app's tools (tasks, calendar, notes, memory…). No key needed.
 *  server     The JARVIS-X server's AI proxy (keys and quotas live on the server),
 *             with the same tools via an Anthropic-format tool loop.
 *  anthropic  Anthropic Messages API with your own key (tool loop, direct from browser).
 *  openai     Any OpenAI-compatible endpoint with your own key (OpenAI, OpenRouter,
 *             Groq, Ollama/LM Studio at http://localhost:…/v1). Streams, no tools.
 *  local      Offline engine (rules, math solver, summariser). Always available.
 *
 * `auto` (the default setting) picks claude → server → your key → local.
 * @module core/ai
 */
import { studyMode } from './studymode.js';
import { store } from './store.js';
import { sleep, fmt, todayKey } from './dom.js';
import { tryCalc, solveEquation, tryConvert } from './mathx.js';
import { platform } from './platform.js';
import { api, readSSE } from './api.js';
import { sampleTools, anthropicTools, runTool } from './tools.js';
import { bus } from './bus.js';
import { license } from './license.js';

/* ============================================================ personalities */
/** How JARVIS-X talks while you study (used automatically in study mode and the Teacher). */
export const TEACHER_PERSONA = [
  "You are the user's personal teacher in a one-to-one lesson. Talk like a really good teacher: calm, clear, structured, patient and encouraging — a warm classroom voice (\"Let's start with…\", \"Good question!\", \"Now you try this one…\", \"Nearly — look again at step 2\").",
  '- Teach in small steps: explain the idea simply, give a worked example, then ask the student to try one themselves.',
  '- Check every answer the student gives: say clearly whether it is right, praise what they did well, and correct mistakes kindly by explaining *why*.',
  '- For homework or exercise problems give hints and leading questions first; show the full worked solution only if the student asks for it or is still stuck after trying.',
  '- Use headings, numbered steps and short paragraphs for lessons; define new terms in **bold**.',
  '- End every reply with exactly one question or small task for the student, unless the lesson is finished.',
  '- If the student drifts off-topic, answer briefly and gently guide them back to the lesson.',
].join('\n');

export const PERSONALITIES = {
  sweet:    { label: 'Sweet & caring', plan: 'free', prompt: "Talk sweetly — warm, gentle and kind, like a caring friend who is always happy to help. Be encouraging and reassuring, use the user's name now and then, celebrate their small wins and be extra gentle when something goes wrong. Keep it sincere, never gushing or romantic; at most one fitting emoji. Stay clear, accurate and helpful." },
  balanced: { label: 'Balanced', plan: 'free', prompt: 'Be warm, clear and efficient. Use short paragraphs and lists when helpful.' },
  concise:  { label: 'Concise', plan: 'free', prompt: 'Answer in as few words as possible while staying correct and useful.' },
  mentor:   { label: 'Mentor', plan: 'pro', prompt: 'Teach patiently. Explain the why, check understanding, and end with a short practice question.' },
  witty:    { label: 'Witty', plan: 'pro', prompt: 'Be helpful with a dry, light sense of humour. Never let jokes get in the way of accuracy.' },
  formal:   { label: 'Executive', plan: 'pro', prompt: 'Use a crisp, formal, executive-briefing style with headings and bullet points.' },
  custom:   { label: 'Custom…', plan: 'pro', prompt: '' },
};

/** Build the standing instructions from profile, memory, personality and KB snippets. */
export function buildSystemPrompt({ memoryLimit = 50, kbSnippets = [], tools = true, persona = null } = {}) {
  const s = store.state;
  const p = PERSONALITIES[s.settings.ai.personality] ?? PERSONALITIES.sweet;
  const teaching = persona === 'teacher' || (studyMode.active && studyMode.session.tutor !== false);
  const style = teaching ? TEACHER_PERSONA : s.settings.ai.personality === 'custom' ? (s.settings.ai.customPersona || PERSONALITIES.sweet.prompt) : p.prompt;
  const facts = (s.memory.facts || []).slice(-memoryLimit).map((f) => `- ${f.text}`).join('\n');
  const open = s.tasks.filter((t) => !t.done).length;
  return [
    `You are JARVIS-X, the user's personal AI operating system. ${style}`,
    `User: ${s.profile.name}. Now: ${new Date().toString()} (today is ${todayKey()}).`,
    `The user has ${open} open task(s), ${s.events.filter((e) => e.date >= todayKey()).length} upcoming event(s) and ${s.notes.length} note(s).`,
    tools && 'You can act inside the app with your tools: manage tasks, calendar events, reminders, notes, memory, timers, focus sessions, flashcards, music, themes and routines. When the user asks you to do something the tools cover, do it with the tools instead of describing steps, then confirm briefly what you did. Use get_agenda before planning or answering schedule questions. Resolve relative dates ("tomorrow", "next Friday") against today\'s date.',
    facts && `Long-term memory about the user:\n${facts}`,
    kbSnippets.length && `Relevant knowledge-base excerpts:\n${kbSnippets.map((k) => `[${k.title}] ${k.text}`).join('\n')}`,
    teaching ? studyMode.lessonContext() : '',
    'Format answers in Markdown. If you are unsure, say so.',
  ].filter(Boolean).join('\n\n');
}

/* ================================================================ helpers */
async function* sse(response, pick) {
  if (!response.ok) { let msg = `${response.status} ${response.statusText}`; try { msg += ' — ' + (await response.text()).slice(0, 300); } catch { /* */ } throw new Error(msg); }
  const reader = response.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const l = line.trim(); if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim(); if (data === '[DONE]') return;
      try { const t = pick(JSON.parse(data)); if (t) yield t; } catch { /* keep-alive / partial */ }
    }
  }
}
/** Reveal a finished answer progressively so every provider feels the same. */
async function reveal(text, onText, signal, prefix = '') {
  const parts = text.match(/\S+\s*|\n/g) || [text]; let out = prefix;
  for (let i = 0; i < parts.length; i += 3) { if (signal?.aborted) break; out += parts.slice(i, i + 3).join(''); onText?.(out); await sleep(8); }
  return prefix + text;
}
const TOOL_LABEL = (n) => n.replace(/_/g, ' ');

/**
 * Anthropic-format tool loop. `call({system, messages, tools, continuation})` → {content, stop_reason}.
 * Runs tool_use blocks locally and feeds results back, up to 6 rounds.
 */
async function anthropicLoop(call, { system, messages, onText, signal }) {
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  let shown = '';
  for (let round = 0; round < 6; round++) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
    const r = await call({ system, messages: msgs, tools: anthropicTools(), continuation: round > 0 });
    const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const uses = (r.content || []).filter((b) => b.type === 'tool_use');
    if (text) shown = await reveal(text + (uses.length ? '\n\n' : ''), onText, signal, shown);
    if (r.stop_reason !== 'tool_use' || !uses.length) return shown || '(No response)';
    msgs.push({ role: 'assistant', content: r.content });
    const results = [];
    for (const u of uses) {
      onText?.(shown + `_${TOOL_LABEL(u.name)}…_`);
      try { results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input)).slice(0, 30000) }); }
      catch (e) { results.push({ type: 'tool_result', tool_use_id: u.id, content: `Error: ${e.message}`, is_error: true }); }
    }
    msgs.push({ role: 'user', content: results });
  }
  return shown;
}

const SAMPLE_ERRORS = {
  not_granted: 'Claude access wasn\'t allowed for this page. Allow it from the page\'s permissions to use AI.',
  sampling_disabled: 'Claude isn\'t available for this account.',
  rate_limited: 'You\'ve hit a Claude usage limit. Try again in a little while.',
  session_expired: 'Your Claude session expired. Sign in again.',
  refused: 'Claude declined that request. Try rephrasing it.',
  prompt_too_large: 'That was too much text to send at once. Try a shorter excerpt.',
  empty_completion: 'Claude returned an empty answer. Try rephrasing.',
};

/* ================================================================ providers */
export const providers = {
  claude: {
    label: 'Claude (built in)',
    available: () => !!platform.host.sample,
    async run(messages, { system, signal, onText, tools = true, tier }) {
      const sample = platform.host.sample; if (!sample) throw new Error('Claude is not available in this view.');
      const turns = messages.filter((m) => m.content?.trim());
      while (turns[0]?.role === 'assistant') turns.shift();
      const input = [{ role: 'user', content: `[Standing instructions — follow them, do not reply to this turn on its own]\n${system}` }, ...turns];
      if (input.at(-1).role !== 'user') input.push({ role: 'user', content: 'Continue.' });
      const useTools = tools && platform.host.toolsMax > 0;
      try {
        const r = await sample(input, { signal, cache: false, modelTier: tier || store.get('settings.ai.tier') || 'default', onText: ({ text }) => onText?.(text), ...(useTools ? { tools: sampleTools(platform.host.toolsMax) } : {}) });
        return r.truncated ? `${r.text}\n\n_(Answer was cut short — ask for less at a time.)_` : r.text;
      } catch (e) {
        if (e.code === 'cancelled') throw Object.assign(new Error('Stopped'), { name: 'AbortError', partial: e.text });
        if (e.code === 'tools_unavailable') { platform.host.toolsMax = 0; return this.run(messages, { system, signal, onText, tools: false, tier }); }
        throw Object.assign(new Error(SAMPLE_ERRORS[e.code] || e.message || 'Claude could not answer right now.'), { code: e.code, partial: e.text });
      }
    },
  },
  server: {
    label: 'JARVIS-X Cloud AI',
    available: () => platform.isServer && !!platform.server?.features?.ai && !!license.user(),
    async run(messages, { system, signal, onText, tools = true }) {
      if (!tools) {
        const res = await api('/api/ai/chat', { method: 'POST', body: { system, messages, stream: true }, signal, raw: true });
        let out = '';
        for await (const ev of readSSE(res)) { if (ev.error) throw new Error(ev.error); if (ev.text) { out += ev.text; onText?.(out); } }
        return out;
      }
      return anthropicLoop((body) => api.post('/api/ai/chat', body, { signal }), { system, messages, onText, signal });
    },
  },
  anthropic: {
    label: 'Anthropic (your key)',
    available: () => !!store.get('secrets.aiKey'),
    async run(messages, { system, signal, onText }) {
      const cfg = store.get('settings.ai');
      const url = (cfg.endpoint || 'https://api.anthropic.com').replace(/\/$/, '') + '/v1/messages';
      return anthropicLoop(async (body) => {
        const res = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-api-key': store.get('secrets.aiKey') || '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: cfg.model || 'claude-sonnet-4-5', max_tokens: 2048, temperature: cfg.temperature, system: body.system, messages: body.messages, tools: body.tools }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Anthropic ${res.status}: ${j.error?.message || res.statusText}`);
        return j;
      }, { system, messages, onText, signal });
    },
  },
  openai: {
    label: 'OpenAI-compatible (your key)',
    available: () => !!store.get('settings.ai.endpoint') || !!store.get('secrets.aiKey'),
    async run(messages, { system, signal, onText }) {
      const cfg = store.get('settings.ai');
      const url = (cfg.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
      const res = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(store.get('secrets.aiKey') ? { Authorization: `Bearer ${store.get('secrets.aiKey')}` } : {}) },
        body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', temperature: cfg.temperature, stream: true, messages: [{ role: 'system', content: system }, ...messages] }) });
      let out = '';
      for await (const t of sse(res, (j) => j.choices?.[0]?.delta?.content)) { out += t; onText?.(out); }
      return out;
    },
  },
  local: {
    label: 'Offline engine',
    available: () => true,
    async run(messages, { signal, onText }) { return reveal(localEngine(messages), onText, signal); },
  },
};

/** Which provider `auto` resolves to right now. */
export function activeProviderId() {
  const pref = store.get('settings.ai.provider');
  if (pref && pref !== 'auto' && providers[pref]) return pref;
  if (providers.claude.available()) return 'claude';
  if (providers.server.available()) return 'server';
  if (store.get('secrets.aiKey')) return store.get('settings.ai.keyProvider') || 'anthropic';
  return 'local';
}
bus.on('platform:ready', () => bus.emit('ai:provider', activeProviderId()));

/* ============================================================ local engine */
const KNOWLEDGE = {
  'photosynthesis': 'Photosynthesis is how plants, algae and some bacteria turn light into chemical energy. In chloroplasts, light reactions split water and make ATP and NADPH; the Calvin cycle then uses them to fix CO₂ into glucose.\n\n**Equation:** 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂',
  'recursion': 'Recursion is when a function solves a problem by calling itself on a smaller version of the same problem. Every recursive function needs a **base case** (stop condition) and a **recursive step** that moves toward it.\n\n```js\nfunction factorial(n) {\n  if (n <= 1) return 1;        // base case\n  return n * factorial(n - 1); // recursive step\n}\n```',
  'api': 'An **API** (Application Programming Interface) is a contract that lets one program request data or actions from another. Web APIs usually use HTTP: you send a request (method + URL + headers + body) and receive a response (status code + data, often JSON).',
  'machine learning': 'Machine learning is a way of building software that learns patterns from data instead of following hand-written rules. You choose a model, feed it training examples, measure its error with a loss function, and adjust its parameters (usually by gradient descent) until predictions generalise to new data.',
  'neural network': 'A neural network is a stack of layers of simple units ("neurons"). Each unit computes a weighted sum of its inputs and applies a non-linear activation. Training adjusts the weights with backpropagation so the network\'s outputs match the targets.',
  'black hole': 'A black hole is a region where gravity is so strong that nothing — not even light — can escape once it crosses the **event horizon**. They form when massive stars collapse; supermassive ones sit at the centres of most galaxies.',
  'inflation': 'Inflation is the rate at which the general level of prices rises, reducing the purchasing power of money. Central banks typically target around 2% a year, raising interest rates to cool inflation and lowering them to stimulate the economy.',
  'dna': 'DNA (deoxyribonucleic acid) is the molecule that stores genetic instructions. It is a double helix of two strands built from nucleotides (A, T, C, G); A pairs with T and C pairs with G. Genes are DNA segments that encode proteins.',
  'gravity': 'Gravity is the attraction between masses. Newton described it as F = G·m₁·m₂ / r²; Einstein\'s general relativity explains it as the curvature of spacetime caused by mass and energy.',
  'closure': 'A **closure** is a function that remembers variables from the scope where it was created, even after that scope has finished.\n\n```js\nfunction counter() {\n  let n = 0;\n  return () => ++n; // keeps access to n\n}\nconst next = counter(); next(); // 1\n```',
  'big o': 'Big-O notation describes how an algorithm\'s running time or memory grows as input size *n* grows, ignoring constants. Common classes: O(1) constant, O(log n) logarithmic, O(n) linear, O(n log n), O(n²) quadratic, O(2ⁿ) exponential.',
  'http': 'HTTP is the request/response protocol of the web. A client sends a method (GET, POST, PUT, DELETE…), URL, headers and optional body; the server replies with a status code (200 OK, 404 Not Found, 500 Server Error…), headers and a body.',
  'blockchain': 'A blockchain is an append-only ledger split into blocks, where each block contains the hash of the previous one. Copies are kept by many nodes, which agree on new blocks via a consensus mechanism, making past records very hard to alter.',
  'entropy': 'Entropy measures the number of microscopic arrangements consistent with a system\'s macroscopic state — informally, its disorder. The second law of thermodynamics says the total entropy of an isolated system never decreases.',
  'supply and demand': 'Supply and demand is the model of how prices form in a market. Demand falls as price rises; supply rises as price rises. The **equilibrium** price is where the two curves cross and quantity demanded equals quantity supplied.',
  'osmosis': 'Osmosis is the movement of water across a semi-permeable membrane from a region of lower solute concentration to higher solute concentration, until concentrations balance.',
  'mitochondria': 'Mitochondria are organelles that produce most of a cell\'s ATP through cellular respiration (the Krebs cycle and oxidative phosphorylation). They have their own DNA, supporting the theory that they descended from ancient bacteria.',
  'quantum computing': 'Quantum computers use **qubits**, which can be in superpositions of 0 and 1 and become entangled. Algorithms exploit interference to amplify correct answers, giving speed-ups for problems like factoring (Shor) and search (Grover).',
  'compound interest': 'Compound interest is interest earned on both the principal and previously earned interest.\n\n**A = P(1 + r/n)^(n·t)** — P principal, r annual rate, n compounds per year, t years.',
  'pythagorean theorem': 'In a right triangle, the square of the hypotenuse equals the sum of the squares of the other two sides: **a² + b² = c²**.',
  'derivative': 'A derivative measures how fast a function changes at a point — the slope of its tangent line. Formally f\'(x) = lim(h→0) [f(x+h) − f(x)] / h. Example: d/dx x² = 2x.',
  'integral': 'An integral accumulates quantities — geometrically, the signed area under a curve. The Fundamental Theorem of Calculus links it to derivatives: ∫ₐᵇ f\'(x) dx = f(b) − f(a).',
  'git': 'Git is a distributed version-control system. Core loop: `git add` (stage changes) → `git commit` (snapshot) → `git push` (share). Branches let you work in parallel; `git merge` or `git rebase` combine work.',
  'sql join': 'A SQL JOIN combines rows from two tables on a related column.\n\n- **INNER JOIN** — only matching rows\n- **LEFT JOIN** — all rows from the left table + matches\n- **RIGHT JOIN** — all rows from the right table + matches\n- **FULL JOIN** — all rows from both',
  'climate change': 'Climate change is the long-term shift in global temperatures and weather patterns, driven mainly since the 1800s by burning fossil fuels, which adds greenhouse gases (CO₂, methane) that trap heat in the atmosphere.',
  'react': 'React is a JavaScript library for building UIs from components. Components are functions that return markup (JSX) from props and state; when state changes, React re-renders and efficiently updates the DOM.',
};

const STOP = new Set('a an the and or but if then of to in on at for with is are was were be been it this that these those as by from i you he she we they my your our their me him her us them not no so do does did have has had can could would should will shall may might just very really also about into over than too'.split(' '));

/** Extractive summary: score sentences by normalised word frequency. */
export function summarize(text, maxSentences = 4) {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter((s) => s.length > 20) || [];
  if (sentences.length <= maxSentences) return sentences;
  const freq = {};
  for (const w of text.toLowerCase().match(/[a-z']+/g) || []) if (!STOP.has(w) && w.length > 2) freq[w] = (freq[w] || 0) + 1;
  const max = Math.max(...Object.values(freq), 1);
  const scored = sentences.map((s, i) => {
    const words = s.toLowerCase().match(/[a-z']+/g) || [];
    const score = words.reduce((a, w) => a + (freq[w] || 0) / max, 0) / Math.sqrt(words.length || 1) + (i === 0 ? 0.3 : 0);
    return { s, i, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, maxSentences).sort((a, b) => a.i - b.i).map((x) => x.s);
}
export function keywords(text, n = 8) {
  const freq = {};
  for (const w of text.toLowerCase().match(/[a-z][a-z'-]+/g) || []) if (!STOP.has(w) && w.length > 3) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

/** Static code review heuristics (language-agnostic-ish). */
export function analyzeCode(code, lang = '') {
  const lines = code.split('\n');
  const L = lang || (/\bdef |import \w+$|print\(/m.test(code) ? 'python' : /#include|std::/.test(code) ? 'cpp' : /public static void|System\.out/.test(code) ? 'java' : /\bSELECT\b|\bFROM\b/i.test(code) ? 'sql' : /<\w+[^>]*>/.test(code) && !/[;{}]\s*$/m.test(code) ? 'html' : 'javascript');
  const fns = [...code.matchAll(/(?:function\s+(\w+)|(\w+)\s*=\s*(?:async\s*)?\(?[\w\s,]*\)?\s*=>|def\s+(\w+)|(?:public|private|static|\s)+[\w<>[\]]+\s+(\w+)\s*\([^)]*\)\s*\{)/g)].map((m) => m[1] || m[2] || m[3] || m[4]).filter(Boolean);
  const issues = [];
  if (L === 'javascript') {
    if (/\bvar\s/.test(code)) issues.push('Uses `var` — prefer `const`/`let` for block scoping.');
    if (/[^=!]==[^=]/.test(code)) issues.push('Loose equality `==` found — prefer `===` to avoid coercion bugs.');
    if (/console\.log/.test(code)) issues.push('Leftover `console.log` calls — remove or guard them for production.');
    if (/\.then\(.*\.then\(/s.test(code)) issues.push('Promise chains could be flattened with `async/await`.');
    if (/innerHTML\s*=/.test(code)) issues.push('`innerHTML` assignment — escape untrusted input to avoid XSS.');
    if (/\beval\(/.test(code)) issues.push('`eval` is slow and unsafe — avoid it.');
  }
  if (L === 'python') {
    if (/except\s*:/.test(code)) issues.push('Bare `except:` — catch specific exceptions.');
    if (/range\(len\(/.test(code)) issues.push('`range(len(x))` — consider `enumerate(x)`.');
    if (/^\s*import \*/m.test(code) || /from \w+ import \*/.test(code)) issues.push('Wildcard import — import names explicitly.');
  }
  if (L === 'sql' && /select\s+\*/i.test(code)) issues.push('`SELECT *` — list needed columns to reduce I/O.');
  if (L === 'sql' && /delete\s+from\s+\w+\s*;?\s*$/im.test(code)) issues.push('`DELETE` without `WHERE` — this removes every row.');
  const depth = Math.max(0, ...lines.map((l) => (l.match(/^\s*/)[0].length)));
  if (depth >= 16) issues.push('Deep nesting detected — extract helpers or use early returns.');
  const loops = (code.match(/\b(for|while)\b/g) || []).length;
  if (loops >= 2 && /for[\s\S]{0,200}for/.test(code)) issues.push('Nested loops — check for O(n²) behaviour; a Map/Set lookup may help.');
  const long = lines.filter((l) => l.length > 120).length;
  if (long) issues.push(`${long} line(s) exceed 120 characters.`);
  let open = 0; for (const ch of code) { if ('({['.includes(ch)) open++; if (')}]'.includes(ch)) open--; }
  if (open !== 0 && L !== 'python' && L !== 'html') issues.push(`Bracket imbalance (${open > 0 ? open + ' unclosed' : -open + ' extra closing'}).`);
  return { lang: L, lines: lines.length, functions: [...new Set(fns)], issues };
}

const ideaLenses = [
  ['Substitute', 'Swap a core ingredient of {t} for something unexpected'],
  ['Combine', 'Merge {t} with a community or social feature'],
  ['Adapt', 'Borrow a mechanic from games and apply it to {t}'],
  ['Magnify', 'Make {t} 10× bigger or more ambitious — what changes?'],
  ['Minify', 'Strip {t} down to a one-minute, one-button version'],
  ['Repurpose', 'Use {t} for a completely different audience (kids, seniors, teams)'],
  ['Reverse', 'Flip the usual order of {t} — start with the result'],
  ['Automate', 'Let an AI agent handle the most boring step of {t}'],
  ['Subscribe', 'Turn {t} into a weekly ritual or subscription box'],
  ['Teach', 'Package what you learn from {t} as a guide or mini-course'],
];

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const s = store.state;
  const t = todayKey();
  const open = s.tasks.filter((x) => !x.done);
  const due = open.filter((x) => x.due && x.due <= t);
  const ev = s.events.filter((e) => e.date === t);
  if (studyMode.active) return `${part}, ${s.profile.name}. Ready for today's lesson${studyMode.session.subject ? ` on **${studyMode.session.subject}**` : ''}? Tell me what you'd like to learn first, or type a question from your book and we'll work through it together, step by step.`;
  return `${part}, ${s.profile.name}! It's lovely to see you 😊\n\n- **${open.length}** open task${open.length === 1 ? '' : 's'}${due.length ? ` (${due.length} due today)` : ''}\n- **${ev.length}** event${ev.length === 1 ? '' : 's'} on today's calendar${ev.length ? ': ' + ev.map((e) => `${e.time || ''} ${e.title}`.trim()).join(', ') : ''}\n\nWhat would you like to work on?`;
}

function planDay() {
  const s = store.state; const t = todayKey();
  const tasks = s.tasks.filter((x) => !x.done).sort((a, b) => ({ hi: 0, med: 1, low: 2 }[a.priority] - { hi: 0, med: 1, low: 2 }[b.priority]));
  const ev = s.events.filter((e) => e.date === t).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  let hour = Math.max(new Date().getHours() + 1, 8);
  const blocks = [];
  for (const task of tasks.slice(0, 5)) {
    while (ev.some((e) => parseInt(e.time) === hour)) { const e = ev.find((x) => parseInt(x.time) === hour); blocks.push(`| ${String(hour).padStart(2, '0')}:00 | Event: ${e.title} |`); hour++; }
    if (hour > 21) break;
    blocks.push(`| ${String(hour).padStart(2, '0')}:00 | ${task.priority === 'hi' ? '**' + task.title + '**' : task.title} (25-min focus + 5 break ×2) |`); hour++;
  }
  if (!blocks.length) return 'Your task list is clear. Add tasks with "add task …" and I\'ll build a time-blocked plan.';
  return `Here's a time-blocked plan for today, highest priority first:\n\n| Time | Block |\n|---|---|\n${blocks.join('\n')}\n\nSay "start pomodoro" when you're ready for the first block.`;
}

/** The offline brain. Pure function of the conversation + app state. */
export function localEngine(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content?.trim() || '';
  const q = last.toLowerCase();
  const note = '\n\n<sub>Offline engine. For open-ended answers, connect an AI provider in **Settings → AI**.</sub>';

  if (/^(hi|hello|hey|yo|good (morning|afternoon|evening)|greetings)\b/.test(q)) return greeting();
  if (/what can you do|^help$|capabilities|commands/.test(q)) return `Here's what I can do right now, even offline:\n\n- **Commands:** "add task …", "remind me in 10 minutes to …", "note …", "open github.com", "start pomodoro", "timer 5 min", "play music", "switch theme to silver"\n- **Memory:** "remember that …", "what do you remember?"\n- **Math:** "2^10 / 4", "solve 3x + 7 = 22", "x^2 - 5x + 6 = 0"\n- **Convert:** "10 km to miles", "100 usd to inr", "72 f to c"\n- **Study:** "explain recursion", "quiz me", "summarize: <text>"\n- **Writing:** "draft an email to …", "outline an essay on …", "tighten: <text>"\n- **Code:** paste code and ask "review this"\n- **Planning:** "plan my day", "brainstorm ideas for …"`;
  if (/plan (my|the) day|daily plan|schedule my day/.test(q)) return planDay();

  // math / equations / conversions
  if (/=/.test(q) && /\b[a-z]\b/.test(q.replace(/^(solve|find)\s+/, '')) && !/==/.test(q)) {
    const sol = solveEquation(last.replace(/^(solve|find)\s+(for\s+\w\s*:?\s*)?/i, ''));
    if (sol) return sol.note || `**Solution:** ${sol.solutions.map((x) => `${sol.var} = ${x}`).join(', ')}\n\n**Steps**\n${sol.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
  }
  const conv = tryConvert(last.replace(/^(what is|what's|how much is)\s+/i, ''));
  if (conv) return `**${conv.from} = ${conv.value} ${conv.unit}**${conv.note ? `\n\n_${conv.note}_` : ''}`;
  const calc = tryCalc(last);
  if (calc) return `**${calc.expr} = ${calc.value}**`;

  // summarise
  const sumM = last.match(/^(?:summari[sz]e|tl;?dr|sum up)\s*:?\s*([\s\S]+)/i);
  if (sumM && sumM[1].length > 40) {
    const pts = summarize(sumM[1]);
    return `**Summary**\n\n${pts.map((p) => `- ${p}`).join('\n')}\n\n**Key terms:** ${keywords(sumM[1], 6).join(', ')}`;
  }

  // code review
  const codeM = last.match(/```(\w*)\n?([\s\S]*?)```/) || (/[{};]\s*$|def .+:|function |=>|#include/m.test(last) && last.split('\n').length > 2 ? [null, '', last] : null);
  if (codeM) {
    const r = analyzeCode(codeM[2], codeM[1]);
    return `**Code review** — ${r.lang}, ${r.lines} lines${r.functions.length ? `, functions: ${r.functions.map((f) => '`' + f + '`').join(', ')}` : ''}\n\n${r.issues.length ? r.issues.map((i) => `- ${i}`).join('\n') : '- No obvious issues found by static checks. ✔'}\n\n**Suggestions**\n- Add tests for edge cases (empty input, large input, invalid types).\n- Name things by intent and keep functions under ~30 lines.${note}`;
  }

  // explain
  const ex = q.match(/^(?:explain|what is|what are|what's|define|tell me about|how does)\s+(?:an?\s+|the\s+)?(.+?)(?:\s+work)?\??$/);
  if (ex) {
    const topic = ex[1].replace(/\s+(to me|simply|like i'?m \d+)$/, '').trim();
    const hit = Object.keys(KNOWLEDGE).find((k) => topic.includes(k) || k.includes(topic));
    if (hit) return `## ${hit.replace(/\b\w/g, (c) => c.toUpperCase())}\n\n${KNOWLEDGE[hit]}\n\nWant a quick quiz on this? Say **"quiz me on ${hit}"**.`;
    return `I don't have "${topic}" in my offline knowledge pack. You can:\n\n- [Search Wikipedia](https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(topic)})\n- Press **Ctrl+K** and search "${topic}"\n- Connect an AI provider in Settings for full explanations${note}`;
  }

  // brainstorm
  const bs = q.match(/(?:brainstorm|ideas? for|give me ideas about|ideas about)\s+(.+)/);
  if (bs) {
    const topic = bs[1].replace(/[?.]$/, '');
    const picks = [...ideaLenses].sort(() => Math.random() - 0.5).slice(0, 6);
    return `**Brainstorm: ${topic}**\n\n${picks.map(([k, v], i) => `${i + 1}. **${k}** — ${v.replace('{t}', topic)}`).join('\n')}\n\nPick one and I'll help you turn it into a plan.`;
  }

  // writing
  const email = q.match(/(?:draft|write)\s+(?:an?\s+)?email\s+(?:to\s+)?(.+)/);
  if (email) return `**Subject:** Quick follow-up\n\nHi ${email[1].split(/\s+(?:about|regarding|re)\s+/)[0].replace(/\b\w/g, (c) => c.toUpperCase())},\n\nI hope you're well. I'm writing ${/(about|regarding|re)\s+(.+)/.exec(email[1])?.[0] ?? 'to follow up on our last conversation'}.\n\n- Context: [one sentence on why now]\n- Ask: [the specific thing you need, with a date]\n- Next step: [what happens after they reply]\n\nThanks for your time,\n${store.state.profile.name}\n\n_Fill the brackets, or connect an AI provider for a fully written draft._`;
  const essay = q.match(/(?:outline|essay|structure)\s+(?:an?\s+)?(?:essay\s+)?(?:on|about)\s+(.+)/);
  if (essay) return `**Essay outline: ${essay[1]}**\n\n1. **Introduction** — hook, context, thesis statement\n2. **Body 1** — strongest argument + evidence\n3. **Body 2** — second argument + example or data\n4. **Body 3** — counter-argument and rebuttal\n5. **Conclusion** — restate thesis, implications, closing thought\n\nTip: write the thesis as one sentence that someone could disagree with.`;
  const tight = last.match(/^(?:tighten|shorten|rewrite|simplify)\s*:?\s*([\s\S]+)/i);
  if (tight) {
    let t = tight[1];
    const rules = [[/\bin order to\b/gi, 'to'], [/\bdue to the fact that\b/gi, 'because'], [/\bat this point in time\b/gi, 'now'], [/\b(very|really|just|basically|actually|quite|totally|literally)\s+/gi, ''], [/\bis able to\b/gi, 'can'], [/\ba lot of\b/gi, 'many'], [/\bmake a decision\b/gi, 'decide'], [/\s{2,}/g, ' ']];
    for (const [a, b] of rules) t = t.replace(a, b);
    return `**Tightened** (${tight[1].split(/\s+/).length} → ${t.split(/\s+/).length} words)\n\n> ${t.trim()}`;
  }

  // translation (tiny phrasebook)
  const tr = q.match(/translate\s+["“]?(.+?)["”]?\s+(?:to|into)\s+(\w+)/);
  if (tr) {
    const book = { hello: { spanish: 'hola', french: 'bonjour', german: 'hallo', hindi: 'नमस्ते', japanese: 'こんにちは', italian: 'ciao' }, 'thank you': { spanish: 'gracias', french: 'merci', german: 'danke', hindi: 'धन्यवाद', japanese: 'ありがとう', italian: 'grazie' }, 'good morning': { spanish: 'buenos días', french: 'bonjour', german: 'guten Morgen', hindi: 'सुप्रभात', japanese: 'おはようございます', italian: 'buongiorno' }, goodbye: { spanish: 'adiós', french: 'au revoir', german: 'auf Wiedersehen', hindi: 'अलविदा', japanese: 'さようなら', italian: 'arrivederci' }, please: { spanish: 'por favor', french: "s'il vous plaît", german: 'bitte', hindi: 'कृपया', japanese: 'お願いします', italian: 'per favore' }, 'how are you': { spanish: '¿cómo estás?', french: 'comment ça va ?', german: 'wie geht es dir?', hindi: 'आप कैसे हैं?', japanese: 'お元気ですか？', italian: 'come stai?' } };
    const hit = book[tr[1].trim()]?.[tr[2]];
    if (hit) return `**${tr[1]}** → *${tr[2]}*: **${hit}**`;
    return `My offline phrasebook doesn't cover that. [Open in Google Translate](https://translate.google.com/?sl=auto&tl=${tr[2].slice(0, 2)}&text=${encodeURIComponent(tr[1])}&op=translate), or connect an AI provider for full translation.`;
  }

  if (/quiz me|test me/.test(q)) return 'Open **Study → Quiz** (or say "open study") — I can generate questions from your flashcards or any notes you paste.';
  if (/homework|stuck on|help me (with|solve)/.test(q)) return `Let's work through it together:\n\n1. **Restate** the problem in your own words.\n2. **List** what you know and what you need to find.\n3. **Pick** a method (formula, diagram, example).\n4. **Solve** step by step — paste equations like "solve 2x + 5 = 17" and I'll show the steps.\n5. **Check** the answer makes sense (units, size, sign).\n\nPaste the exact question and I'll help with each step.`;
  if (/joke|make me laugh/.test(q)) return ['I tried to organise a hide-and-seek tournament for neural networks. Good players are hard to find — they keep overfitting to the closet.', 'My uptime is excellent. My small talk is still in beta.', 'There are 10 kinds of people: those who understand binary, and those who asked for a joke.'][Math.floor(Math.random() * 3)];
  if (/thank/.test(q)) return 'Anytime. Ready when you are.';
  if (/who are you|your name/.test(q)) return 'I\'m **JARVIS-X**, your browser-based AI operating system. I manage your tasks, notes, study sessions, code and routines — and I get smarter when you connect an AI provider.';
  if (/time\b|what day|date today/.test(q)) return `It's **${fmt.time(new Date())}** on **${fmt.date(new Date(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}**.`;

  return `I've noted that. In offline mode I'm strongest at commands, math, conversions, summaries, code review, planning and study help.\n\nTry:\n- "plan my day"\n- "explain recursion"\n- "summarize: <paste text>"\n- "brainstorm ideas for a science fair"${note}`;
}
