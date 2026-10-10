/**
 * Music sources: search real catalogs and resolve playable URLs.
 *
 *  audius   — full-length, free-to-stream tracks from independent artists (Audius API, no key)
 *  archive  — public-domain & Creative Commons recordings (Internet Archive, no key)
 *  itunes   — 30-second previews of mainstream songs (Apple iTunes Search API, no key)
 *  radio    — 30,000+ live internet radio stations (radio-browser.info, no key)
 *  youtube  — full songs & music videos played in the official YouTube player
 *             (needs a YouTube Data API key in Music settings, or YOUTUBE_API_KEY on the server)
 *
 * Every source returns the same normalized track shape:
 *   { source, id, title, artist, album?, artwork?, duration?, url?, youtubeId?, preview?, live? }
 * @module core/music-sources
 */
import { platform } from './platform.js';
import { store } from './store.js';
import * as net from './net.js';

const APP = 'JARVIS-X';
const clean = (s = '') => String(s).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** Direct fetch (see core/net.js). */
const getJSON = (url) => net.getJSON(url);
/** JSONP fallback for APIs without CORS (iTunes). */
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = `__jx_jsonp_${Math.random().toString(36).slice(2)}`;
    const s = document.createElement('script');
    const done = (fn, v) => { delete window[cb]; s.remove(); clearTimeout(t); fn(v); };
    window[cb] = (data) => done(resolve, data);
    s.src = `${url}&callback=${cb}`; s.onerror = () => done(reject, new Error('Search failed'));
    const t = setTimeout(() => done(reject, new Error('Search timed out')), 10000);
    document.head.append(s);
  });
}

/* ---------------------------------------------------------------- Audius */
let audiusHost = null;
async function audius() {
  if (audiusHost) return audiusHost;
  if (!platform.directNetwork) return (audiusHost = 'https://discoveryprovider.audius.co');
  try { const j = await getJSON('https://api.audius.co'); audiusHost = j.data[Math.floor(Math.random() * j.data.length)]; }
  catch { audiusHost = 'https://discoveryprovider.audius.co'; }
  return audiusHost;
}

/* ------------------------------------------------- YouTube without a key
 * Searches go through public Piped / Invidious mirrors (open-source YouTube front ends with
 * CORS-enabled APIs). Playback still uses the official YouTube embedded player.
 * Mirrors come and go, so several are tried in turn; you can add your own in Music → Settings. */
export const YT_MIRRORS = [
  'piped:https://pipedapi.kavin.rocks', 'piped:https://pipedapi.adminforge.de', 'piped:https://api.piped.private.coffee',
  'invidious:https://inv.nadeko.net', 'invidious:https://invidious.nerdvpn.de', 'invidious:https://yewtu.be', 'invidious:https://invidious.f5.si',
];
const ytId = (u = '') => (u.match(/[?&]v=([\w-]{11})/) || u.match(/^([\w-]{11})$/) || [])[1];
export function parseMirror(kind, j) {
  if (kind === 'piped') return (j.items || []).filter((v) => v.type === 'stream' || v.url?.includes('watch')).map((v) => ({ source: 'youtube', id: ytId(v.url), youtubeId: ytId(v.url), title: clean(v.title), artist: clean(v.uploaderName || ''), artwork: v.thumbnail, duration: v.duration > 0 ? v.duration : undefined })).filter((t) => t.id);
  return (Array.isArray(j) ? j : []).filter((v) => v.type === 'video' && v.videoId).map((v) => ({ source: 'youtube', id: v.videoId, youtubeId: v.videoId, title: clean(v.title), artist: clean(v.author || ''), artwork: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`, duration: v.lengthSeconds || undefined }));
}
let goodMirror = null;
async function youtubeKeyless(q) {
  const custom = (store.get('music.ytMirror') || '').trim();
  const list = [...new Set([custom && (custom.includes(':http') ? custom : `invidious:${custom.replace(/\/$/, '')}`), goodMirror, ...YT_MIRRORS].filter(Boolean))];
  const tryOne = async (m) => {
    const i = m.indexOf(':'); const kind = m.slice(0, i); const base = m.slice(i + 1);
    const url = kind === 'piped' ? `${base}/search?q=${encodeURIComponent(q)}&filter=music_songs` : `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video&sort_by=relevance`;
    const tracks = parseMirror(kind, await net.getJSON(url, { signal: AbortSignal.timeout?.(6000) }));
    if (!tracks.length) throw new Error('empty');
    goodMirror = m; return tracks.slice(0, 25);
  };
  for (let k = 0; k < list.length; k += 3) {
    try { return await Promise.any(list.slice(k, k + 3).map(tryOne)); } catch { /* next group */ }
  }
  throw new Error(`YouTube search mirrors are busy right now — try again in a minute, add your own mirror or a YouTube API key in Music → Settings.`);
}

/* ---------------------------------------------------------------- sources */
export const SOURCES = {
  audius: {
    label: 'Audius', blurb: 'Full tracks · independent artists', full: true,
    api: async (q) => `${await audius()}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=${APP}`,
    parse: (j) => (j.data || []).filter((t) => t.is_streamable !== false).slice(0, 30).map((t) => ({ source: 'audius', id: t.id, title: t.title, artist: t.user?.name || 'Unknown', album: t.genre || '', artwork: t.artwork?.['480x480'] || t.artwork?.['150x150'], duration: t.duration, page: t.permalink ? `https://audius.co${t.permalink}` : undefined })),
    async resolve(t) { return `${await audius()}/v1/tracks/${t.id}/stream?app_name=${APP}`; },
  },
  itunes: {
    label: 'iTunes previews', blurb: '30-second previews · any song',
    async search(q) {
      if (platform.isServer) { const r = await fetch(`api/music/search?source=itunes&q=${encodeURIComponent(q)}`, { headers: { 'X-JX': '1' } }); if (r.ok) return (await r.json()).tracks; }
      const url = this.api(q);
      const j = await getJSON(url).catch((e) => (platform.directNetwork ? jsonp(url) : Promise.reject(e)));
      return this.parse(j);
    },
    api: (q) => `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=30`,
    parse: (j) => (j.results || []).filter((t) => t.previewUrl).map((t) => ({ source: 'itunes', id: String(t.trackId), title: t.trackName, artist: t.artistName, album: t.collectionName, artwork: t.artworkUrl100?.replace('100x100', '600x600'), url: t.previewUrl, duration: 30, preview: true, page: t.trackViewUrl })),
    async resolve(t) { return t.url; },
  },
  archive: {
    label: 'Internet Archive', blurb: 'Public-domain & CC recordings', full: true,
    api: (q) => `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(${q}) AND mediatype:(audio) AND -collection:(podcasts)`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&sort[]=downloads+desc&rows=30&output=json`,
    parse: (j) => (j.response?.docs || []).map((d) => ({ source: 'archive', id: d.identifier, title: clean(Array.isArray(d.title) ? d.title[0] : d.title || d.identifier), artist: clean(Array.isArray(d.creator) ? d.creator[0] : d.creator || 'Internet Archive'), album: d.year ? String(d.year) : '', artwork: `https://archive.org/services/img/${d.identifier}`, page: `https://archive.org/details/${d.identifier}` })),
    /** An archive item can hold many files; play the first MP3 (or the one picked). */
    async resolve(t) {
      if (t.url) return t.url;
      const j = await getJSON(`https://archive.org/metadata/${encodeURIComponent(t.id)}`);
      const files = (j.files || []).filter((f) => /mp3|ogg/i.test(f.format || f.name) && !/_64kb|sample/i.test(f.name));
      const f = files.find((x) => /VBR MP3|MP3/i.test(x.format)) || files[0];
      if (!f) throw new Error('This recording has no playable audio file.');
      return `https://archive.org/download/${encodeURIComponent(t.id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`;
    },
  },
  radio: {
    label: 'Live radio', blurb: '30,000+ stations worldwide', full: true,
    async search(q) { return this.parse(await getJSON(this.api(q)).catch(() => getJSON(this.api(q).replace('de1.', 'all.')))); },
    api: (q) => `https://de1.api.radio-browser.info/json/stations/search?name=${encodeURIComponent(q)}&limit=30&hidebroken=true&order=clickcount&reverse=true`,
    parse: (j) => (Array.isArray(j) ? j : []).filter((s) => (s.url_resolved || s.url || '').startsWith('https://')).map((s) => ({ source: 'radio', id: s.stationuuid, title: s.name.trim(), artist: [s.country, s.tags?.split(',').slice(0, 2).join(', ')].filter(Boolean).join(' · ') || 'Radio', artwork: s.favicon?.startsWith('https://') ? s.favicon : '', url: s.url_resolved || s.url, live: true, page: s.homepage || undefined })),
    async resolve(t) { return t.url; },
  },
  youtube: {
    label: 'YouTube', blurb: 'Full songs · no key needed', full: true,
    async search(q) {
      const key = store.get('secrets.youtubeKey');
      if (key) {
        const j = await getJSON(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&videoCategoryId=10&maxResults=25&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`);
        return (j.items || []).map((v) => ({ source: 'youtube', id: v.id.videoId, youtubeId: v.id.videoId, title: clean(v.snippet.title), artist: clean(v.snippet.channelTitle), artwork: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.default?.url }));
      }
      if (platform.isServer) {
        const r = await fetch(`api/music/search?source=youtube&q=${encodeURIComponent(q)}`, { headers: { 'X-JX': '1' } }).catch(() => null);
        if (r?.ok) { const j = await r.json(); if (j.tracks?.length) return j.tracks; }
      }
      return youtubeKeyless(q);
    },
  },
};

for (const s of Object.values(SOURCES)) if (!s.search && s.api) s.search = async function (q) { return this.parse(await getJSON(await this.api(q))); };

/** Search one source, or several at once. Returns { [source]: tracks[] | Error }.
 */
export async function searchMusic(q, sources = ['audius', 'itunes', 'archive'], { onPartial } = {}) {
  const out = {};
  const tick = () => onPartial?.({ ...out });
  await Promise.all(sources.map(async (s) => { try { out[s] = await SOURCES[s].search(q); } catch (e) { out[s] = e; } tick(); }));
  return out;
}

/** The track's own web page (for "open outside" when the viewer can't stream it). */
export function pageUrl(t) {
  if (t.page) return t.page;
  if (t.source === 'youtube') return `https://www.youtube.com/watch?v=${t.youtubeId || t.id}`;
  if (t.source === 'archive') return `https://archive.org/details/${t.id}`;
  if (t.source === 'itunes') return `https://music.apple.com/search?term=${encodeURIComponent(`${t.title} ${t.artist}`)}`;
  if (t.source === 'audius') return `https://audius.co/search/${encodeURIComponent(t.title)}`;
  return t.url || null;
}

/** Turn a track into a playable URL (resolved lazily — some sources need a lookup). */
export async function resolveTrack(t) {
  if (t.url && t.source !== 'archive') return t.url;
  const src = SOURCES[t.source]; if (!src?.resolve) throw new Error('Not a streamable track');
  return src.resolve(t);
}

/** Trim a track to what's worth persisting (no blob URLs). */
export const persistable = (t) => ({ page: t.page, source: t.source, id: t.id, title: t.title, artist: t.artist, album: t.album, artwork: t.artwork, duration: t.duration, url: t.source === 'audius' ? undefined : t.url, youtubeId: t.youtubeId, preview: t.preview, live: t.live, kind: t.kind, fileId: t.fileId, hue: t.hue });
export const trackKey = (t) => `${t.source || t.kind}:${t.id}`;
