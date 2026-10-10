/**
 * Smart Automation: routines made of steps (speak, notify, open, add task,
 * start focus, music, wait, ask AI, theme), manual or daily triggers.
 * Master adds the visual workflow builder with conditional branches.
 * @module modules/automation
 */
import { h, clear, fmt, uid, toast, confirmDialog, sleep, tabs } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { notify } from '../core/scheduler.js';
import { voice } from '../core/voice.js';
import { ask } from '../core/assistant.js';
import { gate, allowed, withinLimit, featureBadge, lockOverlay } from '../core/gate.js';
import { todayKey } from '../core/dom.js';

export const STEP_TYPES = {
  speak:    { label: 'Speak', hint: 'Text to say aloud', icon: 'volume' },
  notify:   { label: 'Notify', hint: 'Notification text', icon: 'bell' },
  open:     { label: 'Open module', hint: 'tasks, notes, study, music, dev…', icon: 'grid' },
  url:      { label: 'Open website', hint: 'https://…', icon: 'globe' },
  task:     { label: 'Add task', hint: 'Task title', icon: 'tasks' },
  pomodoro: { label: 'Start focus', hint: 'Minutes', icon: 'timer' },
  music:    { label: 'Music', hint: 'play | pause | next', icon: 'music' },
  theme:    { label: 'Set theme', hint: 'arc, silver, daylight…', icon: 'palette' },
  wait:     { label: 'Wait', hint: 'Seconds', icon: 'clock', pro: true },
  ask:      { label: 'Ask AI', hint: 'Prompt (result is shown + spoken)', icon: 'sparkles', pro: true },
  if:       { label: 'If… (condition)', hint: 'weekday | weekend | morning | afternoon | evening | tasks-due', icon: 'flag', master: true },
};
const OPEN_MAP = { tasks: ['productivity', 'tasks'], notes: ['productivity', 'notes'], calendar: ['productivity', 'calendar'], planner: ['productivity', 'planner'], pomodoro: ['productivity', 'pomodoro'], study: ['study'], flashcards: ['study', 'flashcards'], music: ['music'], dev: ['dev'], assistant: ['assistant'], files: ['files'], memory: ['memory'] };

function check(cond) {
  const d = new Date(); const hr = d.getHours(); const wd = d.getDay();
  return { weekday: wd > 0 && wd < 6, weekend: wd === 0 || wd === 6, morning: hr < 12, afternoon: hr >= 12 && hr < 17, evening: hr >= 17, 'tasks-due': store.get('tasks').some((t) => !t.done && t.due && t.due <= todayKey()) }[cond.trim()] ?? false;
}

/** Execute a routine by id. Safe to call from scheduler, voice, commands. */
export async function runRoutine(id) {
  const r = store.findById('automation.routines', id); if (!r) return;
  toast(`Running routine: ${r.name}`, { type: 'info' });
  for (let i = 0; i < r.steps.length; i++) {
    const s = r.steps[i]; const v = (s.value || '').trim();
    try {
      switch (s.type) {
        case 'speak': voice.speak(v, { interrupt: false }); break;
        case 'notify': notify(r.name, v); break;
        case 'open': { const [id2, tab] = OPEN_MAP[v.toLowerCase()] || [v.toLowerCase()]; bus.emit('open', { id: id2, params: tab ? { tab } : {} }); break; }
        case 'url': bus.emit('open:url', { url: /^https?:/.test(v) ? v : 'https://' + v }); break;
        case 'task': store.unshift('tasks', { id: uid('t'), title: v, done: false, priority: 'med', due: todayKey(), list: 'Personal', created: Date.now() }); break;
        case 'pomodoro': bus.emit('open', { id: 'productivity', params: { tab: 'pomodoro', autostart: +v || 25 } }); break;
        case 'music': bus.emit('music', { cmd: ['play', 'pause', 'next', 'prev', 'toggle'].includes(v) ? v : 'play' }); break;
        case 'theme': bus.emit('theme:set', { skin: v }); break;
        case 'wait': if (allowed('automation.advanced')) await sleep(Math.min(600, +v || 1) * 1000); break;
        case 'ask': if (allowed('automation.advanced')) { const res = await ask(v, { conversation: false, history: [{ role: 'user', content: v }] }); notify(r.name, res.text.slice(0, 160)); voice.speak(res.text, { interrupt: false }); } break;
        case 'if': if (allowed('workflow.builder') && !check(v)) i += Math.max(1, +s.skip || 1); break;
      }
    } catch (e) { toast(`Step ${i + 1} failed: ${e.message}`, { type: 'error' }); }
  }
  store.patchById('automation.routines', id, { lastRun: Date.now(), runs: (r.runs || 0) + 1 });
}

function Routines(el, { builder = false } = {}) {
  let editing = null;
  const root = h('div.stack'); el.append(root);
  const render = () => {
    clear(root);
    const routines = store.get('automation.routines');
    if (editing) return renderEditor(store.findById('automation.routines', editing));
    root.append(h('div.row', h('button.btn.primary', { onclick: () => {
      if (!withinLimit('routines', routines.length, 'routines')) return;
      const r = { id: uid('r'), name: 'New routine', enabled: true, trigger: { type: 'manual', time: '08:00' }, steps: [{ type: 'notify', value: 'Hello from your routine' }] };
      store.push('automation.routines', r); editing = r.id; render();
    } }, icon('plus'), 'New routine'), h('span.small.dim', 'Tip: say "run morning focus" to trigger a routine by voice.')),
    h('div.grid2', routines.map((r) => h('div.glass.widget',
      h('div.w-head', icon('bolt'), h('h3.w-title', r.name), h('label.switch', h('input', { type: 'checkbox', checked: r.enabled, 'aria-label': 'Enabled', onchange: (e) => store.patchById('automation.routines', r.id, { enabled: e.target.checked }) }), h('span.track'))),
      h('div.small.dim', r.trigger.type === 'daily' ? `Daily at ${r.trigger.time}` : 'Manual trigger', ' · ', `${r.steps.length} step${r.steps.length === 1 ? '' : 's'}`, r.lastRun ? ` · last run ${fmt.rel(r.lastRun)}` : ''),
      h('div.row', { style: 'margin:8px 0;gap:4px' }, r.steps.map((s) => h('span.pill', icon(STEP_TYPES[s.type]?.icon || 'bolt', { size: 11 }), STEP_TYPES[s.type]?.label))),
      h('div.row', h('button.btn.primary.sm', { onclick: () => runRoutine(r.id) }, icon('play'), 'Run'), h('button.btn.sm', { onclick: () => { editing = r.id; render(); } }, icon('edit'), 'Edit'),
        h('button.btn.ghost.sm', { onclick: async () => { if (await confirmDialog(`Delete routine "${r.name}"?`, { danger: true, okLabel: 'Delete' })) store.removeById('automation.routines', r.id); } }, icon('trash')))))));
  };
  const renderEditor = (r) => {
    const save = (patch) => { store.patchById('automation.routines', r.id, patch); Object.assign(r, patch); };
    const steps = h('div.flow');
    const drawSteps = () => clear(steps).append(r.steps.map((s, i) => h('div.flow-step', { 'data-n': String(i + 1).padStart(2, '0') },
      h('select.select', { style: 'width:auto', 'aria-label': 'Step type', onchange: (e) => {
        const t = STEP_TYPES[e.target.value];
        if (t.pro && !gate('automation.advanced')) { e.target.value = s.type; return; }
        if (t.master && !gate('workflow.builder')) { e.target.value = s.type; return; }
        r.steps[i] = { ...s, type: e.target.value }; save({ steps: [...r.steps] }); drawSteps();
      } }, Object.entries(STEP_TYPES).map(([k, t]) => h('option', { value: k, selected: k === s.type }, t.label + (t.master && !allowed('workflow.builder') ? ' (Master)' : t.pro && !allowed('automation.advanced') ? ' (Pro)' : '')))),
      h('input.input.grow', { value: s.value || '', placeholder: STEP_TYPES[s.type]?.hint, 'aria-label': 'Step value', onchange: (e) => { r.steps[i] = { ...s, value: e.target.value }; save({ steps: [...r.steps] }); } }),
      s.type === 'if' ? h('label.small', 'else skip ', h('input.input', { type: 'number', min: 1, value: s.skip || 1, style: 'width:60px', onchange: (e) => { r.steps[i] = { ...s, skip: +e.target.value }; save({ steps: [...r.steps] }); } }), ' step(s)') : null,
      h('button.btn.ghost.icon.sm', { 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [r.steps[i - 1], r.steps[i]] = [r.steps[i], r.steps[i - 1]]; save({ steps: [...r.steps] }); drawSteps(); } }, '↑'),
      h('button.btn.ghost.icon.sm', { 'aria-label': 'Remove step', onclick: () => { r.steps.splice(i, 1); save({ steps: [...r.steps] }); drawSteps(); } }, icon('x')))));
    drawSteps();
    root.append(h('div.row', h('button.btn.ghost.sm', { onclick: () => { editing = null; render(); } }, icon('prev'), 'All routines'), h('span.grow'), h('button.btn.primary.sm', { onclick: () => runRoutine(r.id) }, icon('play'), 'Test run')),
      h('label.field', 'Name', h('input.input', { value: r.name, onchange: (e) => save({ name: e.target.value }) })),
      h('div.row', h('label.field', 'Trigger', h('select.select', { style: 'width:auto', onchange: (e) => { if (e.target.value === 'daily' && !gate('automation.advanced')) { e.target.value = 'manual'; return; } save({ trigger: { ...r.trigger, type: e.target.value } }); } },
        h('option', { value: 'manual', selected: r.trigger.type === 'manual' }, 'Manual / voice'), h('option', { value: 'daily', selected: r.trigger.type === 'daily' }, `Daily at a time${allowed('automation.advanced') ? '' : ' (Pro)'}`))),
        h('label.field', 'Time', h('input.input', { type: 'time', value: r.trigger.time, onchange: (e) => save({ trigger: { ...r.trigger, time: e.target.value } }) }))),
      h('div.section-title', builder ? 'Workflow' : 'Steps'), steps,
      h('button.btn', { style: 'justify-self:start', onclick: () => { r.steps.push({ type: 'notify', value: '' }); save({ steps: [...r.steps] }); drawSteps(); } }, icon('plus'), 'Add step'));
  };
  render();
  return store.on('automation', () => { if (!editing) render(); });
}

function Builder(el) {
  const wrap = h('div.stack', h('div.small.dim', 'Build multi-step workflows with conditions. "If" steps check the time of day, weekday/weekend or whether tasks are due — when false, the next N steps are skipped.'));
  el.append(lockOverlay(wrap, 'workflow.builder'));
  const off = Routines(wrap, { builder: true });
  return off;
}

function Plugins(el) {
  el.append(h('div.stack',
    h('div.small.dim', 'Plugins can add commands, assistant tools and their own panels. Browse and install them from the Plugins page, or register your own:'),
    h('pre.console', { style: 'height:auto' }, `JX.plugins.register({
  id: 'weather-joke', name: 'Weather jokes', icon: 'cloud',
  commands: [{ match: /^weather joke$/i, run: () => 'Why did the cloud date the fog? It was mist-ified.' }],
});`),
    h('button.btn.primary', { style: 'justify-self:start', onclick: () => bus.emit('open', { id: 'plugins' }) }, icon('plug'), 'Open Plugins')));
}

export default {
  flush: true,
  mount(el, ctx) {
    let cleanup;
    const wrap = (fn) => (b) => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } cleanup = fn(b); };
    const t = tabs([
      { id: 'routines', label: 'Routines', icon: 'bolt', render: wrap((b) => Routines(b)) },
      { id: 'builder', label: 'Workflow builder', icon: 'layers', badge: featureBadge('workflow.builder'), render: wrap(Builder) },
      { id: 'plugins', label: 'Plugin hooks', icon: 'plug', render: wrap(Plugins) },
    ], { initial: ctx.params?.tab });
    el.append(t.el);
    return () => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } };
  },
};
