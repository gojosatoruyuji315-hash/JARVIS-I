/**
 * Life & focus plugins: Expense Tracker, Focus Sounds, Journal, Slides from Notes.
 */
import { renderMarkdown } from '../core/markdown.js';

/* ----------------------------------------------------------------- expenses */
const CATS = ['Food', 'Transport', 'Shopping', 'Bills', 'Health', 'Education', 'Entertainment', 'Travel', 'Rent', 'Other'];
const month = (d = new Date()) => d.toISOString().slice(0, 7);
export const expenses = {
  id: 'expenses', name: 'Expense Tracker', version: '1.0.0', author: 'JARVIS-X',
  icon: 'dollar', category: 'Finance', needs: [],
  description: 'Log spending in seconds ("spent 250 on lunch"), set a monthly budget, see where money goes by category and export CSV. The assistant can log and summarise for you.',
  settings: [{ key: 'currency', label: 'Currency', type: 'select', default: 'INR', options: [['INR', '₹ INR'], ['USD', '$ USD'], ['EUR', '€ EUR'], ['GBP', '£ GBP'], ['AED', 'AED'], ['SGD', 'SGD']] }, { key: 'budget', label: 'Monthly budget', type: 'number', default: 0 }],
  commands: [{ match: /^(?:spent|paid)\s+([\d.,]+)\s+(?:on|for)\s+(.+)$/i, run(t, api) { const [, amt, what] = t.match(/^(?:spent|paid)\s+([\d.,]+)\s+(?:on|for)\s+(.+)$/i); const e = add(api, +amt.replace(/,/g, ''), what); return `Logged ${money(api, e.amount)} — ${e.note} (${e.cat}). This month: ${money(api, total(api, month()))}.`; } }],
  tools: [
    { name: 'log_expense', description: 'Record an expense.', schema: { type: 'object', properties: { amount: { type: 'number' }, note: { type: 'string' }, category: { type: 'string', enum: CATS }, date: { type: 'string', description: 'YYYY-MM-DD, default today' } }, required: ['amount', 'note'] }, run: (i, api) => add(api, +i.amount, i.note, i.category, i.date) },
    { name: 'spending_summary', description: 'Spending totals by category for a month (YYYY-MM, default this month) and the budget.', schema: { type: 'object', properties: { month: { type: 'string' } } }, run: (i, api) => ({ month: i.month || month(), total: total(api, i.month || month()), byCategory: byCat(api, i.month || month()), budget: api.setting('budget') || null, currency: api.setting('currency') }) },
  ],
  panel(el, api) {
    const { h, icon } = api;
    const amt = h('input.input', { type: 'number', placeholder: 'Amount', style: 'width:120px' }); const note = h('input.input.grow', { placeholder: 'What for?' });
    const cat = h('select.select', { style: 'width:auto' }, h('option', { value: '' }, 'Auto category'), CATS.map((c) => h('option', c)));
    const date = h('input.input', { type: 'date', value: new Date().toISOString().slice(0, 10), style: 'width:auto' });
    let m = month(); const body = h('div.stack');
    const render = () => {
      const list = api.get('items', []).filter((e) => e.date.startsWith(m)).sort((a, b) => b.date.localeCompare(a.date));
      const t = total(api, m); const bud = +api.setting('budget') || 0; const bc = byCat(api, m); const max = Math.max(1, ...Object.values(bc));
      body.replaceChildren(
        h('div.row', h('button.btn.icon.sm', { 'aria-label': 'Previous month', onclick: () => { const d = new Date(m + '-15'); d.setMonth(d.getMonth() - 1); m = month(d); render(); } }, icon('prev')), h('h3', new Date(m + '-15').toLocaleDateString([], { month: 'long', year: 'numeric' })), h('button.btn.icon.sm', { 'aria-label': 'Next month', onclick: () => { const d = new Date(m + '-15'); d.setMonth(d.getMonth() + 1); m = month(d); render(); } }, icon('next')), h('span.grow'), h('button.btn.ghost.sm', { onclick: () => api.download(`expenses-${m}.csv`, 'date,amount,category,note\n' + list.map((e) => `${e.date},${e.amount},${e.cat},"${e.note.replace(/"/g, '""')}"`).join('\n'), 'text/csv') }, icon('download'), 'CSV')),
        h('div.grid3', h('div.glass.widget', h('div.w-title', 'Spent'), h('div.w-big', money(api, t))), bud ? h('div.glass.widget', h('div.w-title', 'Budget left'), h('div.w-big', { style: `color:var(${t > bud ? '--danger' : '--ok'})` }, money(api, bud - t)), h('div.meter', { class: t > bud ? 'bad' : t > bud * 0.8 ? 'warn' : '' }, h('i', { style: `width:${Math.min(100, (t / bud) * 100)}%` }))) : h('div.glass.widget', h('div.w-title', 'Budget'), h('div.small.dim', 'Set a monthly budget in plugin settings.')), h('div.glass.widget', h('div.w-title', 'Entries'), h('div.w-big', String(list.length)))),
        h('div.stack', Object.entries(bc).sort((a, b) => b[1] - a[1]).map(([c, v]) => h('div', h('div.stat-row', h('span', c), h('b', money(api, v))), h('div.meter', h('i', { style: `width:${(v / max) * 100}%` }))))),
        h('div.list', list.length ? list.map((e) => h('div.item', h('span.mono.small', e.date.slice(5)), h('span.pill', e.cat), h('span.grow.small', e.note), h('b.mono', money(api, e.amount)), h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete', onclick: () => { api.set('items', api.get('items', []).filter((x) => x.id !== e.id)); render(); } }, icon('trash')))) : h('div.empty', 'No expenses this month.')));
    };
    const addNow = () => { if (!+amt.value) return; add(api, +amt.value, note.value || 'Expense', cat.value, date.value); amt.value = ''; note.value = ''; render(); amt.focus(); };
    note.addEventListener('keydown', (e) => e.key === 'Enter' && addNow());
    el.append(h('div.stack', h('div.row', amt, note, cat, date, h('button.btn.primary', { onclick: addNow }, icon('plus'), 'Add')), h('div.xs.muted', 'Tip: type "spent 250 on lunch" in the command bar.'), body));
    render();
  },
};
const guess = (n) => { const s = n.toLowerCase(); return /lunch|dinner|food|coffee|tea|grocer|swiggy|zomato|snack|restaurant/.test(s) ? 'Food' : /uber|ola|cab|bus|metro|train|fuel|petrol|auto|parking/.test(s) ? 'Transport' : /rent/.test(s) ? 'Rent' : /bill|electric|wifi|internet|phone|recharge|water|gas/.test(s) ? 'Bills' : /doctor|medic|pharma|gym|health/.test(s) ? 'Health' : /book|course|tuition|fees|school|college/.test(s) ? 'Education' : /movie|netflix|spotify|game|concert/.test(s) ? 'Entertainment' : /flight|hotel|trip|travel/.test(s) ? 'Travel' : /amazon|flipkart|shop|clothes|shoes/.test(s) ? 'Shopping' : 'Other'; };
function add(api, amount, note, cat, date) { const e = { id: api.uid('x'), amount: Math.round(amount * 100) / 100, note: String(note).slice(0, 120), cat: CATS.includes(cat) ? cat : guess(note), date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : new Date().toISOString().slice(0, 10) }; api.set('items', [e, ...api.get('items', [])]); return e; }
const total = (api, m) => api.get('items', []).filter((e) => e.date.startsWith(m)).reduce((a, e) => a + e.amount, 0);
const byCat = (api, m) => api.get('items', []).filter((e) => e.date.startsWith(m)).reduce((o, e) => ({ ...o, [e.cat]: (o[e.cat] || 0) + e.amount }), {});
const money = (api, n) => api.fmt.money(Math.round(n), api.setting('currency') || 'INR');

/* ------------------------------------------------------------- focus sounds */
let ctx, nodes = {};
function noiseBuffer(c, color) {
  const len = c.sampleRate * 4; const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1;
      if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; }
      else d[i] = w * 0.5; } }
  return b;
}
const SOUNDS = {
  rain: { label: 'Rain', make(c, out) { const s = c.createBufferSource(); s.buffer = noiseBuffer(c, 'pink'); s.loop = true; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 800; s.connect(f).connect(out); s.start(); return () => s.stop(); } },
  ocean: { label: 'Ocean waves', make(c, out) { const s = c.createBufferSource(); s.buffer = noiseBuffer(c, 'brown'); s.loop = true; const g = c.createGain(); const lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 0.45; lfo.connect(lg).connect(g.gain); g.gain.value = 0.55; s.connect(g).connect(out); s.start(); lfo.start(); return () => { s.stop(); lfo.stop(); }; } },
  wind: { label: 'Wind', make(c, out) { const s = c.createBufferSource(); s.buffer = noiseBuffer(c, 'white'); s.loop = true; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; const lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = 0.05; lg.gain.value = 300; lfo.connect(lg).connect(f.frequency); f.frequency.value = 500; s.connect(f).connect(out); s.start(); lfo.start(); return () => { s.stop(); lfo.stop(); }; } },
  fire: { label: 'Fireplace', make(c, out) { const s = c.createBufferSource(); s.buffer = noiseBuffer(c, 'brown'); s.loop = true; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; s.connect(f).connect(out); s.start(); const iv = setInterval(() => { const o = c.createBufferSource(); o.buffer = noiseBuffer(c, 'white'); const g = c.createGain(); const t = c.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25 * Math.random() + 0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000; o.connect(hp).connect(g).connect(out); o.start(t); o.stop(t + 0.05); }, 140); return () => { s.stop(); clearInterval(iv); }; } },
  white: { label: 'White noise', make(c, out) { const s = c.createBufferSource(); s.buffer = noiseBuffer(c, 'white'); s.loop = true; s.connect(out); s.start(); return () => s.stop(); } },
  pink: { label: 'Pink noise', make(c, out) { const s = c.createBufferSource(); s.buffer = noiseBuffer(c, 'pink'); s.loop = true; s.connect(out); s.start(); return () => s.stop(); } },
  brown: { label: 'Brown noise', make(c, out) { const s = c.createBufferSource(); s.buffer = noiseBuffer(c, 'brown'); s.loop = true; s.connect(out); s.start(); return () => s.stop(); } },
  alpha: { label: 'Focus tone (10 Hz binaural, use headphones)', make(c, out) { const m = c.createChannelMerger(2); const a = c.createOscillator(); const b = c.createOscillator(); a.frequency.value = 200; b.frequency.value = 210; const g = c.createGain(); g.gain.value = 0.15; a.connect(m, 0, 0); b.connect(m, 0, 1); m.connect(g).connect(out); a.start(); b.start(); return () => { a.stop(); b.stop(); }; } },
};
export const ambient = {
  id: 'focus-sounds', name: 'Focus Sounds', version: '1.0.0', author: 'JARVIS-X',
  icon: 'music', category: 'Wellbeing', needs: [],
  description: 'Mix rain, ocean, wind, fireplace, white/pink/brown noise and a binaural focus tone — generated live, works offline. Includes a sleep timer.',
  commands: [{ match: /^(?:play|start) (rain|ocean|wind|fire|white noise|pink noise|brown noise)(?: sounds?)?$/i, run(t, api) { const k = t.match(/(rain|ocean|wind|fire|white|pink|brown)/i)[1].toLowerCase(); toggle(k, 0.6); return `Playing ${SOUNDS[k].label.toLowerCase()}.`; } }, { match: /^stop (?:focus )?sounds$/i, run() { for (const k of Object.keys(nodes)) toggle(k, 0); return 'Stopped.'; } }],
  deactivate() { for (const k of Object.keys(nodes)) toggle(k, 0); },
  panel(el, api) {
    const { h, icon } = api;
    const rows = Object.entries(SOUNDS).map(([k, s]) => { const r = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: nodes[k]?.gain.gain.value ?? 0, 'aria-label': s.label, oninput: (e) => toggle(k, +e.target.value) }); return h('div.planner-row', { style: 'grid-template-columns:minmax(140px,220px) minmax(0,1fr)' }, h('span.small', s.label), r); });
    const timer = h('select.select', { style: 'width:auto' }, [0, 15, 30, 45, 60, 90].map((m) => h('option', { value: m }, m ? `Stop after ${m} min` : 'No sleep timer')));
    let tm; timer.onchange = () => { clearTimeout(tm); if (+timer.value) tm = setTimeout(() => { for (const k of Object.keys(nodes)) toggle(k, 0); el.querySelectorAll('input[type=range]').forEach((r) => { r.value = 0; }); }, +timer.value * 6e4); };
    el.append(h('div.stack', { style: 'max-width:640px' }, h('div.small.dim', 'Drag a slider to mix in a sound. Everything is synthesised in your browser.'), ...rows,
      h('div.row', timer, h('button.btn', { onclick: () => { for (const k of Object.keys(nodes)) toggle(k, 0); el.querySelectorAll('input[type=range]').forEach((r) => { r.value = 0; }); } }, icon('stop'), 'Stop all'))));
  },
};
function toggle(k, vol) {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)(); ctx.resume();
  if (!nodes[k] && vol > 0) { const g = ctx.createGain(); g.gain.value = 0; g.connect(ctx.destination); nodes[k] = { gain: g, stop: SOUNDS[k].make(ctx, g) }; }
  if (!nodes[k]) return;
  nodes[k].gain.gain.setTargetAtTime(vol * 0.8, ctx.currentTime, 0.2);
  if (vol === 0) { const n = nodes[k]; delete nodes[k]; setTimeout(() => { try { n.stop(); } catch { /* */ } n.gain.disconnect(); }, 800); }
}

/* ------------------------------------------------------------------ journal */
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
export const journal = {
  id: 'journal', name: 'Daily Journal', version: '1.0.0', author: 'JARVIS-X',
  icon: 'edit', category: 'Wellbeing', needs: [],
  description: 'A private daily journal with mood tracking, gentle prompts and an AI weekly reflection on what went well and what to try next.',
  panel(el, api) {
    const { h, icon } = api;
    const today = new Date().toISOString().slice(0, 10);
    const entries = () => api.get('entries', {});
    const e = entries()[today] || { text: '', mood: 3 };
    const PROMPTS = ['What are three things that went well today?', 'What drained your energy, and what gave you energy?', 'What did you learn today?', 'What would make tomorrow great?', 'Who are you grateful for, and why?'];
    const ta = h('textarea.textarea', { style: 'min-height:180px', placeholder: PROMPTS[new Date().getDay() % PROMPTS.length], value: e.text });
    const moods = h('div.row', MOODS.map((m, i) => h('button.btn', { 'aria-label': `Mood ${i + 1} of 5`, 'aria-pressed': String(e.mood === i), style: `font-size:20px;${e.mood === i ? 'border-color:var(--accent);box-shadow:var(--glow)' : ''}`, onclick: () => { e.mood = i; save(); renderMoods(); } }, m)));
    const renderMoods = () => [...moods.children].forEach((b, i) => { b.style.borderColor = e.mood === i ? 'var(--accent)' : ''; b.style.boxShadow = e.mood === i ? 'var(--glow)' : ''; });
    const save = () => api.set('entries', { ...entries(), [today]: { text: ta.value, mood: e.mood, updated: Date.now() } });
    ta.addEventListener('input', api.fmt ? (() => { let t; return () => { clearTimeout(t); t = setTimeout(save, 400); }; })() : save);
    const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 29 + i); return d.toISOString().slice(0, 10); });
    const strip = h('div', { style: 'display:grid;grid-template-columns:repeat(30,1fr);gap:2px' }, days.map((d) => { const x = entries()[d]; return h('div', { title: `${d}${x ? ' · mood ' + (x.mood + 1) + '/5' : ''}`, style: `height:24px;border-radius:3px;background:${x ? `color-mix(in srgb, var(--accent) ${20 + x.mood * 20}%, transparent)` : 'var(--panel-hi)'}` }); }));
    const refl = h('div.md.glass.widget', { hidden: true });
    const reflect = async () => {
      const week = days.slice(-7).map((d) => [d, entries()[d]]).filter(([, x]) => x?.text);
      if (!week.length) { api.toast('Write a few entries first.'); return; }
      refl.hidden = false; refl.textContent = 'Reflecting…';
      try { const t = await api.ask(`Here are my journal entries for the past week (mood 1–5). Write a warm, short weekly reflection in Markdown: patterns you notice, what went well, one gentle suggestion for next week. Don't diagnose anything.\n\n${week.map(([d, x]) => `${d} (mood ${x.mood + 1}): ${x.text}`).join('\n\n')}`, { onText: (t2) => { refl.innerHTML = renderMarkdown(t2); } }); refl.innerHTML = renderMarkdown(t); }
      catch (err) { refl.textContent = err.message; }
    };
    el.append(h('div.stack', h('h3', new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })), h('div.row', h('span.small.dim', 'Mood'), moods), ta,
      h('div.section-title', 'Last 30 days'), strip, h('button.btn', { style: 'justify-self:start', onclick: reflect }, icon('sparkles'), 'Weekly reflection'), refl,
      h('div.xs.muted', 'Entries are private and stored encrypted with your other data.')));
  },
};

/* ------------------------------------------------------------------- slides */
export const slides = {
  id: 'slides', name: 'Slides from Notes', version: '1.0.0', author: 'JARVIS-X',
  icon: 'layers', category: 'Productivity', needs: [],
  description: 'Present any Markdown note as full-screen slides (split on --- or headings), or ask the AI to draft a deck from a topic.',
  panel(el, api) {
    const { h, icon } = api;
    const notesP = import('../core/store.js').then(({ store }) => store);
    const sel = h('select.select', { style: 'max-width:320px' }); const topic = h('input.input.grow', { placeholder: 'Or have the AI draft slides about…' }); const status = h('div.small.dim'); const prev = h('div.grid3');
    notesP.then((store) => { sel.replaceChildren(...store.get('notes').filter((n) => n.format !== 'rich').map((n) => h('option', { value: n.id }, n.title))); preview(); });
    const split = (md) => (md.includes('\n---') ? md.split(/\n-{3,}\n/) : md.split(/\n(?=#{1,2} )/)).map((s) => s.trim()).filter(Boolean);
    async function preview() { const store = await notesP; const n = store.findById('notes', sel.value); prev.replaceChildren(...(n ? split(n.body).map((s, i) => h('div.glass.widget', { style: 'max-height:160px;overflow:hidden' }, h('div.xs.muted', `Slide ${i + 1}`), h('div.md.small', { html: renderMarkdown(s) }))) : [])); }
    sel.onchange = preview;
    const present = async () => {
      const store = await notesP; const n = store.findById('notes', sel.value); if (!n) return;
      const list = split(n.body); let i = 0;
      const stage = h('div.md', { style: 'font-size:clamp(18px,2.4vw,34px);max-width:1100px;width:100%' });
      const counter = h('div.xs.muted', { style: 'position:absolute;bottom:16px;right:24px' });
      const ov = h('div', { style: 'position:fixed;inset:0;z-index:2000;background:var(--bg);display:grid;place-items:center;padding:6vh 6vw', tabindex: 0 }, stage, counter);
      const draw = () => { stage.innerHTML = renderMarkdown(list[i]); counter.textContent = `${i + 1} / ${list.length} · ← → to move · Esc to exit`; };
      const key = (e) => { if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) { i = Math.min(list.length - 1, i + 1); draw(); } else if (['ArrowLeft', 'PageUp'].includes(e.key)) { i = Math.max(0, i - 1); draw(); } else if (e.key === 'Escape') close(); e.stopPropagation(); };
      const close = () => { removeEventListener('keydown', key, true); ov.remove(); document.fullscreenElement && document.exitFullscreen?.(); };
      ov.addEventListener('click', () => { i = Math.min(list.length - 1, i + 1); draw(); });
      addEventListener('keydown', key, true); document.body.append(ov); ov.requestFullscreen?.().catch(() => {}); draw();
    };
    const draft = async () => {
      if (!topic.value.trim()) return; status.textContent = 'Drafting…';
      try {
        const md = await api.ask(`Write a presentation about: ${topic.value}\nFormat: Markdown slides separated by a line containing only ---. 8–12 slides. Each slide: one "# " title and 3–5 short bullets. First slide is a title slide, last is a summary.`);
        const store = await notesP; const n = { id: api.uid('n'), title: `Slides: ${topic.value.slice(0, 40)}`, body: md, format: 'md', pinned: false, updated: Date.now() };
        store.unshift('notes', n); sel.prepend(h('option', { value: n.id, selected: true }, n.title)); sel.value = n.id; status.textContent = 'Saved as a note.'; preview();
      } catch (e) { status.textContent = e.message; }
    };
    el.append(h('div.stack', h('div.row', sel, h('button.btn.primary', { onclick: present }, icon('play'), 'Present'), h('button.btn.ghost', { onclick: async () => { const store = await notesP; const n = store.findById('notes', sel.value); if (n) { const { exportPDF } = await import('../core/exporters.js'); exportPDF(n.title, split(n.body).join('\n\n')); } } }, icon('download'), 'PDF handout')),
      h('div.row', topic, h('button.btn', { onclick: draft }, icon('sparkles'), 'Draft with AI')), status, prev));
  },
};
