/**
 * "Full internet" overlay.
 *
 * The Claude viewer blocks pages from going online. When JARVIS-X runs there, this overlay
 * moves you to the full version — the same app running as a normal web page with real,
 * direct internet — and carries your data across:
 *
 *   • Open the full version  → your hosted copy (GitHub Pages / your server) or the copy
 *     running on your computer (launcher, http://localhost:8765). Your data travels in the
 *     URL fragment (#jx-import=…, gzip + base64url). Fragments never reach any server.
 *   • Download for my computer → a zip of this app plus one-click launchers.
 *   • Export my data            → a backup file you can import anywhere.
 *
 * On the receiving side, consumeImport() offers to load the carried data.
 * @module core/fullversion
 */
import { h, modal, toast, download } from './dom.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { platform } from './platform.js';

/** Where the hosted full version lives. Filled in by the GitHub Pages deploy (or set in the overlay). */
export const DEFAULT_FULL_URL = 'https://gojosatoruyuji315-hash.github.io/JARVIS-I/';
export const LOCAL_URL = 'http://localhost:8765/';
const MAX_FRAGMENT = 1_500_000;

export const fullUrl = () => store.get('settings.fullUrl') || DEFAULT_FULL_URL || '';

/* ---------------------------------------------------------------- data packing */
const b64url = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
async function gzip(text) {
  if (!window.CompressionStream) return { raw: true, bytes: new TextEncoder().encode(text) };
  const cs = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return { raw: false, bytes: new Uint8Array(await new Response(cs).arrayBuffer()) };
}
async function gunzip(bytes, raw) {
  if (raw) return new TextDecoder().decode(bytes);
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(ds).text();
}
/** Pack the workspace (no secrets) into a URL-fragment-safe string. */
export async function packData() {
  const { raw, bytes } = await gzip(store.export());
  return (raw ? 'r.' : 'z.') + b64url(bytes);
}

/** Open the full version, optionally carrying the data. */
export async function openFull(base, { carry = true } = {}) {
  let url = base;
  if (carry) {
    const packed = await packData();
    if (packed.length > MAX_FRAGMENT) { toast('Your data is too large to carry in a link — use “Export my data” and import the file in the full version.', { type: 'error', timeout: 7000 }); }
    else url = `${base.replace(/#.*$/, '')}#jx-import=${packed}`;
  }
  const w = (() => { try { return window.open(url, '_blank'); } catch { return null; } })();
  if (w) { try { w.opener = null; } catch { /* */ } return true; }
  // Pop-up blocked: show the link so it can be opened by hand
  modal({ title: 'Open the full version', titleIcon: 'globe', body: h('div.stack', h('div.small.dim', 'Your browser blocked the new tab. Open this link:'), h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener' }, icon('external'), 'Open JARVIS-X')), actions: [{ label: 'Close' }] });
  return false;
}

/** Receiving side: if the page was opened with #jx-import=…, offer to load the data. */
export async function consumeImport(hash = location.hash) {
  const m = hash.match(/^#jx-import=([rz])\.([\w-]+)$/);
  if (!m) return false;
  if (location.hash.startsWith('#jx-import=')) { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* */ } }
  let json;
  try { json = await gunzip(unb64url(m[2]), m[1] === 'r'); JSON.parse(json); }
  catch { toast('The carried data could not be read.', { type: 'error' }); return false; }
  const hasData = (store.get('tasks') || []).length + (store.get('notes') || []).length + (store.get('chat.conversations') || []).length > 0;
  return new Promise((resolve) => {
    modal({
      title: 'Bring your data over?', titleIcon: 'download',
      body: h('div.stack', h('div.small', 'This tab was opened from JARVIS-X inside Claude and carries your workspace (tasks, notes, chats, memory, music library, settings — no passwords or keys).'),
        hasData ? h('div.small', { style: 'color:var(--warn)' }, 'This copy already has data. Importing replaces it — export a backup first if you want to keep it.') : null),
      actions: [
        { label: 'Not now', onClick: (close) => { close(); resolve(false); } },
        { label: 'Import my data', kind: 'primary', icon: 'download', onClick: (close) => { store.import(json); close(); toast('Your data is here. Welcome to the full version.', { type: 'ok' }); resolve(true); } },
      ],
    });
  });
}

/* ---------------------------------------------------------------- download the app */
/** Build a zip of this app (+ launchers) from its own published files. */
export async function buildAppZip(onProgress) {
  const { FILES } = await import('./filelist.js');
  const { zip } = await import('./zip.js');
  if (!FILES.length) throw new Error('This copy has no download list');
  const out = [];
  let n = 0;
  for (const entry of FILES) {
    const f = typeof entry === 'string' ? entry : entry.src; const name = typeof entry === 'string' ? entry : entry.name;
    const r = await fetch(f).catch(() => null);
    if (!r?.ok) throw new Error(`Could not read ${f}`);
    let data = new Uint8Array(await r.arrayBuffer());
    if (f === 'index.html' && !/^<!doctype/i.test(new TextDecoder().decode(data.slice(0, 20)))) {
      // The Claude build stores index.html without its document wrapper: restore a full page.
      const body = new TextDecoder().decode(data);
      data = new TextEncoder().encode(`<!doctype html>\n<html lang="en" data-skin="arc">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="manifest" href="manifest.webmanifest">\n${body.replace(/^<!--.*?-->\s*/, '')}\n</body>\n</html>\n`);
    }
    out.push({ name: `jarvis-x/${name}`, data, ...(/\.(command|sh)$|serve\.mjs$/.test(name) ? { mode: 0o755 } : {}) });
    onProgress?.(++n / FILES.length);
  }
  return zip(out);
}

/* ---------------------------------------------------------------- the overlay */
export function showOverlay({ reason } = {}) {
  const urlIn = h('input.input.grow', { placeholder: 'https://you.github.io/jarvis-x/', value: fullUrl(), style: 'min-width:220px' });
  const carry = h('input', { type: 'checkbox', checked: true });
  const status = h('div.small.dim');
  const go = async (base) => {
    if (!base) { urlIn.focus(); return; }
    if (urlIn.value.trim() && urlIn.value.trim() !== fullUrl()) store.set('settings.fullUrl', urlIn.value.trim());
    await openFull(base, { carry: carry.checked });
  };
  const dl = h('button.btn', icon('download'), 'Download for my computer');
  dl.onclick = async () => {
    dl.disabled = true;
    try { const blob = await buildAppZip((p) => { status.textContent = `Packing the app… ${Math.round(p * 100)}%`; }); status.textContent = ''; await download('jarvis-x.zip', blob, 'application/zip'); }
    catch (e) { status.textContent = `${e.message}. The same zip is attached in your Claude chat.`; }
    finally { dl.disabled = false; }
  };
  modal({
    title: 'Full internet', titleIcon: 'globe', wide: true,
    body: h('div.stack',
      reason ? h('div.small', { style: 'color:var(--warn)' }, reason) : null,
      h('div.small.dim', 'The Claude viewer keeps pages offline, so here JARVIS-X can’t stream music, search the web or load live data. The full version is the same app running as a normal web page — everything works with your real internet connection.'),
      h('div.glass.widget.stack',
        h('b', 'Open the full version'),
        h('label.stack', h('span.small', 'Your hosted copy (GitHub Pages or your server)'), h('div.row', urlIn, h('button.btn.primary', { onclick: () => go(urlIn.value.trim()) }, icon('external'), 'Open'))),
        h('div.row', h('button.btn', { onclick: () => go(LOCAL_URL) }, icon('device'), 'Open on this computer'), h('span.xs.muted', 'after starting the launcher (localhost:8765)')),
        h('label.row.small', carry, 'Bring my data (tasks, notes, chats, memory, music library — no keys or passwords)')),
      h('div.glass.widget.stack',
        h('b', 'Run it on your computer'),
        h('ol.small', { style: 'margin:0' },
          h('li', 'Download and unzip JARVIS-X.'),
          h('li', 'Double-click ', h('b', 'Start JARVIS-X'), ' — the Windows, Mac or Linux file.'),
          h('li', 'Your browser opens it with full internet. Use your browser’s ', h('b', 'Install app'), ' button to keep it in your dock or Start menu.')),
        h('div.row', dl, h('button.btn.ghost', { onclick: () => download('jarvis-x-backup.json', store.export(), 'application/json') }, icon('download'), 'Export my data')), status)),
    actions: [{ label: 'Close' }],
  });
}

/** Small top-bar chip shown inside the Claude viewer. */
export function overlayChip() {
  if (!platform.isHost || platform.hasNetwork) return null;
  return h('button.btn.sm.primary', { onclick: () => showOverlay(), title: 'Open the full version with real internet', 'aria-label': 'Full internet' }, icon('globe', { size: 14 }), h('span.hide-sm', 'Full internet'));
}

/** Inline call-to-action for features that need the internet. */
export function needsInternet(what) {
  return h('div.glass.widget.stack',
    h('b', `${what} needs the internet`),
    h('div.small.dim', 'The Claude viewer keeps pages offline. Open the full version — same app, your data comes along — and it works with your real connection.'),
    h('div.row', h('button.btn.primary', { onclick: () => showOverlay() }, icon('globe'), 'Open with full internet')));
}
