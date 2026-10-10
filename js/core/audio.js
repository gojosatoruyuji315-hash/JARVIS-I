/**
 * Music engine (runs independently of the Music window so playback continues).
 *  - A real play queue: search results from Audius, iTunes, Internet Archive, live radio
 *    and YouTube, your own audio files, and original generative tracks synthesised live
 *  - Liked songs, playlists and recently played (synced with your account)
 *  - Shared AnalyserNode for visualizers, MediaSession (lock-screen / media keys)
 * @module core/audio
 */
import { bus } from './bus.js';
import { store } from './store.js';
import { toast } from './dom.js';
import { platform } from './platform.js';
import { resolveTrack, persistable, trackKey } from './music-sources.js';
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const _ = null;

/** Original procedural compositions: 16-step patterns per voice. */
export const SYNTH_TRACKS = [
  { id: 'syn-arc', title: 'Arc Drift', artist: 'JARVIS-X Synth', bpm: 92, hue: 195,
    voices: [
      { wave: 'triangle', gain: 0.10, dec: 0.35, pat: [57, _, 64, _, 60, _, 64, 67, 57, _, 64, _, 60, _, 69, 67] },
      { wave: 'sine', gain: 0.18, dec: 1.4, pat: [33, _, _, _, _, _, _, _, 29, _, _, _, _, _, _, _], bars: [33, 29, 31, 28] },
      { wave: 'sawtooth', gain: 0.025, dec: 2.6, pat: [69, _, _, _, _, _, _, _, 72, _, _, _, _, _, _, _], lp: 1400 },
    ] },
  { id: 'syn-night', title: 'Night Protocol', artist: 'JARVIS-X Synth', bpm: 108, hue: 230,
    voices: [
      { wave: 'square', gain: 0.05, dec: 0.12, pat: [38, 38, _, 38, _, 38, 41, _, 38, 38, _, 38, _, 43, 41, _], lp: 900 },
      { wave: 'sine', gain: 0.09, dec: 0.9, pat: [_, _, 74, _, _, _, _, 77, _, _, 74, _, _, 81, _, _] },
      { wave: 'noise', gain: 0.03, dec: 0.05, pat: [1, _, 1, _, 1, _, 1, 1, 1, _, 1, _, 1, _, 1, 1] },
    ] },
  { id: 'syn-lattice', title: 'Lattice Bloom', artist: 'JARVIS-X Synth', bpm: 80, hue: 170,
    voices: [
      { wave: 'triangle', gain: 0.11, dec: 0.6, pat: [62, _, 69, 66, _, 71, _, 69, 62, _, 74, _, 71, _, 66, _] },
      { wave: 'sine', gain: 0.16, dec: 2.2, pat: [38, _, _, _, _, _, _, _, 35, _, _, _, _, _, _, _], bars: [38, 35, 31, 33] },
    ] },
];


SYNTH_TRACKS.forEach((t) => { t.kind = 'synth'; t.source = 'synth'; });

let ctx, master, analyser, synthTimer, step = 0, nextTime = 0, bar = 0, startedAt = 0, noiseBuf;
let elA, elB, activeEl = null;        // elA → analysed (needs CORS); elB → plain fallback
let yt = null, ytReady = null, ytHolder = null;
let queue = null;
const S = { playing: false, index: 0, loading: false, error: '' };

/* ---------------------------------------------------------------- queue */
function loadQueue() {
  const saved = store.get('music.queue');
  if (!Array.isArray(saved) || !saved.length) return SYNTH_TRACKS.slice();
  return saved.map((t) => (t.kind === 'synth' && !t.composed ? SYNTH_TRACKS.find((x) => x.id === t.id) : t)).filter((t) => t && !(t.kind === 'file' && !t.fileId));
}
const Q = () => (queue ||= loadQueue());
const saveQueue = () => store.set('music.queue', Q().filter((t) => !(t.kind === 'file' && !t.fileId)).map((t) => (t.kind === 'synth' ? (t.composed ? t : { kind: 'synth', id: t.id }) : persistable(t))));

function ensureCtx() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); analyser = ctx.createAnalyser(); analyser.fftSize = 256;
  master.connect(analyser); analyser.connect(ctx.destination);
  master.gain.value = store.get('music.volume') ?? 0.7;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
function ensureEls() {
  if (elA) return;
  elA = new Audio(); elA.crossOrigin = 'anonymous'; elA.preload = 'auto';
  ctx.createMediaElementSource(elA).connect(master);
  elB = new Audio(); elB.preload = 'auto'; elB.volume = store.get('music.volume') ?? 0.7;
  for (const a of [elA, elB]) { a.addEventListener('ended', () => a === activeEl && onEnded()); a.addEventListener('timeupdate', () => a === activeEl && emit()); a.addEventListener('waiting', () => { if (a === activeEl) { S.loading = true; emit(); } }); a.addEventListener('playing', () => { if (a === activeEl) { S.loading = false; emit(); } }); }
}

/** Play one synth note into `out`. Works on a live or an OfflineAudioContext. */
function voiceNote(C, out, nb, v, note, t, stepDur) {
  const g = C.createGain();
  let src; const dur = Math.max(v.dec, stepDur * 0.9);
  if (v.wave === 'kick') {
    src = C.createOscillator(); src.type = 'sine';
    src.frequency.setValueAtTime(150, t); src.frequency.exponentialRampToValueAtTime(42, t + 0.12); src.connect(g);
  } else if (v.wave === 'noise' || v.wave === 'snare') {
    src = C.createBufferSource(); src.buffer = nb; const f = C.createBiquadFilter();
    if (v.wave === 'snare') { f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7; } else { f.type = 'highpass'; f.frequency.value = 7000; }
    src.connect(f); f.connect(g);
  } else {
    src = C.createOscillator(); src.type = v.wave; src.frequency.value = midi(note); if (v.detune) src.detune.value = v.detune;
    if (v.lp) { const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = v.lp; src.connect(f); f.connect(g); } else src.connect(g);
  }
  g.connect(out);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v.gain, t + (v.att || 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.start(t); src.stop(t + Math.max(v.dec, stepDur) + 0.05);
}
function playNote(v, note, t, stepDur) { voiceNote(ctx, master, noiseBuf, v, note, t, stepDur); }
/** Note for voice v at a global step (patterns can be 16, 32 or 64 steps long). */
function noteAt(v, st, br) {
  let n = v.pat[st % v.pat.length];
  if (n != null && v.bars && st % 16 === 0) n = v.bars[br % v.bars.length];
  return n;
}
/** Render a synth/composed track to a WAV Blob (offline, faster than real time). */
export async function renderTrackWav(tr, seconds) {
  const rate = 44100; const stepDur = 60 / tr.bpm / 4;
  const steps = Math.ceil(seconds / stepDur);
  const C = new OfflineAudioContext(2, Math.ceil((steps * stepDur + 2) * rate), rate);
  const out = C.createGain(); out.gain.value = 0.9; out.connect(C.destination);
  const nb = C.createBuffer(1, rate * 0.2, rate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  for (let st = 0; st < steps; st++) for (const v of tr.voices) { const n = noteAt(v, st, Math.floor(st / 16)); if (n != null) voiceNote(C, out, nb, v, n, 0.05 + st * stepDur, stepDur); }
  const buf = await C.startRendering();
  // 16-bit PCM WAV
  const ch = [buf.getChannelData(0), buf.getChannelData(1)]; const len = buf.length;
  const ab = new ArrayBuffer(44 + len * 4); const dv = new DataView(ab);
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + len * 4, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, len * 4, true);
  let o = 44; for (let i = 0; i < len; i++) for (let k = 0; k < 2; k++) { const x = Math.max(-1, Math.min(1, ch[k][i])); dv.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}
function schedule(tr) {
  const stepDur = 60 / tr.bpm / 4;
  while (nextTime < ctx.currentTime + 0.12) {
    for (const v of tr.voices) {
      const n = noteAt(v, step, bar);
      if (n != null) playNote(v, n, nextTime, stepDur);
    }
    nextTime += stepDur; step++;
    if (step % 16 === 0) bar++;
  }
}

/* ---------------------------------------------------------------- YouTube */
function loadYouTube() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    ytHolder = document.createElement('div'); ytHolder.className = 'yt-holder'; ytHolder.hidden = true;
    const inner = document.createElement('div'); ytHolder.append(inner); document.body.append(ytHolder);
    const make = () => {
      yt = new window.YT.Player(inner, { width: '100%', height: '100%', playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => resolve(yt),
          onStateChange: (e) => { if (activeEl !== 'yt') return; if (e.data === 0) onEnded(); else if (e.data === 1) { S.loading = false; S.playing = true; emit(); } else if (e.data === 3) { S.loading = true; emit(); } },
          onError: (e) => { if (activeEl === 'yt') fail(new Error(e.data === 101 || e.data === 150 ? 'The owner of this video doesn\'t allow playback outside YouTube.' : 'YouTube could not play this video.')); },
        } });
    };
    if (window.YT?.Player) return make();
    const prev = window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady = () => { prev?.(); make(); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = () => { ytReady = null; reject(new Error('Could not load the YouTube player.')); }; document.head.append(s);
    setTimeout(() => { if (!yt) { ytReady = null; reject(new Error('The YouTube player did not load.')); } }, 9000);
  });
  return ytReady;
}

/* ---------------------------------------------------------------- playback */
function stopAll() {
  clearInterval(synthTimer); synthTimer = null;
  elA?.pause(); elB?.pause();
  if (yt && activeEl === 'yt') try { yt.pauseVideo(); } catch { /* */ }
}
function current() { return Q()[S.index]; }
function emit() { bus.emit('music:state', engine.state()); }
function fail(e) { S.loading = false; S.playing = false; S.error = e.message || String(e); emit(); toast(S.error, { type: 'error' }); }
function onEnded() {
  const mode = store.get('music.repeat') || 'all';
  if (mode === 'one') return engine.play(S.index);
  if (!store.get('music.shuffle') && S.index >= Q().length - 1 && mode === 'off') { S.playing = false; emit(); return; }
  engine.next();
}
function remember(t) {
  if (t.kind === 'synth') return;
  const k = trackKey(t);
  store.set('music.recent', [persistable(t), ...(store.get('music.recent') || []).filter((x) => trackKey(x) !== k)].slice(0, 50));
}
async function urlFor(t) {
  if (t.kind === 'file') {
    if (t.url) return t.url;
    const { idb } = await import('./idb.js'); const blob = await idb.get('blobs', t.fileId);
    if (!blob) throw new Error('This file is no longer in your File Manager.');
    return (t.url = URL.createObjectURL(blob));
  }
  return resolveTrack(t);
}
async function playUrl(url, live) {
  ensureEls();
  let lastErr;
  for (const a of live ? [elB] : [elA, elB]) {
    if (a.src !== url) a.src = url;
    activeEl = a;
    try { await a.play(); return; } catch (e) { lastErr = e; if (e.name === 'NotAllowedError') throw new Error('Press play to start audio (your browser blocked autoplay).'); if (e.name === 'AbortError') return; }
  }
  throw new Error(lastErr?.name === 'NotSupportedError' ? 'This track can\'t be streamed right now — try another result.' : lastErr?.message || 'Playback failed');
}
let playToken = 0;

export const engine = {
  /** The play queue. */
  tracks: () => Q(),
  get analyser() { ensureCtx(); return analyser; },
  /** True when the visualizer has real data (synth, local files, CORS-enabled streams). */
  get analysed() { return activeEl === elA || current()?.kind === 'synth'; },
  state() {
    const t = current();
    const timed = t && t.kind !== 'synth' && !t.live;
    return { ...S, track: t, time: this.time(), duration: timed ? this.duration() : 0, seekable: !!timed, repeat: store.get('music.repeat') || 'all', shuffle: !!store.get('music.shuffle'), liked: t ? this.isLiked(t) : false, video: activeEl === 'yt' };
  },
  time() {
    const t = current(); if (!t) return 0;
    if (t.kind === 'synth') return S.playing && ctx ? ctx.currentTime - startedAt : 0;
    if (activeEl === 'yt') try { return yt.getCurrentTime() || 0; } catch { return 0; }
    return activeEl?.currentTime || 0;
  },
  duration() {
    if (activeEl === 'yt') try { return yt.getDuration() || 0; } catch { return 0; }
    const d = activeEl?.duration; return Number.isFinite(d) ? d : current()?.duration || 0;
  },

  async play(index = S.index) {
    ensureCtx(); ctx.resume().catch(() => {});
    const list = Q(); if (!list.length) return;
    const token = ++playToken;
    stopAll();
    S.index = (index + list.length) % list.length; S.error = ''; const t = list[S.index];
    store.set('music.current', S.index);
    S.playing = true; S.loading = t.kind !== 'synth'; emit();
    try {
      if (t.kind === 'synth') {
        activeEl = null; if (ytHolder) ytHolder.hidden = true;
        step = 0; bar = 0; nextTime = ctx.currentTime + 0.05; startedAt = nextTime;
        synthTimer = setInterval(() => schedule(t), 25); schedule(t);
      } else if (t.source === 'youtube') {
        const p = await loadYouTube(); if (token !== playToken) return;
        activeEl = 'yt'; ytHolder.hidden = false; ytHolder.classList.toggle('hidden-video', !!store.get('music.hideVideo'));
        p.setVolume(Math.round((store.get('music.volume') ?? 0.7) * 100)); p.loadVideoById(t.youtubeId || t.id);
      } else {
        if (ytHolder) ytHolder.hidden = true;
        const url = await urlFor(t); if (token !== playToken) return;
        await playUrl(url, t.live); if (token !== playToken) return;
      }
      S.loading = false; remember(t);
    } catch (e) {
      if (token !== playToken) return;
      // Inside the Claude viewer streams may be blocked: open the song outside the sandbox instead.
      if (platform.isHost && t.kind !== 'synth' && t.kind !== 'file') {
        const { pageUrl } = await import('./music-sources.js'); const { openExternal } = await import('./net.js');
        const url = pageUrl(t); const where = url ? await openExternal(url) : null;
        if (where) { S.playing = false; S.loading = false; S.error = ''; emit(); toast(`Opened “${t.title}” in a new tab — the Claude viewer can’t stream audio. Use “Full internet” for in-app playback.`, { type: 'ok', timeout: 6000 }); return; }
      }
      fail(e); return;
    }
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || 'JARVIS-X', artwork: t.artwork ? [{ src: t.artwork, sizes: '512x512' }] : [] });
        navigator.mediaSession.setActionHandler('play', () => this.play());
        navigator.mediaSession.setActionHandler('pause', () => this.pause());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
      } catch { /* */ }
    }
    emit();
  },
  pause() { stopAll(); S.playing = false; S.loading = false; emit(); },
  resume() {
    const t = current();
    if (S.playing || !t) return this.play();
    if (activeEl === 'yt' && t.source === 'youtube') { yt.playVideo(); S.playing = true; emit(); return; }
    if (activeEl && activeEl !== 'yt' && t.kind !== 'synth' && activeEl.src && activeEl.currentTime > 0 && !activeEl.ended) { activeEl.play().then(() => { S.playing = true; emit(); }).catch((e) => fail(e)); return; }
    this.play();
  },
  toggle() { S.playing ? this.pause() : this.resume(); },
  next() { const n = store.get('music.shuffle') && Q().length > 1 ? (S.index + 1 + Math.floor(Math.random() * (Q().length - 1))) % Q().length : S.index + 1; this.play(n); },
  prev() { if (this.time() > 4 && current()?.kind !== 'synth') return this.seek(0); this.play(S.index - 1); },
  seek(sec) { const t = current(); if (!t || t.kind === 'synth' || t.live) return; if (activeEl === 'yt') yt.seekTo(sec, true); else if (activeEl) activeEl.currentTime = sec; emit(); },
  setVolume(v) {
    store.set('music.volume', v); if (master) master.gain.value = v; if (elB) elB.volume = v;
    if (yt) try { yt.setVolume(Math.round(v * 100)); } catch { /* */ }
    emit();
  },
  select(i) { S.index = i; emit(); },
  setRepeat(mode) { store.set('music.repeat', mode); emit(); },
  toggleShuffle() { store.set('music.shuffle', !store.get('music.shuffle')); emit(); },
  setVideoHidden(hide) { store.set('music.hideVideo', hide); ytHolder?.classList.toggle('hidden-video', hide); emit(); },

  /* ---- queue editing */
  /** Play a track right now. With `list`, the list becomes the queue (like tapping a song in an album). */
  playTrack(track, list) {
    if (list?.length) { queue = list.slice(); const i = list.findIndex((x) => trackKey(x) === trackKey(track)); saveQueue(); return this.play(Math.max(0, i)); }
    const q = Q(); const at = q.length ? S.index + 1 : 0; q.splice(at, 0, track); saveQueue(); return this.play(at);
  },
  playList(list, start = 0) { if (!list?.length) return; queue = list.slice(); saveQueue(); return this.play(start); },
  enqueue(track) { Q().push(track); saveQueue(); emit(); },
  playNext(track) { Q().splice(S.index + 1, 0, track); saveQueue(); emit(); },
  removeAt(i) {
    const q = Q(); if (i < 0 || i >= q.length) return;
    const wasCurrent = i === S.index; const [t] = q.splice(i, 1);
    if (t.kind === 'file' && !t.fileId && t.url) URL.revokeObjectURL(t.url);
    if (i < S.index) S.index--;
    if (wasCurrent) { this.pause(); S.index = Math.min(S.index, q.length - 1); }
    if (!q.length) { queue = SYNTH_TRACKS.slice(); S.index = 0; }
    saveQueue(); emit();
  },
  removeTrack(id) { this.removeAt(Q().findIndex((t) => t.id === id)); },
  move(from, to) { const q = Q(); if (to < 0 || to >= q.length) return; const [t] = q.splice(from, 1); q.splice(to, 0, t); if (S.index === from) S.index = to; else if (from < S.index && to >= S.index) S.index--; else if (from > S.index && to <= S.index) S.index++; saveQueue(); emit(); },
  clearQueue() { this.pause(); const cur = current(); queue = cur && cur.kind !== 'synth' ? [cur] : SYNTH_TRACKS.slice(); S.index = 0; saveQueue(); emit(); },

  /* ---- local files */
  addFile(file, { fileId, play = false } = {}) {
    const tr = { id: fileId || 'f-' + file.name + file.size, source: 'local', kind: 'file', fileId, url: URL.createObjectURL(file), title: file.name.replace(/\.[^.]+$/, ''), artist: fileId ? 'My files' : 'Local file', hue: [...file.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360 };
    const q = Q(); const i = q.findIndex((u) => u.id === tr.id);
    if (i >= 0) { if (play) this.play(i); return q[i]; }
    q.push(tr); saveQueue(); emit(); if (play) this.play(q.length - 1);
    return tr;
  },

  /* ---- library */
  isLiked: (t) => (store.get('music.liked') || []).some((x) => trackKey(x) === trackKey(t)),
  toggleLike(t) {
    if (!t || t.kind === 'synth' || (t.kind === 'file' && !t.fileId)) return false;
    const liked = store.get('music.liked') || []; const k = trackKey(t);
    const on = !liked.some((x) => trackKey(x) === k);
    store.set('music.liked', on ? [persistable(t), ...liked] : liked.filter((x) => trackKey(x) !== k)); emit();
    return on;
  },
  playlists: () => store.get('music.playlists') || [],
  createPlaylist(name, tracks = []) { const p = { id: 'pl-' + Date.now().toString(36), name: name || 'New playlist', tracks: tracks.map(persistable), created: Date.now() }; store.set('music.playlists', [...this.playlists(), p]); return p; },
  renamePlaylist(id, name) { store.set('music.playlists', this.playlists().map((p) => (p.id === id ? { ...p, name } : p))); },
  deletePlaylist(id) { store.set('music.playlists', this.playlists().filter((p) => p.id !== id)); },
  addToPlaylist(id, t) { store.set('music.playlists', this.playlists().map((p) => (p.id === id && !p.tracks.some((x) => trackKey(x) === trackKey(t)) ? { ...p, tracks: [...p.tracks, persistable(t)] } : p))); },
  removeFromPlaylist(id, i) { store.set('music.playlists', this.playlists().map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((_, j) => j !== i) } : p))); },
};
S.index = Math.max(0, store.get?.('music.current') ?? 0);
bus.on('store:change', ({ path }) => { if (path === '' && !S.playing) { queue = null; S.index = Math.min(store.get('music.current') ?? 0, Math.max(0, Q().length - 1)); } });

bus.on('music', ({ cmd, track, query }) => {
  if (cmd === 'search' && query) return engine.searchAndPlay(query);
  if (cmd === 'playTrack' && track) return engine.playTrack(track);
  if (cmd === 'play') return engine.resume();
  engine[cmd]?.();
});

/** Find a song across the free full-track sources and play the best match. */
engine.searchAndPlay = async function (query) {
  const { searchMusic } = await import('./music-sources.js');
  const sources = platform.hasNetwork ? ['youtube', 'audius', 'itunes', 'archive'] : [];
  if (!sources.length) throw new Error('Music search needs internet — the Claude viewer keeps pages offline. Use “Full internet” at the top to open the full version, or say "compose a song" to have one written here.');
  const res = await searchMusic(query, sources);
  const t = sources.map((s) => (Array.isArray(res[s]) ? res[s][0] : null)).find(Boolean);
  if (!t) throw new Error(`No playable results for "${query}".`);
  await this.playTrack(t);
  return t;
};

/** Generative album artwork drawn into a canvas (unique per track). */
export function drawArtwork(canvas, track) {
  const c = canvas.getContext('2d'); const W = canvas.width = 400, H = canvas.height = 400;
  const hue = track?.hue ?? 200;
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${hue},70%,12%)`); g.addColorStop(1, `hsl(${(hue + 60) % 360},80%,6%)`);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  let seed = [...(track?.title || 'x')].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 9; i++) {
    c.beginPath(); c.arc(W / 2, H / 2, 40 + i * 18 + rnd() * 8, rnd() * 6.28, rnd() * 6.28 + 1 + rnd() * 3);
    c.strokeStyle = `hsla(${hue + rnd() * 40},90%,${55 + rnd() * 25}%,${0.35 + rnd() * 0.5})`; c.lineWidth = 1 + rnd() * 5; c.stroke();
  }
  const rg = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 70);
  rg.addColorStop(0, `hsla(${hue},100%,85%,.95)`); rg.addColorStop(1, 'transparent');
  c.fillStyle = rg; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,.85)'; c.font = '600 22px Oxanium, sans-serif'; c.fillText(track?.title || '', 22, H - 26);
}
