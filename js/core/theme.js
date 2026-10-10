/**
 * Applies appearance & accessibility settings to the document.
 * @module core/theme
 */
import { store } from './store.js';

export const SKINS = [
  { id: 'arc', name: 'Arc Blue', plan: 'free', colors: ['#03070d', '#1e7bff', '#2ad4ff', '#dff4ff'] },
  { id: 'silver', name: 'Midnight Silver', plan: 'free', colors: ['#07090c', '#7f9bb3', '#d6e2ec', '#eef2f5'] },
  { id: 'daylight', name: 'Daylight Lab', plan: 'free', colors: ['#e9f1f6', '#0a4fd6', '#0077c8', '#0b2233'] },
  { id: 'aurum', name: 'Aurum', plan: 'pro', feature: 'themes.premium', colors: ['#07080d', '#3d8bff', '#f5c76b', '#fff6e3'] },
  { id: 'nebula', name: 'Nebula', plan: 'pro', feature: 'themes.premium', colors: ['#05040f', '#8a5cff', '#7ee8ff', '#ece8ff'] },
  { id: 'obsidian', name: 'Obsidian Prime', plan: 'master', feature: 'themes.exclusive', colors: ['#000000', '#2ad4ff', '#f5c76b', '#f4f4f6'] },
];
export const FONTS = {
  plex: { label: 'Plex (default)', body: '"IBM Plex Sans", system-ui, sans-serif' },
  system: { label: 'System UI', body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  mono: { label: 'Monospace', body: '"JetBrains Mono", ui-monospace, monospace' },
  dyslexic: { label: 'Readable (wide spacing)', body: 'Verdana, Tahoma, sans-serif', extra: 'letter-spacing:.03em;word-spacing:.12em' },
};
export const HUDS = [
  { id: 'classic', name: 'Classic rings', plan: 'free' },
  { id: 'reactor', name: 'Reactor (dense)', plan: 'pro', feature: 'hud.premium' },
  { id: 'minimal', name: 'Minimal', plan: 'free' },
  { id: 'prime', name: 'Prime (gold halo)', plan: 'master', feature: 'themes.exclusive' },
];

export function applyTheme() {
  const s = store.get('settings');
  const root = document.documentElement;
  const skin = SKINS.find((k) => k.id === s.skin);
  // Fall back if a premium skin is no longer included in the plan
  root.dataset.skin = skin ? skin.id : 'arc';
  if (s.accent) { root.style.setProperty('--accent', s.accent); } else root.style.removeProperty('--accent');
  root.style.setProperty('--font-scale', s.fontScale);
  const font = FONTS[s.font] || FONTS.plex;
  root.style.setProperty('--font-body', font.body);
  document.body.style.cssText = font.extra || '';
  root.classList.toggle('hc', !!s.highContrast);
  const reduce = s.motion === 'reduced';
  root.classList.toggle('reduce-motion', reduce);
  root.classList.toggle('force-motion', s.motion === 'full');
  root.style.setProperty('--speed', reduce ? 0 : 1);
  root.lang = s.language || 'en';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || '#03070d';
}

export const prefersReducedMotion = () => {
  const m = store.get('settings.motion');
  if (m === 'reduced') return true; if (m === 'full') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
};
