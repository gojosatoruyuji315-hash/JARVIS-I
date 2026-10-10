/**
 * Plugin system.
 *
 * A plugin is an ES module whose default export is a manifest:
 *
 *   export default {
 *     id: 'my-plugin', name: 'My Plugin', version: '1.0.0', author: 'You',
 *     description: 'What it does', icon: 'sparkles', category: 'Productivity',
 *     needs: ['network' | 'server' | 'ai'],          // requirements (shown in the store, checked at use)
 *     settings: [{ key, label, type: 'text'|'password'|'select'|'toggle'|'number', options?, help?, placeholder?, default? }],
 *     panel(el, api) { …; return cleanup? },         // optional UI, opens in its own window
 *     commands: [{ match: /^roll d(\d+)$/i, run(text, api) { return 'reply' } }],  // instant command-bar commands
 *     tools: [{ name, description, schema, run(input, api) }],                    // actions the AI assistant can call
 *     activate(api) {}, deactivate(api) {},          // lifecycle
 *   };
 *
 * Built-in plugins live in js/plugins/ and are listed in js/plugins/catalog.js.
 * Third parties can call JX.plugins.register(manifest) or install from a module URL.
 * Each plugin gets a scoped api (settings, private storage, AI, downloads, UI helpers).
 * @module core/plugins
 */
import { store } from './store.js';
import { bus } from './bus.js';
import { platform } from './platform.js';
import { h, toast, download, modal, uid, fmt, copyText } from './dom.js';
import { icon } from './icons.js';
import { CATALOG } from '../plugins/catalog.js';

const active = new Map();     // id → manifest (loaded & activated)
const runtime = new Map();    // id → manifest registered at runtime (not in catalog)

const S = () => store.get('plugins');
const save = (patch) => store.set('plugins', { ...S(), ...patch });

/** Does this environment satisfy a plugin's requirements? Returns a reason string or null. */
export function unmetNeeds(meta) {
  for (const n of meta.needs || []) {
    if (n === 'network' && !platform.hasNetwork) return 'needs internet — the Claude viewer keeps pages offline. Use “Full internet” at the top to open the full version';
    if (n === 'server' && !platform.isServer) return 'needs the JARVIS-X server';
  }
  return null;
}

/** The scoped API handed to a plugin. */
function makeApi(meta) {
  const id = meta.id;
  const api = {
    id, meta, h, icon, toast, fmt, uid, modal, copyText, bus, platform,
    /** Plugin setting (from its settings page). */
    setting(key) { const c = S().config?.[id] || {}; return key in c ? c[key] : meta.settings?.find((s) => s.key === key)?.default; },
    setSetting(key, value) { store.set(['plugins', 'config', id], { ...(S().config?.[id] || {}), [key]: value }); },
    /** Private, synced storage for this plugin. */
    get(key, fallback) { const d = S().data?.[id] || {}; return key in d ? d[key] : fallback; },
    set(key, value) { store.set(['plugins', 'data', id], { ...(S().data?.[id] || {}), [key]: value }); },
    /** Ask the AI (whatever engine is active). Resolves to text. */
    async ask(prompt, { onText, system, signal, tier } = {}) {
      const { ask } = await import('./assistant.js');
      const r = await ask(prompt, { conversation: false, commands: false, tools: false, history: [{ role: 'user', content: prompt }], system: system || 'You are a precise assistant inside JARVIS-X. Follow the requested output format exactly.', onChunk: onText, signal, tier });
      return r.text;
    },
    download,
    /** Save a generated file into the File Manager (folder created on demand). */
    async saveToFiles(blob, name, folder = '/Generated') {
      const { idb } = await import('./idb.js');
      const folders = store.get('files.folders') || ['/', '/Documents', '/Images', '/Music'];
      if (!folders.includes(folder)) store.set('files.folders', [...folders, folder]);
      const meta2 = { id: uid('f'), name, type: blob.type || 'application/octet-stream', size: blob.size, folder, created: Date.now(), modified: Date.now(), accessed: Date.now() };
      await idb.set('blobs', meta2.id, blob); await idb.set('files', meta2.id, meta2);
      toast(`Saved to Files → ${folder}`, { type: 'ok', timeout: 2500 });
      return meta2;
    },
    /** fetch() returning JSON with friendly errors. */
    async json(url, opts = {}) {
      const plainGet = (!opts.method || opts.method === 'GET') && !opts.headers && !opts.body;
      if (plainGet) { const { getJSON } = await import('./net.js'); return getJSON(url); }
      if (!platform.directNetwork) throw new Error('This request needs a direct internet connection (it sends private headers), which the Claude viewer does not allow.');
      let r; try { r = await fetch(url, opts); } catch { throw new Error('Network request failed — check your connection.'); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error?.message || j.error || j.message || j.detail || `Request failed (${r.status})`);
      return j;
    },
    open(moduleId, params) { bus.emit('open', { id: moduleId, params }); },
    openPanel() { plugins.openPanel(id); },
  };
  return api;
}

export const plugins = {
  catalog: () => [...CATALOG, ...[...runtime.values()].filter((m) => !CATALOG.some((c) => c.id === m.id))],
  meta: (id) => CATALOG.find((p) => p.id === id) || runtime.get(id),
  isInstalled: (id) => S().installed.includes(id) || runtime.has(id),
  isPinned: (id) => (S().pinned || []).includes(id),
  installed() { return this.catalog().filter((p) => this.isInstalled(p.id)); },
  active: () => [...active.values()],

  /** Load and activate every installed plugin. */
  async init() {
    for (const id of S().installed) await this.activate(id).catch((e) => console.warn(`[plugins] ${id}:`, e));
    for (const url of S().urls || []) await this.installFromUrl(url, { silent: true }).catch(() => {});
    bus.emit('plugins:change');
  },
  async load(id) {
    if (active.has(id)) return active.get(id);
    const meta = this.meta(id); if (!meta) throw new Error(`Unknown plugin ${id}`);
    const mod = meta.load ? (await meta.load()).default : meta;
    const full = { ...meta, ...mod };
    return full;
  },
  async activate(id) {
    if (active.has(id)) return active.get(id);
    const full = await this.load(id);
    full.api = makeApi(full);
    active.set(id, full);
    try { await full.activate?.(full.api); } catch (e) { console.error(e); }
    return full;
  },
  async install(id) {
    const meta = this.meta(id);
    if (!S().installed.includes(id)) save({ installed: [...S().installed, id], pinned: meta?.panel || meta?.hasPanel ? [...(S().pinned || []), id] : S().pinned });
    await this.activate(id);
    bus.emit('plugins:change');
    toast(`Installed ${meta?.name || id}`, { type: 'ok' });
  },
  async uninstall(id) {
    const p = active.get(id);
    try { await p?.deactivate?.(p.api); } catch { /* */ }
    active.delete(id); runtime.delete(id);
    save({ installed: S().installed.filter((x) => x !== id), pinned: (S().pinned || []).filter((x) => x !== id) });
    bus.emit('plugins:change');
  },
  togglePin(id) { const p = S().pinned || []; save({ pinned: p.includes(id) ? p.filter((x) => x !== id) : [...p, id] }); bus.emit('plugins:change'); },

  /** Register a plugin at runtime (third-party / console). Not persisted. */
  register(manifest) {
    if (!manifest?.id || !manifest?.name) throw new Error('A plugin needs at least an id and a name.');
    runtime.set(manifest.id, { category: 'Custom', icon: 'plug', ...manifest, hasPanel: !!manifest.panel });
    manifest.api = makeApi(manifest); active.set(manifest.id, manifest);
    manifest.activate?.(manifest.api);
    bus.emit('plugins:change');
    return true;
  },
  /** Install a plugin from an ES module URL (default export = manifest). Persisted. */
  async installFromUrl(url, { silent = false } = {}) {
    const mod = await import(/* @vite-ignore */ url);
    const m = mod.default; this.register({ ...m, source: url });
    if (!(S().urls || []).includes(url)) save({ urls: [...(S().urls || []), url] });
    if (!silent) toast(`Installed ${m.name}`, { type: 'ok' });
    return m;
  },

  openPanel(id) {
    const m = this.meta(id) || active.get(id);
    bus.emit('open', { id: 'plugin', params: { plugin: id, title: m?.name, icon: m?.icon } });
  },

  /** Commands from active plugins (used by core/commands.js). */
  commands() { return this.active().flatMap((p) => (p.commands || []).map((c) => ({ ...c, plugin: p }))); },
  /** AI tools from active plugins (used by core/tools.js). */
  tools() {
    return this.active().filter((p) => !unmetNeeds(p)).flatMap((p) => (p.tools || []).map((t) => ({ ...t, plugin: p, run: (input) => t.run(input, p.api) })));
  },
};
