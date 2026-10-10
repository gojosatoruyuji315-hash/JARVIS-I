/**
 * Media services used by plugins:
 *   /api/media/image, /api/media/speech     OpenAI (server key)
 *   /api/media/replicate/*                  Replicate predictions (video & image models) with the
 *                                           server's REPLICATE_API_TOKEN or the user's own token
 *   /api/music/search                       Music search proxy (iTunes, Audius, Internet Archive, YouTube)
 */
import { config } from '../lib/config.js';
import { HttpError, json, jsonBody, rateLimit, send } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';

const key = () => { if (!config.ai.openaiKey) throw new HttpError(503, 'Media generation needs OPENAI_API_KEY on the server.'); return config.ai.openaiKey; };

export function mediaRoutes(r) {
  r.get('/api/media/status', async (req, res) => json(res, { image: !!config.ai.openaiKey, audio: !!config.ai.openaiKey, video: false }));

  r.post('/api/media/image', async (req, res) => {
    const { user } = requireUser(req); rateLimit(`img:${user.id}`, 10, 60e3);
    const { prompt, size } = await jsonBody(req);
    if (!prompt) throw new HttpError(400, 'prompt is required');
    const r2 = await fetch(`${config.ai.openaiBase}/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
      body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt: String(prompt).slice(0, 4000), size: ['1024x1024', '1536x1024', '1024x1536'].includes(size) ? size : '1024x1024', n: 1 }) });
    const j = await r2.json(); if (!r2.ok) throw new HttpError(502, j.error?.message || 'Image generation failed');
    const d = j.data?.[0];
    return json(res, { image: d.b64_json ? `data:image/png;base64,${d.b64_json}` : d.url });
  });

  r.post('/api/media/speech', async (req, res) => {
    const { user } = requireUser(req); rateLimit(`tts:${user.id}`, 20, 60e3);
    const { text, voice } = await jsonBody(req);
    if (!text) throw new HttpError(400, 'text is required');
    const r2 = await fetch(`${config.ai.openaiBase}/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
      body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: voice || 'alloy', input: String(text).slice(0, 4000), response_format: 'mp3' }) });
    if (!r2.ok) throw new HttpError(502, 'Speech generation failed');
    return send(res, 200, Buffer.from(await r2.arrayBuffer()), { 'Content-Type': 'audio/mpeg' });
  });

  // Replicate (browser CORS is not allowed by Replicate, so the server relays)
  const rep = (req) => {
    const token = req.headers['x-replicate-token'] || process.env.REPLICATE_API_TOKEN;
    if (!token) throw new HttpError(400, 'Add a Replicate API token in the plugin settings (or set REPLICATE_API_TOKEN on the server).');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  };
  r.post('/api/media/replicate/predictions', async (req, res) => {
    const { user } = requireUser(req); rateLimit(`rep:${user.id}`, 10, 60e3);
    const { model, input } = await jsonBody(req);
    if (!/^[\w.-]+\/[\w.-]+(:[\w]+)?$/.test(model || '')) throw new HttpError(400, 'model must look like owner/name or owner/name:version');
    const [path, version] = model.split(':');
    const url = version ? 'https://api.replicate.com/v1/predictions' : `https://api.replicate.com/v1/models/${path}/predictions`;
    const r2 = await fetch(url, { method: 'POST', headers: rep(req), body: JSON.stringify(version ? { version, input } : { input }) });
    const j = await r2.json(); if (!r2.ok) throw new HttpError(r2.status === 401 ? 401 : 502, j.detail || j.title || 'Replicate request failed');
    return json(res, { id: j.id, status: j.status, output: j.output, error: j.error });
  });
  r.get('/api/media/replicate/predictions/:id', async (req, res) => {
    requireUser(req);
    const r2 = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(req.params.id)}`, { headers: rep(req) });
    const j = await r2.json(); if (!r2.ok) throw new HttpError(502, j.detail || 'Replicate request failed');
    return json(res, { id: j.id, status: j.status, output: j.output, error: j.error, logs: String(j.logs || '').slice(-400) });
  });

  // Music search proxy — same result shape for every source
  const cache = new Map();
  r.get('/api/music/search', async (req, res) => {
    rateLimit(`music:${req.socket.remoteAddress}`, 60, 60e3);
    const source = req.query.get('source') || 'itunes'; const q = (req.query.get('q') || '').slice(0, 100);
    if (!q) throw new HttpError(400, 'q is required');
    const key = `${source}:${q}`; const hit = cache.get(key);
    if (hit && Date.now() - hit.t < 10 * 60e3) return json(res, hit.v);
    let tracks = [];
    if (source === 'itunes') {
      const j = await (await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=30`)).json();
      tracks = (j.results || []).filter((t) => t.previewUrl).map((t) => ({ source: 'itunes', id: String(t.trackId), title: t.trackName, artist: t.artistName, album: t.collectionName, artwork: t.artworkUrl100?.replace('100x100', '600x600'), url: t.previewUrl, duration: 30, preview: true }));
    } else if (source === 'youtube') {
      if (!process.env.YOUTUBE_API_KEY) tracks = await youtubeMirrors(q);
      else {
      const j = await (await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=25&q=${encodeURIComponent(q)}&key=${process.env.YOUTUBE_API_KEY}`)).json();
      if (j.error) throw new HttpError(502, j.error.message);
      tracks = (j.items || []).map((v) => ({ source: 'youtube', id: v.id.videoId, title: v.snippet.title.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'), artist: v.snippet.channelTitle, artwork: v.snippet.thumbnails?.high?.url, youtubeId: v.id.videoId }));
      }
    } else throw new HttpError(400, 'Unknown source');
    const v = { tracks }; cache.set(key, { t: Date.now(), v });
    return json(res, v);
  });
}

/* YouTube search without a key: public Piped / Invidious mirrors (YOUTUBE_MIRRORS overrides the list). */
const MIRRORS = (process.env.YOUTUBE_MIRRORS || 'piped:https://pipedapi.kavin.rocks,piped:https://pipedapi.adminforge.de,invidious:https://inv.nadeko.net,invidious:https://invidious.nerdvpn.de,invidious:https://yewtu.be').split(',').map((x) => x.trim()).filter(Boolean);
const unescape = (s = '') => String(s).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
async function youtubeMirrors(q) {
  for (const m of MIRRORS) {
    const i = m.indexOf(':'); const kind = m.slice(0, i); const base = m.slice(i + 1);
    try {
      const r = await fetch(kind === 'piped' ? `${base}/search?q=${encodeURIComponent(q)}&filter=music_songs` : `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue; const j = await r.json();
      const tracks = kind === 'piped'
        ? (j.items || []).map((v) => { const id = (v.url || '').match(/v=([\w-]{11})/)?.[1]; return id && { source: 'youtube', id, youtubeId: id, title: unescape(v.title), artist: unescape(v.uploaderName), artwork: v.thumbnail, duration: v.duration > 0 ? v.duration : undefined }; }).filter(Boolean)
        : (Array.isArray(j) ? j : []).filter((v) => v.type === 'video' && v.videoId).map((v) => ({ source: 'youtube', id: v.videoId, youtubeId: v.videoId, title: unescape(v.title), artist: unescape(v.author), artwork: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`, duration: v.lengthSeconds || undefined }));
      if (tracks.length) return tracks.slice(0, 25);
    } catch { /* try the next mirror */ }
  }
  throw new HttpError(502, 'YouTube mirrors are busy — try again shortly, or set YOUTUBE_API_KEY.');
}
