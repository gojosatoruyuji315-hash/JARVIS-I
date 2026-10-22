/**
 * Live web — lets the AI look things up on the real internet and answer with sources.
 *
 * How the assistant gets live information, best first:
 *  1. Anthropic's own web search + web fetch tools (JARVIS-X server with an Anthropic key,
 *     or your own Anthropic key) — the model searches the web and reads pages itself,
 *     with citations.
 *  2. JARVIS-X's free search tools — `search_web` (DuckDuckGo results through your server,
 *     or DuckDuckGo instant answers + Wikipedia in the browser) and `read_webpage`
 *     (reader proxy on the server; Wikipedia anywhere).
 *  3. For engines without tool use (OpenAI-compatible keys, the offline engine) JARVIS-X
 *     searches first and hands the results to the AI (or answers from them directly).
 * Live web needs a normal browser tab (the Claude viewer keeps pages offline).
 * @module core/liveweb
 */
import { store } from './store.js';
import { platform } from './platform.js';

/** Is live web on and possible here? */
export const liveWebOn = () => store.get('settings.ai.web') !== false && platform.hasNetwork && platform.directNetwork;

/** Approximate location for better local results (time zone + country from the browser language). */
export function approxLocation() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cc = (navigator.language || '').split('-')[1]?.toUpperCase() || (tz === 'Asia/Calcutta' || tz === 'Asia/Kolkata' ? 'IN' : undefined);
  return { timezone: tz, ...(cc && /^[A-Z]{2}$/.test(cc) ? { country: cc } : {}) };
}

/** Questions that need fresh or factual information from the web. */
export function needsWeb(q) {
  const s = q.toLowerCase();
  if (s.length < 6) return false;
  return /\b(latest|today|tonight|yesterday|this (week|month|year)|current(ly)?|right now|news|price|cost|rate|score|match|weather|forecast|result|released?|launch|stock|share|election|who (is|won|was)|when (is|was|did|does)|what (is|are|was|happened)|where (is|can)|how (much|many|to)|define|meaning of|population|capital of|ceo of|president|prime minister|minister|20(2[4-9]|3\d))\b/.test(s) || /\?$/.test(s.trim());
}

const getJSON = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = `__jx_lw_${Math.random().toString(36).slice(2)}`; const s = document.createElement('script');
    const done = (f, v) => { delete window[cb]; s.remove(); clearTimeout(t); f(v); };
    window[cb] = (d) => done(resolve, d); s.onerror = () => done(reject, new Error('failed'));
    s.src = `${url}&callback=${cb}`; const t = setTimeout(() => done(reject, new Error('timeout')), 8000); document.head.append(s);
  });
}

/** Search the web. Returns [{ title, url, snippet }]. */
export async function searchWeb(query) {
  const q = String(query).slice(0, 200);
  if (platform.isServer) {
    const { api } = await import('./api.js');
    const j = await api(`/api/web/search?q=${encodeURIComponent(q)}`);
    if (j.results?.length) return j.results.slice(0, 8);
  }
  // In the browser: DuckDuckGo instant answer + Wikipedia search (both allow pages to call them)
  const [ddg, wiki] = await Promise.all([
    jsonp(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`).catch(() => null),
    getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&format=json&origin=*`).catch(() => null),
  ]);
  const out = [];
  if (ddg?.AbstractText || ddg?.Answer) out.push({ title: ddg.Heading || q, url: ddg.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(q)}`, snippet: ddg.Answer || ddg.AbstractText });
  for (const r of (ddg?.RelatedTopics || []).filter((x) => x.FirstURL).slice(0, 3)) out.push({ title: r.Text?.split(' - ')[0] || r.FirstURL, url: r.FirstURL, snippet: r.Text || '' });
  for (const r of wiki?.query?.search || []) out.push({ title: `${r.title} — Wikipedia`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`, snippet: r.snippet.replace(/<[^>]+>/g, '') });
  return out.slice(0, 8);
}

/** Read a web page as plain text. */
export async function readPage(url) {
  const u = String(url);
  const wiki = u.match(/^https?:\/\/(\w+)\.(?:m\.)?wikipedia\.org\/wiki\/([^#?]+)/);
  if (wiki) {
    const j = await getJSON(`https://${wiki[1]}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${wiki[2]}&format=json&origin=*`);
    const p = Object.values(j.query.pages)[0];
    return { url: u, title: p.title, text: (p.extract || '').slice(0, 15000) };
  }
  if (platform.isServer) {
    const { api } = await import('./api.js');
    const d = await api(`/api/web/read?url=${encodeURIComponent(u)}`);
    return { url: d.url, title: d.title, text: (d.blocks || []).map((b) => b.x).join('\n\n').slice(0, 15000) };
  }
  // Last resort: sites that allow pages to read them
  const r = await fetch(u).catch(() => null);
  if (!r?.ok) throw new Error('This page can only be read through the JARVIS-X server (the site does not allow apps to read it directly).');
  const html = await r.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,header,footer,aside,noscript').forEach((n) => n.remove());
  return { url: u, title: doc.title, text: (doc.querySelector('article,main') || doc.body).innerText.replace(/\n{3,}/g, '\n\n').slice(0, 15000) };
}

/** Client tools the AI can call (any engine with tool use). */
export const WEB_TOOLS = [
  { name: 'search_web', web: true, description: 'Search the live internet for current or factual information (news, prices, scores, weather, recent events, facts you are unsure of). Returns titles, URLs and snippets — cite the URLs you use.', schema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] },
    async run(i) { const results = await searchWeb(i.query); return { query: i.query, results }; } },
  { name: 'read_webpage', web: true, description: 'Open a web page (from search results or the user) and read its text, to get details and exact facts. Cite the URL.', schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    async run(i) { const p = await readPage(i.url); return { ...p, text: p.text.slice(0, 12000) }; } },
];

/** For engines without tools: search first, return a context block + sources. */
export async function prefetchContext(question) {
  const results = await searchWeb(question);
  if (!results.length) return null;
  let top = '';
  try { const p = await readPage(results[0].url); top = `\n\nFull text of [1] (${p.title}):\n${p.text.slice(0, 6000)}`; } catch { /* snippets only */ }
  const block = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
  return { results, text: `Live web results for "${question}" (fetched ${new Date().toString()}):\n\n${block}${top}` };
}

/** Markdown "Sources" list. */
export const sourcesMarkdown = (list) => {
  const seen = new Set(); const uniq = [];
  for (const s of list) { if (!s?.url || seen.has(s.url)) continue; seen.add(s.url); uniq.push(s); }
  return uniq.length ? `\n\n**Sources**\n${uniq.slice(0, 8).map((s, i) => `${i + 1}. [${(s.title || s.url).replace(/[[\]]/g, '')}](${s.url})`).join('\n')}` : '';
};

/** Standing instructions while live web is on. */
export function webInstructions() {
  return [`LIVE WEB IS ON. Today is ${new Date().toDateString()}. You have real internet access through your web search and web page reading tools.`,
    '- For anything current or factual you are not certain about (news, prices, sports, weather, recent releases, people in office, dates, statistics), search first instead of guessing, then read the most relevant page when details matter.',
    '- Answer with the actual information found — numbers, names, dates — not just links. Mention when a source is dated.',
    '- Cite sources inline with Markdown links. Never say you cannot browse the internet.'].join('\n');
}
