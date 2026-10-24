/**
 * Small, safe Markdown renderer (escape-first; no raw HTML passthrough).
 * Supports headings, emphasis, inline/fenced code, lists, quotes, links, tables, hr.
 * Fenced code is syntax-highlighted via core/highlight.js.
 * @module core/markdown
 */
import { esc } from './dom.js';
import { highlight } from './highlight.js';

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(>])_([^_\n]+)_(?=$|[\s.,!?:;)<])/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(src = '') {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = line.match(/^```\s*([\w+#-]*)/);
    if (fence) {
      const lang = fence[1] || ''; const buf = [];
      i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code data-lang="${esc(lang)}">${highlight(buf.join('\n'), lang)}</code></pre>`);
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }
    const hd = line.match(/^(#{1,6})\s+(.*)/);
    if (hd) { const n = Math.min(hd[1].length, 4); out.push(`<h${n}>${inline(esc(hd[2]))}</h${n}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${inline(esc(buf.join(' ')))}</blockquote>`); continue; }
    // table
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(esc(c.trim())));
      const head = row(line); i += 2; const body = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div style="overflow-x:auto"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    // lists
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)/);
    if (li) {
      const ordered = /\d/.test(li[1]); const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)/); if (!m) break;
        let txt = esc(m[2]);
        txt = txt.replace(/^\[( |x)\]\s*/i, (_, x) => `<input type="checkbox" disabled ${x.trim() ? 'checked' : ''}> `);
        items.push(`<li>${inline(txt)}</li>`); i++;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    // paragraph
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out.push(`<p>${inline(esc(buf.join('\n'))).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n');
}

/** Strip markdown to plain text (for TTS and previews). */
export function stripMarkdown(s = '') {
  return s.replace(/```[\s\S]*?```/g, ' (code block) ').replace(/`([^`]+)`/g, '$1').replace(/[*_~#>]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\|/g, ' ').replace(/\n{2,}/g, '\n').trim();
}
