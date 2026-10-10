/**
 * Everyday utility plugins: QR Codes, Text Toolkit, Color Palette,
 * World Clock & Meeting Planner, Finance Calculators, Fun & Random.
 */

/* ------------------------------------------------------------------ QR codes */
let qrLib;
const loadQr = () => qrLib ||= new Promise((res, rej) => { if (window.qrcode) return res(window.qrcode); const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; s.onload = () => res(window.qrcode); s.onerror = () => rej(new Error('Could not load the QR library (offline?).')); document.head.append(s); });
export const qr = {
  id: 'qr-codes', name: 'QR Codes', version: '1.0.0', author: 'JARVIS-X',
  icon: 'grid', category: 'Utilities', needs: [],
  description: 'Make QR codes for links, text, Wi-Fi logins, UPI payments and contacts — download as PNG or SVG. Scan QR codes from images too.',
  panel(el, api) {
    const { h, icon } = api;
    const kind = h('select.select', { style: 'width:auto' }, [['text', 'Link / text'], ['wifi', 'Wi-Fi'], ['upi', 'UPI payment'], ['vcard', 'Contact card']].map(([v, l]) => h('option', { value: v }, l)));
    const fields = h('div.stack'); const stage = h('div', { style: 'background:#fff;padding:16px;border-radius:12px;justify-self:start;min-width:120px;min-height:120px' }); const status = h('div.small.dim');
    const inp = (ph, v = '') => h('input.input', { placeholder: ph, value: v, oninput: draw });
    let f = {}; let svgText = '';
    const setKind = () => {
      const k = kind.value;
      f = k === 'wifi' ? { ssid: inp('Network name (SSID)'), pass: inp('Password'), sec: h('select.select', { onchange: draw }, ['WPA', 'WEP', 'nopass'].map((x) => h('option', x))) }
        : k === 'upi' ? { pa: inp('UPI ID, e.g. name@okbank'), pn: inp('Payee name'), am: inp('Amount (optional)'), tn: inp('Note (optional)') }
        : k === 'vcard' ? { n: inp('Full name'), tel: inp('Phone'), email: inp('Email'), org: inp('Company (optional)') }
        : { text: h('textarea.textarea', { placeholder: 'https://… or any text', oninput: draw, style: 'min-height:70px' }) };
      fields.replaceChildren(...Object.values(f)); draw();
    };
    async function draw() {
      const v = Object.fromEntries(Object.entries(f).map(([k, e]) => [k, e.value.trim()]));
      const k = kind.value;
      const esc = (s) => s.replace(/([\\;,:"])/g, '\\$1');
      const data = k === 'wifi' ? (v.ssid ? `WIFI:T:${v.sec};S:${esc(v.ssid)};P:${esc(v.pass)};;` : '')
        : k === 'upi' ? (v.pa ? `upi://pay?pa=${encodeURIComponent(v.pa)}&pn=${encodeURIComponent(v.pn)}${v.am ? `&am=${encodeURIComponent(v.am)}&cu=INR` : ''}${v.tn ? `&tn=${encodeURIComponent(v.tn)}` : ''}` : '')
        : k === 'vcard' ? (v.n ? `BEGIN:VCARD\nVERSION:3.0\nFN:${v.n}\nTEL:${v.tel}\nEMAIL:${v.email}\nORG:${v.org}\nEND:VCARD` : '') : v.text;
      if (!data) { stage.replaceChildren(); svgText = ''; return; }
      try { const lib = await loadQr(); const q = lib(0, 'M'); q.addData(unescape(encodeURIComponent(data))); q.make(); svgText = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); stage.innerHTML = svgText; stage.firstChild.style.width = '240px'; status.textContent = ''; }
      catch (e) { status.textContent = e.message; }
    }
    const png = async () => { if (!svgText) return; const img = new Image(); const u = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' })); await new Promise((r) => { img.onload = r; img.src = u; }); const c = document.createElement('canvas'); c.width = c.height = 1024; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1024, 1024); x.drawImage(img, 0, 0, 1024, 1024); URL.revokeObjectURL(u); c.toBlob((b) => api.download('qr-code.png', b)); };
    const scanIn = h('input', { type: 'file', accept: 'image/*', onchange: async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (!('BarcodeDetector' in window)) { status.textContent = 'QR scanning needs Chrome or Edge.'; return; }
      try { const codes = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(await createImageBitmap(file)); status.textContent = codes.length ? `Decoded: ${codes.map((c) => c.rawValue).join(' | ')}` : 'No QR code found in that image.'; }
      catch (err) { status.textContent = err.message; }
    } });
    kind.onchange = setKind;
    el.append(h('div.grid2', { style: 'align-items:start' }, h('div.stack', kind, fields, h('label.small.dim', 'Scan a QR from an image: ', scanIn)), h('div.stack', stage, h('div.row', h('button.btn', { onclick: png }, icon('download'), 'PNG'), h('button.btn', { onclick: () => svgText && api.download('qr-code.svg', new Blob([svgText], { type: 'image/svg+xml' })) }, icon('download'), 'SVG')), status)));
    setKind();
  },
};

/* --------------------------------------------------------------- text tools */
export const textTools = {
  id: 'text-tools', name: 'Text Toolkit', version: '1.0.0', author: 'JARVIS-X',
  icon: 'note', category: 'Utilities', needs: [],
  description: 'Word and character counts, reading time, case conversion, sort and dedupe lines, find & replace with regex, Base64/URL encoding, and a side-by-side diff.',
  panel(el, api) {
    const { h } = api;
    const ta = h('textarea.textarea.mono', { style: 'min-height:200px', placeholder: 'Paste text…', value: api.get('text', '') });
    const stats = h('div.row', { style: 'gap:6px' });
    const upd = () => { const t = ta.value; api.set('text', t); const words = (t.match(/\S+/g) || []).length; stats.replaceChildren(...[['Words', words], ['Characters', t.length], ['No spaces', t.replace(/\s/g, '').length], ['Lines', t ? t.split('\n').length : 0], ['Sentences', (t.match(/[.!?]+(\s|$)/g) || []).length], ['Reading time', `${Math.max(1, Math.round(words / 230))} min`]].map(([k, v]) => h('span.pill', `${k}: ${v}`))); };
    ta.addEventListener('input', upd);
    const T = (fn) => () => { try { ta.value = fn(ta.value); upd(); } catch (e) { api.toast(e.message, { type: 'error' }); } };
    const title = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const ops = [['UPPER', (s) => s.toUpperCase()], ['lower', (s) => s.toLowerCase()], ['Title Case', title], ['Sentence case', (s) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase())], ['camelCase', (s) => s.toLowerCase().replace(/[^a-z0-9]+(.)/g, (m, c) => c.toUpperCase())], ['snake_case', (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')], ['slug', (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')],
      ['Sort lines', (s) => s.split('\n').sort((a, b) => a.localeCompare(b)).join('\n')], ['Remove duplicate lines', (s) => [...new Set(s.split('\n'))].join('\n')], ['Trim spaces', (s) => s.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).join('\n')], ['Remove blank lines', (s) => s.split('\n').filter((l) => l.trim()).join('\n')],
      ['Base64 encode', (s) => btoa(unescape(encodeURIComponent(s)))], ['Base64 decode', (s) => decodeURIComponent(escape(atob(s.trim())))], ['URL encode', encodeURIComponent], ['URL decode', decodeURIComponent], ['Format JSON', (s) => JSON.stringify(JSON.parse(s), null, 2)]];
    const find = h('input.input', { placeholder: 'Find (regex)', style: 'width:180px' }); const rep = h('input.input', { placeholder: 'Replace with', style: 'width:180px' });
    const a = h('textarea.textarea.mono', { placeholder: 'Original', style: 'min-height:120px' }); const b = h('textarea.textarea.mono', { placeholder: 'Changed', style: 'min-height:120px' }); const diff = h('pre.console', { style: 'height:auto;max-height:300px' });
    const runDiff = () => { // line diff via LCS
      const A = a.value.split('\n'), B = b.value.split('\n'); const m = A.length, n = B.length; const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
      for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      const out = []; let i = 0, j = 0;
      while (i < m && j < n) { if (A[i] === B[j]) { out.push(h('div', '  ' + A[i])); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push(h('div', { style: 'color:var(--danger)' }, '- ' + A[i++])); else out.push(h('div', { style: 'color:var(--ok)' }, '+ ' + B[j++])); }
      while (i < m) out.push(h('div', { style: 'color:var(--danger)' }, '- ' + A[i++])); while (j < n) out.push(h('div', { style: 'color:var(--ok)' }, '+ ' + B[j++]));
      diff.replaceChildren(...out);
    };
    el.append(h('div.stack', ta, stats, h('div.row', { style: 'gap:4px' }, ops.map(([l, fn]) => h('button.btn.sm', { onclick: T(fn) }, l))),
      h('div.row', find, rep, h('button.btn.sm', { onclick: T((s) => s.replace(new RegExp(find.value, 'g'), rep.value)) }, 'Replace all'), h('button.btn.ghost.sm', { onclick: () => api.copyText(ta.value) }, 'Copy')),
      h('div.section-title', 'Compare two texts'), h('div.grid2', a, b), h('button.btn.sm', { style: 'justify-self:start', onclick: runDiff }, 'Show differences'), diff));
    upd();
  },
};

/* ------------------------------------------------------------------- colors */
const hsl2hex = (h0, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h0 / 30) % 12; const a = s * Math.min(l, 1 - l); const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); };
const hex2rgb = (x) => { const m = x.replace('#', '').match(/.{2}/g); return m ? m.map((v) => parseInt(v, 16)) : [0, 0, 0]; };
const lum = (x) => { const [r, g, b] = hex2rgb(x).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const colors = {
  id: 'color-palette', name: 'Color Palette', version: '1.0.0', author: 'JARVIS-X',
  icon: 'palette', category: 'Creative', needs: [],
  description: 'Generate harmonious palettes (analogous, complementary, triadic, monochrome), check WCAG contrast, and export CSS variables.',
  panel(el, api) {
    const { h } = api;
    const base = h('input', { type: 'color', value: api.get('base', '#2ad4ff'), 'aria-label': 'Base color' });
    const mode = h('select.select', { style: 'width:auto' }, ['analogous', 'complementary', 'triadic', 'split', 'monochrome'].map((m) => h('option', m)));
    const sw = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px' }); const css = h('pre.console', { style: 'height:auto' });
    const fg = h('input', { type: 'color', value: '#ffffff' }); const bg = h('input', { type: 'color', value: '#0a4fd6' }); const cr = h('div.small');
    const toHsl = (hex) => { let [r, g, b] = hex2rgb(hex).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let hh = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; } return [hh, s * 100, l * 100]; };
    const gen = () => {
      api.set('base', base.value);
      const [H, S, L] = toHsl(base.value);
      const hues = { analogous: [-30, -15, 0, 15, 30], complementary: [0, 0, 180, 180, 0], triadic: [0, 120, 240, 0, 120], split: [0, 150, 210, 0, 150], monochrome: [0, 0, 0, 0, 0] }[mode.value];
      const ls = mode.value === 'monochrome' ? [20, 35, 50, 65, 80] : [L - 15, L, L, L + 10, L + 25].map((x) => Math.max(8, Math.min(92, x)));
      const pal = hues.map((d, i) => hsl2hex((H + d + 360) % 360, S, ls[i]));
      sw.replaceChildren(...pal.map((c) => h('button', { style: `height:110px;border-radius:12px;border:1px solid var(--line);background:${c};color:${contrast(c, '#ffffff') > 4.5 ? '#fff' : '#000'};cursor:pointer;font-family:var(--font-mono)`, onclick: () => api.copyText(c) }, c)));
      css.textContent = `:root {\n${pal.map((c, i) => `  --color-${i + 1}: ${c};`).join('\n')}\n}`;
    };
    const check = () => { const r = contrast(fg.value, bg.value); cr.replaceChildren(h('div', { style: `padding:12px;border-radius:8px;background:${bg.value};color:${fg.value}` }, 'The quick brown fox jumps over the lazy dog.'), h('div', `Contrast ${r.toFixed(2)}:1 — AA normal ${r >= 4.5 ? '✓' : '✗'} · AA large ${r >= 3 ? '✓' : '✗'} · AAA ${r >= 7 ? '✓' : '✗'}`)); };
    base.oninput = gen; mode.onchange = gen; fg.oninput = check; bg.oninput = check;
    el.append(h('div.stack', h('div.row', base, mode, h('button.btn.sm', { onclick: () => { base.value = hsl2hex(Math.random() * 360, 60 + Math.random() * 30, 45 + Math.random() * 15); gen(); } }, 'Random')), sw, css, h('div.section-title', 'Contrast checker'), h('div.row', h('span.small', 'Text'), fg, h('span.small', 'Background'), bg), cr));
    gen(); check();
  },
};

/* --------------------------------------------------------------- world time */
export const worldClock = {
  id: 'world-clock', name: 'World Clock & Meeting Planner', version: '1.0.0', author: 'JARVIS-X',
  icon: 'globe', category: 'Productivity', needs: [],
  description: 'Track cities across time zones and find meeting slots that fall inside everyone\'s working hours.',
  panel(el, api) {
    const { h } = api;
    const zones = () => api.get('zones', [Intl.DateTimeFormat().resolvedOptions().timeZone, 'Europe/London', 'America/New_York']);
    let all = []; try { all = Intl.supportedValuesOf('timeZone'); } catch { all = ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']; }
    const pick = h('input.input', { placeholder: 'Add city or time zone (e.g. Tokyo)', list: 'jx-tz', style: 'max-width:300px' });
    const dl = h('datalist', { id: 'jx-tz' }, all.map((z) => h('option', { value: z })));
    const grid = h('div.stack');
    const hourIn = (tz, d) => +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(d);
    const render = () => {
      const now = new Date(); const start = new Date(now); start.setMinutes(0, 0, 0);
      grid.replaceChildren(...zones().map((tz) => h('div.glass.widget', h('div.row', h('b.grow', tz.split('/').pop().replace(/_/g, ' ')), h('span.mono', now.toLocaleTimeString([], { timeZone: tz, hour: '2-digit', minute: '2-digit' })), h('span.xs.muted', now.toLocaleDateString([], { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })), h('button.btn.ghost.sm', { onclick: () => { api.set('zones', zones().filter((z) => z !== tz)); render(); } }, '✕')),
        h('div', { style: 'display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin-top:6px' }, Array.from({ length: 24 }, (_, i) => { const d = new Date(start.getTime() + i * 36e5); const hr = hourIn(tz, d); const work = hr >= 9 && hr < 18; return h('div', { title: d.toLocaleString([], { timeZone: tz }), style: `font-size:10px;text-align:center;padding:4px 0;border-radius:3px;background:${work ? 'color-mix(in srgb, var(--ok) 35%, transparent)' : hr >= 7 && hr < 22 ? 'var(--panel-hi)' : 'transparent'}` }, hr); })))),
        h('div.small.dim', `Green = 9:00–18:00. Columns are the next 24 hours from now. Best overlap: ${(() => { const ok = Array.from({ length: 24 }, (_, i) => new Date(start.getTime() + i * 36e5)).filter((d) => zones().every((tz) => { const x = hourIn(tz, d); return x >= 9 && x < 18; })); return ok.length ? ok.slice(0, 3).map((d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })).join(', ') + ' (your time)' : 'none — try fewer zones'; })()}`));
    };
    const add = () => { const v = pick.value.trim(); const tz = all.find((z) => z.toLowerCase() === v.toLowerCase()) || all.find((z) => z.toLowerCase().includes(v.toLowerCase().replace(/ /g, '_'))); if (tz && !zones().includes(tz)) { api.set('zones', [...zones(), tz]); render(); } pick.value = ''; };
    pick.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    el.append(h('div.stack', h('div.row', pick, dl, h('button.btn.primary', { onclick: add }, 'Add')), grid));
    render(); const iv = setInterval(render, 30e3); return () => clearInterval(iv);
  },
};

/* ------------------------------------------------------------------ finance */
export const finance = {
  id: 'finance-calc', name: 'Finance Calculators', version: '1.0.0', author: 'JARVIS-X',
  icon: 'dollar', category: 'Finance', needs: [],
  description: 'Loan EMI with amortisation, SIP and lump-sum growth, GST add/remove, and bill splitting.',
  commands: [{ match: /^emi\s+([\d.,]+)\s+(?:at\s+)?([\d.]+)%?\s+(?:for\s+)?([\d.]+)\s*(y|yr|years?|m|months?)$/i, run(t) { const [, p, r, n, u] = t.match(/^emi\s+([\d.,]+)\s+(?:at\s+)?([\d.]+)%?\s+(?:for\s+)?([\d.]+)\s*(y|yr|years?|m|months?)$/i); const P = +p.replace(/,/g, ''), R = +r / 1200, N = /^m/i.test(u) ? +n : +n * 12; const e = R ? (P * R * (1 + R) ** N) / ((1 + R) ** N - 1) : P / N; return `**EMI ${e.toLocaleString(undefined, { maximumFractionDigits: 0 })}/month** for ${N} months · total interest ${(e * N - P).toLocaleString(undefined, { maximumFractionDigits: 0 })}`; } }],
  panel(el, api) {
    const { h } = api; const cur = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    const num = (label, v) => { const i = h('input.input', { type: 'number', value: v, style: 'width:140px' }); return [i, h('label.field', label, i)]; };
    // EMI
    const [p, pL] = num('Loan amount', 1000000); const [r, rL] = num('Interest % / year', 8.5); const [y, yL] = num('Years', 20); const emiOut = h('div.stack');
    const emi = () => { const P = +p.value, R = +r.value / 1200, N = +y.value * 12; const e = R ? (P * R * (1 + R) ** N) / ((1 + R) ** N - 1) : P / N; let bal = P; const rows = []; for (let yr = 1; yr <= +y.value; yr++) { let int = 0, prin = 0; for (let m = 0; m < 12 && bal > 0; m++) { const i2 = bal * R; int += i2; prin += e - i2; bal -= e - i2; } rows.push([yr, prin, int, Math.max(0, bal)]); }
      emiOut.replaceChildren(h('div.row', h('span.pill.ok', `EMI ${cur(e)}/month`), h('span.pill', `Total interest ${cur(e * N - P)}`), h('span.pill', `Total paid ${cur(e * N)}`)), h('div.table-wrap', { style: 'max-height:240px' }, h('table.tbl', h('thead', h('tr', ['Year', 'Principal', 'Interest', 'Balance'].map((x) => h('th', x)))), h('tbody', rows.map((rw) => h('tr', rw.map((c, i) => h('td.mono', i ? cur(c) : c)))))))); };
    // SIP
    const [sm, smL] = num('Monthly SIP', 10000); const [sr, srL] = num('Expected return %', 12); const [sy, syL] = num('Years', 15); const [ls, lsL] = num('Lump sum (optional)', 0); const sipOut = h('div');
    const sip = () => { const i = +sr.value / 1200, n = +sy.value * 12; const fv = i ? +sm.value * (((1 + i) ** n - 1) / i) * (1 + i) : +sm.value * n; const lfv = +ls.value * (1 + +sr.value / 100) ** +sy.value; const inv = +sm.value * n + +ls.value; sipOut.replaceChildren(h('div.row', h('span.pill.ok', `Value ${cur(fv + lfv)}`), h('span.pill', `Invested ${cur(inv)}`), h('span.pill', `Gain ${cur(fv + lfv - inv)}`))); };
    // GST
    const [g, gL] = num('Amount', 1000); const gr = h('select.select', { style: 'width:auto' }, [5, 12, 18, 28].map((x) => h('option', { value: x, selected: x === 18 }, `${x}%`))); const gOut = h('div');
    const gst = () => { const a = +g.value, t = +gr.value / 100; gOut.replaceChildren(h('div.small', `Add GST: ${cur(a)} + ${cur(a * t)} = `, h('b', cur(a * (1 + t))), ` · Remove GST: base `, h('b', cur(a / (1 + t))), ` + tax ${cur(a - a / (1 + t))}`)); };
    // Split
    const [b, bL] = num('Bill total', 2400); const [tip, tipL] = num('Tip %', 10); const [ppl, pplL] = num('People', 4); const sOut = h('div');
    const split = () => { const t = +b.value * (1 + +tip.value / 100); sOut.replaceChildren(h('div.small', `Total ${cur(t)} → `, h('b', `${cur(t / Math.max(1, +ppl.value))} each`))); };
    const sec = (title, inputs, _fn, out) => h('div.glass.widget.stack', h('b', title), h('div.row', ...inputs), out);
    el.append(h('div.stack', sec('Loan EMI', [pL, rL, yL], emi, emiOut), sec('SIP & lump-sum growth', [smL, srL, syL, lsL], sip, sipOut), sec('GST', [gL, h('label.field', 'Rate', gr)], gst, gOut), sec('Split a bill', [bL, tipL, pplL], split, sOut)));
    for (const i of el.querySelectorAll('input,select')) i.addEventListener('input', () => { emi(); sip(); gst(); split(); });
    emi(); sip(); gst(); split();
  },
};

/* ------------------------------------------------------------- fun & random */
const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
export const fun = {
  id: 'fun-random', name: 'Fun & Random', version: '1.0.0', author: 'JARVIS-X',
  icon: 'sparkles', category: 'Fun', needs: [],
  description: 'Dice (any notation like 3d6+2), coin flips, a random picker, strong password generator and countdowns. Try "roll 2d20" or "flip a coin".',
  commands: [
    { match: /^roll\s+(\d*)d(\d+)([+-]\d+)?$/i, run(t) { const [, n, s, mod] = t.match(/^roll\s+(\d*)d(\d+)([+-]\d+)?$/i); const rolls = Array.from({ length: Math.min(+n || 1, 100) }, () => 1 + rnd(+s)); const total = rolls.reduce((a, b) => a + b, 0) + (+mod || 0); return `${rolls.join(' + ')}${mod || ''} = **${total}**`; } },
    { match: /^flip( a)? coin$/i, run: () => `**${rnd(2) ? 'Heads' : 'Tails'}**` },
    { match: /^(generate|make)( a)? (strong )?password$/i, run: () => '`' + password(20) + '`' },
    { match: /^pick (?:one|from|between)?:?\s*(.+)$/i, run(t) { const items = t.replace(/^pick (?:one|from|between)?:?\s*/i, '').split(/,|\bor\b/).map((x) => x.trim()).filter(Boolean); return items.length ? `I pick **${items[rnd(items.length)]}**.` : 'Give me some options, separated by commas.'; } },
  ],
  panel(el, api) {
    const { h } = api;
    const out = h('div.w-big', { style: 'text-align:center;min-height:60px' });
    const dice = h('input.input', { value: '2d6', style: 'width:100px' }); const opts = h('input.input.grow', { placeholder: 'Pizza, Biryani, Dosa' });
    const len = h('input', { type: 'range', min: 8, max: 64, value: 20, style: 'max-width:160px' }); const pw = h('input.input.mono', { readonly: true });
    const target = h('input.input', { type: 'datetime-local', value: api.get('target', ''), style: 'width:auto' }); const cd = h('div.small');
    const roll = () => { const m = dice.value.match(/^(\d*)d(\d+)([+-]\d+)?$/i); if (!m) return; const r = Array.from({ length: Math.min(+m[1] || 1, 100) }, () => 1 + rnd(+m[2])); out.textContent = `${r.reduce((a, b) => a + b, 0) + (+m[3] || 0)}`; out.title = r.join(' + '); };
    const tick = () => { const t = Date.parse(target.value); if (!t) { cd.textContent = ''; return; } const ms = t - Date.now(); const d = Math.floor(Math.abs(ms) / 864e5); cd.textContent = `${ms < 0 ? 'Since' : 'Until'} ${target.value.replace('T', ' ')}: ${d} days, ${api.fmt.dur(Math.abs(ms) % 864e5)}`; };
    target.oninput = () => { api.set('target', target.value); tick(); };
    el.append(h('div.stack', out,
      h('div.row', dice, h('button.btn.primary', { onclick: roll }, 'Roll'), h('button.btn', { onclick: () => { out.textContent = rnd(2) ? 'Heads' : 'Tails'; } }, 'Flip a coin'), h('button.btn', { onclick: () => { out.textContent = String(1 + rnd(100)); } }, '1–100')),
      h('div.row', opts, h('button.btn', { onclick: () => { const it = opts.value.split(',').map((x) => x.trim()).filter(Boolean); if (it.length) out.textContent = it[rnd(it.length)]; } }, 'Pick one')),
      h('div.row', pw, h('span.small.dim', 'Length'), len, h('button.btn', { onclick: () => { pw.value = password(+len.value); } }, 'Generate password'), h('button.btn.ghost', { onclick: () => api.copyText(pw.value) }, 'Copy')),
      h('div.row', h('span.small.dim', 'Countdown to'), target), cd));
    const iv = setInterval(tick, 1000); tick(); return () => clearInterval(iv);
  },
};
function password(n) { const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+'; return Array.from({ length: n }, () => cs[rnd(cs.length)]).join(''); }
