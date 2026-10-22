/**
 * Test-only fetch interceptor: fakes Anthropic, Replicate, iTunes and data APIs so
 * the full server can be exercised offline. Load with:
 *   node --import ./server/test/mock-providers.js server/index.js
 * Never use in production.
 */
const realFetch = globalThis.fetch;
const subs = new Map();
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const nowS = () => Math.floor(Date.now() / 1000);

globalThis.__mock = { subs };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const body = opts.body && typeof opts.body === 'string' ? (() => { try { return JSON.parse(opts.body); } catch { return Object.fromEntries(new URLSearchParams(opts.body)); } })() : opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body) : {};

  if (u.host === 'api.razorpay.com') {
    if (u.pathname === '/v1/subscriptions' && opts.method === 'POST') { const id = 'sub_' + Math.random().toString(36).slice(2, 10); const s = { id, plan_id: body.plan_id, status: 'created', notes: body.notes, current_end: null, short_url: `https://rzp.io/i/${id}` }; subs.set(id, s); return json(s); }
    let m;
    if ((m = u.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/))) { const s = subs.get(m[1]); if (!s) return json({ error: { description: 'not found' } }, 404); if (s.status === 'created') { s.status = 'active'; s.current_end = nowS() + 30 * 86400; } return json(s); }
    if ((m = u.pathname.match(/^\/v1\/subscriptions\/([^/]+)\/cancel$/))) { const s = subs.get(m[1]); s.has_scheduled_changes = true; return json({ ...s, status: 'active' }); }
    if ((m = u.pathname.match(/^\/v1\/payments\/([^/]+)$/))) return json({ id: m[1], amount: 99900, currency: 'INR', status: 'captured' });
  }
  if (u.host === 'api.stripe.com') {
    if (u.pathname === '/v1/checkout/sessions' && opts.method === 'POST') return json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    if (u.pathname.startsWith('/v1/checkout/sessions/')) return json({ id: 'cs_test_1', status: 'complete', payment_status: 'paid', client_reference_id: globalThis.__mock.stripeUser, amount_total: 1200, currency: 'usd', metadata: { plan: 'pro', cycle: 'monthly' },
      subscription: { id: 'sub_stripe_1', status: 'active', customer: 'cus_1', cancel_at_period_end: false, metadata: { user_id: globalThis.__mock.stripeUser }, items: { data: [{ price: { id: process.env.STRIPE_PRICE_PRO_MONTHLY }, current_period_end: nowS() + 30 * 86400 }] } } });
  }
  if (u.host === 'api.anthropic.com') {
    globalThis.__mock.lastAnthropic = body;
    const last = body.messages.at(-1);
    if ((body.tools || []).some((t) => t.type === 'web_search_20250305') && /latest|news|today/i.test(typeof last.content === 'string' ? last.content : '')) {
      return json({ stop_reason: 'end_turn', content: [
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'ISRO latest launch' } },
        { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://www.isro.gov.in/launch', title: 'ISRO launches', page_age: 'October 21, 2026', encrypted_content: 'enc' }] },
        { type: 'text', text: 'ISRO launched a new satellite on 21 October 2026.', citations: [{ type: 'web_search_result_location', url: 'https://www.isro.gov.in/launch', title: 'ISRO launches', encrypted_index: 'x', cited_text: 'launched a new satellite' }] },
      ] });
    }
    const text = typeof last.content === 'string' ? last.content : '';
    if (body.tools && /add a task/i.test(text)) {
      const title = text.replace(/.*add a task (to )?/i, '').replace(/[.?!]$/, '');
      return json({ content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'tu_1', name: 'add_task', input: { title, priority: 'hi' } }], stop_reason: 'tool_use' });
    }
    if (Array.isArray(last.content) && last.content[0]?.type === 'tool_result') return json({ content: [{ type: 'text', text: 'Added it to your tasks as high priority.' }], stop_reason: 'end_turn' });
    if (body.stream) {
      const enc = new TextEncoder();
      const chunks = ['Hello', ' from', ' the', ' mock', ' model.'].map((t) => `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: t } })}\n\n`);
      return new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return json({ content: [{ type: 'text', text: `Mock answer to: ${text.slice(0, 60)}` }], stop_reason: 'end_turn' });
  }
  if (u.host === 'news.google.com') return new Response('<rss><channel><item><title>Mock headline one - Source A</title><link>https://example.com/1</link><source>Source A</source><pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>', { status: 200 });
  if (u.host === 'query1.finance.yahoo.com') return json({ chart: { result: [{ meta: { regularMarketPrice: 101, chartPreviousClose: 100, currency: 'USD', regularMarketTime: nowS(), shortName: 'Mock Corp' }, indicators: { quote: [{ close: [99, 100, 101] }] } }] } });
  if (u.host === 'api.frankfurter.app') return json({ base: 'USD', date: '2026-10-09', rates: { EUR: 0.9, INR: 84 } });
  if (u.host === 'api.resend.com') return json({ id: 'mail_1' });
  if (u.host === 'api.replicate.com') {
    if (opts.method === 'POST') return json({ id: 'pred_1', status: 'starting', output: null });
    return json({ id: 'pred_1', status: 'succeeded', output: 'https://replicate.delivery/mock/video.mp4' });
  }
  if (u.host === 'html.duckduckgo.com') return new Response('<div class="result results_links web-result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fweather&amp;rut=x">Bengaluru weather today</a><a class="result__snippet" href="#">Sunny, <b>29°C</b> with light winds.</a></div><div class="result results_links"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>', { status: 200, headers: { 'content-type': 'text/html' } });
  if (u.host === '93.184.215.14') return new Response('<html><head><title>Mock Article</title><meta property="og:site_name" content="Mock News"></head><body><nav>Menu</nav><article><h1>Big story</h1><p>This is the first paragraph of a long article about something important.</p><script>evil()</script><p>Second paragraph with more words to pass the length filter.</p></article><footer>foot</footer></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  if (u.host === 'itunes.apple.com') return json({ results: [{ trackId: 1, trackName: 'Mock Song', artistName: 'Mock Artist', collectionName: 'Mock Album', artworkUrl100: 'https://example.com/100x100.jpg', previewUrl: 'https://example.com/p.m4a' }] });
  return realFetch(url, opts);
};
