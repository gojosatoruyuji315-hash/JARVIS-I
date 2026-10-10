/**
 * Background scheduler: reminders, timers, daily routines, renewal reminders,
 * notifications and idle (session-timeout) detection. Ticks every second.
 * @module core/scheduler
 */
import { store } from './store.js';
import { bus } from './bus.js';
import { toast, uid, fmt } from './dom.js';

const timers = new Map(); // id -> { id, label, end, total, paused, remaining }
let lastActivity = Date.now();
let tickHandle;

/** Show a system notification (falls back to an in-app toast). */
export async function notify(title, body = '', { type = 'info' } = {}) {
  try { const { studyMode } = await import('./studymode.js'); if (studyMode.hold(title, body, type)) return; } catch { /* */ }
  if (!store.get('settings.notifications')) return;
  toast(body ? `${title} — ${body}` : title, { type, timeout: 7000 });
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(title, { body, icon: 'assets/icons/logo.svg', tag: 'jx' });
    }
  } catch { /* sandboxed */ }
  if (store.get('settings.sounds')) chime();
}
export async function requestNotificationPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') return await Notification.requestPermission(); return Notification.permission; }
  catch { return 'denied'; }
}

/** Short synthesized chime (no audio files needed). */
export function chime(freq = 880) {
  try {
    const ctx = chime.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.start(); o.stop(ctx.currentTime + 0.65);
    const o2 = ctx.createOscillator(); o2.frequency.value = freq * 1.5; o2.connect(g); o2.start(ctx.currentTime + 0.12); o2.stop(ctx.currentTime + 0.65);
  } catch { /* audio blocked until user gesture */ }
}

/* ----------------------------------------------------------------- timers */
export const timerService = {
  list: () => [...timers.values()],
  start(ms, label = 'Timer') {
    const id = uid('tm'); timers.set(id, { id, label, total: ms, end: Date.now() + ms, paused: false, remaining: ms });
    bus.emit('timers:change'); return id;
  },
  pause(id) { const t = timers.get(id); if (t && !t.paused) { t.paused = true; t.remaining = t.end - Date.now(); bus.emit('timers:change'); } },
  resume(id) { const t = timers.get(id); if (t?.paused) { t.paused = false; t.end = Date.now() + t.remaining; bus.emit('timers:change'); } },
  cancel(id) { timers.delete(id); bus.emit('timers:change'); },
  remaining(t) { return t.paused ? t.remaining : Math.max(0, t.end - Date.now()); },
};

/* -------------------------------------------------------------- reminders */
export function addReminder(text, at, repeat = null) {
  return store.push('reminders', { id: uid('rm'), text, at, repeat, done: false, created: Date.now() });
}

function tick() {
  const now = Date.now();
  // timers
  for (const t of timers.values()) if (!t.paused && t.end <= now) { timers.delete(t.id); notify('Timer finished', t.label, { type: 'ok' }); bus.emit('timers:change'); }
  // reminders
  const due = store.get('reminders').filter((r) => !r.done && r.at <= now);
  if (due.length) {
    for (const r of due) {
      notify('Reminder', r.text, { type: 'warn' });
      bus.emit('voice:say', { text: `Reminder: ${r.text}` });
      if (r.repeat === 'daily') store.patchById('reminders', r.id, { at: r.at + 864e5 });
      else if (r.repeat === 'weekly') store.patchById('reminders', r.id, { at: r.at + 7 * 864e5 });
      else store.patchById('reminders', r.id, { done: true });
    }
  }
  // daily routines (once per minute boundary)
  const d = new Date(now);
  if (d.getSeconds() === 0) {
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    for (const r of store.get('automation.routines')) {
      if (r.enabled && r.trigger?.type === 'daily' && r.trigger.time === hhmm) bus.emit('routine:run', { id: r.id });
    }
  }
  // session timeout
  const sec = store.get('settings.security');
  if (sec.lockEnabled && sec.timeoutMin > 0 && now - lastActivity > sec.timeoutMin * 60000 && !document.querySelector('.lock')) {
    bus.emit('system', { cmd: 'lock', reason: 'timeout' });
  }
  bus.emit('tick', now);
}

export function startScheduler() {
  if (tickHandle) return;
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true });
  tickHandle = setInterval(tick, 1000);
}
export const markActivity = () => { lastActivity = Date.now(); };
export const describeTime = (ts) => `${fmt.dt(ts)} (${fmt.rel(ts)})`;
