/**
 * Global keyboard shortcuts (user-rebindable; stored in settings.shortcuts).
 * Browsers reserve some combos (Ctrl+N / Ctrl+T in Chrome), so each action
 * also has an Alt+ fallback.
 * @module core/shortcuts
 */
import { store } from './store.js';

export const DEFAULT_SHORTCUTS = {
  voice:     { label: 'Push-to-talk (hold)', keys: ['Space'] },
  search:    { label: 'Smart search', keys: ['Ctrl+K'] },
  palette:   { label: 'Command palette', keys: ['Ctrl+P', 'Ctrl+Shift+P'] },
  memory:    { label: 'Memory', keys: ['Ctrl+M', 'Alt+M'] },
  notes:     { label: 'Notes', keys: ['Ctrl+N', 'Alt+N'] },
  tasks:     { label: 'Tasks', keys: ['Ctrl+T', 'Alt+T'] },
  close:     { label: 'Close window / dialog', keys: ['Escape'] },
  home:      { label: 'Home dashboard', keys: ['Alt+H'] },
  assistant: { label: 'Assistant chat', keys: ['Alt+A'] },
  settings:  { label: 'Settings', keys: ['Ctrl+,', 'Alt+S'] },
  music:     { label: 'Play / pause music', keys: ['Alt+P'] },
  nextTrack: { label: 'Next track', keys: ['Alt+ArrowRight'] },
  lock:      { label: 'Lock', keys: ['Alt+L'] },
};

export function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && e.key.length > 1) parts.push('Shift');
  else if (e.shiftKey && /^[a-z]$/i.test(e.key)) parts.push('Shift');
  let k = e.key === ' ' ? 'Space' : e.key;
  if (k.length === 1) k = k.toUpperCase();
  // Alt on macOS changes e.key; use e.code for letters
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return parts.join('+');
  parts.push(k);
  return parts.join('+');
}

export function getShortcuts() {
  const custom = store.get('settings.shortcuts') || {};
  return Object.fromEntries(Object.entries(DEFAULT_SHORTCUTS).map(([id, d]) => [id, { ...d, keys: custom[id] ?? d.keys }]));
}

const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * Install listeners. handlers: { [action]: (phase: 'down'|'up') => void }
 */
export function installShortcuts(handlers) {
  let voiceHeld = false;
  addEventListener('keydown', (e) => {
    const combo = comboFromEvent(e);
    const map = getShortcuts();
    for (const [id, sc] of Object.entries(map)) {
      if (!sc.keys.includes(combo)) continue;
      const typing = isTyping(e.target);
      // Plain keys (Space) only fire outside text fields; Ctrl/Alt combos fire everywhere; Escape always.
      if (typing && !/^(Ctrl|Alt)\+/.test(combo) && combo !== 'Escape') return;
      if (combo === 'Space' && e.target.closest?.('button,a,[role="button"],summary,label')) return; // let Space activate focused controls
      if (id === 'voice') { if (e.repeat || voiceHeld) { e.preventDefault(); return; } voiceHeld = true; }
      e.preventDefault();
      handlers[id]?.('down', e);
      return;
    }
  });
  addEventListener('keyup', (e) => {
    if (voiceHeld && (e.key === ' ' || e.code === 'Space')) { voiceHeld = false; handlers.voice?.('up', e); }
  });
}
