/**
 * Holographic HUD core (SVG). Variants: classic | reactor | minimal | prime.
 * State is driven by bus 'hud:state' → idle | listening | thinking | speaking.
 * @module core/hud
 */
import { bus } from './bus.js';
import { h } from './dom.js';

const STATE_LABEL = { idle: 'STANDBY', listening: 'LISTENING', thinking: 'PROCESSING', speaking: 'SPEAKING', locked: 'SECURED' };

function ticks(r1, r2, every = 5) {
  let s = '';
  for (let a = 0; a < 360; a += every) {
    const long = a % 30 === 0; const rad = (a * Math.PI) / 180;
    const ri = long ? r1 - 6 : r1;
    s += `<line x1="${200 + ri * Math.cos(rad)}" y1="${200 + ri * Math.sin(rad)}" x2="${200 + r2 * Math.cos(rad)}" y2="${200 + r2 * Math.sin(rad)}" stroke-width="${long ? 2 : 1}"/>`;
  }
  return s;
}
function segments(r, n, gap = 4) {
  const c = 2 * Math.PI * r; const seg = c / n - gap;
  return `<circle class="ring r4" cx="200" cy="200" r="${r}" stroke-width="8" stroke-dasharray="${seg} ${gap}" style="opacity:.35"/>`;
}

export function hudSVG(variant = 'classic', label = 'JX') {
  const prime = variant === 'prime';
  const minimal = variant === 'minimal';
  const C = 2 * Math.PI * 128;
  return `<svg viewBox="0 0 400 400" role="img" aria-label="JARVIS-X core">
  <defs>
    <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="var(--fg)" stop-opacity=".95"/>
      <stop offset=".35" stop-color="${prime ? 'var(--gold)' : 'var(--accent)'}" stop-opacity=".8"/>
      <stop offset=".75" stop-color="var(--accent-2)" stop-opacity=".25"/>
      <stop offset="1" stop-color="var(--accent-2)" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle class="ring r1" cx="200" cy="200" r="190" ${prime ? 'style="stroke:var(--gold)"' : ''}/>
  ${minimal ? '' : '<circle class="ring r2" cx="200" cy="200" r="172"/>'}
  ${minimal ? '' : `<g class="ticks">${ticks(164, 156)}</g>`}
  <circle class="ring r3" cx="200" cy="200" r="145" ${prime ? 'style="stroke:var(--gold)"' : ''}/>
  <circle class="level" cx="200" cy="200" r="128" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 200 200)"/>
  ${minimal ? '' : '<circle class="ring r4" cx="200" cy="200" r="112"/>'}
  ${variant === 'reactor' || prime ? segments(88, 12) : ''}
  <circle class="ring r5" cx="200" cy="200" r="100"/>
  <circle class="core-glow" cx="200" cy="200" r="72"/>
  <text class="core-label" x="200" y="206">${label}</text>
  <text class="core-state" x="200" y="236">STANDBY</text>
</svg>`;
}

/** Create a live HUD element bound to the bus. */
export function createHUD({ variant = 'classic', onClick, size } = {}) {
  const el = h('div.hud', { html: hudSVG(variant), tabindex: 0, role: 'button', 'aria-label': 'Activate voice assistant', onclick: onClick, onkeydown: (e) => { if (e.key === 'Enter') onClick?.(); } });
  if (size) el.style.width = size;
  const stateText = el.querySelector('.core-state');
  const level = el.querySelector('.level');
  const C = 2 * Math.PI * 128;
  const setState = ({ state }) => {
    el.classList.remove('listening', 'thinking', 'speaking');
    if (state && state !== 'idle') el.classList.add(state);
    stateText.textContent = STATE_LABEL[state] || 'STANDBY';
  };
  const setLevel = (v) => level.setAttribute('stroke-dashoffset', String(C * (1 - Math.max(0, Math.min(1, v)))));
  const offs = [bus.on('hud:state', setState), bus.on('hud:level', setLevel)];
  el.destroy = () => offs.forEach((o) => o());
  el.setLevel = setLevel; el.setState = setState;
  return el;
}
