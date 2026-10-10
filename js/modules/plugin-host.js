/**
 * Hosts one plugin's panel in a window: router.open('plugin', { plugin: id }).
 * @module modules/plugin-host
 */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { plugins, unmetNeeds } from '../core/plugins.js';
import { bus } from '../core/bus.js';
import { settingsDialog } from './plugins.js';

export default {
  async mount(el, ctx) {
    const id = ctx.params?.plugin;
    if (!id || !plugins.isInstalled(id)) { el.append(h('div.empty', 'This plugin isn\'t installed.', h('div', h('button.btn.sm', { style: 'margin-top:8px', onclick: () => bus.emit('open', { id: 'plugins' }) }, 'Open the plugin store')))); return; }
    const p = await plugins.activate(id);
    const why = unmetNeeds(p);
    if (why) el.append(h('div.item', { style: 'margin-bottom:12px' }, icon('alert'), h('span.grow.small', `${p.name} ${why}. Some features won't work here.`)));
    if (p.settings?.length) ctx.setActions(h('button.btn.ghost.sm', { onclick: () => settingsDialog(p) }, icon('settings'), 'Settings'));
    if (!p.panel) { el.append(h('div.empty', `${p.name} works in the background (commands and assistant tools). It has no window.`)); return; }
    try { return await p.panel(el, p.api); }
    catch (e) { console.error(e); el.append(h('div.empty', `${p.name} failed to open: ${e.message}`)); }
  },
};
