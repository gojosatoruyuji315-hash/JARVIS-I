/**
 * Plugins: the plugin store (browse, search, install), installed plugins
 * (open, pin to dock, settings, uninstall) and developer install-from-URL.
 * @module modules/plugins
 */
import { h, clear, toast, tabs, confirmDialog, modal, promptDialog } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { plugins, unmetNeeds } from '../core/plugins.js';

const NEED_LABEL = { network: 'Internet', server: 'JARVIS-X server', ai: 'AI' };

export function settingsDialog(meta) {
  const p = plugins.active().find((x) => x.id === meta.id); if (!p?.settings?.length) return;
  const api = p.api;
  const fields = p.settings.map((s) => {
    const v = api.setting(s.key);
    const input = s.type === 'select' ? h('select.select', s.options.map(([val, lab]) => h('option', { value: val, selected: v === val }, lab)))
      : s.type === 'toggle' ? h('input', { type: 'checkbox', checked: !!v })
      : h('input.input', { type: s.type === 'password' ? 'password' : s.type === 'number' ? 'number' : 'text', value: v ?? '', placeholder: s.placeholder || '', autocomplete: 'off' });
    return { s, input, el: h('label.field', s.label, input, s.help ? h('span.xs.muted', s.help) : null) };
  });
  modal({ title: `${p.name} settings`, titleIcon: 'settings', body: h('div.stack', fields.map((f) => f.el), h('div.xs.muted', 'Keys are stored in your encrypted vault and synced with your data.')), actions: [
    { label: 'Cancel', kind: 'ghost' },
    { label: 'Save', kind: 'primary', onClick: (close) => { for (const f of fields) api.setSetting(f.s.key, f.s.type === 'toggle' ? f.input.checked : f.s.type === 'number' ? Number(f.input.value) : f.input.value.trim()); toast('Settings saved', { type: 'ok' }); close(); } },
  ] });
}

function card(meta, rerender) {
  const installed = plugins.isInstalled(meta.id);
  const why = unmetNeeds(meta);
  return h('div.glass.widget.plugin-card',
    h('div.row', { style: 'align-items:flex-start;flex-wrap:nowrap' },
      h('div.plugin-icon', icon(meta.icon || 'plug', { size: 24 })),
      h('div.grow', { style: 'min-width:0' }, h('b', meta.name), h('div.xs.muted', `${meta.category} · v${meta.version || '1.0.0'}${meta.author ? ' · ' + meta.author : ''}`))),
    h('div.small.dim', { style: 'margin:8px 0;min-height:40px' }, meta.description),
    h('div.row', { style: 'gap:4px' }, (meta.needs || []).map((n) => h('span.pill', NEED_LABEL[n] || n)), meta.tools?.length || meta.toolCount ? h('span.pill.ok', icon('sparkles', { size: 11 }), 'Assistant tools') : null),
    why ? h('div.xs', { style: 'color:var(--warn);margin-top:6px' }, `Here it ${why}.`) : null,
    h('div.row', { style: 'margin-top:10px' },
      installed
        ? [meta.hasPanel ? h('button.btn.primary.sm', { onclick: () => plugins.openPanel(meta.id) }, icon('external'), 'Open') : null,
          meta.settingsCount ? h('button.btn.sm', { onclick: async () => { await plugins.activate(meta.id); settingsDialog(meta); } }, icon('settings'), 'Settings') : null,
          meta.hasPanel ? h('button.btn.ghost.sm', { onclick: () => { plugins.togglePin(meta.id); rerender(); } }, plugins.isPinned(meta.id) ? 'Unpin from dock' : 'Pin to dock') : null,
          h('span.grow'),
          h('button.btn.ghost.sm', { onclick: async () => { if (await confirmDialog(`Uninstall ${meta.name}? Its saved data stays until you reinstall or erase it.`, { okLabel: 'Uninstall' })) { await plugins.uninstall(meta.id); rerender(); } } }, 'Uninstall')]
        : h('button.btn.primary.sm', { onclick: async () => { try { await plugins.install(meta.id); rerender(); if (meta.hasPanel) plugins.openPanel(meta.id); } catch (e) { toast(e.message, { type: 'error' }); } } }, icon('plus'), 'Install')));
}

function Store(el) {
  let q = ''; let cat = 'All';
  const grid = h('div.plugin-grid'); const cats = h('div.row');
  const search = h('input.input', { placeholder: 'Search plugins', style: 'max-width:320px', 'aria-label': 'Search plugins', oninput: (e) => { q = e.target.value.toLowerCase(); render(); } });
  const render = () => {
    const all = plugins.catalog();
    clear(cats).append(['All', ...new Set(all.map((p) => p.category))].map((c) => h('button.btn.sm', { class: c === cat ? 'primary' : '', onclick: () => { cat = c; render(); } }, c)));
    const list = all.filter((p) => (cat === 'All' || p.category === cat) && (!q || `${p.name} ${p.description} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q)));
    clear(grid).append(list.length ? list.map((p) => card(p, render)) : h('div.empty', 'No plugins match.'));
  };
  render();
  el.append(h('div.stack', h('div.row', search, h('span.grow'), h('span.small.dim', `${plugins.catalog().length} plugins · all free`)), cats, grid));
  return bus.on('plugins:change', render);
}

function Installed(el) {
  const grid = h('div.plugin-grid');
  const render = () => { const list = plugins.installed(); clear(grid).append(list.length ? list.map((p) => card(p, render)) : h('div.empty', 'No plugins installed yet. Browse the store to add some.')); };
  render(); el.append(grid);
  return bus.on('plugins:change', render);
}

function Developers(el) {
  el.append(h('div.stack', { style: 'max-width:760px' },
    h('div.small.dim', 'Build your own plugin: an ES module whose default export is a manifest. It can add a panel, instant commands, and tools the AI assistant can call.'),
    h('pre.console', { style: 'height:auto' }, `// my-plugin.js
export default {
  id: 'hello', name: 'Hello', icon: 'sparkles', category: 'Custom',
  description: 'Says hello and counts visits.',
  panel(el, api) {
    const n = api.get('visits', 0) + 1; api.set('visits', n);
    el.append(api.h('h2', \`Hello! Visit #\${n}\`));
  },
  commands: [{ match: /^say hello$/i, run: () => 'Hello from my plugin!' }],
  tools: [{ name: 'say_hello', description: 'Greets someone by name.',
    schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: ({ name }) => \`Hello, \${name}!\` }],
};`),
    h('div.row', h('button.btn.primary', { onclick: async () => {
      const url = await promptDialog('Install from URL', { placeholder: 'https://example.com/my-plugin.js', label: 'ES module URL' }); if (!url) return;
      const ok = await confirmDialog('Plugins run with full access to your JARVIS-X data. Only install code you trust.', { title: 'Install this plugin?', okLabel: 'Install' });
      if (ok) try { await plugins.installFromUrl(url); } catch (e) { toast(`Couldn't load the plugin: ${e.message}`, { type: 'error' }); }
    } }, icon('download'), 'Install from URL'), h('span.small.dim', 'or run JX.plugins.register(manifest) in the console.')),
    h('div.small.dim', 'Full reference: docs/PLUGINS.md')));
}

export default {
  flush: true,
  mount(el, ctx) {
    let cleanup;
    const wrap = (fn) => (b) => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } cleanup = fn(b); };
    const t = tabs([
      { id: 'store', label: 'Plugin store', icon: 'grid', render: wrap(Store) },
      { id: 'installed', label: 'Installed', icon: 'check', render: wrap(Installed) },
      { id: 'dev', label: 'Build a plugin', icon: 'code', render: wrap(Developers) },
    ], { initial: ctx.params?.tab });
    el.append(t.el);
    return () => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } };
  },
};
