/**
 * Command palette (Ctrl+P) and Smart Search (Ctrl+K).
 * Both use the same keyboard-driven overlay list.
 * @module core/palette
 */
import { h, $, clear, debounce, esc, fmt, copyText } from './dom.js';
import { icon } from './icons.js';
import { bus } from './bus.js';
import { store } from './store.js';
import { MODULES } from './router.js';
import { t } from './i18n.js';
import { tryCalc, tryConvert, FX_NOTE } from './mathx.js';
import { getShortcuts } from './shortcuts.js';
import { platform } from './platform.js';
import { plugins } from './plugins.js';

/* ---------------------------------------------------------- generic list UI */
function overlayList({ placeholder, initial = '', sync, async: asyncSrc, footer }) {
  document.querySelector('.palette')?.remove();
  const input = h('input', { placeholder, 'aria-label': placeholder, autocomplete: 'off', spellcheck: false, value: initial, role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'jx-pal-list' });
  const list = h('div.palette-list', { id: 'jx-pal-list', role: 'listbox' });
  const box = h('div.palette-box.glass', h('div.palette-input', icon('search'), input, h('kbd', 'Esc')), list, h('div.palette-foot', footer || [h('span', h('kbd', '↑↓'), ' navigate'), h('span', h('kbd', 'Enter'), ' select'), h('span', h('kbd', 'Esc'), ' close')]));
  const el = h('div.palette', { onmousedown: (e) => { if (e.target === el) close(); } }, box);
  let items = []; let sel = 0; let asyncGroups = []; let token = 0;
  const close = () => el.remove();
  const render = (groups) => {
    clear(list); items = [];
    for (const g of groups) {
      if (!g.items.length) continue;
      list.append(h('div.palette-group', g.name));
      for (const it of g.items) {
        const idx = items.length;
        const row = h('div.palette-item', { role: 'option', id: 'pi' + idx, onmousemove: () => select(idx), onclick: () => run(idx) },
          icon(it.icon || 'sparkles'), h('div.grow', it.html ? { html: it.html } : it.label), it.hint ? h('span.xs.muted', it.hint) : null);
        items.push({ ...it, row }); list.append(row);
      }
    }
    if (!items.length) list.append(h('div.empty', 'No matches. Press Enter to ask JARVIS-X instead.'));
    select(Math.min(sel, items.length - 1));
  };
  const select = (i) => { sel = Math.max(0, i); items.forEach((it, j) => it.row.setAttribute('aria-selected', String(j === sel))); items[sel]?.row.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', 'pi' + sel); };
  const run = (i) => { const it = items[i]; if (!it) { if (input.value.trim()) { close(); bus.emit('assistant:ask', { text: input.value }); } return; } if (it.keepOpen) { it.run(); return; } close(); it.run(); };
  const refresh = async () => {
    const q = input.value.trim(); const my = ++token; sel = 0; asyncGroups = [];
    const base = sync(q); render(base);
    if (asyncSrc && q.length > 1) {
      for (const p of asyncSrc(q)) p.then((g) => { if (my !== token || !g) return; asyncGroups.push(g); render([...base.slice(0, 1), ...asyncGroups, ...base.slice(1)]); }).catch(() => {});
    }
  };
  input.addEventListener('input', debounce(refresh, 90));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select((sel + 1) % Math.max(items.length, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select((sel - 1 + items.length) % Math.max(items.length, 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  $('#jx-overlays').append(el);
  input.focus(); input.select(); refresh();
  return { close };
}

const match = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q.toLowerCase()));
const ext = (url) => () => bus.emit('open:url', { url });

/* ----------------------------------------------------------------- palette */
export function openPalette() {
  const sc = getShortcuts();
  const actions = [
    { label: 'New conversation', icon: 'chat', run: () => { bus.emit('chat:new'); bus.emit('open', { id: 'assistant' }); } },
    { label: 'New note', icon: 'note', run: () => bus.emit('open', { id: 'productivity', params: { tab: 'notes', new: true } }), hint: sc.notes.keys[0] },
    { label: 'New task', icon: 'tasks', run: () => bus.emit('open', { id: 'productivity', params: { tab: 'tasks', new: true } }), hint: sc.tasks.keys[0] },
    { label: 'Start Pomodoro (25 min)', icon: 'timer', run: () => bus.emit('open', { id: 'productivity', params: { tab: 'pomodoro', autostart: 25 } }) },
    { label: 'Push-to-talk', icon: 'mic', run: () => bus.emit('voice:toggle'), hint: 'Space' },
    { label: 'Smart search', icon: 'search', run: () => openSearch(), hint: sc.search.keys[0] },
    { label: 'Play / pause music', icon: 'music', run: () => bus.emit('music', { cmd: 'toggle' }), hint: sc.music.keys[0] },
    { label: 'Toggle privacy mode', icon: 'eyeoff', run: () => { const v = !store.get('settings.privacy.privacyMode'); store.set('settings.privacy.privacyMode', v); bus.emit('privacy', v); } },
    { label: 'Toggle reduced motion', icon: 'sliders', run: () => { store.set('settings.motion', store.get('settings.motion') === 'reduced' ? 'auto' : 'reduced'); bus.emit('theme:apply'); } },
    { label: 'Toggle high contrast', icon: 'eye', run: () => { store.set('settings.highContrast', !store.get('settings.highContrast')); bus.emit('theme:apply'); } },
    { label: 'Customize dashboard widgets', icon: 'grid', run: () => bus.emit('dashboard:customize') },
    { label: 'Lock JARVIS-X', icon: 'lock', run: () => bus.emit('system', { cmd: 'lock' }), hint: sc.lock.keys[0] },
    { label: 'Shut down', icon: 'power', run: () => bus.emit('system', { cmd: 'shutdown' }) },
    { label: 'Keyboard shortcuts', icon: 'keyboard', run: () => bus.emit('open', { id: 'settings', params: { tab: 'shortcuts' } }) },
    { label: 'Study mode — start or manage a session', icon: 'book', run: () => import('./studymode.js').then(({ studyMode }) => studyMode.openDialog()) },
    { label: 'Browse plugins', icon: 'plug', run: () => bus.emit('open', { id: 'plugins' }) },
    ...plugins.installed().filter((p) => p.hasPanel !== false).map((p) => ({ label: `Plugin: ${p.name}`, icon: p.icon || 'plug', run: () => plugins.openPanel(p.id) })),
    ...['arc', 'silver', 'daylight', 'aurum', 'nebula', 'obsidian'].map((s) => ({ label: `Theme: ${s}`, icon: 'palette', run: () => bus.emit('theme:set', { skin: s }) })),
  ];
  const usage = store.get('memory.commandUsage');
  overlayList({
    placeholder: 'Type a command or module…',
    sync: (q) => [
      { name: 'Modules', items: MODULES.filter((m) => m.id && match(q, t(m.id), m.id)).map((m) => ({ label: t(m.id), icon: m.icon, hint: m.plan ? m.plan.toUpperCase() : '', run: () => bus.emit('open', { id: m.id }) })) },
      { name: 'Actions', items: actions.filter((a) => match(q, a.label)) },
      { name: 'Favorite prompts', items: store.get('memory.prompts').filter((p) => match(q, p.title, p.text)).map((p) => ({ label: p.title, icon: 'star', run: () => bus.emit('open', { id: 'assistant', params: { prefill: p.text + ' ' } }) })) },
      { name: 'Frequent commands', items: q ? [] : Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => ({ label: k, icon: 'bolt', hint: `${n}×`, run: () => bus.emit('open', { id: 'home' }) })) },
    ],
  });
}

/* ------------------------------------------------------------- smart search */
export function openSearch(initial = '') {
  overlayList({
    placeholder: 'Search notes, tasks, files, the web, Wikipedia… or type 12*7, 10 km to mi',
    initial,
    sync: (q) => {
      if (!q) return [{ name: 'Try', items: [
        { label: 'sqrt(144) + 2^5', icon: 'calc', keepOpen: true, run: () => {} },
        { label: '100 usd to eur', icon: 'dollar', keepOpen: true, run: () => {} },
        { label: 'define serendipity', icon: 'book', keepOpen: true, run: () => {} },
      ].map((x) => ({ ...x, run: () => { const i = document.querySelector('.palette input'); i.value = x.label; i.dispatchEvent(new Event('input')); } })) }];
      const s = store.state;
      const calc = tryCalc(q); const conv = tryConvert(q);
      const instant = [];
      if (calc) instant.push({ html: `<b>${esc(calc.expr)} = ${calc.value}</b>`, icon: 'calc', hint: 'Copy', run: () => copyText(String(calc.value)) });
      if (conv) instant.push({ html: `<b>${esc(conv.from)} = ${conv.value} ${esc(conv.unit)}</b>${conv.note ? `<div class="xs muted">${esc(FX_NOTE)}</div>` : ''}`, icon: conv.kind === 'currency' ? 'dollar' : 'refresh', hint: 'Copy', run: () => copyText(`${conv.value} ${conv.unit}`) });
      const web = encodeURIComponent(q);
      return [
        { name: 'Instant answer', items: instant },
        { name: 'Notes', items: s.notes.filter((n) => match(q, n.title, n.body)).slice(0, 5).map((n) => ({ label: n.title, icon: 'note', hint: fmt.rel(n.updated), run: () => bus.emit('open', { id: 'productivity', params: { tab: 'notes', id: n.id } }) })) },
        { name: 'Tasks', items: s.tasks.filter((x) => match(q, x.title)).slice(0, 5).map((x) => ({ label: x.title, icon: x.done ? 'check' : 'tasks', hint: x.due || '', run: () => bus.emit('open', { id: 'productivity', params: { tab: 'tasks' } }) })) },
        { name: 'Calendar', items: s.events.filter((x) => match(q, x.title)).slice(0, 4).map((x) => ({ label: x.title, icon: 'calendar', hint: `${x.date} ${x.time}`, run: () => bus.emit('open', { id: 'productivity', params: { tab: 'calendar', date: x.date } }) })) },
        { name: 'Memory', items: s.memory.facts.filter((x) => match(q, x.text)).slice(0, 4).map((x) => ({ label: x.text, icon: 'brain', run: () => bus.emit('open', { id: 'memory' }) })) },
        { name: 'Conversations', items: s.chat.conversations.filter((c) => match(q, c.title)).slice(0, 3).map((c) => ({ label: c.title, icon: 'chat', run: () => { store.set('chat.activeId', c.id); bus.emit('open', { id: 'assistant' }); } })) },
        { name: 'Web', items: [
          { label: `Search the web for "${q}"`, icon: 'globe', hint: 'DuckDuckGo', run: ext(`https://duckduckgo.com/?q=${web}`) },
          { label: `Images of "${q}"`, icon: 'image', run: ext(`https://duckduckgo.com/?q=${web}&iax=images&ia=images`) },
          { label: `Videos: "${q}"`, icon: 'video', hint: 'YouTube', run: ext(`https://www.youtube.com/results?search_query=${web}`) },
          { label: `Map: "${q}"`, icon: 'map', hint: 'OpenStreetMap', run: ext(`https://www.openstreetmap.org/search?query=${web}`) },
          { label: `Wikipedia: "${q}"`, icon: 'book', run: ext(`https://en.wikipedia.org/wiki/Special:Search?search=${web}`) },
          { label: `Dictionary: "${q.replace(/^define\s+/i, '')}"`, icon: 'translate', run: ext(`https://www.merriam-webster.com/dictionary/${encodeURIComponent(q.replace(/^define\s+/i, ''))}`) },
        ] },
        { name: 'Ask', items: [{ label: `Ask JARVIS-X: "${q}"`, icon: 'sparkles', run: () => bus.emit('assistant:ask', { text: q }) }] },
      ];
    },
    async: (q) => [
      // Local files (indexed by the File Manager)
      import('../modules/files.js').then(async ({ fileIndex }) => {
        const files = (await fileIndex()).filter((f) => match(q, f.name)).slice(0, 5);
        return files.length ? { name: 'Files', items: files.map((f) => ({ label: f.name, icon: 'file', hint: fmt.bytes(f.size), run: () => bus.emit('open', { id: 'files', params: { select: f.id } }) })) } : null;
      }),
      // Wikipedia summary (may be blocked by CSP in sandboxed hosts)
      !platform.directNetwork ? Promise.resolve(null) : fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/^(define|what is|who is)\s+/i, ''))}`).then((r) => (r.ok ? r.json() : null)).then((j) => (j?.extract ? { name: 'Wikipedia', items: [{ html: `<b>${esc(j.title)}</b> — <span class="dim">${esc(j.extract.slice(0, 220))}…</span>`, icon: 'book', run: ext(j.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(j.title)}`) }] } : null)),
      // Dictionary
      platform.directNetwork && /^(define\s+)?[a-z-]+$/i.test(q) ? fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(q.replace(/^define\s+/i, ''))}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
        const m = j?.[0]?.meanings?.[0]; if (!m) return null;
        return { name: 'Dictionary', items: [{ html: `<b>${esc(j[0].word)}</b> <i class="muted">${esc(m.partOfSpeech)}</i> — ${esc(m.definitions[0].definition)}`, icon: 'translate', run: () => copyText(m.definitions[0].definition) }] };
      }) : Promise.resolve(null),
    ],
  });
}

bus.on('search:open', ({ q }) => openSearch(q));
