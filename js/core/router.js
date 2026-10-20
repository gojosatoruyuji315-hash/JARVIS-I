/**
 * Module registry + window manager.
 * Modules are lazy-loaded with dynamic import() the first time they open.
 *
 * Module contract (js/modules/*.js):
 *   export default {
 *     flush?: boolean,                         // body without padding (full-bleed layouts)
 *     mount(el, ctx) { …; return cleanup? },   // ctx = { params, close, setActions }
 *     update?(params)                          // called when re-opened with new params
 *   }
 * @module core/router
 */
import { h, $, clear, toast, announce } from './dom.js';
import { icon } from './icons.js';
import { bus } from './bus.js';
import { t } from './i18n.js';

export const MODULES = [
  { id: 'home', icon: 'home' },
  { id: 'assistant', icon: 'chat', load: () => import('../modules/assistant.js') },
  { id: 'internet', icon: 'globe', load: () => import('../modules/internet.js') },
  { id: 'productivity', icon: 'tasks', load: () => import('../modules/productivity.js') },
  { id: 'study', icon: 'book', load: () => import('../modules/study.js') },
  { id: 'dev', icon: 'code', load: () => import('../modules/devspace.js') },
  { id: 'files', icon: 'folder', load: () => import('../modules/files.js') },
  { id: 'music', icon: 'music', load: () => import('../modules/music.js') },
  { id: 'memory', icon: 'brain', load: () => import('../modules/memory.js') },
  { id: 'automation', icon: 'bolt', load: () => import('../modules/automation.js') },
  { sep: true },
  { id: 'plugins', icon: 'plug', load: () => import('../modules/plugins.js') },
  { id: 'analytics', icon: 'chart', load: () => import('../modules/analytics.js') },
  { id: 'workspace', icon: 'grid', load: () => import('../modules/workspace.js') },
  { id: 'plugin', icon: 'plug', dock: false, load: () => import('../modules/plugin-host.js') },
  { sep: true },
  { id: 'settings', icon: 'settings', load: () => import('../modules/settings.js') },
  { id: 'account', icon: 'user', dock: false, load: () => import('../modules/account.js') },
];
export const moduleById = (id) => MODULES.find((m) => m.id === id);

const cache = new Map();
let layer, current = null; // { id, el, cleanup, mod }

export const router = {
  get current() { return current?.id ?? 'home'; },
  init(stageLayer) { layer = stageLayer; },

  async open(id, params = {}) {
    if (id === 'home') return this.close();
    const def = moduleById(id);
    if (!def?.load) { toast(`Unknown module "${id}"`, { type: 'error' }); return; }
    if (current?.id === id && id !== 'plugin') { current.mod.update?.(params); return; }
    this.close(true);
    const body = h('div.win-body', h('div.empty', 'Loading module…'));
    const actions = h('div.row');
    const win = h('section.win.glass', { role: 'dialog', 'aria-label': t(id) },
      h('header.win-head',
        h('h2', icon(params.icon || def.icon), params.title || t(id)),
        actions,
        h('button.btn.ghost.icon', { 'aria-label': 'Close (Esc)', title: 'Close (Esc)', onclick: () => this.close() }, icon('x'))),
      body);
    clear(layer).append(win);
    current = { id, el: win, cleanup: null, mod: null };
    bus.emit('module:open', { id, params });
    try { history.replaceState(null, '', '#' + id); } catch { /* sandbox */ }
    try {
      let mod = cache.get(id);
      if (!mod) { mod = (await def.load()).default; cache.set(id, mod); }
      if (current?.el !== win) return; // closed meanwhile
      current.mod = mod;
      clear(body);
      if (mod.flush) body.classList.add('flush');
      current.cleanup = await mod.mount(body, { params, close: () => this.close(), setActions: (...nodes) => { clear(actions).append(...nodes.flat().filter(Boolean)); } });
      announce(`${t(id)} opened`);
    } catch (e) {
      console.error(e);
      clear(body).append(h('div.empty', `Couldn't load this module: ${e.message}`));
    }
  },

  close(silent = false) {
    if (!current) return false;
    const { el, cleanup } = current;
    try { typeof cleanup === 'function' && cleanup(); } catch (e) { console.error(e); }
    current = null;
    if (silent) el.remove();
    else { el.classList.add('closing'); setTimeout(() => el.remove(), 220); bus.emit('module:open', { id: 'home' }); }
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* */ }
    return true;
  },

  /** Preload modules in idle time for snappy first opens. */
  prefetch(ids = ['assistant', 'productivity']) {
    const run = () => ids.forEach((id) => { const d = moduleById(id); if (d?.load && !cache.has(id)) d.load().then((m) => cache.set(id, m.default)).catch(() => {}); });
    'requestIdleCallback' in window ? requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 2500);
  },
};
