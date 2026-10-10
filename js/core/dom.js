/**
 * DOM utilities: element factory, overlays (toast / modal / dialogs),
 * formatting helpers and small functional utilities shared by all modules.
 * @module core/dom
 */
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Hyperscript-style element factory.
 *   h('button.btn.primary', { onclick: fn, title: 'Go' }, 'Launch')
 * - `tag` may include `.class` and `#id` shorthands.
 * - attrs: `class`, `style` (string|object), `on<event>` handlers, `dataset`, `html` (trusted markup only!),
 *   boolean attributes, anything else -> setAttribute.
 * - children: strings, numbers, Nodes, arrays (flattened), null/false ignored.
 */
export function h(tag, attrs = {}, ...children) {
  if (attrs instanceof Node || typeof attrs === 'string' || Array.isArray(attrs)) { children.unshift(attrs); attrs = {}; }
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  rest.replace(/([.#])([\w-]+)/g, (_, t, v) => { t === '.' ? el.classList.add(v) : (el.id = v); });
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style') typeof v === 'string' ? (el.style.cssText = v) : Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
/**
 * Remove all children. Returns a proxy of the element whose append() also
 * accepts (nested) arrays, so `clear(el).append(list.map(...))` works.
 */
export const clear = (el) => {
  while (el.firstChild) el.firstChild.remove();
  return new Proxy(el, { get: (t, k) => (k === 'append' ? (...c) => append(t, c) : typeof t[k] === 'function' ? t[k].bind(t) : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
};

/** Escape text for safe insertion into HTML strings. */
export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const throttle = (fn, ms = 100) => { let last = 0; return (...a) => { const n = Date.now(); if (n - last >= ms) { last = n; fn(...a); } }; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fmt = {
  time: (d = new Date(), sec = false) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}) }),
  date: (d = new Date(), opts = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(d).toLocaleDateString([], opts),
  dt: (d) => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  bytes: (n = 0) => { const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; },
  dur: (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return (h ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; },
  rel: (ts) => {
    const d = (Date.now() - ts) / 1000, a = Math.abs(d), sfx = d >= 0 ? ' ago' : '';
    const pre = d < 0 ? 'in ' : '';
    if (a < 60) return d >= 0 ? 'just now' : 'in <1 min';
    if (a < 3600) return `${pre}${Math.round(a / 60)} min${sfx}`;
    if (a < 86400) return `${pre}${Math.round(a / 3600)} h${sfx}`;
    return `${pre}${Math.round(a / 86400)} d${sfx}`;
  },
  money: (n, cur = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n),
};

/* ---------------------------------------------------------------- toasts */
export function toast(message, { type = 'info', timeout = 3600, action } = {}) {
  const host = $('#jx-toasts');
  const t = h('div.toast', { class: type }, h('div', { style: 'flex:1;min-width:0' }, message));
  if (action) t.append(h('button.btn.sm', { onclick: () => { action.run(); t.remove(); } }, action.label));
  t.append(h('button.btn.ghost.sm.icon', { 'aria-label': 'Dismiss', onclick: () => t.remove() }, icon('x')));
  host.append(t);
  if (timeout) setTimeout(() => t.remove(), timeout);
  return t;
}

/** Screen-reader announcement. */
export function announce(msg) { const a = $('#jx-announcer'); if (a) { a.textContent = ''; setTimeout(() => (a.textContent = msg), 30); } }

/* ----------------------------------------------------------------- modal */
const modalStack = [];
/**
 * Open a modal dialog. Returns { el, close }.
 * actions: [{ label, kind: 'primary'|'danger'|'ghost'|'gold', onClick(close) }]
 */
export function modal({ title, body, actions = [], wide = false, onClose, titleIcon, dismissable = true } = {}) {
  const prevFocus = document.activeElement;
  const close = (result) => {
    back.remove(); modalStack.splice(modalStack.indexOf(api), 1);
    onClose?.(result); prevFocus?.focus?.();
  };
  const box = h('div.modal.glass', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog', class: wide ? 'wide' : '' },
    title && h('h3', titleIcon && icon(titleIcon), title),
    body instanceof Node ? body : h('div.small.dim', body ?? ''),
    actions.length && h('div.modal-actions', actions.map((a) =>
      h('button.btn', { class: a.kind || '', onclick: () => a.onClick ? a.onClick(close) : close() }, a.icon && icon(a.icon), a.label))),
  );
  const back = h('div.modal-backdrop', { onmousedown: (e) => { if (e.target === back && dismissable) close(); } }, box);
  $('#jx-overlays').append(back);
  const api = { el: box, close, dismissable };
  modalStack.push(api);
  setTimeout(() => (box.querySelector('input,textarea,select,button.primary,button') )?.focus(), 30);
  return api;
}
/** Close the top-most modal. Returns true if one was closed. */
export function closeTopModal() { const m = modalStack.at(-1); if (m && m.dismissable) { m.close(); return true; } return false; }

/** Promise-based confirmation (native confirm() is unavailable in sandboxed frames). */
export function confirmDialog(message, { title = 'Confirm', okLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    modal({ title, body: message, onClose: (r) => resolve(!!r), actions: [
      { label: 'Cancel', kind: 'ghost', onClick: (c) => c(false) },
      { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: (c) => c(true) },
    ] });
  });
}
/** Promise-based text prompt. Resolves to string or null. */
export function promptDialog(title, { value = '', placeholder = '', label = '', multiline = false } = {}) {
  return new Promise((resolve) => {
    const inp = multiline ? h('textarea.textarea', { placeholder }) : h('input.input', { placeholder });
    inp.value = value;
    let m;
    const ok = () => m.close(inp.value.trim());
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) ok(); });
    m = modal({ title, body: h('label.field', label, inp), onClose: (r) => resolve(typeof r === 'string' && r ? r : null),
      actions: [{ label: 'Cancel', kind: 'ghost', onClick: (c) => c(null) }, { label: 'OK', kind: 'primary', onClick: ok }] });
  });
}

/* --------------------------------------------------------- clipboard / IO */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', { type: 'ok', timeout: 1600 }); return true; }
  catch { modal({ title: 'Copy', body: h('textarea.textarea', { readonly: true, style: 'min-height:160px' }, text), actions: [{ label: 'Close' }] }); return false; }
}
/**
 * Save a file for the viewer. Inside a Claude viewer this goes through the
 * `downloads` capability (the viewer confirms); elsewhere a normal download.
 */
export async function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const host = (await import('./platform.js')).platform.host?.downloads;
  if (host) {
    try { await host.save({ filename, data: blob }); toast(`Saved ${filename}`, { type: 'ok', timeout: 2500 }); }
    catch (e) {
      if (e.code === 'declined') return;
      toast(e.code === 'rejected_extension' ? `This viewer can't save .${filename.split('.').pop()} files.` : `Couldn't save the file (${e.code || e.message}).`, { type: 'warn' });
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: 'display:none' });
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    document.body.append(inp); inp.click();
  });
}

/** Tabs helper: returns { el, body, select(id) } */
export function tabs(items, { initial, onChange } = {}) {
  const body = h('div.tab-body');
  const bar = h('div.tabs', { role: 'tablist' });
  const el = h('div.tabbed', bar, body);
  let current;
  const select = (id) => {
    const it = items.find((i) => i.id === id) || items[0];
    current = it.id;
    for (const b of bar.children) b.setAttribute('aria-selected', String(b.dataset.id === it.id));
    clear(body); body.scrollTop = 0;
    const r = it.render(body); if (r instanceof Node) body.append(r);
    onChange?.(it.id);
  };
  for (const it of items) bar.append(h('button.tab', { role: 'tab', dataset: { id: it.id }, onclick: () => select(it.id) }, it.icon && icon(it.icon), it.label, it.badge || null));
  select(initial || items[0].id);
  return { el, body, select, get current() { return current; } };
}

/** Toggle switch component. */
export function toggle(label, checked, onchange, id) {
  const inp = h('input', { type: 'checkbox', id: id || uid('t'), checked: !!checked, onchange: (e) => onchange(e.target.checked) });
  return h('label.switch', inp, h('span.track'), label && h('span', label));
}
