/**
 * Developer Workspace: highlighted editor for 9 languages, sandboxed runners,
 * console, static analysis, AI explain/optimize, API tester, JSON viewer,
 * storage inspector and the Master-tier AI coding studio.
 * @module modules/devspace
 */
import { h, clear, fmt, toast, tabs, copyText, download, debounce, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { highlight } from '../core/highlight.js';
import { renderMarkdown } from '../core/markdown.js';
import { analyzeCode } from '../core/ai.js';
import { ask } from '../core/assistant.js';
import { gate, featureBadge, lockOverlay } from '../core/gate.js';
import { idb } from '../core/idb.js';
import { platform } from '../core/platform.js';
import { api } from '../core/api.js';
let runnerCache = null;
const runnerStatus = async () => (runnerCache ||= await api.get('/api/run/status').catch(() => ({ languages: [] })));

const LANGS = {
  javascript: { label: 'JavaScript', ext: 'js', run: 'js', sample: `// JavaScript runs in an isolated Web Worker\nconst fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2));\nconst nums = Array.from({ length: 10 }, (_, i) => fib(i));\nconsole.log('Fibonacci:', nums.join(', '));\nconsole.table?.(nums);\nconsole.warn('Tip: try the Analyze and Explain buttons');` },
  html: { label: 'HTML', ext: 'html', run: 'html', sample: `<!doctype html>\n<html>\n  <body>\n    <h1>Hello from JARVIS-X</h1>\n    <button onclick="this.textContent = 'Clicked!'">Click me</button>\n  </body>\n</html>` },
  css: { label: 'CSS', ext: 'css', run: 'css', sample: `.card {\n  padding: 24px;\n  border-radius: 16px;\n  background: linear-gradient(135deg, #1e7bff, #2ad4ff);\n  color: white;\n  font-family: system-ui;\n}` },
  python: { label: 'Python', ext: 'py', run: 'python', sample: `# Python runs via Pyodide (downloaded on first run)\ndef greet(name: str) -> str:\n    return f"Hello, {name}!"\n\nsquares = [n * n for n in range(1, 8)]\nprint(greet("JARVIS-X"))\nprint("Squares:", squares)` },
  java: { label: 'Java', ext: 'java', run: null, sample: `public class Main {\n    public static void main(String[] args) {\n        int sum = 0;\n        for (int i = 1; i <= 10; i++) sum += i;\n        System.out.println("Sum: " + sum);\n    }\n}` },
  cpp: { label: 'C++', ext: 'cpp', run: null, sample: `#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    vector<int> v = {5, 3, 8, 1};\n    for (int x : v) cout << x * 2 << " ";\n    return 0;\n}` },
  sql: { label: 'SQL', ext: 'sql', run: 'sql', sample: `-- Runs on a tiny in-browser SQL engine (SELECT/WHERE/ORDER BY/LIMIT)\nSELECT name, score FROM students WHERE score > 70 ORDER BY score DESC;` },
  json: { label: 'JSON', ext: 'json', run: 'json', sample: `{\n  "assistant": "JARVIS-X",\n  "version": 1,\n  "modules": ["chat", "study", "dev"],\n  "online": true\n}` },
  markdown: { label: 'Markdown', ext: 'md', run: 'md', sample: `# Release notes\n\n- **New:** study mind maps\n- Faster boot\n\n\`\`\`js\nconsole.log('hi')\n\`\`\`` },
};

/* Languages contributed by plugins (e.g. GDScript from the Godot plugin). */
const GD_LANG = { label: 'GDScript (Godot)', ext: 'gd', run: null, sample: 'extends CharacterBody2D\n\n@export var speed := 300.0\n\nfunc _physics_process(delta: float) -> void:\n\tvar dir := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")\n\tvelocity = dir * speed\n\tmove_and_slide()' };
if ((store.get('plugins')?.installed || []).includes('godot')) LANGS.gdscript = GD_LANG;
import('../core/bus.js').then(({ bus }) => bus.on('dev:lang', (l) => { LANGS[l.id] = { ...GD_LANG, ...l }; }));

/* -------------------------------------------------------------- code editor */
function codeEditor(value, lang, onChange) {
  const ta = h('textarea', { spellcheck: false, autocapitalize: 'off', 'aria-label': 'Code editor', value });
  const pre = h('pre', { 'aria-hidden': 'true' }); const gutter = h('div.gutter', { 'aria-hidden': 'true' });
  const wrap = h('div.code-wrap', gutter, pre, ta);
  const paint = () => { pre.innerHTML = highlight(ta.value, wrap.dataset.lang) + '\n'; gutter.textContent = ta.value.split('\n').map((_, i) => i + 1).join('\n'); };
  wrap.dataset.lang = lang;
  ta.addEventListener('input', () => { paint(); onChange?.(ta.value); });
  ta.addEventListener('scroll', () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    if (e.key === 'Enter') { const s = ta.selectionStart; const line = ta.value.slice(0, s).split('\n').pop(); const ind = line.match(/^\s*/)[0] + (/[{[(:]\s*$/.test(line) ? '  ' : ''); e.preventDefault(); ta.setRangeText('\n' + ind, s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
  });
  paint();
  return { el: wrap, get value() { return ta.value; }, set value(v) { ta.value = v; paint(); }, setLang(l) { wrap.dataset.lang = l; paint(); }, focus: () => ta.focus() };
}

/* ------------------------------------------------------------------ runners */
function runJS(code, log) {
  return new Promise((resolve) => {
    const src = `const __s=(t,a)=>postMessage({t,a:a.map(x=>{try{return typeof x==='object'?JSON.stringify(x,null,1):String(x)}catch{return String(x)}})});
self.console={log:(...a)=>__s('log',a),info:(...a)=>__s('info',a),warn:(...a)=>__s('warn',a),error:(...a)=>__s('err',a),table:(x)=>__s('log',[x])};
(async()=>{try{\n${code}\n}catch(e){__s('err',[e.name+': '+e.message])}finally{postMessage({done:1})}})();`;
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); } catch (e) { log('err', `Cannot start worker: ${e.message}`); return resolve(); }
    const t0 = performance.now();
    const kill = setTimeout(() => { w.terminate(); log('err', 'Stopped: exceeded 5 s time limit (infinite loop?)'); resolve(); }, 5000);
    w.onmessage = (e) => { if (e.data.done) { clearTimeout(kill); w.terminate(); log('info', `Finished in ${(performance.now() - t0).toFixed(1)} ms`); resolve(); } else log(e.data.t, e.data.a.join(' ')); };
    w.onerror = (e) => { e.preventDefault(); clearTimeout(kill); w.terminate(); log('err', `${e.message}${e.lineno ? ` (line ${e.lineno - 3})` : ''}`); resolve(); };
  });
}
let pyodide;
async function runPython(code, log) {
  if (!pyodide) {
    log('info', 'Loading Python runtime (Pyodide, ~10 MB)…');
    try {
      await new Promise((res, rej) => { const s = h('script', { src: 'https://cdn.jsdelivr.net/npm/pyodide@0.26.4/pyodide.js' }); s.onload = res; s.onerror = rej; document.head.append(s); });
      pyodide = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/npm/pyodide@0.26.4/' });
    } catch { log('err', 'Python runtime could not be downloaded here (network or sandbox restriction). Run JARVIS-X locally to use Python.'); return; }
  }
  pyodide.setStdout({ batched: (s) => log('log', s) }); pyodide.setStderr({ batched: (s) => log('err', s) });
  try { const r = await pyodide.runPythonAsync(code); if (r !== undefined) log('info', String(r)); } catch (e) { log('err', e.message.split('\n').slice(-3).join('\n')); }
}
/** Mini SQL engine for offline use: CREATE/INSERT/SELECT with WHERE/ORDER BY/LIMIT over in-memory tables. */
const DB = { students: [{ id: 1, name: 'Asha', score: 91 }, { id: 2, name: 'Ben', score: 67 }, { id: 3, name: 'Chen', score: 78 }, { id: 4, name: 'Dana', score: 84 }, { id: 5, name: 'Eli', score: 59 }] };
function runSQL(code, log, show) {
  for (const stmt of code.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)) {
    try {
      let m;
      if ((m = stmt.match(/^create\s+table\s+(\w+)/i))) { DB[m[1]] = []; log('info', `Created table ${m[1]}`); continue; }
      if ((m = stmt.match(/^insert\s+into\s+(\w+)\s*\(([^)]+)\)\s*values\s*\((.+)\)$/i))) {
        const cols = m[2].split(',').map((c) => c.trim()); const vals = m[3].split(',').map((v) => v.trim().replace(/^'(.*)'$/, '$1')).map((v) => (isNaN(v) ? v : +v));
        (DB[m[1]] ||= []).push(Object.fromEntries(cols.map((c, i) => [c, vals[i]]))); log('info', '1 row inserted'); continue;
      }
      if ((m = stmt.match(/^select\s+(.+?)\s+from\s+(\w+)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+(\w+)(?:\s+(asc|desc))?)?(?:\s+limit\s+(\d+))?$/i))) {
        let rows = [...(DB[m[2]] || (() => { throw new Error(`no such table: ${m[2]}`); })())];
        if (m[3]) {
          const conds = m[3].split(/\s+and\s+/i).map((c) => c.match(/(\w+)\s*(>=|<=|!=|=|>|<|like)\s*(.+)/i));
          rows = rows.filter((r) => conds.every(([, col, op, raw]) => { const v = raw.trim().replace(/^'(.*)'$/, '$1'); const x = r[col]; const n = isNaN(v) ? v : +v;
            return op === '=' ? x == n : op === '!=' ? x != n : op === '>' ? x > n : op === '<' ? x < n : op === '>=' ? x >= n : op === '<=' ? x <= n : new RegExp('^' + String(v).replace(/%/g, '.*') + '$', 'i').test(x); }));
        }
        if (m[4]) rows.sort((a, b) => (a[m[4]] > b[m[4]] ? 1 : -1) * (m[5]?.toLowerCase() === 'desc' ? -1 : 1));
        if (m[6]) rows = rows.slice(0, +m[6]);
        const cols = m[1].trim() === '*' ? Object.keys(rows[0] || DB[m[2]][0] || {}) : m[1].split(',').map((c) => c.trim());
        if (/^count\(\*\)$/i.test(m[1].trim())) { log('log', `count = ${rows.length}`); continue; }
        show(h('div.table-wrap', h('table.tbl', h('thead', h('tr', cols.map((c) => h('th', c)))), h('tbody', rows.map((r) => h('tr', cols.map((c) => h('td', String(r[c] ?? 'NULL')))))))));
        log('info', `${rows.length} row(s)`); continue;
      }
      throw new Error('Unsupported statement in the offline mini engine. Supported: CREATE TABLE, INSERT INTO … VALUES, SELECT … FROM … WHERE … ORDER BY … LIMIT');
    } catch (e) { log('err', e.message); }
  }
}

/* ------------------------------------------------------------------- EDITOR */
function Editor(el) {
  let lang = store.get('dev.lang') || 'javascript';
  const files = store.get('dev.files') || {};
  const consoleEl = h('div.console', { role: 'log', 'aria-label': 'Console' });
  const preview = h('div.stack', { style: 'min-height:0' });
  const ai = h('div.md.glass.widget', { hidden: true, style: 'max-height:280px;overflow:auto' });
  const log = (t, msg) => { consoleEl.append(h('div.l', { class: t }, `${t === 'err' ? '✖ ' : t === 'warn' ? '⚠ ' : t === 'info' ? '› ' : ''}${msg}`)); consoleEl.scrollTop = consoleEl.scrollHeight; };
  const save = debounce((v) => store.set(['dev', 'files', lang], v), 400);
  const ed = codeEditor(files[lang] ?? LANGS[lang].sample, lang, save);
  const sel = h('select.select', { style: 'width:auto', 'aria-label': 'Language', onchange: (e) => { lang = e.target.value; store.set('dev.lang', lang); ed.setLang(lang); ed.value = store.get(['dev', 'files', lang]) ?? LANGS[lang].sample; clear(preview); } }, Object.entries(LANGS).map(([k, l]) => h('option', { value: k, selected: k === lang }, l.label)));

  const run = async () => {
    clear(consoleEl); clear(preview); const code = ed.value; const kind = LANGS[lang].run;
    const runner = platform.isServer ? await runnerStatus() : null;
    const serverLang = { python: 'python', java: 'java', cpp: 'cpp', sql: 'sql' }[lang];
    if (serverLang && runner?.languages.includes(serverLang)) return runOnServer(serverLang, code);
    if (kind === 'js') return runJS(code, log);
    if (kind === 'python') return runPython(code, log);
    if (kind === 'sql') { log('info', 'Using the built-in mini SQL engine (run the JARVIS-X server for full SQLite).'); return runSQL(code, log, (n) => preview.append(n)); }
    if (kind === 'html' || kind === 'css') {
      const doc = kind === 'css' ? `<style>${code}</style><div class="card">Styled .card element</div>` : code;
      if (platform.isServer) {
        const frame = h('iframe.dev-frame', { sandbox: 'allow-scripts', src: 'sandbox.html', title: 'Preview' });
        frame.addEventListener('load', () => frame.contentWindow.postMessage({ type: 'jx-render', html: doc }, '*'), { once: true });
        preview.append(frame);
      } else preview.append(h('iframe.dev-frame', { sandbox: 'allow-scripts', srcdoc: doc, title: 'Preview' }));
      log('info', 'Preview rendered in a sandboxed frame'); return;
    }
    if (kind === 'json') { try { const v = JSON.parse(code); preview.append(jsonTree(v)); log('info', 'Valid JSON'); } catch (e) { log('err', e.message); } return; }
    if (kind === 'md') { preview.append(h('div.md.glass.widget', { html: renderMarkdown(code) })); return; }
    log('warn', platform.isServer ? `${LANGS[lang].label} execution is disabled on this server (set CODE_RUNNER=docker).` : `${LANGS[lang].label} runs on the JARVIS-X server's code runner. Use Analyze / Explain here.`);
  };
  async function runOnServer(language, code) {
    log('info', `Running on server (${language})…`);
    try {
      const r = await api.post('/api/run', { lang: language, code });
      if (language === 'sql') {
        for (const res of r.results) {
          if (res.rows) { const cols = Object.keys(res.rows[0] || {}); preview.append(h('div.table-wrap', h('table.tbl', h('thead', h('tr', cols.map((c) => h('th', c)))), h('tbody', res.rows.map((row) => h('tr', cols.map((c) => h('td', String(row[c] ?? 'NULL'))))))))); log('info', `${res.rows.length} row(s)`); }
          else log('log', `${res.sql.split(/\s+/)[0].toUpperCase()} · ${res.changes} change(s)`);
        }
        if (r.error) log('err', r.error);
        log('info', `SQLite · ${r.ms} ms`); return;
      }
      if (r.stdout) for (const l of r.stdout.replace(/\n$/, '').split('\n')) log('log', l);
      if (r.stderr) for (const l of r.stderr.replace(/\n$/, '').split('\n')) log('err', l);
      log(r.exitCode === 0 ? 'info' : 'warn', r.timedOut ? 'Stopped: time limit exceeded' : `Exit code ${r.exitCode} · ${r.ms} ms`);
    } catch (e) { log('err', e.status === 401 ? 'Sign in to run code on the server.' : e.message); }
  }
  const analyze = () => {
    const r = analyzeCode(ed.value, lang === 'cpp' ? 'cpp' : lang);
    clear(consoleEl); log('info', `${r.lang} · ${r.lines} lines · functions: ${r.functions.join(', ') || 'none'}`);
    r.issues.length ? r.issues.forEach((i) => log('warn', i.replace(/`/g, ''))) : log('log', 'No issues found by static checks.');
  };
  const aiAction = async (kind) => {
    if (kind !== 'explain' && !gate('dev.advanced')) return;
    const prompts = { explain: 'Explain what this code does, step by step, for a learner', optimize: 'Optimize this code for performance and readability. Show the improved version and list the changes', debug: 'Find bugs and edge cases in this code and show a fixed version', tests: 'Write unit tests for this code' };
    ai.hidden = false; ai.innerHTML = '<span class="typing"></span>';
    const msg = `${prompts[kind]}:\n\n\`\`\`${lang}\n${ed.value}\n\`\`\``;
    await ask(msg, { conversation: false, history: [{ role: 'user', content: msg }], onChunk: (f) => { ai.innerHTML = renderMarkdown(f); } });
  };
  const formatCode = () => {
    if (lang === 'json') { try { ed.value = JSON.stringify(JSON.parse(ed.value), null, 2); save(ed.value); } catch (e) { log('err', e.message); } return; }
    ed.value = ed.value.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n'); save(ed.value); log('info', 'Trimmed trailing whitespace & blank lines');
  };
  el.append(h('div.stack', { style: 'height:100%;display:flex;flex-direction:column' },
    h('div.row', sel,
      h('button.btn.primary', { onclick: run, title: 'Run (Ctrl+Enter)' }, icon('play'), 'Run'),
      h('button.btn', { onclick: analyze }, icon('shield'), 'Analyze'),
      h('button.btn', { onclick: () => aiAction('explain') }, icon('sparkles'), 'Explain'),
      h('button.btn', { onclick: () => aiAction('debug') }, icon('alert'), 'Debug', featureBadge('dev.advanced')),
      h('button.btn', { onclick: () => aiAction('optimize') }, icon('bolt'), 'Optimize', featureBadge('dev.advanced')),
      h('button.btn', { onclick: () => aiAction('tests') }, icon('check'), 'Tests', featureBadge('dev.advanced')),
      h('span.grow'),
      h('button.btn.ghost.sm', { onclick: formatCode }, 'Format'),
      h('button.btn.ghost.sm', { onclick: () => copyText(ed.value) }, icon('copy')),
      h('button.btn.ghost.sm', { onclick: () => download(`main.${LANGS[lang].ext}`, ed.value) }, icon('download')),
      h('button.btn.ghost.sm', { onclick: () => { ed.value = LANGS[lang].sample; save(ed.value); } }, 'Reset')),
    h('div.grid2', { style: 'grid-template-columns:minmax(0,3fr) minmax(0,2fr);flex:1;min-height:340px' }, ed.el, h('div.stack', { style: 'align-content:start;min-width:0' }, h('div.section-title', 'Console'), consoleEl, preview, ai))));
  el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
  log('info', 'Ready. Ctrl+Enter runs the code.');
}

/* ---------------------------------------------------------------- JSON tree */
function jsonTree(v, key) {
  const label = key !== undefined ? h('span.k', JSON.stringify(key) + ': ') : null;
  if (v && typeof v === 'object') {
    const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
    return h('details', { open: true }, h('summary', label, Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`), entries.map(([k, x]) => jsonTree(x, k)));
  }
  const cls = typeof v === 'string' ? 's' : typeof v === 'number' ? 'n' : 'b';
  return h('div', label, h('span', { class: cls }, JSON.stringify(v)));
}
function JSONViewer(el) {
  const ta = h('textarea.textarea.mono', { style: 'min-height:260px', value: '{"user":{"name":"Operator","plan":"free","tags":["study","dev"]},"stats":{"tasks":12,"streak":5,"active":true}}' });
  const out = h('div.json-tree.glass.widget'); const status = h('span.small');
  const render = () => { clear(out); try { const v = JSON.parse(ta.value); out.append(jsonTree(v)); status.textContent = `Valid JSON · ${fmt.bytes(new Blob([ta.value]).size)}`; status.style.color = 'var(--ok)'; } catch (e) { status.textContent = e.message; status.style.color = 'var(--danger)'; } };
  ta.addEventListener('input', debounce(render, 200));
  el.append(h('div.stack', h('div.row', h('button.btn.sm', { onclick: () => { try { ta.value = JSON.stringify(JSON.parse(ta.value), null, 2); render(); } catch { /* */ } } }, 'Pretty'), h('button.btn.sm', { onclick: () => { try { ta.value = JSON.stringify(JSON.parse(ta.value)); render(); } catch { /* */ } } }, 'Minify'), h('button.btn.sm', { onclick: () => copyText(ta.value) }, icon('copy'), 'Copy'), status),
    h('div.grid2', ta, out)));
  render();
}

/* --------------------------------------------------------------- API TESTER */
function ApiTester(el) {
  const method = h('select.select', { style: 'width:auto' }, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => h('option', m)));
  const url = h('input.input.grow', { value: 'https://api.github.com/repos/microsoft/vscode', placeholder: 'https://…' });
  const headers = h('textarea.textarea.mono', { style: 'min-height:70px', value: '{\n  "Accept": "application/json"\n}' });
  const body = h('textarea.textarea.mono', { style: 'min-height:70px', placeholder: 'Request body (JSON)' });
  const out = h('div.stack'); const hist = h('div.list');
  const renderHist = () => clear(hist).append(store.get('dev.apiHistory').slice(0, 8).map((r) => h('button.item', { style: 'cursor:pointer;color:var(--fg);text-align:left', onclick: () => { method.value = r.method; url.value = r.url; } }, h('span.pill', r.method), h('span.grow.small.mono', r.url), h('span.pill', { class: r.status < 300 ? 'ok' : 'hi' }, r.status || 'ERR'))));
  const send = async () => {
    clear(out).append(h('div.small.dim', 'Sending…'));
    let hdrs = {}; try { hdrs = headers.value.trim() ? JSON.parse(headers.value) : {}; } catch { clear(out).append(h('div.small', { style: 'color:var(--danger)' }, 'Headers must be valid JSON')); return; }
    const t0 = performance.now();
    try {
      const res = await fetch(url.value, { method: method.value, headers: hdrs, body: ['GET', 'DELETE'].includes(method.value) ? undefined : body.value || undefined });
      const ms = performance.now() - t0; const text = await res.text();
      let parsed = null; try { parsed = JSON.parse(text); } catch { /* */ }
      store.update('dev.apiHistory', (l) => [{ method: method.value, url: url.value, status: res.status, ts: Date.now() }, ...l].slice(0, 20));
      clear(out).append(h('div.row', h('span.pill', { class: res.ok ? 'ok' : 'hi' }, `${res.status} ${res.statusText}`), h('span.pill', `${ms.toFixed(0)} ms`), h('span.pill', fmt.bytes(text.length)), h('span.pill', res.headers.get('content-type') || '')),
        parsed ? h('div.json-tree.glass.widget', { style: 'max-height:360px' }, jsonTree(parsed)) : h('pre.console', { style: 'height:auto;max-height:360px' }, text.slice(0, 20000)));
    } catch (e) {
      store.update('dev.apiHistory', (l) => [{ method: method.value, url: url.value, status: 0, ts: Date.now() }, ...l].slice(0, 20));
      clear(out).append(h('div.item', icon('alert'), h('span.grow.small', `Request failed: ${e.message}. The API may not allow browser (CORS) requests, or this host blocks network access.`)));
    }
    renderHist();
  };
  el.append(h('div.stack', h('div.row', method, url, h('button.btn.primary', { onclick: send }, icon('send'), 'Send')), h('div.grid2', h('label.field', 'Headers (JSON)', headers), h('label.field', 'Body', body)), out, h('div.section-title', 'History'), hist));
  renderHist();
}

/* -------------------------------------------------------- STORAGE INSPECTOR */
async function Storage(el) {
  const ls = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls.push([k, localStorage.getItem(k)]); } } catch { /* */ }
  const sections = Object.entries(store.state).map(([k, v]) => [k, JSON.stringify(v).length]).sort((a, b) => b[1] - a[1]);
  const fileKeys = await idb.keys('files').catch(() => []);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const detail = h('pre.console', { style: 'height:240px' }, 'Select a section to inspect its decrypted contents.');
  el.append(h('div.stack',
    h('div.grid3', [['Vault (encrypted)', fmt.bytes(store.vaultSize())], ['Encryption', store.mode === 'password' ? 'AES-GCM · password' : store.mode === 'device' ? 'AES-GCM · device key' : 'None (insecure context)'], ['Files in IndexedDB', String(fileKeys.length)], ['Browser quota', est ? `${fmt.bytes(est.usage)} / ${fmt.bytes(est.quota)}` : 'n/a']].map(([k, v]) => h('div.glass.widget', h('div.w-title', k), h('div', { style: 'font-size:18px;margin-top:4px' }, v)))),
    h('div.grid2', { style: 'align-items:start' },
      h('div.stack', h('div.section-title', 'Vault sections (decrypted in memory)'), h('div.list', sections.map(([k, n]) => h('button.item', { style: 'cursor:pointer;color:var(--fg)', onclick: () => { detail.textContent = k === 'license' || k === 'secrets' ? '(hidden for security)' : JSON.stringify(store.get(k), null, 2).slice(0, 30000); } }, h('span.grow.small.mono', k), h('span.xs.muted', fmt.bytes(n)))))),
      h('div.stack', h('div.section-title', 'Raw localStorage keys'), h('div.list', ls.map(([k, v]) => h('div.item', h('span.grow.small.mono', k), h('span.xs.muted', fmt.bytes(v.length))))), detail))));
}

/* ------------------------------------------------------------ CODING STUDIO */
function Studio(el) {
  const spec = h('textarea.textarea', { placeholder: 'Describe an app or component, e.g. "a todo list with drag-and-drop and local storage"', style: 'min-height:90px' });
  const stack = h('select.select', { style: 'width:auto' }, ['Vanilla JS', 'React', 'Vue', 'Svelte', 'Node/Express API', 'Python/FastAPI'].map((s) => h('option', s)));
  const out = h('div.md.glass.widget', { hidden: true });
  const wrap = h('div.stack', h('div.small.dim', 'The AI coding studio plans a project, scaffolds files and writes the code with a multi-step agent. Connect a remote AI provider in Settings for best results.'),
    h('div.row', stack, h('span.grow')), spec,
    h('div.row', h('button.btn.primary', { onclick: async () => {
      if (!gate('dev.studio')) return; if (!spec.value.trim()) return;
      out.hidden = false; out.innerHTML = '<span class="typing"></span>';
      const msg = `Act as a senior engineer. Create a ${stack.value} project for: ${spec.value}\n1) A file tree\n2) Each file's full contents in fenced code blocks\n3) Run instructions.`;
      await ask(msg, { conversation: false, history: [{ role: 'user', content: msg }], onChunk: (f) => { out.innerHTML = renderMarkdown(f); } });
    } }, icon('wand'), 'Generate project')), out);
  el.append(lockOverlay(wrap, 'dev.studio'));
}

export default {
  flush: true,
  mount(el, ctx) {
    const t = tabs([
      { id: 'editor', label: 'Editor & console', icon: 'code', render: Editor },
      { id: 'api', label: 'API tester', icon: 'send', render: ApiTester },
      { id: 'json', label: 'JSON viewer', icon: 'database', render: JSONViewer },
      { id: 'storage', label: 'Storage inspector', icon: 'chip', render: (b) => { Storage(b); } },
      { id: 'studio', label: 'AI coding studio', icon: 'wand', badge: featureBadge('dev.studio'), render: Studio },
    ], { initial: ctx.params?.tab });
    el.append(t.el);
    this.update = (p) => t.select(p.tab || t.current);
  },
};
