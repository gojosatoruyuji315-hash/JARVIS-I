/**
 * Internet access.
 *
 * JARVIS-X talks to the internet directly with fetch(). That works everywhere the app runs
 * as a normal web page: the one-click launcher on your computer, the JARVIS-X server, or
 * any website you host it on (e.g. GitHub Pages).
 *
 * The Claude viewer blocks pages from going online, and no code inside a page can change
 * that. There, JARVIS-X shows the "Full internet" overlay (modules/fullversion.js) which
 * opens the full version in a normal browser tab and carries your data across.
 * @module core/net
 */
import { platform } from './platform.js';

/** Can the page fetch the internet itself? (A cheap CORS-enabled endpoint, 4 s budget.) */
export async function probeDirect() {
  try {
    const r = await fetch('https://api.datamuse.com/words?ml=sun&max=1', { signal: AbortSignal.timeout?.(4000), cache: 'no-store' });
    return r.ok;
  } catch { return false; }
}

function offline() {
  return new Error(platform.isHost
    ? 'The Claude viewer blocks internet access. Open the full version (the “Full internet” button at the top) to use this.'
    : 'Network request failed — check your connection.');
}

/** Parse JSON even when it arrives wrapped in other text. */
export function looseJSON(text) {
  const t = String(text ?? '').trim();
  try { return JSON.parse(t); } catch { /* keep looking */ }
  for (const s of [t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0).sort((a, b) => a - b)) {
    const e = t.lastIndexOf(t[s] === '{' ? '}' : ']');
    if (e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { /* */ } }
  }
  throw new Error('The page did not return data in a readable format.');
}

/** Fetch several URLs as text. Returns an array of strings or Errors (same order). */
export async function getMany(urls) {
  if (!platform.directNetwork) return urls.map(() => offline());
  return Promise.all(urls.map(async (u) => {
    try { const r = await fetch(u); if (!r.ok) return new Error(`Request failed (${r.status})`); return await r.text(); }
    catch { return offline(); }
  }));
}

/** GET a URL as text. */
export async function getText(url) {
  const [r] = await getMany([url]);
  if (r instanceof Error) throw r;
  return r;
}

/** GET a URL and parse JSON. */
export async function getJSON(url, { signal } = {}) {
  if (!platform.directNetwork) throw offline();
  let r; try { r = await fetch(url, { signal }); } catch (e) { if (e?.name === 'AbortError' || e?.name === 'TimeoutError') throw e; throw offline(); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || j.error || j.message || `Request failed (${r.status})`);
  return j;
}

/** Several JSON URLs at once. Errors are returned in place. */
export async function getJSONMany(urls) {
  return (await getMany(urls)).map((t) => { if (t instanceof Error) return t; try { return looseJSON(t); } catch (e) { return e; } });
}

/** Web search is not available without a search API; kept for API compatibility. */
export async function webSearch() { throw new Error('Web search is not available here.'); }
export const canSearchWeb = () => false;

/** Open a page in a normal browser tab (outside the viewer). */
export async function openExternal(url) {
  try { const w = window.open(url, '_blank'); if (w) { try { w.opener = null; } catch { /* */ } } return w ? 'tab' : null; } catch { return null; }
}
