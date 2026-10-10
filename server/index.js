#!/usr/bin/env node
/**
 * JARVIS-X server — zero third-party dependencies (Node ≥ 22.13).
 *
 *   node server/index.js          (or: npm start)
 *
 * Serves the app, plus /api/* (accounts, AI proxy, sync, live data,
 * code runner, media & music for plugins) and /v1/* (developer API). See server/README.md.
 */
import http from 'node:http';
import { config, PUBLIC_DIR } from './lib/config.js';
import { createRouter, HttpError, json, securityHeaders, serveStatic } from './lib/http.js';
import { authenticate } from './lib/auth.js';
import { authRoutes } from './routes/auth.js';
import { aiRoutes } from './routes/ai.js';
import { dataRoutes } from './routes/data.js';
import { syncRoutes } from './routes/sync.js';
import { runRoutes } from './routes/run.js';
import { mediaRoutes } from './routes/media.js';

const router = createRouter();
router.get('/api/health', async (req, res) => json(res, {
  ok: true, app: 'jarvis-x', version: '2.6.0',
  features: { ai: !!config.ai.provider, aiDailyLimit: config.aiDailyLimit || null, runner: config.runner.mode, media: !!config.ai.openaiKey },
}));
for (const register of [authRoutes, aiRoutes, dataRoutes, syncRoutes, runRoutes, mediaRoutes]) register(router);

const WEBHOOK = /^\/api\/webhooks?\//;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const pathname = url.pathname;
  securityHeaders(res, pathname);
  try {
    if (pathname.startsWith('/api/') || pathname === '/v1' || pathname.startsWith('/v1/')) {
      const m = router.match(req.method, pathname);
      if (!m) throw new HttpError(404, 'Not found');
      req.params = m.params; req.query = url.searchParams;
      req.auth = authenticate(req);
      // CSRF: cookie-authenticated state changes must carry our custom header (blocked cross-site without CORS)
      const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (unsafe && !WEBHOOK.test(pathname) && !req.headers.authorization && req.headers['x-jx'] !== '1') throw new HttpError(403, 'Missing X-JX header');
      for (const h of m.handlers) await h(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (serveStatic(req, res, PUBLIC_DIR, pathname)) return;
    // SPA fallback
    if (!serveStatic(req, res, PUBLIC_DIR, '/index.html')) throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error(`[${req.method} ${pathname}]`, e);
    if (e.extra?.retryAfter) res.setHeader('Retry-After', e.extra.retryAfter);
    json(res, { error: status >= 500 && !(e instanceof HttpError) ? 'Internal server error' : e.message, ...e.extra }, status);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`JARVIS-X server running at ${config.publicUrl}  (listening on ${config.host}:${config.port})`);
  console.log(`  AI: ${config.ai.provider || 'not configured'} · Code runner: ${config.runner.mode}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
