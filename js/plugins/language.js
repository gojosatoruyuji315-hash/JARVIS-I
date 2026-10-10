/**
 * Language plugins: Translator (AI), Dictionary & Thesaurus (dictionaryapi.dev + Datamuse)
 * and Wikipedia Reader. Exported as three manifests from one module.
 */
const LANGS = ['English', 'Hindi', 'Spanish', 'French', 'German', 'Japanese', 'Chinese (Simplified)', 'Arabic', 'Portuguese', 'Russian', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Kannada', 'Malayalam', 'Gujarati', 'Punjabi', 'Urdu', 'Korean', 'Italian'];

export const translator = {
  id: 'translator', name: 'Translator', version: '1.0.0', author: 'JARVIS-X',
  icon: 'translate', category: 'Language', needs: ['ai'],
  description: 'Translate text between 20+ languages, including Indian languages, with tone control. Uses your AI engine, so it works inside Claude too.',
  panel(el, api) {
    const { h, icon } = api;
    const sel = (v) => h('select.select', { style: 'width:auto' }, ['Detect language', ...LANGS].map((l) => h('option', { selected: l === v }, l)));
    const from = sel('Detect language'); const to = sel(api.get('to', 'Hindi')); to.querySelector('option').remove();
    const tone = h('select.select', { style: 'width:auto' }, ['Natural', 'Formal', 'Casual', 'Literal'].map((t) => h('option', t)));
    const src = h('textarea.textarea', { placeholder: 'Type or paste text…', style: 'min-height:160px' });
    const out = h('div.md.glass.widget', { style: 'min-height:160px;white-space:pre-wrap' });
    const go = async () => {
      if (!src.value.trim()) return; api.set('to', to.value); out.textContent = 'Translating…';
      try { out.textContent = await api.ask(`Translate the text below ${from.value === 'Detect language' ? '' : `from ${from.value} `}into ${to.value}. Tone: ${tone.value}. Reply with ONLY the translation, preserving line breaks and formatting.\n\n${src.value}`, { onText: (t) => { out.textContent = t; } }); }
      catch (e) { out.textContent = e.message; }
    };
    el.append(h('div.stack', h('div.row', from, h('button.btn.ghost.icon', { 'aria-label': 'Swap', onclick: () => { if (from.value !== 'Detect language') { const f = from.value; from.value = to.value; to.value = f; } } }, '⇄'), to, tone, h('button.btn.primary', { onclick: go }, icon('translate'), 'Translate')),
      h('div.grid2', src, out), h('div.row', h('button.btn.ghost.sm', { onclick: () => api.copyText(out.textContent) }, icon('copy'), 'Copy translation'))));
  },
};

export const dictionary = {
  id: 'dictionary', name: 'Dictionary & Thesaurus', version: '1.0.0', author: 'JARVIS-X',
  icon: 'book', category: 'Language', needs: ['network'],
  description: 'Definitions with pronunciation audio, synonyms, antonyms and rhymes. Type "define serendipity" or "synonyms for happy" in the command bar.',
  commands: [
    { match: /^define\s+([a-z-]+)$/i, async run(t, api) { const w = t.split(/\s+/)[1]; const j = await api.json(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`); const m = j[0].meanings.slice(0, 3); return `**${j[0].word}** ${j[0].phonetic || ''}\n\n${m.map((x) => `*${x.partOfSpeech}* — ${x.definitions[0].definition}`).join('\n\n')}`; } },
    { match: /^(synonyms?|antonyms?|rhymes?)\s+(for|of|with)\s+([a-z-]+)$/i, async run(t, api) { const [, kind, , w] = t.match(/^(synonyms?|antonyms?|rhymes?)\s+(for|of|with)\s+([a-z-]+)$/i); const rel = /^syn/i.test(kind) ? 'rel_syn' : /^ant/i.test(kind) ? 'rel_ant' : 'rel_rhy'; const j = await api.json(`https://api.datamuse.com/words?${rel}=${encodeURIComponent(w)}&max=20`); return j.length ? `**${kind} ${w}:** ${j.map((x) => x.word).join(', ')}` : `No ${kind.toLowerCase()} found for "${w}".`; } },
  ],
  panel(el, api) {
    const { h, icon } = api;
    const q = h('input.input.grow', { placeholder: 'Look up a word' }); const out = h('div.stack');
    const look = async () => {
      const w = q.value.trim().toLowerCase(); if (!w) return; out.replaceChildren(h('div.small.dim', 'Looking up…'));
      try {
        const [def, syn, ant, rhy] = await Promise.all([api.json(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`).catch(() => null), ...['rel_syn', 'rel_ant', 'rel_rhy'].map((r) => api.json(`https://api.datamuse.com/words?${r}=${encodeURIComponent(w)}&max=24`).catch(() => []))]);
        const audio = def?.[0]?.phonetics?.find((p) => p.audio)?.audio;
        const chips = (list) => h('div.row', { style: 'gap:4px' }, list.length ? list.map((x) => h('button.btn.sm', { onclick: () => { q.value = x.word; look(); } }, x.word)) : h('span.small.muted', '—'));
        out.replaceChildren(
          def ? h('div.glass.widget.stack', h('div.row', h('h2', def[0].word), h('span.dim', def[0].phonetic || ''), audio ? h('button.btn.icon.sm', { 'aria-label': 'Pronounce', onclick: () => new Audio(audio).play() }, icon('volume')) : null),
            def[0].meanings.map((m) => h('div', h('i.dim', m.partOfSpeech), h('ol', { style: 'margin:4px 0' }, m.definitions.slice(0, 4).map((d) => h('li.small', d.definition, d.example ? h('div.xs.muted', `“${d.example}”`) : null)))))) : h('div.item', `No dictionary entry for "${w}".`),
          h('div.section-title', 'Synonyms'), chips(syn), h('div.section-title', 'Antonyms'), chips(ant), h('div.section-title', 'Rhymes'), chips(rhy));
      } catch (e) { out.replaceChildren(h('div.small', e.message)); }
    };
    q.addEventListener('keydown', (e) => e.key === 'Enter' && look());
    el.append(h('div.stack', h('div.row', q, h('button.btn.primary', { onclick: look }, icon('search'), 'Look up')), out));
  },
};

export const wikipedia = {
  id: 'wikipedia', name: 'Wikipedia Reader', version: '1.0.0', author: 'JARVIS-X',
  icon: 'globe', category: 'Knowledge', needs: ['network'],
  description: 'Search and read Wikipedia in any language, save articles to notes, and let the assistant look up facts with sources.',
  settings: [{ key: 'lang', label: 'Wikipedia language code', type: 'text', default: 'en', help: 'e.g. en, hi, ta, es' }],
  tools: [{ name: 'wikipedia_lookup', description: 'Look up a topic on Wikipedia and return a factual summary with the article URL. Use for factual questions.', schema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
    async run({ topic }, api) { const L = api.setting('lang') || 'en'; const s = await api.json(`https://${L}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&srlimit=1&format=json&origin=*`); const t = s.query.search[0]?.title; if (!t) return { found: false }; const j = await api.json(`https://${L}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`); return { title: j.title, summary: j.extract, url: j.content_urls?.desktop?.page }; } }],
  panel(el, api) {
    const { h, icon } = api; const L = () => api.setting('lang') || 'en';
    const q = h('input.input.grow', { placeholder: 'Search Wikipedia' }); const list = h('div.list'); const art = h('div.md.glass.widget', { hidden: true, style: 'max-height:60vh;overflow:auto' });
    const read = async (title) => {
      art.hidden = false; art.textContent = 'Loading…';
      const j = await api.json(`https://${L()}.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&explaintext=1&piprop=thumbnail&pithumbsize=400&titles=${encodeURIComponent(title)}&format=json&origin=*`);
      const p = Object.values(j.query.pages)[0];
      const text = (p.extract || '').replace(/\n{3,}/g, '\n\n');
      art.replaceChildren(h('div.row', h('h2.grow', p.title), h('button.btn.sm', { onclick: () => { api.bus.emit('wiki:save'); import('../core/store.js').then(({ store }) => { store.unshift('notes', { id: api.uid('n'), title: p.title, body: `# ${p.title}\n\nSource: https://${L()}.wikipedia.org/wiki/${encodeURIComponent(p.title)}\n\n${text.slice(0, 20000)}`, format: 'md', pinned: false, updated: Date.now() }); api.toast('Saved to Notes', { type: 'ok' }); }); } }, icon('note'), 'Save to notes'),
        h('a.btn.sm', { href: `https://${L()}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`, target: '_blank', rel: 'noopener' }, icon('external'), 'Open')),
        p.thumbnail ? h('img', { src: p.thumbnail.source, alt: '', style: 'float:right;max-width:200px;margin:0 0 8px 12px;border-radius:8px' }) : null,
        ...text.split('\n').filter(Boolean).map((para) => /^=+ .* =+$/.test(para) ? h('h3', para.replace(/=/g, '').trim()) : h('p', para)));
    };
    const search = async () => {
      if (!q.value.trim()) return; list.replaceChildren(h('div.small.dim', 'Searching…'));
      try { const j = await api.json(`https://${L()}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q.value)}&srlimit=10&format=json&origin=*`);
        list.replaceChildren(...j.query.search.map((r) => h('button.item', { style: 'cursor:pointer;color:var(--fg);text-align:left', onclick: () => read(r.title) }, icon('book', { size: 14 }), h('span.grow', h('b.small', r.title), h('div.xs.dim', { html: r.snippet.replace(/<(?!\/?span)[^>]+>/g, '') }))))); }
      catch (e) { list.replaceChildren(h('div.small', e.message)); }
    };
    q.addEventListener('keydown', (e) => e.key === 'Enter' && search());
    el.append(h('div.stack', h('div.row', q, h('button.btn.primary', { onclick: search }, icon('search'), 'Search')), list, art));
  },
};
