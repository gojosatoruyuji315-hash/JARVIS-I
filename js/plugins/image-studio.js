/**
 * Image Studio plugin — text-to-image generation.
 * Engines: Pollinations (free, no key), OpenAI (server key or your key),
 * Replicate FLUX (via the JARVIS-X server). Results are saved to Files → /Generated.
 */
import { api as server } from '../core/api.js';
import { sanitizeSvg } from './svg-illustrator.js';

const SIZES = { square: [1024, 1024], landscape: [1536, 1024], portrait: [1024, 1536] };
const STYLES = ['', 'photorealistic', 'digital art', 'watercolor', 'anime', 'pixel art', '3D render', 'line art', 'cinematic'];

async function generate(prompt, { engine, aspect = 'square', style = '' }, api) {
  const full = style ? `${prompt}, ${style} style` : prompt;
  const [w, h] = SIZES[aspect] || SIZES.square;
  if (engine === 'illustrated') {
    // Works with any AI engine (including Claude inside the viewer): the AI paints the picture as SVG,
    // then it is rasterised to a PNG at the requested size.
    const text = await api.ask(`Paint this picture as a detailed SVG illustration: ${full}.\nRules: output ONLY one complete <svg> element, viewBox="0 0 ${w} ${h}", fill the whole canvas with a background, use layered shapes, gradients and soft shadows in <defs> for depth, no text unless asked, no external images, fonts or scripts, under 16 KB.`, { tier: 'default' });
    const svg = sanitizeSvg(text);
    const img = new Image(); const u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('The drawing could not be rendered — try again.')); img.src = u; });
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(u);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }
  if (engine === 'pollinations') {
    const seed = Math.floor(Math.random() * 1e9);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=flux`;
    const r = await fetch(url); if (!r.ok) throw new Error(`Pollinations returned ${r.status}`);
    return r.blob();
  }
  if (engine === 'openai') {
    const size = `${w}x${h}`;
    if (api.platform.isServer && api.platform.server?.features?.media) {
      const { image } = await server.post('/api/media/image', { prompt: full, size });
      return (await fetch(image)).blob();
    }
    const key = api.setting('openaiKey'); if (!key) throw new Error('Add your OpenAI API key in Image Studio settings (or run the JARVIS-X server with OPENAI_API_KEY).');
    const j = await api.json('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'gpt-image-1', prompt: full, size, n: 1 }) });
    const d = j.data[0]; return d.b64_json ? (await fetch(`data:image/png;base64,${d.b64_json}`)).blob() : (await fetch(d.url)).blob();
  }
  if (engine === 'replicate') {
    if (!api.platform.isServer) throw new Error('Replicate runs through the JARVIS-X server.');
    const headers = api.setting('replicateToken') ? { 'x-replicate-token': api.setting('replicateToken') } : {};
    const call = (path, body) => fetch(path, { method: body ? 'POST' : 'GET', headers: { 'X-JX': '1', 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });
    let p = await call('api/media/replicate/predictions', { model: api.setting('replicateModel') || 'black-forest-labs/flux-schnell', input: { prompt: full, aspect_ratio: aspect === 'square' ? '1:1' : aspect === 'landscape' ? '3:2' : '2:3' } });
    for (let i = 0; i < 120 && !['succeeded', 'failed', 'canceled'].includes(p.status); i++) { await new Promise((r) => setTimeout(r, 2000)); p = await call(`api/media/replicate/predictions/${p.id}`); }
    if (p.status !== 'succeeded') throw new Error(p.error || `Generation ${p.status}`);
    const out = Array.isArray(p.output) ? p.output[0] : p.output;
    return (await fetch(out)).blob();
  }
  throw new Error('Unknown engine');
}

async function run(prompt, opts, api) {
  let engine = opts.engine || api.setting('engine') || 'auto';
  if (engine === 'auto') engine = api.platform.directNetwork ? 'pollinations' : 'illustrated';
  if (!api.platform.directNetwork && engine !== 'illustrated') engine = 'illustrated';
  const blob = await generate(prompt, { ...opts, engine }, api);
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
  const name = `${prompt.slice(0, 40).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'image'}-${Date.now().toString(36)}.${ext}`;
  const file = await api.saveToFiles(blob, name, '/Generated/Images');
  api.set('gallery', [{ id: file.id, prompt, engine, ts: Date.now() }, ...api.get('gallery', [])].slice(0, 200));
  return { blob, file };
}

export default {
  id: 'image-studio', name: 'Image Studio', version: '1.0.0', author: 'JARVIS-X',
  icon: 'image', category: 'Creative', needs: [],
  description: 'Generate images from text with Pollinations FLUX (free), OpenAI or Replicate — or let the AI paint them, which also works offline-from-the-web and inside Claude. Saves to your Files and lets the assistant create images on request.',
  settings: [
    { key: 'engine', label: 'Default engine', type: 'select', default: 'auto', options: [['auto', 'Automatic'], ['pollinations', 'Pollinations FLUX — free, no key'], ['illustrated', 'AI-painted (works everywhere)'], ['openai', 'OpenAI gpt-image-1'], ['replicate', 'Replicate (via server)']] },
    { key: 'openaiKey', label: 'OpenAI API key (optional)', type: 'password', placeholder: 'sk-…', help: 'Only needed for OpenAI without the JARVIS-X server.' },
    { key: 'replicateToken', label: 'Replicate API token (optional)', type: 'password', placeholder: 'r8_…', help: 'Used through your JARVIS-X server.' },
    { key: 'replicateModel', label: 'Replicate model', type: 'text', default: 'black-forest-labs/flux-schnell' },
  ],
  tools: [{
    name: 'generate_image', description: 'Generate an image from a text description and save it to the user\'s Files. Returns the saved file name.',
    schema: { type: 'object', properties: { prompt: { type: 'string', description: 'Detailed visual description' }, aspect: { type: 'string', enum: ['square', 'landscape', 'portrait'] } }, required: ['prompt'] },
    async run(input, api) { const { file } = await run(String(input.prompt), { aspect: input.aspect }, api); return { saved: file.name, folder: file.folder }; },
  }],
  commands: [{ match: /^(?:generate|create|draw|make) (?:an? )?(?:image|picture|photo) (?:of )?(.+)/i, async run(text, api) { const p = text.match(/^(?:generate|create|draw|make) (?:an? )?(?:image|picture|photo) (?:of )?(.+)/i)[1]; const { file } = await run(p, {}, api); return `Created **${file.name}** — it's in Files → ${file.folder}.`; } }],

  async panel(el, api) {
    const { h, icon } = api;
    const prompt = h('textarea.textarea', { placeholder: 'A lighthouse on a cliff at dusk, dramatic clouds, warm light…', style: 'min-height:80px' });
    const engine = h('select.select', { style: 'width:auto', 'aria-label': 'Engine' }, (api.platform.directNetwork ? [['pollinations', 'Pollinations FLUX (free)'], ['illustrated', 'AI-painted'], ['openai', 'OpenAI'], ['replicate', 'Replicate FLUX']] : [['illustrated', 'AI-painted']]).map(([v, l]) => h('option', { value: v, selected: v === ((api.setting('engine') || 'auto') === 'auto' ? (api.platform.directNetwork ? 'pollinations' : 'illustrated') : api.setting('engine')) }, l)));
    const aspect = h('select.select', { style: 'width:auto', 'aria-label': 'Aspect' }, [['square', 'Square'], ['landscape', 'Landscape'], ['portrait', 'Portrait']].map(([v, l]) => h('option', { value: v }, l)));
    const style = h('select.select', { style: 'width:auto', 'aria-label': 'Style' }, STYLES.map((s) => h('option', { value: s }, s || 'Any style')));
    const btn = h('button.btn.primary', icon('sparkles'), 'Generate');
    const status = h('div.small.dim');
    const grid = h('div.gen-grid');
    const urls = [];
    const renderGallery = async () => {
      const { idb } = await import('../core/idb.js');
      grid.replaceChildren();
      for (const g of api.get('gallery', []).slice(0, 60)) {
        const blob = await idb.get('blobs', g.id); if (!blob) continue;
        const u = URL.createObjectURL(blob); urls.push(u);
        grid.append(h('figure', h('img', { src: u, alt: g.prompt, loading: 'lazy' }), h('figcaption', { title: g.prompt }, g.prompt),
          h('div.row', h('button.btn.sm', { onclick: () => api.download(`${g.prompt.slice(0, 30).replace(/\W+/g, '-')}.png`, blob) }, icon('download'), 'Save'), h('button.btn.ghost.sm', { onclick: () => { prompt.value = g.prompt; prompt.focus(); } }, 'Reuse prompt'))));
      }
      if (!grid.children.length) grid.append(h('div.empty', 'Your generated images will appear here.'));
    };
    btn.onclick = async () => {
      if (!prompt.value.trim()) return;
      btn.disabled = true; status.textContent = 'Generating… (5–30 s)';
      try { await run(prompt.value.trim(), { engine: engine.value, aspect: aspect.value, style: style.value }, api); status.textContent = 'Done — saved to Files → /Generated/Images.'; await renderGallery(); }
      catch (e) { status.textContent = e.message; }
      finally { btn.disabled = false; }
    };
    el.append(h('div.stack', prompt, h('div.row', engine, aspect, style, btn), status, h('div.section-title', 'Gallery'), grid));
    renderGallery();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  },
};
