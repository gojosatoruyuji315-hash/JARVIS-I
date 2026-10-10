/**
 * Music: search real catalogs and play whatever you pick.
 *  - Search Audius (full tracks), iTunes (30 s previews), Internet Archive (public domain / CC),
 *    30,000+ live radio stations and YouTube (with a key)
 *  - Play now, play next, add to queue, like, build playlists, recently played
 *  - Your own audio files and original generative tracks
 * Playback lives in core/audio.js so it continues when this window closes.
 * @module modules/music
 */
import { h, clear, fmt, pickFiles, toast, tabs, modal } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { platform } from '../core/platform.js';
import { engine, drawArtwork, renderTrackWav } from '../core/audio.js';
import { STYLES as COMPOSE_STYLES, compose } from '../core/composer.js';
import { needsInternet } from '../core/fullversion.js';
import { SOURCES, searchMusic, trackKey } from '../core/music-sources.js';

const MOODS = ['Lo-fi', 'Chill', 'Workout', 'Focus', 'Classical', 'Jazz', 'Bollywood', 'Hip hop', 'Ambient', 'Rock', 'Piano', 'Tamil'];
const SRC_LABEL = { composed: 'AI song', audius: 'Audius', itunes: 'Preview', archive: 'Archive', radio: 'Live', youtube: 'YouTube', local: 'My file', synth: 'Generative' };
const time = (s) => (s ? fmt.dur(s * 1000) : '');
let lastQuery = '', lastResults = null;

function artEl(t, size = 48) {
  if (t.artwork) {
    const img = h('img', { src: t.artwork, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', width: size, height: size });
    img.onerror = () => img.replaceWith(h('div.art', icon(t.live ? 'wifi' : 'music', { size: 18 })));
    return img;
  }
  return h('div.art', icon(t.kind === 'synth' ? 'sparkles' : t.live ? 'wifi' : 'music', { size: 18 }));
}

function addToPlaylistDialog(t) {
  const name = h('input.input', { placeholder: 'New playlist name' });
  const list = h('div.list', engine.playlists().map((p) => h('button.item', { style: 'cursor:pointer;color:var(--fg);text-align:left', onclick: () => { engine.addToPlaylist(p.id, t); toast(`Added to ${p.name}`, { type: 'ok' }); m.close(); } }, icon('layers', { size: 14 }), h('span.grow', p.name), h('span.xs.muted', `${p.tracks.length} tracks`))));
  const m = modal({ title: `Add “${t.title}” to…`, titleIcon: 'layers', body: h('div.stack', engine.playlists().length ? list : h('div.small.dim', 'No playlists yet — create one.'), h('div.row', name)),
    actions: [{ label: 'Cancel' }, { label: 'Create & add', kind: 'primary', icon: 'plus', onClick: (close) => { const p = engine.createPlaylist(name.value.trim() || 'My playlist', [t]); toast(`Created ${p.name}`, { type: 'ok' }); close(); } }] });
}

/** One track row. `list` = the list it belongs to (playing it from a list makes that list the queue). */
function trackRow(t, { list, index, inQueue = false, onRemove } = {}) {
  const s = engine.state();
  const isCur = inQueue ? index === s.index : s.track && trackKey(s.track) === trackKey(t);
  const like = h('button.btn.ghost.icon.sm', { 'aria-label': 'Like', title: 'Like', onclick: (e) => { e.stopPropagation(); const on = engine.toggleLike(t); like.style.color = on ? 'var(--accent)' : ''; toast(on ? 'Added to Liked songs' : 'Removed from Liked songs', { timeout: 1500 }); } }, icon('heart', { size: 15 }));
  if (engine.isLiked(t)) like.style.color = 'var(--accent)';
  const canLike = t.kind !== 'synth' && !(t.kind === 'file' && !t.fileId);
  const play = () => (inQueue ? engine.play(index) : list ? engine.playTrack(t, list) : engine.playTrack(t));
  return h('div.track-row', { class: isCur ? 'playing' : '', role: 'button', tabindex: 0, style: 'cursor:pointer', onclick: play, onkeydown: (e) => e.key === 'Enter' && play() },
    artEl(t),
    h('div.t', h('b.small', t.title), h('span.xs.dim', [t.artist, t.album].filter(Boolean).join(' · '))),
    h('span.xs.muted.hide-sm', h('span.pill', { style: 'font-size:10px;padding:1px 6px' }, SRC_LABEL[t.source] || SRC_LABEL[t.kind] || ''), ' ', t.live ? '' : time(t.duration)),
    h('div.row', { style: 'gap:2px;flex-wrap:nowrap', onclick: (e) => e.stopPropagation() },
      !inQueue ? h('button.btn.ghost.icon.sm', { 'aria-label': 'Play next', title: 'Play next', onclick: () => { engine.playNext(t); toast('Plays next', { timeout: 1200 }); } }, icon('next', { size: 15 })) : null,
      !inQueue ? h('button.btn.ghost.icon.sm', { 'aria-label': 'Add to queue', title: 'Add to queue', onclick: () => { engine.enqueue(t); toast('Added to queue', { timeout: 1200 }); } }, icon('plus', { size: 15 })) : null,
      canLike ? like : null,
      canLike ? h('button.btn.ghost.icon.sm', { 'aria-label': 'Add to playlist', title: 'Add to playlist', onclick: () => addToPlaylistDialog(t) }, icon('layers', { size: 15 })) : null,
      inQueue ? h('button.btn.ghost.icon.sm', { 'aria-label': 'Move up', title: 'Move up', onclick: () => engine.move(index, index - 1) }, '↑') : null,
      t.kind !== 'synth' && t.kind !== 'file' ? h('button.btn.ghost.icon.sm', { 'aria-label': 'Open source page', title: 'Open on its website', onclick: async () => { const { pageUrl } = await import('../core/music-sources.js'); const { openExternal } = await import('../core/net.js'); const u = pageUrl(t); if (u && !(await openExternal(u))) toast('Your browser blocked the new tab.', { type: 'error' }); } }, icon('external', { size: 15 })) : null,
      onRemove ? h('button.btn.ghost.icon.sm', { 'aria-label': 'Remove', title: 'Remove', onclick: onRemove }, icon('x', { size: 15 })) : null));
}

export default {
  mount(el, { params = {} } = {}) {
    /* ---------------- player */
    const artBox = h('div.artwork'); const canvas = h('canvas');
    const viz = h('canvas.viz', { width: 900, height: 120 });
    const title = h('h2', { style: 'margin:0' }); const artist = h('div.dim'); const badge = h('div.xs.muted');
    const clock = h('span.mono.small.dim');
    const seek = h('input', { type: 'range', min: 0, max: 100, value: 0, step: 0.5, 'aria-label': 'Seek', oninput: (e) => engine.seek(+e.target.value) });
    const play = h('button.btn.primary.round', { style: 'width:52px;height:52px', 'aria-label': 'Play or pause', onclick: () => engine.toggle() });
    const shuffle = h('button.btn.ghost.sm', { onclick: () => engine.toggleShuffle() });
    const repeat = h('button.btn.ghost.sm', { onclick: () => { const r = engine.state().repeat; engine.setRepeat(r === 'all' ? 'one' : r === 'one' ? 'off' : 'all'); } });
    const like = h('button.btn.ghost.icon', { 'aria-label': 'Like current track', onclick: () => engine.toggleLike(engine.state().track) }, icon('heart'));
    const videoBtn = h('button.btn.ghost.sm', { hidden: true, onclick: () => engine.setVideoHidden(!store.get('music.hideVideo')) });
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: store.get('music.volume'), 'aria-label': 'Volume', style: 'max-width:160px', oninput: (e) => engine.setVolume(+e.target.value) });
    let lastKey;
    const upd = (s = engine.state()) => {
      const t = s.track;
      title.textContent = t?.title || 'Nothing playing';
      artist.textContent = [t?.artist, t?.album].filter(Boolean).join(' · ');
      badge.textContent = s.error ? `⚠ ${s.error}` : s.loading ? 'Loading…' : t ? `${SRC_LABEL[t.source] || ''}${t.preview ? ' · 30-second preview' : ''}${t.live ? ' · live stream' : ''}` : '';
      play.replaceChildren(icon(s.playing ? 'pause' : 'play'));
      shuffle.replaceChildren(icon('repeat'), s.shuffle ? 'Shuffle on' : 'Shuffle off'); shuffle.classList.toggle('primary', s.shuffle);
      repeat.replaceChildren(s.repeat === 'one' ? 'Repeat one' : s.repeat === 'off' ? 'Repeat off' : 'Repeat all');
      like.style.color = s.liked ? 'var(--accent)' : ''; like.disabled = !t || t.kind === 'synth';
      videoBtn.hidden = !s.video; videoBtn.textContent = store.get('music.hideVideo') ? 'Show video' : 'Hide video';
      const k = t ? trackKey(t) : '';
      if (k !== lastKey) { lastKey = k; clear(artBox); if (t?.artwork) artBox.append(artEl({ ...t }, 400)); else { drawArtwork(canvas, t); artBox.append(canvas); } }
      seek.disabled = !s.seekable; seek.max = Math.max(1, s.duration || 1); if (s.seekable && document.activeElement !== seek) seek.value = s.time;
      clock.textContent = t?.kind === 'synth' ? `${fmt.dur(s.time * 1000)} · ${t.composed ? `${t.bpm} BPM · live synth` : 'generative'}` : t?.live ? `${fmt.dur(s.time * 1000)} · live` : `${fmt.dur(s.time * 1000)} / ${fmt.dur((s.duration || 0) * 1000)}`;
    };
    const c = viz.getContext('2d'); let raf; let data;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      c.clearRect(0, 0, viz.width, viz.height);
      const cs = getComputedStyle(document.documentElement);
      const accent = cs.getPropertyValue('--accent').trim(); const accent2 = cs.getPropertyValue('--accent-2').trim();
      const st = engine.state();
      if (!st.playing || st.loading) { c.fillStyle = accent; c.globalAlpha = 0.25; c.fillRect(0, viz.height / 2, viz.width, 1); c.globalAlpha = 1; return; }
      const n = 96, w = viz.width / n; const g = c.createLinearGradient(0, viz.height, 0, 0); g.addColorStop(0, accent2); g.addColorStop(1, accent); c.fillStyle = g;
      if (engine.analysed) {
        const an = engine.analyser; data ||= new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(data);
        for (let i = 0; i < n; i++) { const v = data[Math.floor(i * data.length / n / 1.3)] / 255; const hgt = v * viz.height * 0.48; c.fillRect(i * w + 1, viz.height / 2 - hgt, w - 2, hgt * 2); }
      } else { // stream without CORS access: gentle animated idle bars
        const tt = performance.now() / 400;
        for (let i = 0; i < n; i++) { const v = 0.15 + 0.12 * Math.sin(tt + i * 0.35) * Math.sin(tt * 0.7 + i * 0.11); const hgt = Math.abs(v) * viz.height * 0.48; c.fillRect(i * w + 1, viz.height / 2 - hgt, w - 2, hgt * 2); }
      }
    };
    draw();

    /* ---------------- tabs */
    let net = platform.hasNetwork;
    const searchTab = (body) => {
      const enabled = new Set(store.get('music.sources') || ['audius', 'itunes', 'archive']);
      const q = h('input.input.grow', { placeholder: 'Search songs, artists, albums, radio stations…', value: lastQuery, 'aria-label': 'Search music' });
      const chips = h('div.row', { style: 'gap:6px' });
      const results = h('div.stack');
      const paintChips = () => chips.replaceChildren(...Object.entries(SOURCES).map(([id, s]) => h('button.btn.sm', { class: enabled.has(id) ? 'primary' : '', title: s.blurb, 'aria-pressed': String(enabled.has(id)), onclick: () => { enabled.has(id) ? enabled.delete(id) : enabled.add(id); if (!enabled.size) enabled.add('audius'); store.set('music.sources', [...enabled]); paintChips(); if (q.value.trim()) go(); } }, s.label)));
      paintChips();
      const show = (res) => {
        const groups = Object.keys(SOURCES).filter((k) => k in res).map((k) => [k, res[k]]);
        results.replaceChildren(...groups.map(([src, list]) => h('div.stack', { style: 'gap:4px' },
          h('div.row', h('div.section-title', { style: 'margin:0' }, SOURCES[src].label), h('span.xs.muted', SOURCES[src].blurb), h('span.grow'), Array.isArray(list) && list.length > 1 ? h('button.btn.ghost.sm', { onclick: () => engine.playList(list, 0) }, icon('play', { size: 13 }), 'Play all') : null),
          list === null ? h('div.small.dim', 'Searching…') : list instanceof Error ? h('div.small.dim', list.message) : !list.length ? h('div.small.muted', 'No results.') : list.map((t) => trackRow(t, { list: null })))));
      };
      const go = async () => {
        const text = q.value.trim(); if (!text) return; lastQuery = text;
        results.replaceChildren(h('div.small.dim', 'Searching…'));
        lastResults = await searchMusic(text, [...enabled], { onPartial: (part) => { if (lastQuery === text) show(Object.fromEntries([...enabled].map((k) => [k, k in part ? part[k] : null]))); } });
        if (lastQuery === text) show(lastResults);
      };
      q.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      if (!net) {
        return h('div.stack', needsInternet('Music search'),
          h('div.row', h('button.btn.ghost', { onclick: () => tb.select('compose') }, icon('sparkles'), 'Compose a song here instead'), h('button.btn.ghost', { onclick: addFiles }, icon('upload'), 'Play my own audio files')));
      }
      body.append(h('div.stack', h('div.row', q, h('button.btn.primary', { onclick: go }, icon('search'), 'Search')), chips,
        h('div.row', { style: 'gap:6px' }, h('span.xs.muted', 'Try:'), MOODS.map((m) => h('button.btn.ghost.sm', { onclick: () => { q.value = m; go(); } }, m))),
        results,
        h('div.xs.muted', 'Audius, Internet Archive and radio stream full-length audio for free. iTunes gives 30-second previews of mainstream songs. YouTube plays full songs in the official YouTube player — no key needed.')));
      if (lastResults) show(lastResults); else if (params.q) { q.value = params.q; go(); }
      setTimeout(() => q.focus(), 50);
    };
    const queueTab = (body) => {
      const s = engine.state(); const list = engine.tracks();
      body.append(h('div.stack', h('div.row', h('b', `${list.length} in queue`), h('span.grow'), h('button.btn.ghost.sm', { onclick: () => { const p = engine.createPlaylist(`Queue ${new Date().toLocaleDateString()}`, list.filter((t) => t.kind !== 'synth' && !(t.kind === 'file' && !t.fileId))); toast(`Saved as playlist “${p.name}”`, { type: 'ok' }); } }, icon('layers', { size: 14 }), 'Save as playlist'), h('button.btn.ghost.sm', { onclick: () => engine.clearQueue() }, icon('trash', { size: 14 }), 'Clear')),
        h('div.stack', { style: 'gap:2px' }, list.map((t, i) => trackRow(t, { index: i, inQueue: true, onRemove: () => engine.removeAt(i) }))),
        h('div.small.dim', s.track ? '' : 'Search for something to play.')));
    };
    const likedTab = (body) => {
      const liked = store.get('music.liked') || [];
      body.append(liked.length ? h('div.stack', h('div.row', h('b', `${liked.length} liked songs`), h('span.grow'), h('button.btn.primary.sm', { onclick: () => engine.playList(liked, 0) }, icon('play', { size: 13 }), 'Play all'), h('button.btn.ghost.sm', { onclick: () => engine.playList([...liked].sort(() => Math.random() - 0.5), 0) }, icon('repeat', { size: 13 }), 'Shuffle')),
        h('div.stack', { style: 'gap:2px' }, liked.map((t) => trackRow(t, { list: liked, onRemove: () => { engine.toggleLike(t); tb.select('liked'); } }))))
        : h('div.empty', 'Tap ♥ on any song to keep it here. Liked songs sync to your other devices.'));
    };
    const playlistsTab = (body, openId) => {
      const lists = engine.playlists(); const pl = lists.find((p) => p.id === openId);
      if (pl) {
        body.append(h('div.stack', h('div.row', h('button.btn.ghost.sm', { onclick: () => { clear(body); playlistsTab(body); } }, '← All playlists'), h('h3.grow', { style: 'margin:0' }, pl.name),
          h('button.btn.primary.sm', { disabled: !pl.tracks.length, onclick: () => engine.playList(pl.tracks, 0) }, icon('play', { size: 13 }), 'Play'),
          h('button.btn.ghost.sm', { onclick: () => { const inp = h('input.input', { value: pl.name }); modal({ title: 'Rename playlist', body: inp, actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: (close) => { if (inp.value.trim()) { engine.renamePlaylist(pl.id, inp.value.trim()); clear(body); playlistsTab(body, pl.id); } close(); } }] }); } }, icon('edit', { size: 13 })),
          h('button.btn.ghost.sm', { onclick: () => { engine.deletePlaylist(pl.id); clear(body); playlistsTab(body); } }, icon('trash', { size: 13 }))),
          pl.tracks.length ? h('div.stack', { style: 'gap:2px' }, pl.tracks.map((t, i) => trackRow(t, { list: pl.tracks, onRemove: () => { engine.removeFromPlaylist(pl.id, i); clear(body); playlistsTab(body, pl.id); } }))) : h('div.empty', 'Empty — use the playlist button on any song to add it here.')));
        return;
      }
      const name = h('input.input.grow', { placeholder: 'New playlist name' });
      body.append(h('div.stack', h('div.row', name, h('button.btn', { onclick: () => { if (!name.value.trim()) return; engine.createPlaylist(name.value.trim()); clear(body); playlistsTab(body); } }, icon('plus'), 'Create')),
        lists.length ? h('div.plugin-grid', lists.map((p) => h('button.choice-card', { onclick: () => { clear(body); playlistsTab(body, p.id); } }, h('div.row', { style: 'gap:6px' }, p.tracks.slice(0, 3).map((t) => artEl(t, 36))), h('b', p.name), h('span.xs.dim', `${p.tracks.length} tracks`)))) : h('div.empty', 'No playlists yet.')));
    };
    const recentTab = (body) => {
      const r = store.get('music.recent') || [];
      body.append(r.length ? h('div.stack', { style: 'gap:2px' }, h('div.row', h('span.grow'), h('button.btn.ghost.sm', { onclick: () => { store.set('music.recent', []); tb.select('recent'); } }, 'Clear history')), r.map((t) => trackRow(t))) : h('div.empty', 'Songs you play show up here.'));
    };
    const libraryTab = (body) => {
      body.append(h('div.stack', h('div.row', h('b.grow', 'Your files & generative tracks'), h('button.btn', { onclick: addFiles }, icon('upload'), 'Add audio files'), h('button.btn.ghost', { onclick: () => bus.emit('open', { id: 'files' }) }, icon('folder'), 'File Manager')),
        h('div.small.dim', 'Audio you add from the File Manager stays in your queue across sessions. Generative tracks are original compositions synthesised live in your browser.'),
        h('div.stack', { style: 'gap:2px' }, engine.tracks().filter((t) => t.kind === 'synth' || t.kind === 'file').map((t) => trackRow(t)))));
    };
    const composeTab = (body) => {
      const desc = h('textarea.textarea', { placeholder: 'Describe a song — e.g. "rainy evening lo-fi to study", "epic sunrise over mountains", "happy 8-bit game level", "calm raga for meditation"', style: 'min-height:70px' });
      const style = h('select.select', { style: 'width:auto', 'aria-label': 'Style' }, [['auto', 'Style: automatic'], ...Object.entries(COMPOSE_STYLES).map(([k, v]) => [k, v.label])].map(([v, l]) => h('option', { value: v }, l)));
      const status = h('div.small.dim'); const list = h('div.stack', { style: 'gap:2px' });
      const askAI = async (prompt) => { const { ask } = await import('../core/assistant.js'); const r = await ask(prompt, { conversation: false, commands: false, tools: false, history: [{ role: 'user', content: prompt }], system: 'You are a composer. Reply with JSON only.' }); return r.text; };
      const paint = () => {
        const songs = store.get('music.composed') || [];
        list.replaceChildren(...(songs.length ? songs.map((t) => h('div.track-row', { role: 'button', tabindex: 0, style: 'cursor:pointer', onclick: () => engine.playTrack(t) },
          h('div.art', icon('sparkles', { size: 18 })), h('div.t', h('b.small', t.title), h('span.xs.dim', `${t.artist} · ${t.bpm} BPM · ${t.plan?.scale || ''}`)), h('span'),
          h('div.row', { style: 'gap:2px;flex-wrap:nowrap', onclick: (e) => e.stopPropagation() },
            h('button.btn.ghost.icon.sm', { title: 'Add to queue', 'aria-label': 'Add to queue', onclick: () => { engine.enqueue(t); toast('Added to queue', { timeout: 1200 }); } }, icon('plus', { size: 15 })),
            h('button.btn.ghost.icon.sm', { title: 'Download WAV', 'aria-label': 'Download WAV', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const secs = Math.min(150, (t.voices[0].pat.length * 60 / t.bpm / 4) * 4); const wav = await renderTrackWav(t, secs); const { download } = await import('../core/dom.js'); await download(`${t.title.replace(/\W+/g, '-')}.wav`, wav); const { idb } = await import('../core/idb.js'); const folders = store.get('files.folders') || []; if (!folders.includes('/Music')) store.set('files.folders', [...folders, '/Music']); const meta = { id: 'f' + Date.now().toString(36), name: `${t.title}.wav`, type: 'audio/wav', size: wav.size, folder: '/Music', created: Date.now(), modified: Date.now(), accessed: Date.now() }; await idb.set('blobs', meta.id, wav); await idb.set('files', meta.id, meta); toast('Also saved to Files → /Music', { type: 'ok' }); } catch (err) { toast(err.message, { type: 'error' }); } finally { b.disabled = false; } } }, icon('download', { size: 15 })),
            h('button.btn.ghost.icon.sm', { title: 'Delete', 'aria-label': 'Delete', onclick: () => { store.set('music.composed', songs.filter((x) => x.id !== t.id)); paint(); } }, icon('x', { size: 15 })))))
          : [h('div.empty', 'Songs you compose appear here.')]));
      };
      const go = async () => {
        const d = desc.value.trim() || 'a relaxing lo-fi tune'; status.textContent = 'Composing…';
        try {
          const t = await compose(d, { style: style.value, ask: askAI });
          store.set('music.composed', [t, ...(store.get('music.composed') || [])].slice(0, 50));
          status.textContent = `“${t.title}” — ${t.artist}, ${t.bpm} BPM. Playing now.`; paint(); engine.playTrack(t);
        } catch (e) { status.textContent = e.message; }
      };
      body.append(h('div.stack', h('div.small.dim', 'The AI writes an original song — tempo, key, chords and melody — and the built-in synthesiser performs it live. Works offline and inside Claude. Download any song as a WAV file.'),
        desc, h('div.row', style, h('button.btn.primary', { onclick: go }, icon('sparkles'), 'Compose'), h('span.grow'), h('span.xs.muted', 'Try:'), ['Rainy lo-fi', 'Epic sunrise', '8-bit adventure', 'Calm raga', 'Neon night drive'].map((x) => h('button.btn.ghost.sm', { onclick: () => { desc.value = x; go(); } }, x))),
        status, h('div.section-title', 'Your songs'), list));
      paint();
    };
    const settingsTab = (body) => {
      const key = h('input.input', { type: 'password', placeholder: 'AIza…', value: store.get('secrets.youtubeKey') || '', autocomplete: 'off' });
      body.append(h('div.stack', { style: 'max-width:620px' },
        h('h3', 'YouTube'), h('div.small.dim', 'YouTube search works without a key: it goes through public Piped / Invidious mirrors and plays in the official YouTube player. If the mirrors are busy, add your own mirror or a free YouTube Data API v3 key (Google Cloud Console → APIs & Services → Credentials). The key is stored encrypted on this device only.'),
        h('label.stack', h('span.small', 'YouTube API key (optional)'), h('div.row', key, h('button.btn.primary', { onclick: () => { store.set('secrets.youtubeKey', key.value.trim()); toast('Saved', { type: 'ok' }); } }, 'Save'))),
        (() => { const mi = h('input.input', { placeholder: 'https://your-invidious.example or piped:https://pipedapi.example', value: store.get('music.ytMirror') || '' }); return h('label.stack', h('span.small', 'Preferred mirror (optional)'), h('div.row', mi, h('button.btn', { onclick: () => { store.set('music.ytMirror', mi.value.trim()); toast('Saved', { type: 'ok' }); } }, 'Save'))); })(),
        h('h3', 'Playback'),
        h('label.row.small', h('input', { type: 'checkbox', checked: !!store.get('music.hideVideo'), onchange: (e) => engine.setVideoHidden(e.target.checked) }), 'Hide the YouTube video window (audio keeps playing)'),
        h('div.xs.muted', 'Shortcuts: Alt+P play/pause · Alt+→ next · Shift+←/→ previous/next · Shift+↑/↓ volume. Say or type “play <song>” anywhere to search and play.'),
        h('h3', 'About the sources'),
        h('ul.small.dim', Object.values(SOURCES).map((s) => h('li', h('b', s.label), ' — ', s.blurb)))));
    };
    async function addFiles() { const fs = await pickFiles({ accept: 'audio/*' }); fs.forEach((f, i) => engine.addFile(f, { play: i === 0 })); if (fs.length) toast(`Added ${fs.length} track(s)`, { type: 'ok' }); }

    const tb = tabs([
      { id: 'search', label: 'Search', icon: 'search', render: searchTab },
      { id: 'queue', label: 'Queue', icon: 'menu', render: queueTab },
      { id: 'liked', label: 'Liked', icon: 'heart', render: likedTab },
      { id: 'playlists', label: 'Playlists', icon: 'layers', render: (b) => playlistsTab(b) },
      { id: 'recent', label: 'Recent', icon: 'clock', render: recentTab },
      { id: 'compose', label: 'Compose', icon: 'sparkles', render: composeTab },
      { id: 'library', label: 'My music', icon: 'folder', render: libraryTab },
      { id: 'settings', label: 'Settings', icon: 'settings', render: settingsTab },
    ], { initial: params.tab || (net || platform.isHost ? 'search' : 'compose') });

    tb.el.style.height = 'auto'; tb.body.style.padding = '12px 0 0';
    let lastQ = '';
    const onState = (s) => {
      upd(s);
      const sig = `${engine.tracks().length}:${s.index}:${s.playing}:${s.liked}`;
      if (sig !== lastQ) { lastQ = sig; if (tb.current === 'queue') tb.select('queue'); if (tb.current === 'search' && lastResults) for (const r of tb.body.querySelectorAll('.track-row')) r.classList.remove('playing'); }
    };
    const offs = [bus.on('music:state', onState), bus.on('tick', () => upd()), bus.on('platform:net', () => { const was = net; net = platform.hasNetwork; if (net !== was && tb.current === 'search') tb.select('search'); })];
    const onKey = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight' && e.shiftKey) engine.next(); else if (e.key === 'ArrowLeft' && e.shiftKey) engine.prev();
      else if (e.key === 'ArrowUp' && e.shiftKey) { e.preventDefault(); engine.setVolume(Math.min(1, store.get('music.volume') + 0.05)); vol.value = store.get('music.volume'); }
      else if (e.key === 'ArrowDown' && e.shiftKey) { e.preventDefault(); engine.setVolume(Math.max(0, store.get('music.volume') - 0.05)); vol.value = store.get('music.volume'); }
    };
    addEventListener('keydown', onKey);
    el.append(h('div.stack',
      h('div.player', artBox, h('div.stack', { style: 'min-width:0' }, title, artist, badge,
        h('div.transport', h('button.btn.icon.round', { 'aria-label': 'Previous', onclick: () => engine.prev() }, icon('prev')), play, h('button.btn.icon.round', { 'aria-label': 'Next', onclick: () => engine.next() }, icon('next')), like, shuffle, repeat, videoBtn,
          h('span.grow'), icon('volume', { size: 16 }), vol),
        h('div.row', h('div.grow', seek), clock), viz)),
      tb.el));
    upd();
    return () => { offs.forEach((o) => o()); cancelAnimationFrame(raf); removeEventListener('keydown', onKey); };
  },
};
