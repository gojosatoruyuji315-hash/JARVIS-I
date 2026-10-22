/**
 * Reader proxy for the Internet app (server mode):
 *   GET /api/web/read?url=https://…   → { url, title, site, image, blocks: [{t:'h'|'p'|'li'|'q', x}] }
 *   GET /api/web/search?q=…           → { results: [{ title, url, snippet }] }  (free search for the assistant)
 *
 * Lets the in-app browser show any article as clean, readable text even when the site
 * refuses to be framed. Signed-in users only, rate-limited, public http(s) addresses only
 * (private / loopback / link-local networks are refused to prevent SSRF), 10 s timeout,
 * 3 MB cap, up to 4 redirects each re-checked.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { HttpError, json, rateLimit, clientIp } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36 JARVIS-X-Reader';
const MAX = 3 * 1024 * 1024;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}
async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Only http and https pages can be read.');
  if (u.port && !['80', '443'].includes(u.port)) throw new HttpError(400, 'That port is not allowed.');
  if (u.username || u.password) throw new HttpError(400, 'Addresses with credentials are not allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new HttpError(400, 'That address could not be found.'); });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new HttpError(400, 'Private network addresses cannot be read.');
}

const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) => (c[0] === '#' ? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : +c.slice(1)) : ent[c.toLowerCase()] ?? m));
const text = (html) => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*/g, '\n').trim();
const meta = (html, prop) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)`, 'i'))?.[1] || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'))?.[1];

/** Very small "readability": main/article region → headings, paragraphs, list items, quotes. */
export function extract(html, url) {
  const title = decode(meta(html, 'og:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).trim();
  const site = decode(meta(html, 'og:site_name') || new URL(url).hostname.replace(/^www\./, ''));
  let image = meta(html, 'og:image'); try { if (image) image = new URL(decode(image), url).href; } catch { image = null; }
  let body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|form|iframe|template)[\s\S]*?<\/\1>/gi, '');
  const region = body.match(/<article[\s\S]*?<\/article>/gi)?.sort((a, b) => b.length - a.length)[0] || body.match(/<main[\s\S]*?<\/main>/i)?.[0] || body.match(/<body[\s\S]*<\/body>/i)?.[0] || body;
  const cleaned = region.replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, '');
  const blocks = [];
  for (const m of cleaned.matchAll(/<(h[1-4]|p|li|blockquote|pre)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = m[1].toLowerCase(); const x = text(m[2]);
    if (!x || (t === 'p' && x.length < 25) || (t === 'li' && x.length < 3)) continue;
    blocks.push({ t: t[0] === 'h' ? 'h' : t === 'blockquote' ? 'q' : t === 'pre' ? 'pre' : t, x: x.slice(0, 4000) });
    if (blocks.length >= 400) break;
  }
  return { url, title, site, image: image || null, blocks };
}

/** Parse DuckDuckGo's no-JavaScript results page. */
export function parseDDG(html) {
  const out = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const b of blocks) {
    const a = b.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i); if (!a) continue;
    let url = decode(a[1]);
    const uddg = url.match(/[?&]uddg=([^&]+)/); if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js|\/\/duckduckgo\.com\/\?/.test(url)) continue; // skip ads
    const sn = b.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    out.push({ title: text(a[2]), url, snippet: sn ? text(sn[1]).slice(0, 400) : '' });
    if (out.length >= 10) break;
  }
  return out;
}
const searchCache = new Map();

export function webRoutes(r) {
  r.get('/api/web/search', async (req, res) => {
    requireUser(req);
    rateLimit(`wsearch:${clientIp(req)}`, 40, 60e3);
    const q = (req.query.get('q') || '').trim().slice(0, 200);
    if (!q) throw new HttpError(400, 'q is required');
    const hit = searchCache.get(q.toLowerCase()); if (hit && Date.now() - hit.t < 10 * 60e3) return json(res, hit.v);
    let results = [];
    try {
      const r1 = await fetch('https://html.duckduckgo.com/html/', { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'en-IN,en;q=0.9' }, body: `q=${encodeURIComponent(q)}&kl=in-en` });
      if (r1.ok) results = parseDDG(await r1.text());
    } catch { /* fall back below */ }
    if (!results.length) {
      try {
        const j = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=6&format=json`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) })).json();
        results = (j.query?.search || []).map((x) => ({ title: x.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`, snippet: text(x.snippet) }));
      } catch { /* none */ }
    }
    const v = { q, results, source: results.length && !results[0].url.includes('wikipedia.org') ? 'duckduckgo' : 'wikipedia' };
    searchCache.set(q.toLowerCase(), { t: Date.now(), v });
    return json(res, v);
  });

  r.get('/api/web/read', async (req, res) => {
    requireUser(req);
    rateLimit(`read:${clientIp(req)}`, 30, 60e3);
    let u; try { u = new URL(req.query.get('url') || ''); } catch { throw new HttpError(400, 'Give a full web address, like https://example.com/page'); }
    let resp;
    for (let hop = 0; hop < 5; hop++) {
      await assertPublic(u);
      resp = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-IN,en;q=0.9' } }).catch(() => { throw new HttpError(502, 'That site did not respond.'); });
      if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) { u = new URL(resp.headers.get('location'), u); continue; }
      break;
    }
    if (!resp.ok) throw new HttpError(502, `The site answered ${resp.status}.`);
    if (!/html|xml/.test(resp.headers.get('content-type') || '')) throw new HttpError(415, 'Reader view works on web pages (HTML) only.');
    const reader = resp.body.getReader(); const chunks = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX) { reader.cancel(); break; } chunks.push(value); }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    return json(res, extract(html, u.href));
  });
}
