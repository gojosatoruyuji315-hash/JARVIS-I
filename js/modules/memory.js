/**
 * Personal Memory: long-term facts, preferences, favorite prompts, recent
 * conversations, goals & projects, frequently used commands, backup/restore.
 * Facts are injected into the AI system prompt (core/ai.js → buildSystemPrompt).
 * @module modules/memory
 */
import { h, clear, fmt, uid, toast, tabs, confirmDialog, promptDialog, download, pickFiles } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { license } from '../core/license.js';
import { limit } from '../core/plans.js';
import { withinLimit } from '../core/gate.js';

function Facts(el) {
  const inp = h('input.input.grow', { placeholder: 'Teach me something about you, e.g. "I prefer metric units"' });
  const tag = h('select.select', { style: 'width:auto' }, ['general', 'preference', 'personal', 'work', 'study', 'health'].map((t) => h('option', t)));
  const list = h('div.list'); const cap = h('div');
  const add = () => { if (!inp.value.trim()) return; if (!withinLimit('memoryFacts', store.get('memory.facts').length, 'memory')) return; store.push('memory.facts', { id: uid('m'), text: inp.value.trim(), tags: [tag.value], ts: Date.now() }); inp.value = ''; };
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  const render = () => {
    const facts = store.get('memory.facts'); const max = limit('memoryFacts', license.plan());
    clear(cap).append(h('div.stat-row', h('span.dim', 'Memory capacity'), h('b', max === Infinity ? `${facts.length} · unlimited` : `${facts.length} / ${max}`)), h('div.meter', h('i', { style: `width:${max === Infinity ? 5 : (facts.length / max) * 100}%` })));
    clear(list).append(facts.length ? facts.slice().reverse().map((f) => h('div.item', icon('brain', { size: 14 }),
      h('span.grow.small', { contenteditable: 'true', onblur: (e) => { const v = e.target.textContent.trim(); if (v && v !== f.text) store.patchById('memory.facts', f.id, { text: v }); } }, f.text),
      (f.tags || []).map((t) => h('span.pill', t)), f.example ? h('span.pill', 'example') : null, h('span.xs.muted', fmt.rel(f.ts)),
      h('button.btn.ghost.icon.sm', { 'aria-label': 'Forget', onclick: () => store.removeById('memory.facts', f.id) }, icon('trash')))) : h('div.empty', 'Nothing remembered yet.'));
  };
  render();
  el.append(h('div.stack', h('div.small.dim', 'Facts are private, encrypted on this device and shared with the AI as context so answers fit you.'), cap, h('div.row', inp, tag, h('button.btn.primary', { onclick: add }, icon('plus'), 'Remember')), list));
  return store.on('memory.facts', render);
}

function Prefs(el) {
  const s = store.get('settings');
  const name = h('input.input', { value: store.get('profile.name'), onchange: (e) => store.set('profile.name', e.target.value || 'Operator') });
  el.append(h('div.stack', { style: 'max-width:560px' },
    h('label.field', 'What should I call you?', name),
    h('label.field', 'Units', h('select.select', { onchange: (e) => store.set('settings.units', e.target.value) }, h('option', { value: 'metric', selected: s.units === 'metric' }, 'Metric (°C, km)'), h('option', { value: 'imperial', selected: s.units === 'imperial' }, 'Imperial (°F, mi)'))),
    h('label.field', 'Reply length', h('select.select', { onchange: (e) => store.set('settings.ai.personality', e.target.value) }, h('option', { value: 'balanced', selected: s.ai.personality === 'balanced' }, 'Balanced'), h('option', { value: 'concise', selected: s.ai.personality === 'concise' }, 'Concise'))),
    h('div.small.dim', 'More options in ', h('button.btn.ghost.sm', { onclick: () => bus.emit('open', { id: 'settings' }) }, 'Settings'), '.')));
}

function Prompts(el) {
  const list = h('div.list');
  const render = () => clear(list).append(store.get('memory.prompts').map((p) => h('div.item', icon('star', { size: 14 }), h('div.grow', h('b.small', p.title), h('div.xs.dim', p.text)), h('span.xs.muted', `${p.uses || 0} uses`),
    h('button.btn.sm', { onclick: () => { store.patchById('memory.prompts', p.id, { uses: (p.uses || 0) + 1 }); bus.emit('open', { id: 'assistant', params: { prefill: p.text + ' ' } }); } }, 'Use'),
    h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete', onclick: () => store.removeById('memory.prompts', p.id) }, icon('trash')))));
  render();
  el.append(h('div.stack', h('button.btn.primary', { style: 'justify-self:start', onclick: async () => { const title = await promptDialog('Prompt name'); if (!title) return; const text = await promptDialog('Prompt text', { multiline: true }); if (text) store.push('memory.prompts', { id: uid('p'), title, text, uses: 0 }); } }, icon('plus'), 'New favorite prompt'), list));
  return store.on('memory.prompts', render);
}

function Recent(el) {
  const convs = store.get('chat.conversations');
  el.append(h('div.list', convs.length ? convs.map((c) => h('div.item', icon('chat', { size: 14 }), h('span.grow.small', c.title), h('span.xs.muted', `${c.messages.length} messages · ${fmt.rel(c.updated || c.created)}`),
    h('button.btn.sm', { onclick: () => { store.set('chat.activeId', c.id); bus.emit('open', { id: 'assistant' }); } }, 'Open'))) : h('div.empty', store.get('settings.privacy.privacyMode') ? 'Privacy mode is on — conversations are not kept.' : 'No conversations yet.')));
}

function Projects(el) {
  const list = h('div.grid2');
  const render = () => clear(list).append(store.get('memory.projects').map((p) => h('div.glass.widget',
    h('div.w-head', icon('layers'), h('h3.w-title', p.name), h('span.pill', { class: p.status === 'done' ? 'ok' : '' }, p.status), h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete project', onclick: () => store.removeById('memory.projects', p.id) }, icon('trash'))),
    h('div.stat-row', h('span.dim', 'Progress'), h('b', `${p.progress}%`)), h('input', { type: 'range', min: 0, max: 100, value: p.progress, 'aria-label': 'Progress', onchange: (e) => store.patchById('memory.projects', p.id, { progress: +e.target.value, status: +e.target.value >= 100 ? 'done' : 'active' }) }),
    h('textarea.textarea', { style: 'min-height:60px', value: p.notes || '', placeholder: 'Notes', onchange: (e) => store.patchById('memory.projects', p.id, { notes: e.target.value }) }),
    p.due ? h('div.xs.muted', `Due ${fmt.date(p.due)}`) : null)),
  h('button.glass.widget', { style: 'display:grid;place-items:center;min-height:150px;cursor:pointer;color:var(--fg-dim)', onclick: async () => { const name = await promptDialog('Project name'); if (name) store.push('memory.projects', { id: uid('pr'), name, progress: 0, status: 'active', notes: '', due: null }); } }, h('div', icon('plus', { size: 26 }), h('div', 'New project'))));
  render();
  el.append(h('div.stack', h('div.small.dim', 'Projects and goals I keep in mind when planning your day. Goals live in Productivity → Goals.'), list));
  return store.on('memory.projects', render);
}

function Commands(el) {
  const usage = Object.entries(store.get('memory.commandUsage')).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...usage.map((u) => u[1]));
  el.append(h('div.stack', usage.length ? usage.map(([k, n]) => h('div', h('div.stat-row', h('span', k), h('b', `${n}×`)), h('div.meter', h('i', { style: `width:${(n / max) * 100}%` })))) : h('div.empty', 'Commands you use (like "add task" or "remind me") will be tracked here.')));
}

function Backup(el) {
  el.append(h('div.stack', { style: 'max-width:620px' },
    h('div.small.dim', 'Export everything (settings, notes, tasks, memory, study data) as JSON. Account credentials are never exported.'),
    h('div.row', h('button.btn.primary', { onclick: () => download(`jarvis-x-backup-${new Date().toISOString().slice(0, 10)}.json`, store.export(), 'application/json') }, icon('download'), 'Export backup'),
      h('button.btn', { onclick: async () => { const [f] = await pickFiles({ accept: 'application/json,.json', multiple: false }); if (!f) return; try { store.import(await f.text()); toast('Backup restored', { type: 'ok' }); bus.emit('theme:apply'); } catch (e) { toast(`Import failed: ${e.message}`, { type: 'error' }); } } }, icon('upload'), 'Import backup')),
    h('div.glass.widget', h('div.w-head', icon('cloud'), h('h3.w-title', 'Cloud sync')), h('div.small.dim', 'Sync status and controls live in Account.'), h('button.btn.sm', { style: 'margin-top:8px', onclick: () => bus.emit('open', { id: 'account' }) }, 'Open Account')),
    h('button.btn.danger', { style: 'justify-self:start', onclick: async () => { if (await confirmDialog('Erase every fact in long-term memory?', { danger: true, okLabel: 'Erase memory' })) store.set('memory.facts', []); } }, icon('trash'), 'Erase all memory')));
}

export default {
  flush: true,
  mount(el, ctx) {
    let cleanup;
    const wrap = (fn) => (b) => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } cleanup = fn(b); };
    const t = tabs([
      { id: 'facts', label: 'Long-term memory', icon: 'brain', render: wrap(Facts) },
      { id: 'prefs', label: 'Preferences', icon: 'sliders', render: wrap(Prefs) },
      { id: 'prompts', label: 'Favorite prompts', icon: 'star', render: wrap(Prompts) },
      { id: 'recent', label: 'Recent conversations', icon: 'chat', render: wrap(Recent) },
      { id: 'projects', label: 'Projects', icon: 'layers', render: wrap(Projects) },
      { id: 'commands', label: 'Frequent commands', icon: 'bolt', render: wrap(Commands) },
      { id: 'backup', label: 'Backup', icon: 'download', render: wrap(Backup) },
    ], { initial: ctx.params?.tab });
    el.append(t.el);
    return () => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } };
  },
};
