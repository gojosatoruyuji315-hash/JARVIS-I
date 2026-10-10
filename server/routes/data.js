/**
 * Live data proxies with in-memory caching:
 *   /api/data/news?q=topic      Google News RSS (no key)
 *   /api/data/quotes?symbols=   Yahoo Finance chart API, or Finnhub when FINNHUB_API_KEY is set
 *   /api/data/fx?base=USD       ECB reference rates (Frankfurter), fallback open.er-api.com
 */
import { config } from '../lib/config.js';
import { HttpError, json, rateLimit, clientIp } from '../lib/http.js';

const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key); if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn(); cache.set(key, { t: Date.now(), v }); return v;
}
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; JARVIS-X/1.0)' };
const decode = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '').trim();
const tag = (xml, t) => decode(xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1]);

export function dataRoutes(r) {
  r.get('/api/data/news', async (req, res) => {
    rateLimit(`news:${clientIp(req)}`, 30, 60e3);
    const q = (req.query.get('q') || '').slice(0, 80);
    const region = (req.query.get('region') || 'IN:en').replace(/[^A-Za-z:]/g, '');
    const [gl, hl] = region.split(':');
    const url = q ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}-${gl}&gl=${gl}&ceid=${gl}:${hl}` : `https://news.google.com/rss?hl=${hl}-${gl}&gl=${gl}&ceid=${gl}:${hl}`;
    const items = await cached(url, 10 * 60e3, async () => {
      const x = await fetch(url, { headers: UA }); if (!x.ok) throw new HttpError(502, 'News feed unavailable');
      const xml = await x.text();
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20).map(([, it]) => ({ title: tag(it, 'title'), link: tag(it, 'link'), source: tag(it, 'source'), published: Date.parse(tag(it, 'pubDate')) || null }));
    });
    return json(res, { items, fetchedAt: cache.get(url)?.t });
  });

  r.get('/api/data/quotes', async (req, res) => {
    rateLimit(`quotes:${clientIp(req)}`, 30, 60e3);
    const symbols = (req.query.get('symbols') || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.^=-]{1,15}$/.test(s)).slice(0, 12);
    if (!symbols.length) throw new HttpError(400, 'symbols is required');
    const quotes = await Promise.all(symbols.map((s) => cached(`q:${s}`, 60e3, async () => {
      try {
        if (config.data.finnhubKey) {
          const j = await (await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${config.data.finnhubKey}`)).json();
          return { symbol: s, price: j.c, change: j.d, changePct: j.dp, prevClose: j.pc, time: j.t * 1000, spark: [] };
        }
        const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=15m`, { headers: UA })).json();
        const m = j.chart?.result?.[0]; if (!m) return { symbol: s, error: 'Unknown symbol' };
        const closes = (m.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
        const price = m.meta.regularMarketPrice, prev = m.meta.chartPreviousClose ?? m.meta.previousClose;
        return { symbol: s, name: m.meta.shortName || m.meta.longName || s, currency: m.meta.currency, price, prevClose: prev, change: price - prev, changePct: ((price - prev) / prev) * 100, time: m.meta.regularMarketTime * 1000, spark: closes.slice(-30) };
      } catch { return { symbol: s, error: 'Quote unavailable' }; }
    })));
    return json(res, { quotes, source: config.data.finnhubKey ? 'Finnhub' : 'Yahoo Finance (delayed)' });
  });

  r.get('/api/data/fx', async (req, res) => {
    const base = (req.query.get('base') || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    const data = await cached(`fx:${base}`, 3600e3, async () => {
      try {
        const j = await (await fetch(`https://api.frankfurter.app/latest?from=${base}`)).json();
        if (j.rates) return { base, date: j.date, rates: { ...j.rates, [base]: 1 }, source: 'European Central Bank (Frankfurter)' };
      } catch { /* fall through */ }
      const j = await (await fetch(`https://open.er-api.com/v6/latest/${base}`)).json();
      if (j.result !== 'success') throw new HttpError(502, 'Exchange rates unavailable');
      return { base, date: j.time_last_update_utc, rates: j.rates, source: 'ExchangeRate-API' };
    });
    return json(res, data);
  });
}
