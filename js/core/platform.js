/**
 * Runtime platform detection. JARVIS-X runs in three environments and picks
 * real backends for each:
 *
 *  server      Served by the JARVIS-X Node server (/api/health answers):
 *              real accounts, AI proxy, sync, live data, code runner.
 *  host        Opened inside a Claude viewer (window.claude.use exists):
 *              real Claude AI with tools, claude.ai identity, cloud sync, downloads.
 *  standalone  Any static host / file server: personal edition with your own
 *              AI key; data stays in this browser.
 *
 * Detection never blocks first paint for more than ~1.5 s. Host capabilities
 * resolve later and announce themselves with the 'platform:ready' bus event.
 * @module core/platform
 */
import { bus } from './bus.js';

const state = {
  mode: 'standalone',
  server: null,      // /api/health payload
  host: { sample: null, db: null, user: null, downloads: null, mcp: null, me: null, toolsMax: 0 },
  ready: false,
  direct: null,      // host only: can the page reach the internet directly? (probed)
};

async function probeServer() {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch('api/health', { signal: ctl.signal, cache: 'no-store' }); clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.app === 'jarvis-x' ? j : null;
  } catch { return null; }
}

async function probeHost() {
  const c = window.claude;
  if (!c?.use) return;
  const [sample, db, user, downloads] = await Promise.all(['sample', 'db', 'user', 'downloads'].map((n) => c.use(n).catch(() => null)));
  Object.assign(state.host, { sample, db, user, downloads });
  if (user) state.host.me = await user.me().catch(() => null);
  if (sample) { const lim = await sample.limits().catch(() => null); state.host.toolsMax = lim?.tools?.maxCount ?? 0; }
  bus.emit('platform:ready', platform);
  // Does this viewer let the page go online? (Claude's viewer doesn't — then the Full internet overlay appears.)
  const { probeDirect } = await import('./net.js');
  state.direct = await probeDirect();
  bus.emit('platform:net', platform);
}

export const platform = {
  get mode() { return state.mode; },
  get server() { return state.server; },
  get host() { return state.host; },
  get isServer() { return state.mode === 'server'; },
  get isHost() { return state.mode === 'host'; },
  get isStandalone() { return state.mode === 'standalone'; },
  /** The page can reach the internet. */
  get hasNetwork() { return state.mode !== 'host' || !!state.direct; },
  /** The page itself can load internet resources (media streams, images as blobs, CORS fetch). */
  get directNetwork() { return state.mode !== 'host' || !!state.direct; },
  get netRoute() { return state.mode !== 'host' || state.direct ? 'direct' : null; },
  /** Re-check internet access. */
  async refreshNet() { if (state.mode !== 'host') return; const { probeDirect } = await import('./net.js'); state.direct = await probeDirect(); bus.emit('platform:net', platform); },
  label() { return { server: 'JARVIS-X Cloud', host: 'Claude workspace', standalone: 'Personal edition' }[state.mode]; },

  async detect() {
    if (window.claude?.use) { state.mode = 'host'; probeHost(); }
    else {
      state.server = await probeServer();
      if (state.server) state.mode = 'server';
    }
    state.ready = true;
    if (state.mode !== 'host') bus.emit('platform:ready', platform);
    return platform;
  },
};
