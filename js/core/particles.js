/**
 * Ambient particle field with proximity links and pointer attraction.
 * Pauses when the tab is hidden, caps at ~45 fps, respects reduced motion.
 * @module core/particles
 */
import { store } from './store.js';
import { prefersReducedMotion } from './theme.js';

let canvas, ctx, parts = [], raf, running = false, mouse = { x: -999, y: -999 }, last = 0, color = '42,212,255';

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const density = store.get('settings.particleDensity') ?? 1;
  const n = Math.round(Math.min(110, (innerWidth * innerHeight) / 16000) * density);
  parts = Array.from({ length: n }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, r: Math.random() * 1.6 + 0.3 }));
}
function readColor() {
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (m) color = `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}
function frame(t) {
  raf = requestAnimationFrame(frame);
  if (t - last < 22) return; last = t;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const p of parts) {
    const dx = mouse.x - p.x, dy = mouse.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 < 22000) { p.vx += dx * 0.000012; p.vy += dy * 0.000012; }
    p.x += p.vx; p.y += p.vy; p.vx *= 0.999; p.vy *= 0.999;
    if (p.x < 0 || p.x > innerWidth) p.vx *= -1; if (p.y < 0 || p.y > innerHeight) p.vy *= -1;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fillStyle = `rgba(${color},.7)`; ctx.fill();
  }
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i], b = parts[j], dx = a.x - b.x, dy = a.y - b.y, d = dx * dx + dy * dy;
    if (d < 11000) { ctx.strokeStyle = `rgba(${color},${0.16 * (1 - d / 11000)})`; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }
}

export const particles = {
  init() {
    canvas = document.getElementById('jx-particles'); if (!canvas) return;
    ctx = canvas.getContext('2d');
    addEventListener('resize', () => running && resize());
    addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.sync()));
    this.sync();
  },
  /** Start/stop according to settings. */
  sync() {
    if (!canvas) return;
    const on = store.get('settings.particles') && !prefersReducedMotion() && !document.hidden;
    readColor();
    if (on && !running) { running = true; resize(); raf = requestAnimationFrame(frame); }
    else if (!on) this.stop();
    else resize();
    canvas.hidden = !store.get('settings.particles');
  },
  stop() { running = false; cancelAnimationFrame(raf); ctx?.clearRect(0, 0, innerWidth, innerHeight); },
  refreshColor: readColor,
};
