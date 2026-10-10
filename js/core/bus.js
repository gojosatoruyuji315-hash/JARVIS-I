/**
 * Tiny pub/sub event bus used for decoupled communication between modules.
 * Common events:
 *   'store:change' {path}      'plan:change' {plan}     'voice:state' {state}
 *   'hud:state' {state}        'ai:usage' {count}       'module:open' {id}
 * @module core/bus
 */
const listeners = new Map();
export const bus = {
  on(evt, fn) { (listeners.get(evt) ?? listeners.set(evt, new Set()).get(evt)).add(fn); return () => this.off(evt, fn); },
  off(evt, fn) { listeners.get(evt)?.delete(fn); },
  once(evt, fn) { const off = this.on(evt, (d) => { off(); fn(d); }); return off; },
  emit(evt, data) { for (const fn of [...(listeners.get(evt) ?? [])]) { try { fn(data); } catch (e) { console.error(`[bus] ${evt}`, e); } } },
};
