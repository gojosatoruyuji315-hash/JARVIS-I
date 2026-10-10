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
    const last = body.messages.at(-1);
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
  if (u.host === 'itunes.apple.com') return json({ results: [{ trackId: 1, trackName: 'Mock Song', artistName: 'Mock Artist', collectionName: 'Mock Album', artworkUrl100: 'https://example.com/100x100.jpg', previewUrl: 'https://example.com/p.m4a' }] });
  return realFetch(url, opts);
};
