/**
 * Workspace: multi-agent AI, custom assistants, personal knowledge base,
 * project board and the Developer API. (Image/video generation lives in plugins.)
 * @module modules/workspace
 */
import { h, clear, fmt, uid, toast, tabs, pickFiles, promptDialog, copyText } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { ask } from '../core/assistant.js';
import { renderMarkdown } from '../core/markdown.js';
import { lockOverlay, planBadge, allowed, gate } from '../core/gate.js';
import { randomBytes } from '../core/crypto.js';
import { platform } from '../core/platform.js';
import { api } from '../core/api.js';
import { download } from '../core/dom.js';

const DEFAULT_AGENTS = [
  { id: 'researcher', name: 'Researcher', icon: 'search', persona: 'You are a meticulous researcher. Gather the key facts, cite what is known vs uncertain, and list open questions.' },
  { id: 'critic', name: 'Critic', icon: 'shield', persona: 'You are a sharp critic. Find weaknesses, risks and counter-arguments. Be constructive.' },
  { id: 'planner', name: 'Planner', icon: 'calendar', persona: 'You are a pragmatic planner. Turn the request into a step-by-step action plan with milestones.' },
  { id: 'coder', name: 'Engineer', icon: 'code', persona: 'You are a senior software engineer. Propose a technical approach with code where useful.' },
  { id: 'writer', name: 'Writer', icon: 'edit', persona: 'You are an editor. Produce a clear, well-structured written answer for a general audience.' },
  { id: 'analyst', name: 'Analyst', icon: 'chart', persona: 'You are a data analyst. Quantify where possible, estimate, and state assumptions.' },
];
const agents = () => store.get('workspace.agents') || DEFAULT_AGENTS;
const master = (title) => h('div.row', h('h3', title));

function MultiAgent(el) {
  const chosen = new Set(['researcher', 'critic', 'planner']);
  const prompt = h('textarea.textarea', { placeholder: 'Give the team a task, e.g. "Should I learn Rust or Go for backend work in 2026?"', style: 'min-height:80px' });
  const cols = h('div.agents'); const synth = h('div.md.glass.widget', { hidden: true });
  const picks = h('div.row');
  const drawPicks = () => clear(picks).append(agents().map((a) => h('button.btn.sm', { class: chosen.has(a.id) ? 'primary' : '', onclick: () => { chosen.has(a.id) ? chosen.delete(a.id) : chosen.add(a.id); drawPicks(); } }, icon(a.icon || 'user'), a.name)));
  drawPicks();
  const run = async () => {
    if (!gate('workspace.multiagent')) return; const q = prompt.value.trim(); if (!q || !chosen.size) return;
    clear(cols); synth.hidden = true;
    const outs = {};
    await Promise.all(agents().filter((a) => chosen.has(a.id)).map(async (a) => {
      const body = h('div.md.small', { html: '<span class="typing"></span>' });
      cols.append(h('div.agent-col.glass', h('h4', icon(a.icon || 'user'), a.name), body));
      const r = await ask(q, { conversation: false, system: `${a.persona} Keep it under 200 words. Use Markdown.`, history: [{ role: 'user', content: q }], onChunk: (f) => { body.innerHTML = renderMarkdown(f); } });
      outs[a.name] = r.text;
    }));
    synth.hidden = false; synth.innerHTML = '<span class="typing"></span>';
    const merged = `Synthesize these expert views into one recommendation with a clear verdict and next steps.\n\n${Object.entries(outs).map(([n, t]) => `## ${n}\n${t}`).join('\n\n')}`;
    await ask(merged, { conversation: false, history: [{ role: 'user', content: merged }], onChunk: (f) => { synth.innerHTML = renderMarkdown(f); } });
  };
  el.append(lockOverlay(h('div.stack', master('Multi-agent workspace'), h('div.small.dim', 'Several specialised agents tackle the same task in parallel, then a coordinator synthesises their answers.'), picks, prompt, h('button.btn.gold', { style: 'justify-self:start', onclick: run }, icon('users'), 'Run agents'), cols, synth), 'workspace.multiagent'));
}

function Assistants(el) {
  const list = h('div.grid2');
  const render = () => clear(list).append(agents().map((a) => h('div.glass.widget', h('div.w-head', icon(a.icon || 'user'), h('input.input', { value: a.name, 'aria-label': 'Assistant name', onchange: (e) => save(a.id, { name: e.target.value }) })),
    h('textarea.textarea', { value: a.persona, 'aria-label': 'Persona', style: 'min-height:80px', onchange: (e) => save(a.id, { persona: e.target.value }) }),
    h('div.row', h('button.btn.sm', { onclick: () => { store.set('settings.ai.personality', 'custom'); store.set('settings.ai.customPersona', a.persona); toast(`${a.name} is now your main assistant persona`, { type: 'ok' }); } }, 'Use as main assistant'), h('span.grow'), h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete', onclick: () => { store.set('workspace.agents', agents().filter((x) => x.id !== a.id)); render(); } }, icon('trash'))))),
  h('button.glass.widget', { style: 'display:grid;place-items:center;min-height:150px;cursor:pointer;color:var(--fg-dim)', onclick: async () => { const name = await promptDialog('Assistant name'); if (name) { store.set('workspace.agents', [...agents(), { id: uid('ag'), name, icon: 'user', persona: `You are ${name}, a helpful specialist.` }]); render(); } } }, h('div', icon('plus', { size: 26 }), h('div', 'New assistant'))));
  const save = (id, patch) => store.set('workspace.agents', agents().map((x) => (x.id === id ? { ...x, ...patch } : x)));
  render();
  el.append(lockOverlay(h('div.stack', master('Multiple AI assistants'), h('div.small.dim', 'Create named assistants with their own personas. They appear in the multi-agent workspace.'), list), 'workspace.multiagent'));
}

function Knowledge(el) {
  const list = h('div.list'); const q = h('input.input', { placeholder: 'Test retrieval: ask a question to see matching passages' }); const res = h('div.stack');
  const render = () => clear(list).append(store.get('kb.docs').length ? store.get('kb.docs').map((d) => h('div.item', icon('file', { size: 14 }), h('span.grow.small', d.title), h('span.xs.muted', `${(d.text.length / 1000).toFixed(1)}k chars · ${fmt.rel(d.ts)}`), h('button.btn.ghost.icon.sm', { 'aria-label': 'Remove', onclick: () => store.removeById('kb.docs', d.id) }, icon('trash')))) : h('div.empty', 'Add documents — JARVIS-X will cite them automatically when you chat.'));
  const add = (title, text) => { store.push('kb.docs', { id: uid('kb'), title, text: text.slice(0, 500000), ts: Date.now() }); toast(`Added "${title}" to your knowledge base`, { type: 'ok' }); };
  q.addEventListener('change', async () => { const { retrieveKB } = await import('../core/assistant.js'); clear(res).append(retrieveKB(q.value, 4).map((c) => h('div.glass.widget', h('b.small', c.title), h('div.small.dim', c.text.slice(0, 300) + '…')))); });
  render();
  el.append(lockOverlay(h('div.stack', master('Personal knowledge base'),
    h('div.row', h('button.btn.gold', { onclick: async () => { if (!gate('kb.personal')) return; for (const f of await pickFiles({ accept: '.txt,.md,.csv,.json,.html' })) add(f.name, await f.text()); } }, icon('upload'), 'Upload documents'),
      h('button.btn', { onclick: async () => { if (!gate('kb.personal')) return; const t = await promptDialog('Paste text', { multiline: true }); if (t) add(t.split('\n')[0].slice(0, 50) || 'Pasted text', t); } }, icon('clipboard'), 'Paste text'),
      h('button.btn', { onclick: () => { if (!gate('kb.personal')) return; for (const n of store.get('notes')) add(`Note: ${n.title}`, n.body); } }, icon('note'), 'Import all notes')),
    list, q, res), 'kb.personal'));
  return store.on('kb', render);
}

function Projects(el) {
  const board = h('div.grid3', { style: 'align-items:start' });
  const cols = [['active', 'In progress'], ['review', 'Review'], ['done', 'Done']];
  const render = () => clear(board).append(cols.map(([st, label]) => h('div.glass.agent-col', { ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/jx-proj'); store.patchById('memory.projects', id, { status: st, progress: st === 'done' ? 100 : store.findById('memory.projects', id).progress }); } },
    h('h4', label, h('span.pill', store.get('memory.projects').filter((p) => p.status === st).length)),
    store.get('memory.projects').filter((p) => p.status === st).map((p) => h('div.item', { draggable: true, style: 'display:grid;cursor:grab', ondragstart: (e) => e.dataTransfer.setData('text/jx-proj', p.id) },
      h('b.small', p.name), h('div.meter', h('i', { style: `width:${p.progress}%` })), h('div.xs.muted', `${p.progress}%${p.due ? ` · due ${fmt.date(p.due)}` : ''}`))),
    st === 'active' ? h('button.btn.ghost.sm', { onclick: async () => { const n = await promptDialog('Project name'); if (n) store.push('memory.projects', { id: uid('pr'), name: n, progress: 0, status: 'active', notes: '', due: null }); } }, icon('plus'), 'Add project') : null)));
  render();
  el.append(lockOverlay(h('div.stack', master('Project management dashboard'), h('div.small.dim', 'Drag cards between columns. Edit details in Memory → Projects.'), board), 'projects.dashboard'));
  return store.on('memory.projects', render);
}

function DevAPI(el) {
  el.append(lockOverlay(h('div.stack', master('Developer API'),
    h('div.small.dim', 'A REST API for your own scripts and automations: read and add tasks, notes, memory and events, or chat with your assistant. Changes appear in the app on the next sync.'),
    h('pre.console', { style: 'height:auto' }, `GET   /v1/tasks              list tasks
POST  /v1/tasks              {"title":"Ship v2","due":"2026-10-20","priority":"hi"}
PATCH /v1/tasks/:id          {"done":true}
GET   /v1/notes · POST /v1/notes   {"title":"…","body":"markdown"}
GET   /v1/memory · POST /v1/memory {"text":"Prefers morning meetings"}
GET   /v1/events · POST /v1/events {"title":"…","date":"YYYY-MM-DD","time":"HH:MM"}
POST  /v1/chat               {"message":"What's due this week?"}

curl -H "Authorization: Bearer jxk_…" ${location.origin}/v1/tasks`),
    platform.isServer ? h('button.btn.gold', { style: 'justify-self:start', onclick: () => bus.emit('open', { id: 'account' }) }, icon('key'), 'Manage API keys') : h('div.small.dim', 'API keys are issued by the JARVIS-X server.')), 'api.developer'));
}

export default {
  flush: true,
  mount(el, ctx) {
    let cleanup;
    const wrap = (fn) => (b) => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } cleanup = fn(b); };
    const t = tabs([
      { id: 'agents', label: 'Multi-agent', icon: 'users', render: wrap(MultiAgent) },
      { id: 'assistants', label: 'Assistants', icon: 'user', render: wrap(Assistants) },
      { id: 'kb', label: 'Knowledge base', icon: 'database', render: wrap(Knowledge) },
      { id: 'projects', label: 'Projects', icon: 'layers', render: wrap(Projects) },
      { id: 'api', label: 'Developer API', icon: 'terminal', render: wrap(DevAPI) },
    ], { initial: ctx.params?.tab });
    el.append(t.el);
    return () => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } };
  },
};
