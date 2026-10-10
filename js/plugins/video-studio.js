/**
 * Video Studio plugin.
 *
 *  Story video (default, free, runs in your browser — no server or key):
 *    the AI writes a storyboard → each scene gets a picture (Pollinations FLUX when online,
 *    an AI-drawn illustration when offline / inside Claude) → scenes are animated on a canvas
 *    (slow zoom & pan, crossfades, captions, title card, optional generated soundtrack)
 *    → recorded to an MP4/WebM file with MediaRecorder.
 *
 *  AI video model (optional): MiniMax, Wan, Kling or Luma through Replicate, relayed by the
 *    JARVIS-X server (needs REPLICATE_API_TOKEN on the server or your own token).
 *
 * Results are saved to Files → /Generated/Videos.
 */
import { sanitizeSvg } from './svg-illustrator.js';

const MODELS = [
  ['minimax/video-01', 'MiniMax Video-01 (6 s, 720p)'],
  ['wan-video/wan-2.1-t2v-480p', 'Wan 2.1 text-to-video (480p)'],
  ['kwaivgi/kling-v1.6-standard', 'Kling 1.6 standard'],
  ['luma/ray', 'Luma Ray (Dream Machine)'],
];
const FORMATS = { landscape: [1280, 720], portrait: [720, 1280], square: [960, 960] };
const LOOKS = ['cinematic', 'watercolor', 'anime', 'documentary photo', 'pixel art', '3D render', 'flat illustration'];
const slugify = (s) => s.slice(0, 40).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'video';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================ storyboard */
async function storyboard(api, prompt, scenes) {
  const { activeProviderId } = await import('../core/ai.js');
  if (activeProviderId() !== 'local') {
    try {
      const text = await api.ask(`Plan a short video about: "${prompt}".\nReturn ONLY JSON: {"title": string (max 6 words), "scenes": [{"caption": string (max 14 words, shown on screen), "visual": string (a vivid one-sentence picture description for an image generator, no text in the image)}]}.\nUse exactly ${scenes} scenes that tell a clear story with a beginning, middle and end.`, { tier: 'default' });
      const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      if (j.scenes?.length) return { title: String(j.title || prompt).slice(0, 60), scenes: j.scenes.slice(0, 12).map((s) => ({ caption: String(s.caption || ''), visual: String(s.visual || s.caption || prompt) })) };
    } catch { /* fall through to the offline storyboard */ }
  }
  // Offline: one scene per sentence of the prompt (or the prompt repeated with variations)
  const parts = prompt.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const list = parts.length >= 2 ? parts : Array.from({ length: scenes }, (_, i) => `${prompt}${['', ', wide shot', ', close-up', ', at golden hour', ', at night', ', from above'][i % 6]}`);
  return { title: (parts.length >= 2 ? parts[0].replace(/[.!?]$/, '') : prompt).slice(0, 60), scenes: list.slice(0, 12).map((c) => ({ caption: parts.length >= 2 ? c : '', visual: c })) };
}

/* ================================================================ scene images */
async function sceneImage(api, scene, look, [w, h], engine, seed) {
  const vis = `${scene.visual}, ${look} style, no text`;
  if (engine === 'pollinations') {
    const r = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(vis)}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=flux`);
    if (!r.ok) throw new Error(`Image service returned ${r.status}`);
    return blobToImage(await r.blob());
  }
  if (engine === 'illustrated') {
    const text = await api.ask(`Draw this scene as an SVG illustration: ${vis}.\nRules: output ONLY one complete <svg> element, viewBox="0 0 ${w} ${h}", fill the whole canvas with a background, rich colours and gradients in <defs>, no text, no external images, fonts or scripts, under 14 KB.`, { tier: 'default' });
    return blobToImage(new Blob([sanitizeSvg(text)], { type: 'image/svg+xml' }));
  }
  return null; // 'abstract' → drawn procedurally at render time
}
function blobToImage(blob) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(blob); const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Could not load the scene image')); img.src = u; });
}

/* ================================================================ soundtrack */
function soundtrack(ctx, dest, seconds, mood = 'calm') {
  const prog = { calm: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]], upbeat: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], epic: [[50, 57, 62], [46, 53, 58], [48, 55, 60], [45, 52, 57]] }[mood] || [];
  const f = (n) => 440 * 2 ** ((n - 69) / 12);
  const master = ctx.createGain(); master.gain.value = 0.0001; master.connect(dest);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.connect(master);
  const t0 = ctx.currentTime + 0.05; const bar = mood === 'upbeat' ? 2 : 3;
  master.gain.setValueAtTime(0.0001, t0); master.gain.exponentialRampToValueAtTime(0.5, t0 + 1.5);
  master.gain.setValueAtTime(0.5, t0 + seconds - 1.5); master.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
  for (let t = 0, i = 0; t < seconds; t += bar, i++) {
    for (const n of prog[i % prog.length]) for (const det of [-4, 4]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f(n); o.detune.value = det;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0 + t); g.gain.exponentialRampToValueAtTime(0.035, t0 + t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + bar + 0.3);
      o.connect(g); g.connect(lp); o.start(t0 + t); o.stop(t0 + t + bar + 0.4);
    }
    const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = f(prog[i % prog.length][0] - 12);
    const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, t0 + t); bg.gain.exponentialRampToValueAtTime(0.18, t0 + t + 0.05); bg.gain.exponentialRampToValueAtTime(0.0001, t0 + t + bar);
    b.connect(bg); bg.connect(master); b.start(t0 + t); b.stop(t0 + t + bar + 0.1);
  }
}

/* ================================================================ renderer */
function wrap(c, text, maxW) {
  const words = text.split(/\s+/); const lines = []; let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function drawAbstract(c, W, H, i, t) {
  const hue = (i * 67 + 200) % 360;
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, `hsl(${hue},60%,18%)`); g.addColorStop(1, `hsl(${(hue + 50) % 360},70%,8%)`);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let k = 0; k < 7; k++) { c.beginPath(); c.arc(W / 2 + Math.sin(t + k) * W * 0.2, H / 2 + Math.cos(t * 0.7 + k) * H * 0.2, (k + 1) * Math.min(W, H) * 0.06, 0, 6.29); c.strokeStyle = `hsla(${hue + k * 12},90%,65%,${0.12 + k * 0.03})`; c.lineWidth = 3; c.stroke(); }
}
function drawCover(c, img, W, H, p, i) {
  // Ken Burns: slow zoom in or out with a gentle pan, alternating per scene
  const zoomIn = i % 2 === 0; const s = zoomIn ? 1.04 + 0.12 * p : 1.16 - 0.12 * p;
  const base = Math.max(W / img.width, H / img.height) * s;
  const dw = img.width * base, dh = img.height * base;
  const dx = (W - dw) / 2 + (i % 3 - 1) * W * 0.03 * (p - 0.5) * 2; const dy = (H - dh) / 2 + ((i + 1) % 3 - 1) * H * 0.03 * (p - 0.5) * 2;
  c.drawImage(img, dx, dy, dw, dh);
}

async function renderVideo({ canvas, board, images, perScene = 4, music = 'calm', onProgress }) {
  const W = canvas.width, H = canvas.height; const c = canvas.getContext('2d');
  const titleDur = 2.5, fade = 0.7; const total = titleDur + board.scenes.length * perScene;
  const stream = canvas.captureStream(30);
  let actx = null;
  if (music !== 'none') {
    actx = new (window.AudioContext || window.webkitAudioContext)(); await actx.resume().catch(() => {});
    const dest = actx.createMediaStreamDestination(); soundtrack(actx, dest, total, music);
    for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  }
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mimeType = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
  if (!window.MediaRecorder || !mimeType) throw new Error('This browser can\'t record video. Try Chrome, Edge or Safari.');
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => { rec.onstop = res; });
  const fontPx = Math.round(Math.min(W, H) * 0.045);
  const frame = (t) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    if (t < titleDur) {
      drawAbstract(c, W, H, 0, t);
      if (images[0]) { c.globalAlpha = 0.35; drawCover(c, images[0], W, H, t / titleDur, 0); c.globalAlpha = 1; }
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, W, H);
      const a = Math.min(1, t / 0.6, (titleDur - t) / 0.5); c.globalAlpha = Math.max(0, a);
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 ${Math.round(fontPx * 1.7)}px system-ui, sans-serif`;
      wrap(c, board.title, W * 0.8).forEach((l, k, arr) => c.fillText(l, W / 2, H / 2 + (k - (arr.length - 1) / 2) * fontPx * 2));
      c.globalAlpha = 1; return;
    }
    const st = t - titleDur; const i = Math.min(board.scenes.length - 1, Math.floor(st / perScene)); const p = (st - i * perScene) / perScene;
    const paint = (k, pp) => (images[k] ? drawCover(c, images[k], W, H, pp, k) : drawAbstract(c, W, H, k, st));
    paint(i, p);
    const intoNext = st - i * perScene - (perScene - fade);
    if (intoNext > 0 && i + 1 < board.scenes.length) { c.globalAlpha = intoNext / fade; paint(i + 1, 0); c.globalAlpha = 1; }
    const cap = board.scenes[i].caption;
    if (cap) {
      c.font = `600 ${fontPx}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      const lines = wrap(c, cap, W * 0.84); const lh = fontPx * 1.3; const boxH = lines.length * lh + fontPx * 0.9;
      const ca = Math.min(1, p * perScene / 0.4, (1 - p) * perScene / 0.4);
      c.globalAlpha = Math.max(0, ca);
      const g = c.createLinearGradient(0, H - boxH * 1.8, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.75)'); c.fillStyle = g; c.fillRect(0, H - boxH * 1.8, W, boxH * 1.8);
      c.fillStyle = '#fff'; lines.forEach((l, k) => c.fillText(l, W / 2, H - boxH + fontPx * 0.95 + k * lh)); c.globalAlpha = 1;
    }
    if (st > board.scenes.length * perScene - 0.8) { c.fillStyle = `rgba(0,0,0,${Math.min(1, (st - (board.scenes.length * perScene - 0.8)) / 0.8)})`; c.fillRect(0, 0, W, H); }
  };
  frame(0); rec.start(500);
  const t0 = performance.now();
  // setTimeout (not rAF) so rendering keeps going if the tab is in the background
  await new Promise((resolve) => {
    const tick = () => { const t = (performance.now() - t0) / 1000; if (t >= total) return resolve(); frame(t); onProgress?.(t / total); setTimeout(tick, 1000 / 30); };
    tick();
  });
  frame(total); await sleep(150); rec.stop(); await done;
  stream.getTracks().forEach((tr) => tr.stop()); actx?.close();
  return new Blob(chunks, { type: mimeType.split(';')[0] });
}

/* ================================================================ story pipeline */
async function makeStoryVideo(api, { prompt, scenes = 5, format = 'landscape', look = 'cinematic', imageEngine = 'auto', perScene = 4, music = 'calm', canvas, onStatus }) {
  const size = FORMATS[format] || FORMATS.landscape;
  onStatus?.('Writing the storyboard…');
  const board = await storyboard(api, prompt, scenes);
  const { activeProviderId } = await import('../core/ai.js');
  let engine = imageEngine === 'auto' ? (api.platform.directNetwork ? 'pollinations' : activeProviderId() !== 'local' ? 'illustrated' : 'abstract') : imageEngine;
  const images = new Array(board.scenes.length).fill(null);
  const seed = Math.floor(Math.random() * 1e6);
  let doneCount = 0;
  const one = async (k) => {
    try { images[k] = await sceneImage(api, board.scenes[k], look, size, engine, seed + k); }
    catch (e) {
      if (engine === 'pollinations' && activeProviderId() !== 'local') { try { images[k] = await sceneImage(api, board.scenes[k], look, size, 'illustrated'); } catch { /* abstract */ } }
    }
    onStatus?.(`Creating scene pictures… ${++doneCount}/${board.scenes.length}`);
  };
  onStatus?.(`Creating scene pictures… 0/${board.scenes.length}`);
  const queue = board.scenes.map((_, k) => k); const workers = Array.from({ length: engine === 'pollinations' ? 2 : 1 }, async () => { while (queue.length) await one(queue.shift()); });
  await Promise.all(workers);
  const cv = canvas || document.createElement('canvas'); cv.width = size[0]; cv.height = size[1];
  const blob = await renderVideo({ canvas: cv, board, images, perScene, music, onProgress: (p) => onStatus?.(`Recording video… ${Math.round(p * 100)}%`) });
  images.forEach((im) => im && URL.revokeObjectURL(im.src));
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const file = await api.saveToFiles(blob, `${slugify(board.title)}-${Date.now().toString(36)}.${ext}`, '/Generated/Videos');
  const item = { id: file.id, prompt, title: board.title, model: `Story video · ${engine === 'pollinations' ? 'FLUX pictures' : engine === 'illustrated' ? 'AI illustrations' : 'abstract'}`, ts: Date.now() };
  api.set('gallery', [item, ...api.get('gallery', [])].slice(0, 100));
  return { ...item, blob, file, board };
}

/* ================================================================ Replicate (optional) */
async function call(api, path, body) {
  const token = api.setting('replicateToken');
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'X-JX': '1', 'Content-Type': 'application/json', ...(token ? { 'x-replicate-token': token } : {}) }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j;
}
async function generateModel(api, { prompt, model, image }, onStatus) {
  if (!api.platform.isServer) throw new Error('AI video models run through the JARVIS-X server. Use "Story video" here — it works without a server.');
  const input = { prompt };
  if (image) { input.first_frame_image = image; input.image = image; }
  let p = await call(api, 'api/media/replicate/predictions', { model: model || api.setting('model') || MODELS[0][0], input });
  const t0 = Date.now();
  while (!['succeeded', 'failed', 'canceled'].includes(p.status)) {
    if (Date.now() - t0 > 15 * 60e3) throw new Error('Timed out after 15 minutes.');
    onStatus?.(`${p.status === 'starting' ? 'Starting model' : 'Rendering'}… ${Math.round((Date.now() - t0) / 1000)} s`);
    await sleep(4000);
    p = await call(api, `api/media/replicate/predictions/${p.id}`);
  }
  if (p.status !== 'succeeded') throw new Error(p.error || `Generation ${p.status}`);
  const url = Array.isArray(p.output) ? p.output[0] : p.output;
  let file = null;
  try { const blob = await (await fetch(url)).blob(); file = await api.saveToFiles(blob, `${slugify(prompt)}-${Date.now().toString(36)}.mp4`, '/Generated/Videos'); }
  catch { /* keep the remote URL if the file can't be fetched */ }
  const item = { id: file?.id || null, url, prompt, model, ts: Date.now() };
  api.set('gallery', [item, ...api.get('gallery', [])].slice(0, 100));
  return item;
}

/* ================================================================ manifest */
export default {
  id: 'video-studio', name: 'Video Studio', version: '2.0.0', author: 'JARVIS-X',
  icon: 'video', category: 'Creative', needs: [],
  description: 'Make videos from a sentence: the AI writes a storyboard, creates a picture for every scene and animates them with captions and a soundtrack — free, right in your browser. Optional AI video models (MiniMax, Wan, Kling, Luma) on the server.',
  settings: [
    { key: 'model', label: 'AI video model (server)', type: 'select', default: MODELS[0][0], options: MODELS },
    { key: 'replicateToken', label: 'Replicate API token (optional)', type: 'password', placeholder: 'r8_…', help: 'Only for AI video models. Not needed if the server has REPLICATE_API_TOKEN.' },
  ],
  tools: [{
    name: 'generate_video', description: 'Make a short video (about 15–40 s) about a topic or story: storyboard, scene pictures, animation, captions and music. Saved to the user\'s Files. Takes about a minute.',
    schema: { type: 'object', properties: { prompt: { type: 'string', description: 'What the video is about, or the story to tell' }, scenes: { type: 'integer', minimum: 3, maximum: 10 }, format: { type: 'string', enum: Object.keys(FORMATS) }, look: { type: 'string', enum: LOOKS } }, required: ['prompt'] },
    async run(input, api) { const r = await makeStoryVideo(api, { prompt: String(input.prompt), scenes: input.scenes || 5, format: input.format, look: input.look || 'cinematic' }); return { saved: r.file.name, folder: r.file.folder, title: r.title, scenes: r.board.scenes.map((s) => s.caption) }; },
  }],
  commands: [{ match: /^(?:make|create|generate) (?:a |an )?(?:short )?video (?:about|of|on) (.+)/i, run(text, api) { const p = text.match(/(?:about|of|on) (.+)$/i)[1]; api.openPanel(); setTimeout(() => api.bus.emit('video-studio:make', { prompt: p }), 400); return `Making a video about **${p}** in Video Studio — it takes about a minute.`; } }],

  panel(el, api) {
    const { h, icon } = api;
    const urls = [];
    const grid = h('div.gen-grid');
    const render = async () => {
      const { idb } = await import('../core/idb.js'); grid.replaceChildren();
      for (const g of api.get('gallery', [])) {
        let src = g.url; let blob = null;
        if (g.id) { blob = await idb.get('blobs', g.id); if (blob) { src = URL.createObjectURL(blob); urls.push(src); } }
        if (!src) continue;
        grid.append(h('figure', h('video', { src, controls: true, preload: 'metadata', playsinline: true }), h('figcaption', { title: g.prompt }, g.title || g.prompt), h('div.row', h('span.xs.muted.grow', g.model), blob ? h('button.btn.ghost.sm', { onclick: () => api.download(`${slugify(g.title || g.prompt)}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, blob) }, icon('download', { size: 13 })) : null)));
      }
      if (!grid.children.length) grid.append(h('div.empty', 'Your videos appear here.'));
    };

    /* ---- Story video */
    const prompt = h('textarea.textarea', { placeholder: 'e.g. "How a seed becomes a tree" · "A day in the life of a Mumbai street cat" · or paste your own script, one sentence per scene', style: 'min-height:80px' });
    const sel = (opts, val) => h('select.select', { style: 'width:auto' }, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
    const scenes = sel([3, 4, 5, 6, 8, 10].map((n) => [String(n), `${n} scenes`]), '5');
    const format = sel([['landscape', '16:9 Landscape'], ['portrait', '9:16 Reels/Shorts'], ['square', '1:1 Square']], 'landscape');
    const look = sel(LOOKS.map((l) => [l, l[0].toUpperCase() + l.slice(1)]), 'cinematic');
    const pace = sel([['3', 'Fast (3 s/scene)'], ['4', 'Normal (4 s)'], ['6', 'Slow (6 s)']], '4');
    const music = sel([['calm', 'Calm music'], ['upbeat', 'Upbeat music'], ['epic', 'Epic music'], ['none', 'No music']], 'calm');
    const pictures = sel([['auto', 'Pictures: automatic'], ['pollinations', 'FLUX photos (online)'], ['illustrated', 'AI illustrations'], ['abstract', 'Abstract motion']], 'auto');
    const preview = h('canvas', { style: 'width:100%;max-height:52vh;object-fit:contain;border-radius:12px;background:#000;display:none' });
    const status = h('div.small.dim');
    const go = h('button.btn.primary', icon('video'), 'Make video');
    const make = async (text) => {
      if (text) prompt.value = text;
      if (!prompt.value.trim() || go.disabled) return;
      go.disabled = true; preview.style.display = 'block';
      try {
        const r = await makeStoryVideo(api, { prompt: prompt.value.trim(), scenes: +scenes.value, format: format.value, look: look.value, perScene: +pace.value, music: music.value, imageEngine: pictures.value, canvas: preview, onStatus: (s) => { status.textContent = s; } });
        status.textContent = `Done — “${r.title}” saved to Files → /Generated/Videos.`; preview.style.display = 'none'; await render();
      } catch (e) { status.textContent = e.message; }
      finally { go.disabled = false; }
    };
    go.onclick = () => make();
    const off = api.bus.on('video-studio:make', ({ prompt: p }) => make(p));
    const story = h('div.stack', prompt, h('div.row', { style: 'gap:6px' }, scenes, format, look, pace, music, pictures, go), status, preview,
      h('div.xs.muted', api.platform.directNetwork ? 'Free and private: pictures come from Pollinations FLUX (or the AI draws them), and the video is recorded right here in your browser.' : 'No internet here, so the AI draws each scene as an illustration and the video is recorded in your browser.'));

    /* ---- AI video model (server) */
    const mprompt = h('textarea.textarea', { placeholder: 'A paper boat drifting down a rainy city street, slow motion, cinematic lighting', style: 'min-height:70px' });
    const model = h('select.select', { style: 'width:auto', 'aria-label': 'Model' }, MODELS.map(([v, l]) => h('option', { value: v, selected: v === api.setting('model') }, l)));
    const imgIn = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'Starting image (optional)' });
    const mbtn = h('button.btn', icon('sparkles'), 'Generate clip'); const mstatus = h('div.small.dim');
    mbtn.onclick = async () => {
      if (!mprompt.value.trim()) return; mbtn.disabled = true;
      try {
        const f = imgIn.files[0];
        const image = f ? await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); }) : null;
        await generateModel(api, { prompt: mprompt.value.trim(), model: model.value, image }, (s) => { mstatus.textContent = s; });
        mstatus.textContent = 'Done — saved to Files → /Generated/Videos.'; await render();
      } catch (e) { mstatus.textContent = e.message; } finally { mbtn.disabled = false; }
    };
    const pro = h('details.glass.widget', h('summary', h('b.small', 'AI video model (MiniMax, Wan, Kling, Luma) — needs the JARVIS-X server')),
      h('div.stack', { style: 'margin-top:8px' }, mprompt, h('div.row', model, h('label.small.dim', 'Start from image ', imgIn), mbtn), mstatus,
        h('div.xs.muted', api.platform.isServer ? 'Billed by Replicate to the server\'s or your token (a few cents to ~$0.50 per clip).' : 'Not available here — run the JARVIS-X server with REPLICATE_API_TOKEN. Story videos above work everywhere.')));

    el.append(h('div.stack', h('h3', { style: 'margin:0' }, 'Story video'), story, pro, h('div.section-title', 'Your videos'), grid));
    render();
    return () => { off(); urls.forEach((u) => URL.revokeObjectURL(u)); };
  },
};

export { makeStoryVideo };
