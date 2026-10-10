/**
 * AI Illustrator plugin — the AI draws vector illustrations, icons and logos as SVG.
 * Works anywhere the assistant works (including inside Claude). Export SVG or PNG.
 */
const STYLES = { flat: 'flat vector illustration, bold shapes, limited palette', line: 'clean monoline line art, consistent stroke width', icon: 'simple app icon on a rounded square, centered symbol', logo: 'minimal logo mark with optional wordmark', isometric: 'isometric illustration with soft shading', diagram: 'clear labelled diagram, readable text' };

/** Strip anything executable or external from AI-produced SVG. */
export function sanitizeSvg(src) {
  const m = String(src).match(/<svg[\s\S]*<\/svg>/i); if (!m) throw new Error('The AI did not return an SVG. Try rephrasing.');
  const doc = new DOMParser().parseFromString(m[0], 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('The SVG had errors. Try again.');
  const svg = doc.documentElement;
  svg.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((n) => n.remove());
  for (const n of [svg, ...svg.querySelectorAll('*')]) for (const a of [...n.attributes]) {
    if (/^on/i.test(a.name)) n.removeAttribute(a.name);
    if (/href$/i.test(a.name) && !/^#/.test(a.value) && !/^data:image\//.test(a.value)) n.removeAttribute(a.name);
  }
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${parseFloat(svg.getAttribute('width')) || 512} ${parseFloat(svg.getAttribute('height')) || 512}`);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(svg);
}

export async function draw(api, prompt, style = 'flat', onText) {
  const text = await api.ask(`Create an SVG image: ${prompt}.\nStyle: ${STYLES[style] || style}.\nRules: output ONLY one complete <svg> element (no Markdown, no explanation), viewBox="0 0 512 512", no external images, fonts or scripts, use <defs> for gradients if useful, keep it under 12 KB, make it visually polished.`, { onText, tier: 'default' });
  return sanitizeSvg(text);
}
export async function toPng(svgText, size = 1024) {
  const img = new Image(); const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').drawImage(img, 0, 0, size, size);
  URL.revokeObjectURL(url);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

export default {
  id: 'svg-illustrator', name: 'AI Illustrator', version: '1.0.0', author: 'JARVIS-X',
  icon: 'wand', category: 'Creative', needs: ['ai'],
  description: 'The AI draws vector illustrations, icons, logos and diagrams as crisp SVG. Works with any AI engine, including Claude. Export SVG or PNG.',
  tools: [{
    name: 'draw_svg', description: 'Draw a vector illustration/icon/logo as SVG and save it to the user\'s Files.',
    schema: { type: 'object', properties: { prompt: { type: 'string' }, style: { type: 'string', enum: Object.keys(STYLES) } }, required: ['prompt'] },
    async run(input, api) { const svg = await draw(api, String(input.prompt), input.style); const f = await api.saveToFiles(new Blob([svg], { type: 'image/svg+xml' }), `${String(input.prompt).slice(0, 30).replace(/\W+/g, '-')}.svg`, '/Generated/Illustrations'); return { saved: f.name }; },
  }],
  panel(el, api) {
    const { h, icon } = api;
    const prompt = h('input.input.grow', { placeholder: 'e.g. a friendly robot waving, a rocket logo, the water cycle' });
    const style = h('select.select', { style: 'width:auto', 'aria-label': 'Style' }, Object.keys(STYLES).map((s) => h('option', { value: s }, s[0].toUpperCase() + s.slice(1))));
    const stage = h('div.svg-stage', h('div.small', { style: 'color:#667' }, 'Your illustration appears here.'));
    const status = h('div.small.dim'); let current = null;
    const go = async () => {
      if (!prompt.value.trim()) return; status.textContent = 'Drawing… (the AI writes the SVG, usually 10–40 s)';
      try { current = await draw(api, prompt.value.trim(), style.value); stage.innerHTML = current; status.textContent = ''; api.set('last', current); }
      catch (e) { status.textContent = e.message; }
    };
    prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const last = api.get('last'); if (last) { current = last; stage.innerHTML = last; }
    el.append(h('div.stack', h('div.row', prompt, style, h('button.btn.primary', { onclick: go }, icon('wand'), 'Draw')), status, stage,
      h('div.row',
        h('button.btn', { onclick: () => current && api.download('illustration.svg', new Blob([current], { type: 'image/svg+xml' })) }, icon('download'), 'SVG'),
        h('button.btn', { onclick: async () => current && api.download('illustration.png', await toPng(current)) }, icon('download'), 'PNG 1024'),
        h('button.btn.ghost', { onclick: async () => current && api.saveToFiles(new Blob([current], { type: 'image/svg+xml' }), `illustration-${Date.now().toString(36)}.svg`, '/Generated/Illustrations') }, icon('folder'), 'Save to Files'),
        h('button.btn.ghost', { onclick: () => current && api.copyText(current) }, icon('copy'), 'Copy SVG code'))));
  },
};
