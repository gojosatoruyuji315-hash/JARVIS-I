/**
 * Productivity suite: tasks, notes (Markdown + rich text), calendar, reminders,
 * Pomodoro, goals, habits, sticky notes, clipboard manager and daily planner.
 * @module modules/productivity
 */
import { h, clear, fmt, uid, todayKey, toast, tabs, confirmDialog, promptDialog, copyText, debounce, modal } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { renderMarkdown } from '../core/markdown.js';
import { addReminder, notify, chime } from '../core/scheduler.js';
import { withinLimit, featureBadge } from '../core/gate.js';
import { exportMarkdown, exportPDF, exportWord } from '../core/exporters.js';

let pomo = { running: false, end: 0, remaining: 25 * 60e3, total: 25 * 60e3, mode: 'focus', cycles: 0, draw: null, set: null };
const POMO_LENS = { focus: 25, short: 5, long: 15 };
/* Runs even when the window is closed so sessions complete in the background. */
bus.on('tick', () => {
  if (!pomo.running) return;
  if (pomo.end - Date.now() <= 0) {
    pomo.running = false;
    const next = (m) => { pomo.mode = m; pomo.total = pomo.remaining = POMO_LENS[m] * 60e3; };
    if (pomo.mode === 'focus') {
      pomo.cycles++; const mins = Math.round(pomo.total / 6e4);
      store.set(['study', 'minutesByDay', todayKey()], (store.get(['study', 'minutesByDay', todayKey()]) || 0) + mins);
      store.set('usage.totals.focusMin', store.get('usage.totals.focusMin') + mins);
      notify('Focus session complete', 'Time for a break.', { type: 'ok' }); bus.emit('voice:say', { text: 'Focus session complete. Take a break.' });
      next(pomo.cycles % 4 === 0 ? 'long' : 'short');
    } else { notify('Break over', 'Ready for the next focus block?'); next('focus'); }
    chime(660);
  }
  pomo.draw?.();
});

/* =================================================================== TASKS */
function Tasks(el, params) {
  let filter = 'open'; let list = 'All';
  const input = h('input.input.grow', { placeholder: 'New task… (Enter to add)', 'aria-label': 'New task' });
  const prio = h('select.select', { style: 'width:auto', 'aria-label': 'Priority' }, h('option', { value: 'low' }, 'Low'), h('option', { value: 'med', selected: true }, 'Medium'), h('option', { value: 'hi' }, 'High'));
  const due = h('input.input', { type: 'date', style: 'width:auto', 'aria-label': 'Due date' });
  const listSel = h('select.select', { style: 'width:auto', 'aria-label': 'List' });
  const body = h('div.list');
  const lists = h('div.row');
  const add = () => {
    if (!input.value.trim()) return;
    store.unshift('tasks', { id: uid('t'), title: input.value.trim(), done: false, priority: prio.value, due: due.value || null, list: listSel.value, created: Date.now() });
    input.value = ''; input.focus();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  const render = () => {
    const allLists = store.get('taskLists');
    clear(listSel).append(allLists.map((l) => h('option', { value: l }, l)));
    clear(lists).append(['All', ...allLists].map((l) => h('button.btn.sm', { class: l === list ? 'primary' : '', onclick: () => { list = l; render(); } }, l)),
      h('button.btn.ghost.sm', { onclick: async () => {
        if (!withinLimit('taskLists', allLists.length, 'task list')) return;
        const n = await promptDialog('New list name'); if (n) store.set('taskLists', [...allLists, n]);
      } }, icon('plus'), 'List'),
      h('span.grow'), ...['open', 'today', 'done', 'all'].map((f) => h('button.btn.ghost.sm', { style: f === filter ? 'color:var(--accent)' : '', onclick: () => { filter = f; render(); } }, f[0].toUpperCase() + f.slice(1))));
    const tk = todayKey();
    let items = store.get('tasks').filter((x) => list === 'All' || x.list === list);
    items = items.filter((x) => filter === 'all' || (filter === 'open' && !x.done) || (filter === 'done' && x.done) || (filter === 'today' && !x.done && x.due && x.due <= tk));
    items.sort((a, b) => a.done - b.done || { hi: 0, med: 1, low: 2 }[a.priority] - { hi: 0, med: 1, low: 2 }[b.priority] || (a.due || '9').localeCompare(b.due || '9'));
    clear(body).append(items.length ? items.map((x) => h('div.item', { class: x.done ? 'done' : '' },
      h('input', { type: 'checkbox', checked: x.done, 'aria-label': 'Complete', onchange: (e) => store.patchById('tasks', x.id, { done: e.target.checked, doneAt: Date.now() }) }),
      h('span.grow', { contenteditable: 'true', spellcheck: false, onblur: (e) => { const v = e.target.textContent.trim(); if (v && v !== x.title) store.patchById('tasks', x.id, { title: v }); } }, x.title),
      h('span.pill', x.list),
      x.due ? h('span.pill', { class: !x.done && x.due < tk ? 'hi' : x.due === tk ? 'med' : '' }, x.due === tk ? 'Today' : x.due) : null,
      h('span.pill', { class: x.priority }, { hi: 'High', med: 'Med', low: 'Low' }[x.priority]),
      h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete task', onclick: () => store.removeById('tasks', x.id) }, icon('trash')))) : h('div.empty', filter === 'done' ? 'Nothing completed yet.' : 'No tasks here. Add one above, or say "add task …".'));
  };
  render();
  el.append(h('div.stack', h('div.row', input, prio, due, listSel, h('button.btn.primary', { onclick: add }, icon('plus'), 'Add')), lists, body));
  if (params.new) setTimeout(() => input.focus(), 50);
  return store.on('task', render);
}

/* =================================================================== NOTES */
function Notes(el, params) {
  let currentId = params.id || store.get('notes')[0]?.id; let mode = 'split'; let q = '';
  const side = h('div.list'); const editor = h('div.stack', { style: 'flex:1;align-content:start;min-width:0' });
  const renderSide = () => {
    const notes = store.get('notes').filter((n) => !q || (n.title + n.body).toLowerCase().includes(q)).sort((a, b) => b.pinned - a.pinned || b.updated - a.updated);
    clear(side).append(notes.map((n) => h('div.item', { class: n.id === currentId ? 'active' : '', style: 'cursor:pointer', onclick: () => { currentId = n.id; renderSide(); renderEditor(); } },
      n.pinned ? icon('star', { size: 13 }) : icon('note', { size: 13 }), h('span.grow.small', n.title || 'Untitled'), h('span.xs.muted', fmt.rel(n.updated)))));
  };
  const newNote = (format = 'md') => {
    if (!withinLimit('notes', store.get('notes').length, 'notes')) return;
    const n = { id: uid('n'), title: 'Untitled note', body: '', format, pinned: false, updated: Date.now() };
    store.unshift('notes', n); currentId = n.id; renderSide(); renderEditor();
    setTimeout(() => editor.querySelector('input')?.select(), 30);
  };
  const renderEditor = () => {
    const n = store.findById('notes', currentId);
    clear(editor);
    if (!n) { editor.append(h('div.empty', 'Select or create a note.')); return; }
    const save = debounce((patch) => { store.patchById('notes', n.id, { ...patch, updated: Date.now() }); renderSide(); }, 300);
    const title = h('input.input', { value: n.title, 'aria-label': 'Note title', style: 'font-size:18px;font-family:var(--font-display)', oninput: (e) => save({ title: e.target.value }) });
    const toolbar = h('div.row',
      h('select.select', { style: 'width:auto', 'aria-label': 'Format', onchange: (e) => { store.patchById('notes', n.id, { format: e.target.value }); renderEditor(); } },
        h('option', { value: 'md', selected: n.format === 'md' }, 'Markdown'), h('option', { value: 'rich', selected: n.format === 'rich' }, 'Rich text')),
      n.format === 'md' ? ['edit', 'split', 'preview'].map((m) => h('button.btn.ghost.sm', { style: m === mode ? 'color:var(--accent)' : '', onclick: () => { mode = m; renderEditor(); } }, m[0].toUpperCase() + m.slice(1))) : null,
      h('span.grow'),
      h('button.btn.ghost.sm', { onclick: () => { store.patchById('notes', n.id, { pinned: !n.pinned }); renderSide(); renderEditor(); } }, icon('star'), n.pinned ? 'Unpin' : 'Pin'),
      h('button.btn.ghost.sm', { onclick: () => exportMarkdown(n.title, n.format === 'rich' ? htmlToText(n.body) : n.body) }, icon('download'), 'MD'),
      h('button.btn.ghost.sm', { onclick: () => exportPDF(n.title, n.format === 'rich' ? htmlToText(n.body) : n.body) }, 'PDF', featureBadge('export.docs')),
      h('button.btn.ghost.sm', { onclick: () => exportWord(n.title, n.format === 'rich' ? htmlToText(n.body) : n.body) }, 'Word', featureBadge('export.docs')),
      h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete note', onclick: async () => { if (await confirmDialog(`Delete "${n.title}"?`, { okLabel: 'Delete', danger: true })) { store.removeById('notes', n.id); currentId = store.get('notes')[0]?.id; renderSide(); renderEditor(); } } }, icon('trash')));
    let area;
    if (n.format === 'rich') {
      const rte = h('div.rte', { contenteditable: 'true', 'aria-label': 'Rich text editor', html: sanitize(n.body.includes('<') ? n.body : renderMarkdown(n.body)) });
      rte.addEventListener('input', () => save({ body: sanitize(rte.innerHTML) }));
      const cmd = (c, v) => () => { document.execCommand(c, false, v); rte.focus(); save({ body: sanitize(rte.innerHTML) }); };
      area = h('div.stack', h('div.row', [['B', 'bold'], ['I', 'italic'], ['U', 'underline'], ['H1', 'formatBlock', 'H2'], ['H2', 'formatBlock', 'H3'], ['• List', 'insertUnorderedList'], ['1. List', 'insertOrderedList'], ['Quote', 'formatBlock', 'BLOCKQUOTE'], ['Clear', 'removeFormat']].map(([l, c, v]) => h('button.btn.sm', { onmousedown: (e) => e.preventDefault(), onclick: cmd(c, v) }, l))), rte);
    } else {
      const ta = h('textarea.textarea.mono', { value: n.body, 'aria-label': 'Markdown editor', spellcheck: true });
      const prev = h('div.preview.md', { html: renderMarkdown(n.body) });
      ta.addEventListener('input', () => { prev.innerHTML = renderMarkdown(ta.value); save({ body: ta.value }); });
      area = h('div.editor-wrap', { style: mode !== 'split' ? 'grid-template-columns:minmax(0,1fr)' : '' }, mode !== 'preview' ? ta : null, mode !== 'edit' ? prev : null);
    }
    editor.append(title, toolbar, area, h('div.xs.muted', `${(n.body.match(/\S+/g) || []).length} words · edited ${fmt.rel(n.updated)}`));
  };
  const search = h('input.input', { placeholder: 'Search notes', 'aria-label': 'Search notes', oninput: (e) => { q = e.target.value.toLowerCase(); renderSide(); } });
  el.append(h('div', { style: 'display:grid;grid-template-columns:minmax(180px,240px) minmax(0,1fr);gap:14px;min-height:100%', class: 'notes-grid' },
    h('div.stack', { style: 'align-content:start' }, h('div.row', h('button.btn.primary.sm.grow', { onclick: () => newNote('md') }, icon('plus'), 'Markdown'), h('button.btn.sm.grow', { onclick: () => newNote('rich') }, icon('plus'), 'Rich text')), search, side),
    editor));
  if (matchMedia('(max-width: 760px)').matches) el.firstChild.style.gridTemplateColumns = 'minmax(0,1fr)';
  renderSide(); renderEditor();
  if (params.new) newNote();
}
/** Allow-list sanitizer for rich text. */
function sanitize(html) {
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  const ok = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'P', 'BR', 'DIV', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'CODE', 'PRE', 'A', 'SPAN', 'DEL']);
  const walk = (node) => { for (const c of [...node.childNodes]) { if (c.nodeType === 1) { if (!ok.has(c.tagName)) { c.replaceWith(...c.childNodes); walk(node); return; } for (const a of [...c.attributes]) if (!(c.tagName === 'A' && a.name === 'href' && /^https?:/.test(a.value))) c.removeAttribute(a.name); walk(c); } else if (c.nodeType !== 3) c.remove(); } };
  walk(tpl.content); return tpl.innerHTML;
}
const htmlToText = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.innerText; };

/* ================================================================ CALENDAR */
function Calendar(el, params) {
  let cursor = params.date ? new Date(params.date + 'T12:00') : new Date(); let selected = params.date || todayKey();
  const head = h('div.row'); const grid = h('div.cal-grid'); const dayPanel = h('div.stack');
  const render = () => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    clear(head).append(h('button.btn.icon.sm', { 'aria-label': 'Previous month', onclick: () => { cursor = new Date(y, m - 1, 1); render(); } }, icon('prev')),
      h('h3', { style: 'min-width:170px;text-align:center' }, cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })),
      h('button.btn.icon.sm', { 'aria-label': 'Next month', onclick: () => { cursor = new Date(y, m + 1, 1); render(); } }, icon('next')),
      h('button.btn.ghost.sm', { onclick: () => { cursor = new Date(); selected = todayKey(); render(); } }, 'Today'));
    clear(grid).append(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => h('div.dow', d)));
    const start = new Date(y, m, 1 - new Date(y, m, 1).getDay());
    const events = store.get('events');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i); const key = todayKey(d);
      const evs = events.filter((e) => e.date === key);
      grid.append(h('button.cal-day', { class: `${d.getMonth() !== m ? 'other' : ''} ${key === todayKey() ? 'today' : ''} ${key === selected ? 'sel' : ''}`, 'aria-label': `${key}, ${evs.length} events`, onclick: () => { selected = key; render(); } },
        h('b', String(d.getDate())), evs.slice(0, 2).map((e) => h('span.ev', `${e.time} ${e.title}`)), evs.length > 2 ? h('span.xs.muted', `+${evs.length - 2}`) : null));
    }
    const evs = events.filter((e) => e.date === selected).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const title = h('input.input.grow', { placeholder: 'Event title' }); const time = h('input.input', { type: 'time', style: 'width:auto' });
    const addEv = () => { if (!title.value.trim()) return; store.push('events', { id: uid('e'), title: title.value.trim(), date: selected, time: time.value, notes: '' }); };
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') addEv(); });
    clear(dayPanel).append(h('h3', fmt.date(selected + 'T12:00', { weekday: 'long', month: 'long', day: 'numeric' })),
      h('div.row', title, time, h('button.btn.primary', { onclick: addEv }, icon('plus'), 'Add')),
      h('div.list', evs.length ? evs.map((e) => h('div.item', h('span.mono.small', e.time || 'All day'), h('span.grow', e.title),
        h('button.btn.ghost.sm', { title: 'Remind me 10 minutes before', onclick: () => { const at = new Date(`${e.date}T${e.time || '09:00'}`).getTime() - 6e5; addReminder(e.title, at); toast(`Reminder set for ${fmt.dt(at)}`, { type: 'ok' }); } }, icon('bell')),
        h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete event', onclick: () => store.removeById('events', e.id) }, icon('trash')))) : h('div.empty', 'No events on this day.')));
  };
  render();
  el.append(h('div.stack', head, h('div.grid2', { style: 'grid-template-columns:minmax(0,2fr) minmax(240px,1fr);align-items:start' }, grid, dayPanel)));
  return store.on('events', render);
}

/* =============================================================== REMINDERS */
function Reminders(el) {
  const text = h('input.input.grow', { placeholder: 'Remind me to…' });
  const when = h('input.input', { type: 'datetime-local', style: 'width:auto', value: new Date(Date.now() + 36e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) });
  const rep = h('select.select', { style: 'width:auto' }, h('option', { value: '' }, 'Once'), h('option', { value: 'daily' }, 'Daily'), h('option', { value: 'weekly' }, 'Weekly'));
  const list = h('div.list');
  const add = () => {
    if (!text.value.trim()) return;
    if (!withinLimit('reminders', store.get('reminders').filter((r) => !r.done).length, 'reminders')) return;
    addReminder(text.value.trim(), new Date(when.value).getTime(), rep.value || null); text.value = '';
  };
  const render = () => {
    const rs = store.get('reminders').slice().sort((a, b) => a.done - b.done || a.at - b.at);
    clear(list).append(rs.length ? rs.map((r) => h('div.item', { class: r.done ? 'done' : '' }, icon('bell', { size: 15 }), h('span.grow', r.text), r.repeat ? h('span.pill', r.repeat) : null,
      h('span.small.mono.dim', `${fmt.dt(r.at)}`), h('span.xs.muted', r.done ? 'done' : fmt.rel(r.at)),
      !r.done ? h('button.btn.ghost.sm', { onclick: () => store.patchById('reminders', r.id, { at: Date.now() + 6e5 }) }, 'Snooze 10m') : null,
      h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete', onclick: () => store.removeById('reminders', r.id) }, icon('trash')))) : h('div.empty', 'No reminders. Try "remind me in 20 minutes to drink water" in the command bar.'));
  };
  render();
  el.append(h('div.stack', h('div.row', text, when, rep, h('button.btn.primary', { onclick: add }, icon('plus'), 'Add')),
    h('div.row', h('button.btn.ghost.sm', { onclick: async () => { const { requestNotificationPermission } = await import('../core/scheduler.js'); const p = await requestNotificationPermission(); toast(`Notifications: ${p}`); } }, icon('bell'), 'Enable desktop notifications')), list));
  const offs = [store.on('reminders', render), bus.on('tick', () => { if (new Date().getSeconds() % 30 === 0) render(); })];
  return () => offs.forEach((o) => o());
}

/* ================================================================ POMODORO */
function Pomodoro(el, params) {
  const C = 2 * Math.PI * 100;
  const ring = h('div', { html: `<svg class="pomo-ring" viewBox="0 0 240 240"><circle class="bg" cx="120" cy="120" r="100"/><circle class="fg" cx="120" cy="120" r="100" stroke-dasharray="${C}" stroke-dashoffset="0"/><text x="120" y="112">25:00</text><text x="120" y="152" style="font-size:12px;letter-spacing:.3em;fill:var(--accent)">FOCUS</text></svg>` });
  const [txt, mode] = ring.querySelectorAll('text'); const fg = ring.querySelector('.fg');
  const startBtn = h('button.btn.primary', { onclick: () => (pomo.running ? pause() : start()) });
  const set = (m, min) => { pause(); pomo.mode = m; pomo.total = pomo.remaining = (min ?? POMO_LENS[m]) * 60e3; draw(); };
  const remaining = () => (pomo.running ? Math.max(0, pomo.end - Date.now()) : pomo.remaining);
  const draw = () => {
    const r = remaining(); txt.textContent = fmt.dur(r); mode.textContent = pomo.mode === 'focus' ? 'FOCUS' : 'BREAK';
    fg.setAttribute('stroke-dashoffset', String(C * (1 - r / pomo.total)));
    startBtn.replaceChildren(icon(pomo.running ? 'pause' : 'play'), pomo.running ? 'Pause' : 'Start');
    stats.textContent = `${pomo.cycles} focus session${pomo.cycles === 1 ? '' : 's'} completed this sitting · ${store.get(['study', 'minutesByDay', todayKey()]) || 0} focus minutes today`;
  };
  function start() { pomo.running = true; pomo.end = Date.now() + pomo.remaining; draw(); }
  function pause() { if (pomo.running) { pomo.remaining = remaining(); pomo.running = false; } draw(); }
  const stats = h('div.small.dim');
  pomo.draw = draw; pomo.set = set;
  const off = () => { pomo.draw = null; };
  if (params.autostart) { set('focus', params.autostart); start(); }
  el.append(h('div.pomo', ring, h('div.row', startBtn, h('button.btn', { onclick: () => set(pomo.mode) }, icon('refresh'), 'Reset')),
    h('div.row', h('button.btn.sm', { onclick: () => set('focus') }, 'Focus 25'), h('button.btn.sm', { onclick: () => set('short') }, 'Short break 5'), h('button.btn.sm', { onclick: () => set('long') }, 'Long break 15'),
      h('input.input', { type: 'number', min: 1, max: 180, placeholder: 'Custom min', style: 'width:110px', 'aria-label': 'Custom minutes', onchange: (e) => { if (+e.target.value > 0) set('focus', +e.target.value); } })),
    stats));
  draw();
  return off;
}

/* =================================================================== GOALS */
function Goals(el) {
  const list = h('div.grid2');
  const render = () => clear(list).append(store.get('goals').map((g) => {
    const pct = Math.min(100, (g.progress / g.target) * 100);
    return h('div.glass.widget', h('div.w-head', icon('flag'), h('h3.w-title', g.title), h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete goal', onclick: () => store.removeById('goals', g.id) }, icon('trash'))),
      h('div.w-big', `${g.progress}`, h('span.small.dim', ` / ${g.target} ${g.unit}`)), h('div.meter', { style: 'margin:8px 0' }, h('i', { style: `width:${pct}%` })),
      h('div.row', h('button.btn.sm', { onclick: () => store.patchById('goals', g.id, { progress: Math.max(0, g.progress - 1) }) }, icon('minus')), h('button.btn.sm.primary', { onclick: () => { store.patchById('goals', g.id, { progress: g.progress + 1 }); if (g.progress + 1 === g.target) notify('Goal reached!', g.title, { type: 'ok' }); } }, icon('plus')),
        h('span.grow'), g.deadline ? h('span.xs.muted', `by ${g.deadline}`) : null));
  }), h('button.glass.widget', { style: 'display:grid;place-items:center;min-height:150px;cursor:pointer;color:var(--fg-dim)', onclick: async () => {
    const title = await promptDialog('Goal', { placeholder: 'e.g. Run 100 km' }); if (!title) return;
    const target = +(await promptDialog('Target number', { value: '10' })) || 10;
    const unit = (await promptDialog('Unit', { value: 'times' })) || '';
    store.push('goals', { id: uid('g'), title, target, progress: 0, unit, deadline: null });
  } }, h('div', icon('plus', { size: 26 }), h('div', 'New goal'))));
  render(); el.append(list); return store.on('goals', render);
}

/* ================================================================== HABITS */
function Habits(el) {
  const grid = h('div.habit-grid');
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; });
  const streak = (log) => { let s = 0; const d = new Date(); while (log[todayKey(d)]) { s++; d.setDate(d.getDate() - 1); } return s; };
  const render = () => {
    clear(grid).append(h('div'), days.map((d) => h('div.xs.muted', { style: 'text-align:center' }, d.toLocaleDateString([], { weekday: 'narrow' }), h('br'), d.getDate())), h('div.xs.muted', 'Streak'));
    for (const hb of store.get('habits')) {
      grid.append(h('div.row', { style: 'gap:4px;flex-wrap:nowrap;min-width:0' }, h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, hb.name), h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete habit', onclick: () => store.removeById('habits', hb.id) }, icon('x'))));
      for (const d of days) { const k = todayKey(d); grid.append(h('button.habit-cell', { class: hb.log[k] ? 'on' : '', 'aria-label': `${hb.name} ${k}`, 'aria-pressed': String(!!hb.log[k]), onclick: () => store.patchById('habits', hb.id, { log: { ...hb.log, [k]: !hb.log[k] } }) })); }
      grid.append(h('b.mono', `${streak(hb.log)}d`));
    }
  };
  const inp = h('input.input.grow', { placeholder: 'New habit, e.g. Drink 2L water' });
  const add = () => { if (inp.value.trim()) { store.push('habits', { id: uid('h'), name: inp.value.trim(), log: {} }); inp.value = ''; } };
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  render(); el.append(h('div.stack', h('div.row', inp, h('button.btn.primary', { onclick: add }, icon('plus'), 'Add habit')), h('div', { style: 'overflow-x:auto' }, grid)));
  return store.on('habits', render);
}

/* ================================================================== STICKY */
function Sticky(el) {
  const board = h('div.board');
  const colors = ['#9fe8ff', '#ffe08a', '#b6f5c9', '#ffc4d6', '#d6c8ff'];
  const render = () => {
    clear(board);
    for (const s of store.get('sticky')) {
      const ta = h('textarea', { value: s.text, 'aria-label': 'Sticky note', oninput: debounce((e) => store.patchById('sticky', s.id, { text: e.target.value }), 300) });
      const note = h('div.sticky', { style: `left:${s.x}px;top:${s.y}px;background:${s.color}` },
        h('div.grip', h('span', '⋮⋮ drag'), h('span', colors.map((c) => h('button', { 'aria-label': 'Color', style: `width:10px;height:10px;border-radius:50%;background:${c};border:1px solid #0003;margin-left:2px`, onclick: () => store.patchById('sticky', s.id, { color: c }) })), h('button', { 'aria-label': 'Delete sticky', onclick: () => store.removeById('sticky', s.id) }, '✕'))), ta);
      const grip = note.firstChild;
      grip.addEventListener('pointerdown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        grip.setPointerCapture(e.pointerId); const ox = e.clientX - s.x, oy = e.clientY - s.y;
        const move = (ev) => { note.style.left = Math.max(0, ev.clientX - ox) + 'px'; note.style.top = Math.max(0, ev.clientY - oy) + 'px'; };
        const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); store.patchById('sticky', s.id, { x: parseInt(note.style.left), y: parseInt(note.style.top) }); };
        grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
      });
      board.append(note);
    }
  };
  render();
  el.append(h('div.stack', h('div.row', h('button.btn.primary', { onclick: () => store.push('sticky', { id: uid('s'), text: '', color: colors[Math.floor(Math.random() * colors.length)], x: 20 + Math.random() * 200, y: 20 + Math.random() * 120 }) }, icon('plus'), 'New sticky'), h('span.small.muted', 'Drag notes by their top bar.')), board));
  return store.on('sticky', () => { if (!board.contains(document.activeElement)) render(); });
}

/* =============================================================== CLIPBOARD */
function Clipboard(el) {
  const list = h('div.list');
  const inp = h('textarea.textarea', { placeholder: 'Paste here (Ctrl+V) to save a clip, or type and press Save', style: 'min-height:70px' });
  const save = (text) => { text = text.trim(); if (!text) return; store.unshift('clipboard', { id: uid('cb'), text, ts: Date.now(), pinned: false }); store.set('clipboard', store.get('clipboard').slice(0, 100)); };
  inp.addEventListener('paste', (e) => { const t = e.clipboardData?.getData('text'); if (t) { e.preventDefault(); save(t); toast('Clip saved', { type: 'ok', timeout: 1200 }); } });
  const render = () => clear(list).append(store.get('clipboard').length ? store.get('clipboard').slice().sort((a, b) => b.pinned - a.pinned).map((c) => h('div.item',
    h('pre.grow.small', { style: 'margin:0;white-space:pre-wrap;max-height:90px;overflow:auto;font-family:var(--font-mono)' }, c.text),
    h('span.xs.muted', fmt.rel(c.ts)),
    h('button.btn.ghost.icon.sm', { 'aria-label': 'Pin', onclick: () => store.patchById('clipboard', c.id, { pinned: !c.pinned }), style: c.pinned ? 'color:var(--gold)' : '' }, icon('star')),
    h('button.btn.ghost.icon.sm', { 'aria-label': 'Copy', onclick: () => copyText(c.text) }, icon('copy')),
    h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete', onclick: () => store.removeById('clipboard', c.id) }, icon('trash')))) : h('div.empty', 'Clipboard history is empty.'));
  render();
  el.append(h('div.stack', inp, h('div.row', h('button.btn.primary', { onclick: () => { save(inp.value); inp.value = ''; } }, icon('clipboard'), 'Save clip'), h('button.btn.ghost', { onclick: async () => { if (await confirmDialog('Clear unpinned clips?')) store.set('clipboard', store.get('clipboard').filter((c) => c.pinned)); } }, 'Clear unpinned'), h('span.xs.muted', 'Browsers don\'t allow reading the clipboard automatically — paste into the box to capture.')), list));
  return store.on('clipboard', render);
}

/* ================================================================= PLANNER */
function Planner(el) {
  let date = todayKey();
  const body = h('div.stack');
  const render = () => {
    const day = store.get(['planner', date]) || { focus: '', blocks: {}, notes: '', gratitude: '' };
    const save = (patch) => store.set(['planner', date], { ...day, ...patch });
    const hours = Array.from({ length: 16 }, (_, i) => i + 6);
    clear(body).append(
      h('div.row', h('button.btn.icon.sm', { 'aria-label': 'Previous day', onclick: () => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() - 1); date = todayKey(d); render(); } }, icon('prev')),
        h('h3', fmt.date(date + 'T12:00', { weekday: 'long', month: 'long', day: 'numeric' })),
        h('button.btn.icon.sm', { 'aria-label': 'Next day', onclick: () => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + 1); date = todayKey(d); render(); } }, icon('next')),
        h('span.grow'), h('button.btn.sm', { onclick: () => bus.emit('assistant:ask', { text: 'plan my day' }) }, icon('sparkles'), 'AI: plan my day')),
      h('div.grid2', { style: 'align-items:start' },
        h('div.stack', h('div.section-title', 'Time blocks'), hours.map((hr) => h('div.planner-row', h('span.mono.small.dim', `${String(hr).padStart(2, '0')}:00`),
          h('input.input', { value: day.blocks?.[hr] || '', 'aria-label': `${hr}:00`, onchange: (e) => { day.blocks = { ...day.blocks, [hr]: e.target.value }; save({ blocks: day.blocks }); } })))),
        h('div.stack',
          h('label.field', 'Top priority for the day', h('input.input', { value: day.focus, onchange: (e) => save({ focus: e.target.value }) })),
          h('div.section-title', 'Due today'),
          h('div.list', store.get('tasks').filter((x) => !x.done && x.due === date).map((x) => h('div.item', icon('tasks', { size: 14 }), h('span.grow.small', x.title)))),
          h('div.section-title', 'Events'),
          h('div.list', store.get('events').filter((e) => e.date === date).map((e) => h('div.item', h('span.mono.small', e.time), h('span.grow.small', e.title)))),
          h('label.field', 'Notes', h('textarea.textarea', { value: day.notes, onchange: (e) => save({ notes: e.target.value }) })),
          h('label.field', 'Gratitude / wins', h('textarea.textarea', { value: day.gratitude, style: 'min-height:60px', onchange: (e) => save({ gratitude: e.target.value }) })))));
  };
  render(); el.append(body);
}

/* ================================================================== MODULE */
export default {
  flush: true,
  mount(el, ctx) {
    let cleanup = null;
    const wrap = (fn) => (body) => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } cleanup = fn(body, ctx.params || {}); ctx.params = {}; };
    const t = tabs([
      { id: 'tasks', label: 'Tasks', icon: 'tasks', render: wrap(Tasks) },
      { id: 'notes', label: 'Notes', icon: 'note', render: wrap(Notes) },
      { id: 'calendar', label: 'Calendar', icon: 'calendar', render: wrap(Calendar) },
      { id: 'reminders', label: 'Reminders', icon: 'bell', render: wrap(Reminders) },
      { id: 'pomodoro', label: 'Pomodoro', icon: 'timer', render: wrap(Pomodoro) },
      { id: 'planner', label: 'Daily planner', icon: 'sun', render: wrap(Planner) },
      { id: 'goals', label: 'Goals', icon: 'flag', render: wrap(Goals) },
      { id: 'habits', label: 'Habits', icon: 'repeat', render: wrap(Habits) },
      { id: 'sticky', label: 'Sticky notes', icon: 'sticky', render: wrap(Sticky) },
      { id: 'clipboard', label: 'Clipboard', icon: 'clipboard', render: wrap(Clipboard) },
    ], { initial: ctx.params?.tab });
    el.append(t.el);
    this.update = (p) => { ctx.params = p; t.select(p.tab || t.current); };
    return () => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } };
  },
};
