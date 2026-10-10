/**
 * Lightweight, dependency-free syntax highlighter.
 * Single-pass tokenizer: comments, strings, numbers, keywords, types, functions.
 * Languages: js/ts, html, css, python, java, cpp, sql, json, markdown.
 * Returns escaped HTML with <span class="tok-*"> wrappers.
 * @module core/highlight
 */
import { esc } from './dom.js';

const KW = {
  javascript: 'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield null undefined true false',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self print',
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws try void volatile while true false var String',
  cpp: 'auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for friend if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while include define std cout cin endl string vector',
  sql: 'select from where and or not insert into values update set delete create table drop alter add primary key foreign references join left right inner outer on group by order having limit offset as distinct count sum avg min max null is in like between union all case when then else end index view int integer varchar text date boolean',
  css: 'important media keyframes from to root import supports',
  json: 'true false null',
};
KW.gdscript = 'func var const extends class_name signal if elif else for while match return pass break continue in not and or true false null self await preload load enum static class super is as void tool breakpoint int float bool String StringName Array Dictionary Vector2 Vector2i Vector3 Vector3i Color Node Node2D Node3D PackedVector2Array PackedStringArray Callable';
KW.typescript = KW.javascript + ' interface type enum implements private public readonly declare namespace keyof';
KW.js = KW.javascript; KW.gd = KW.gdscript; KW.ts = KW.typescript; KW.py = KW.python; KW['c++'] = KW.cpp; KW.c = KW.cpp;
const sets = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, new Set(v.split(' '))]));

const ALIASES = { gdscript: 'gdscript', gd: 'gdscript', javascript: 'javascript', js: 'javascript', jsx: 'javascript', ts: 'typescript', typescript: 'typescript', py: 'python', python: 'python', java: 'java', cpp: 'cpp', 'c++': 'cpp', c: 'cpp', sql: 'sql', css: 'css', json: 'json', html: 'html', xml: 'html', md: 'markdown', markdown: 'markdown' };

export function highlight(code = '', lang = 'javascript') {
  lang = ALIASES[(lang || '').toLowerCase()] || 'javascript';
  if (lang === 'html') return highlightHTML(code);
  if (lang === 'markdown') return esc(code).replace(/^(#{1,6} .*)$/gm, '<span class="tok-k">$1</span>').replace(/(\*\*[^*]+\*\*)/g, '<span class="tok-t">$1</span>').replace(/(`[^`]+`)/g, '<span class="tok-s">$1</span>');
  const kw = sets[lang] || sets.javascript;
  const lineC = lang === 'python' || lang === 'gdscript' ? '#' : lang === 'sql' ? '--' : lang === 'css' || lang === 'json' ? null : '//';
  let out = '', i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i], rest = code.slice(i, i + 3);
    // block comments
    if ((lang !== 'python' && lang !== 'gdscript' && lang !== 'sql' && rest.startsWith('/*')) || (lang === 'sql' && rest.startsWith('/*'))) {
      const e = code.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2;
      out += `<span class="tok-c">${esc(code.slice(i, end))}</span>`; i = end; continue;
    }
    if ((lang === 'python' || lang === 'gdscript') && (rest === '"""' || rest === "'''")) {
      const e = code.indexOf(rest, i + 3); const end = e < 0 ? n : e + 3;
      out += `<span class="tok-s">${esc(code.slice(i, end))}</span>`; i = end; continue;
    }
    if (lineC && code.startsWith(lineC, i)) {
      const e = code.indexOf('\n', i); const end = e < 0 ? n : e;
      out += `<span class="tok-c">${esc(code.slice(i, end))}</span>`; i = end; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1; while (j < n && code[j] !== c) { if (code[j] === '\\') j++; if (code[j] === '\n' && c !== '`') break; j++; }
      j = Math.min(n, j + 1);
      const s = code.slice(i, j);
      const isKey = lang === 'json' && /^\s*:/.test(code.slice(j));
      out += `<span class="${isKey ? 'tok-p' : 'tok-s'}">${esc(s)}</span>`; i = j; continue;
    }
    if (/[0-9]/.test(c) && !/[\w$]/.test(code[i - 1] || '')) {
      const m = code.slice(i).match(/^(0x[\da-f]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?)[a-z%]*/i);
      out += `<span class="tok-n">${esc(m[0])}</span>`; i += m[0].length; continue;
    }
    if (/[A-Za-z_$@#-]/.test(c) && !(c === '-' && lang !== 'css')) {
      const m = code.slice(i).match(lang === 'css' ? /^[-\w@#.:]+/ : /^[A-Za-z_$#][\w$]*/);
      if (m) {
        const w = m[0]; const nextCh = code.slice(i + w.length).match(/^\s*(.)/)?.[1];
        let cls = '';
        const low = lang === 'sql' ? w.toLowerCase() : w;
        if (lang === 'css') cls = w.startsWith('@') ? 'tok-k' : nextCh === ':' && !w.includes(':') ? 'tok-p' : (w.startsWith('.') || w.startsWith('#')) ? 'tok-f' : '';
        else if (kw.has(low)) cls = 'tok-k';
        else if (nextCh === '(') cls = 'tok-f';
        else if (/^[A-Z][a-z]/.test(w)) cls = 'tok-t';
        out += cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w); i += w.length; continue;
      }
    }
    out += esc(c); i++;
  }
  return out;
}

function highlightHTML(code) {
  return esc(code)
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-c">$1</span>')
    .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="tok-k">$2</span>')
    .replace(/([\w-]+)=(&quot;.*?&quot;)/g, '<span class="tok-p">$1</span>=<span class="tok-s">$2</span>');
}
