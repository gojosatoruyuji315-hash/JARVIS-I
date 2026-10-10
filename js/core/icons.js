/**
 * Original line-icon set (24×24, stroke = currentColor).
 * Usage: icon('mic') -> <svg>. Add icons by appending path data below.
 * @module core/icons
 */
const P = {
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  chat: 'M4 5h16v11H9l-5 4z',
  mic: 'M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  book: 'M4 4h6a2 2 0 012 2v14a2 2 0 00-2-2H4zM20 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  brain: 'M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 1V5a2 2 0 00-3-1zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 1',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  folder: 'M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12l2-1-1-3-2 .3-1.4-1.4L17 5l-3-1-1 2h-2L10 4 7 5l.4 2L6 8.3 4 8l-1 3 2 1v0l-2 1 1 3 2-.3 1.4 1.4L7 19l3 1 1-2h2l1 2 3-1-.4-2 1.4-1.4 2 .4 1-3z',
  crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M16 4a4 4 0 010 7M22 21a7 7 0 00-4-6',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 017.5-2',
  power: 'M12 3v9M6.3 6.3a8 8 0 1011.4 0',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  check: 'M5 12l5 5L20 7',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h4v16H7zM14 4h4v16h-4z',
  stop: 'M6 6h12v12H6z',
  next: 'M5 4l10 8-10 8zM19 4v16',
  prev: 'M19 4L9 12l10 8zM5 4v16',
  volume: 'M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 010 6M19.5 6.5a8 8 0 010 11',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  cloud: 'M7 18a5 5 0 01-.6-10A6 6 0 0118 9a4.5 4.5 0 01-.5 9z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  rain: 'M7 15a5 5 0 01-.6-10A6 6 0 0118 6a4.5 4.5 0 01-.5 9zM8 18l-1 3M12 18l-1 3M16 18l-1 3',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  note: 'M5 3h10l4 4v14H5zM15 3v4h4M8 12h8M8 16h6',
  battery: 'M3 8h15v8H3zM21 11v2M5 10h6v4H5z',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
  chip: 'M4 8h16v8H4zM7 8v8M11 8v8M15 8v8M7 5v3M17 5v3M7 16v3M17 16v3',
  wifi: 'M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01',
  pin: 'M12 22s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12zM12 7a3 3 0 100 6 3 3 0 000-6z',
  news: 'M4 5h13v14H6a2 2 0 01-2-2zM17 9h3v8a2 2 0 01-2 2M7 9h7M7 13h7M7 16h4',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8M20 16v-3',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  timer: 'M12 6a8 8 0 100 16 8 8 0 000-16zM12 10v4l2 2M9 2h6',
  calc: 'M6 3h12v18H6zM8 6h8v3H8zM8 12h2M12 12h2M16 12v0M8 15h2M12 15h2M8 18h2M12 18h2M16 15v3',
  rocket: 'M14 4c3-1 6 0 6 0s1 3 0 6l-7 7-6-6zM7 11l-3 1 2 3M13 17l-1 3-3-2M15 9a1 1 0 100-.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  send: 'M4 12l16-8-6 16-3-7z',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  upload: 'M12 20V8M7 13l5-5 5 5M4 4h16',
  refresh: 'M20 11a8 8 0 10-2 6M20 4v7h-7',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3z',
  file: 'M6 3h9l4 4v14H6zM15 3v4h4',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  key: 'M14 4a6 6 0 11-5 9.3L3 20v1h4v-2h2v-2h2l1.7-1.7A6 6 0 0114 4zM16 8h.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  eyeoff: 'M3 3l18 18M10.6 6.1A10 10 0 0112 6c6 0 10 6 10 6a17 17 0 01-3 3.7M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9 9 0 004.3-1.1',
  bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4',
  clipboard: 'M9 4h6v3H9zM7 5H5v16h14V5h-2',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  keyboard: 'M3 6h18v12H3zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10',
  palette: 'M12 3a9 9 0 000 18c1.5 0 2-1 2-2s-1-2 0-3 2 0 3 0a4 4 0 004-4c0-5-4-9-9-9zM7.5 11h.01M10 7h.01M15 7h.01',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7a5 5 0 100 10 5 5 0 000-10zM12 11a1 1 0 100 2 1 1 0 000-2z',
  plug: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 01-12 0zM12 17v5',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  terminal: 'M3 5h18v14H3zM7 9l3 3-3 3M12 15h5',
  sticky: 'M4 4h16v10l-6 6H4zM14 20v-6h6',
  fingerprint: 'M12 11v4M8 9a4 4 0 018 0v5a8 8 0 01-1 4M5 12a7 7 0 0114 0M9 13v2a6 6 0 001 3.5',
  device: 'M7 2h10v20H7zM11 18h2',
  link: 'M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1',
  translate: 'M4 5h8M8 3v2M5 9c1.5 3 4 5 6 6M11 5c-1 4-3 7-6 9M13 21l4-10 4 10M14.5 17h5',
  wand: 'M4 20L16 8M14 4v2M18 6h2M18 10v2M10 6H8',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 018-3 4.5 4.5 0 018 3c0 6-8 11-8 11z',
  dollar: 'M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  gamepad: 'M6 8h12a4 4 0 014 4v2a3 3 0 01-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 012 14v-2a4 4 0 014-4zM7 10v4M5 12h4M15.5 11h.01M17.5 13h.01',
  hud: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6a6 6 0 100 12 6 6 0 000-12zM12 10a2 2 0 100 4 2 2 0 000-4z',
};

/** Create an SVG icon element. */
export function icon(name, { size, cls = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  // Default intrinsic size; CSS rules (e.g. .btn svg) override it.
  svg.setAttribute('width', size || 18); svg.setAttribute('height', size || 18);
  if (size) { svg.style.width = svg.style.height = size + 'px'; }
  svg.style.flex = 'none';
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || P.sparkles);
  svg.append(p);
  return svg;
}
export const iconNames = Object.keys(P);

/** Brand mark: concentric ring emblem (original). Returns SVG markup string. */
export const logoSVG = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><defs><radialGradient id="lg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="var(--fg)"/><stop offset=".45" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)" stop-opacity="0"/></radialGradient></defs><circle cx="16" cy="16" r="14" fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="20 4 6 4"/><circle cx="16" cy="16" r="9.5" fill="none" stroke="var(--accent-2)" stroke-width="2.4" stroke-dasharray="3 2.2"/><circle cx="16" cy="16" r="5" fill="url(#lg)"/></svg>`;
