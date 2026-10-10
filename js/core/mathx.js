/**
 * Safe math evaluation (no eval), equation solving and unit / currency conversion.
 * @module core/mathx
 */

const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: (x) => Math.sin(x), cos: (x) => Math.cos(x), tan: (x) => Math.tan(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan, log: Math.log10, ln: Math.log, exp: Math.exp,
};
const CONSTS = { pi: Math.PI, π: Math.PI, e: Math.E, tau: Math.PI * 2 };

function tokenize(src) {
  const t = []; let i = 0;
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if (num) { t.push({ type: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = s.slice(i).match(/^[a-zπ]+/i);
    if (id) { t.push({ type: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    if ('+-*/^%(),!'.includes(c)) { t.push({ type: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return t;
}

/** Recursive-descent parser. vars: { x: 2 } */
export function evaluate(expr, vars = {}) {
  const t = tokenize(String(expr)); let p = 0;
  const peek = () => t[p], next = () => t[p++];
  const expect = (v) => { if (next()?.v !== v) throw new Error(`Expected "${v}"`); };
  function primary() {
    const tk = next(); if (!tk) throw new Error('Incomplete expression');
    if (tk.type === 'num') return tk.v;
    if (tk.v === '(') { const v = add(); expect(')'); return v; }
    if (tk.v === '-') return -unary();
    if (tk.v === '+') return unary();
    if (tk.type === 'id') {
      if (tk.v in vars) return vars[tk.v];
      if (tk.v in CONSTS) return CONSTS[tk.v];
      if (tk.v in FUNCS) { expect('('); const a = add(); expect(')'); return FUNCS[tk.v](a); }
      throw new Error(`Unknown name "${tk.v}"`);
    }
    throw new Error(`Unexpected "${tk.v}"`);
  }
  function postfix() {
    let v = primary();
    while (peek()?.v === '!' || peek()?.v === '%') {
      const op = next().v;
      if (op === '!') { if (v < 0 || v > 170 || v % 1) throw new Error('Bad factorial'); let r = 1; for (let i = 2; i <= v; i++) r *= i; v = r; }
      else if (peek() && (peek().type === 'num' || peek().v === '(' || peek().type === 'id')) { p--; break; } // modulo, handled in mul
      else v = v / 100;
    }
    return v;
  }
  function implicit() { // implicit multiplication: 2x, 3(4), 2pi
    let v = postfix();
    while (peek() && (peek().type === 'id' || peek().v === '(')) {
      let r = postfix();
      if (peek()?.v === '^') { next(); r = Math.pow(r, pow()); } // 5x^2 = 5·(x^2)
      v *= r;
    }
    return v;
  }
  function unary() { return implicit(); }
  function pow() { const b = unary(); if (peek()?.v === '^') { next(); return Math.pow(b, pow()); } return b; }
  function mul() { let v = pow(); while (['*', '/', '%'].includes(peek()?.v)) { const op = next().v; const r = pow(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; } return v; }
  function add() { let v = mul(); while (['+', '-'].includes(peek()?.v)) { const op = next().v; const r = mul(); v = op === '+' ? v + r : v - r; } return v; }
  const v = add();
  if (p < t.length) throw new Error(`Unexpected "${t[p].v}"`);
  return v;
}

/** Try to evaluate; returns number or null. Rejects plain numbers & words. */
export function tryCalc(text) {
  const s = String(text).trim().replace(/^(what is|what's|calculate|calc|compute|=)\s*/i, '').replace(/\?$/, '');
  if (!/[\d)]\s*[-+*/^%!×÷]|\b(sqrt|sin|cos|tan|log|ln|pi)\b/i.test(s)) return null;
  if (/[a-z]{4,}/i.test(s.replace(/\b(sqrt|cbrt|sin|cos|tan|asin|acos|atan|log|ln|exp|abs|round|floor|ceil|tau)\b/gi, ''))) return null;
  try { const v = evaluate(s); return Number.isFinite(v) ? { expr: s, value: +v.toPrecision(12) } : null; } catch { return null; }
}

/**
 * Solve a single-variable linear or quadratic equation, e.g. "2x + 3 = 11", "x^2 - 5x + 6 = 0".
 * Fits a polynomial through samples of f(x) = lhs - rhs, verifies the fit.
 */
export function solveEquation(text) {
  const m = String(text).match(/([^=]+)=([^=]+)/); if (!m) return null;
  const varName = (m[0].match(/\b([a-z])\b/i) || m[0].match(/([a-z])(?![a-z])/i))?.[1]?.toLowerCase();
  if (!varName) return null;
  const f = (x) => evaluate(m[1], { [varName]: x }) - evaluate(m[2], { [varName]: x });
  try {
    const c = f(0), f1 = f(1), fm1 = f(-1);
    const a = (f1 + fm1) / 2 - c, b = (f1 - fm1) / 2;
    const ok = [2, -3, 5.5].every((x) => Math.abs(f(x) - (a * x * x + b * x + c)) < 1e-6 * (1 + Math.abs(f(x))));
    if (!ok) return null;
    const r = (v) => +v.toPrecision(10);
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) < 1e-12) return { var: varName, steps: [], solutions: [], note: c === 0 ? 'Every value is a solution.' : 'No solution.' };
      const x = -c / b;
      return { var: varName, kind: 'linear', solutions: [r(x)], steps: [`Rearrange to ${r(b)}${varName} + ${r(c)} = 0`, `${varName} = −(${r(c)}) / ${r(b)}`, `${varName} = ${r(x)}`] };
    }
    const D = b * b - 4 * a * c;
    const steps = [`Standard form: ${r(a)}${varName}² + ${r(b)}${varName} + ${r(c)} = 0`, `Discriminant D = b² − 4ac = ${r(D)}`];
    if (D < 0) { const re = -b / (2 * a), im = Math.sqrt(-D) / (2 * a); return { var: varName, kind: 'quadratic', solutions: [`${r(re)} + ${r(Math.abs(im))}i`, `${r(re)} − ${r(Math.abs(im))}i`], steps: [...steps, 'D < 0, so the roots are complex.'] }; }
    const x1 = (-b + Math.sqrt(D)) / (2 * a), x2 = (-b - Math.sqrt(D)) / (2 * a);
    return { var: varName, kind: 'quadratic', solutions: D === 0 ? [r(x1)] : [r(x1), r(x2)], steps: [...steps, `${varName} = (−b ± √D) / 2a`] };
  } catch { return null; }
}

/* ------------------------------------------------------------- conversion */
const UNITS = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, mile: 1609.344, miles: 1609.344, yd: 0.9144, ft: 0.3048, feet: 0.3048, foot: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254, nm: 1852 },
  mass: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237, oz: 0.028349523, t: 1000, ton: 1000 },
  volume: { l: 1, liter: 1, liters: 1, ml: 0.001, gal: 3.785411784, gallon: 3.785411784, gallons: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, cups: 0.2365882365, floz: 0.0295735 },
  time: { s: 1, sec: 1, min: 60, h: 3600, hr: 3600, hour: 3600, hours: 3600, day: 86400, days: 86400, week: 604800, weeks: 604800, year: 31557600, years: 31557600 },
  data: { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1048576, gib: 1073741824 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, kph: 1 / 3.6, mph: 0.44704, knot: 0.514444, knots: 0.514444 },
  area: { m2: 1, km2: 1e6, ha: 1e4, acre: 4046.8564224, acres: 4046.8564224, ft2: 0.09290304, sqft: 0.09290304 },
};
/**
 * Exchange rates (USD base). Refreshed from the ECB via the JARVIS-X server or
 * Frankfurter directly; the last good set is cached on this device. Until the
 * first refresh succeeds no currency conversion is offered.
 */
export const FX = {};
export let FX_NOTE = '';
function setFX(j) {
  if (!j?.rates) return false;
  const base = j.base || 'USD'; const toUsd = base === 'USD' ? 1 : 1 / (j.rates.USD || 1);
  for (const [k, v] of Object.entries(j.rates)) FX[k] = v * toUsd; FX.USD = 1;
  FX_NOTE = `Rates from ${j.source || 'European Central Bank'}${j.date ? `, ${String(j.date).slice(0, 16)}` : ''}.`;
  return true;
}
try { setFX(JSON.parse(localStorage.getItem('jx.fx') || 'null')); } catch { /* none cached */ }
export async function refreshFX({ server = false, network = true } = {}) {
  if (!network) return false;
  const sources = [...(server ? ['api/data/fx?base=USD'] : []), 'https://api.frankfurter.app/latest?from=USD'];
  for (const url of sources) {
    try {
      let j;
      if (url.startsWith('api/')) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) continue; j = await r.json(); }
      else { const { getJSON } = await import('./net.js'); j = await getJSON(url); } const data = j.rates ? { base: j.base || 'USD', date: j.date, rates: { ...j.rates, USD: 1 }, source: j.source || 'European Central Bank (Frankfurter)' } : null;
      if (setFX(data)) { try { localStorage.setItem('jx.fx', JSON.stringify(data)); } catch { /* */ } return true; }
    } catch { /* try next */ }
  }
  return false;
}

export function convert(value, from, to) {
  const f = from.toLowerCase(), t = to.toLowerCase();
  const F = from.toUpperCase(), T = to.toUpperCase();
  if (FX[F] && FX[T]) return { value: +(value / FX[F] * FX[T]).toFixed(2), unit: T, kind: 'currency', note: FX_NOTE };
  const temp = { c: 'c', celsius: 'c', f: 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };
  if (temp[f] && temp[t]) {
    const toC = { c: (v) => v, f: (v) => (v - 32) * 5 / 9, k: (v) => v - 273.15 }[temp[f]](value);
    const out = { c: (v) => v, f: (v) => v * 9 / 5 + 32, k: (v) => v + 273.15 }[temp[t]](toC);
    return { value: +out.toFixed(2), unit: '°' + temp[t].toUpperCase(), kind: 'temperature' };
  }
  for (const [kind, tbl] of Object.entries(UNITS)) {
    if (tbl[f] != null && tbl[t] != null) return { value: +((value * tbl[f]) / tbl[t]).toPrecision(8), unit: to, kind };
  }
  return null;
}
/** Parse "10 km to miles", "100 usd in inr", "convert 5 lb to kg". */
export function tryConvert(text) {
  const m = String(text).trim().match(/^(?:convert\s+)?(-?[\d.,]+)\s*([a-z°/²0-9]+)\s+(?:to|in|into)\s+([a-z°/²0-9]+)\??$/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  const r = convert(v, m[2].replace('°', ''), m[3].replace('°', ''));
  return r ? { from: `${v} ${m[2]}`, ...r } : null;
}
