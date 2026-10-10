/**
 * Document exporters: Markdown, Word (.docx, real Office Open XML) and PDF.
 * No external libraries. Word and PDF are Pro features.
 * @module core/exporters
 */
import { download } from './dom.js';
import { stripMarkdown } from './markdown.js';
import { gate } from './gate.js';
import { zip } from './zip.js';

const slug = (s) => (s || 'jarvis-x').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';

export function exportMarkdown(title, md) { return download(`${slug(title)}.md`, md, 'text/markdown'); }
export function exportWord(title, md) { if (!gate('export.docs')) return; return download(`${slug(title)}.docx`, buildDocx(title, md)); }
export function exportPDF(title, md) { if (!gate('export.docs')) return; return download(`${slug(title)}.pdf`, new Blob([buildPDF(title, stripMarkdown(md))], { type: 'application/pdf' })); }

/* -------------------------------------------------------------------- DOCX */
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function runs(text, base = '') {
  const out = []; const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g; let last = 0; let m;
  const run = (t, props = '') => `<w:r>${props || base ? `<w:rPr>${base}${props}</w:rPr>` : ''}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(run(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(run(tok.slice(2, -2), '<w:b/>'));
    else if (tok.startsWith('`')) out.push(run(tok.slice(1, -1), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="EEF2F5"/>'));
    else if (tok.startsWith('[')) { const [, l, u] = tok.match(/\[([^\]]+)\]\(([^)]+)\)/); out.push(run(`${l} (${u})`, '<w:color w:val="0A4FD6"/><w:u w:val="single"/>')); }
    else out.push(run(tok.slice(1, -1), '<w:i/>'));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(run(text.slice(last)));
  return out.join('');
}
const para = (inner, style, extra = '') => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${inner}</w:p>`;

export function buildDocx(title, md) {
  const body = [para(runs(title), 'Title')];
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n'); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { i++; while (i < lines.length && !/^```/.test(lines[i])) body.push(para(runs(lines[i++] || ' ', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>'), 'Code')); i++; continue; }
    const hd = l.match(/^(#{1,3})\s+(.*)/);
    if (hd) body.push(para(runs(hd[2]), `Heading${hd[1].length}`));
    else if (/^\s*[-*+]\s+/.test(l)) body.push(para(runs(l.replace(/^\s*[-*+]\s+(\[( |x)\]\s*)?/i, (_, c, v) => (c ? (v.trim() ? '☑ ' : '☐ ') : ''))), 'ListBullet'));
    else if (/^\s*\d+[.)]\s+/.test(l)) body.push(para(runs(l.trim()), 'ListParagraph'));
    else if (/^>\s?/.test(l)) body.push(para(runs(l.replace(/^>\s?/, '')), 'Quote'));
    else if (/^(-{3,}|\*{3,})\s*$/.test(l)) body.push(para('', null, '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr>'));
    else if (/^\|.*\|\s*$/.test(l)) { if (!/^\|[\s:|-]+\|\s*$/.test(l)) body.push(para(runs(l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('   ·   ')))); }
    else if (l.trim()) body.push(para(runs(l)));
    i++;
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1200" w:bottom="1200" w:left="1200" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const style = (id, name, rpr, ppr = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:rPr>${rpr}</w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style('Title', 'Title', '<w:b/><w:color w:val="0A4FD6"/><w:sz w:val="44"/>', '<w:spacing w:after="240"/>')}
${style('Heading1', 'heading 1', '<w:b/><w:color w:val="0A4FD6"/><w:sz w:val="32"/>', '<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/>')}
${style('Heading2', 'heading 2', '<w:b/><w:color w:val="1E3A5F"/><w:sz w:val="27"/>', '<w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/>')}
${style('Heading3', 'heading 3', '<w:b/><w:sz w:val="24"/>', '<w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="2"/>')}
${style('ListBullet', 'List Bullet', '', '<w:ind w:left="360" w:hanging="220"/>')}
${style('ListParagraph', 'List Paragraph', '', '<w:ind w:left="360"/>')}
${style('Quote', 'Quote', '<w:i/><w:color w:val="555555"/>', '<w:ind w:left="400"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="0A4FD6"/></w:pBdr>')}
${style('Code', 'Code', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>', '<w:spacing w:after="0"/><w:shd w:val="clear" w:fill="F3F6F9"/>')}
</w:styles>`;
  const fixBullets = doc.replace(/<w:pStyle w:val="ListBullet"\/><\/w:pPr>/g, '<w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t xml:space="preserve">•  </w:t></w:r>');
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>JARVIS-X</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>` },
    { name: 'word/document.xml', data: fixBullets },
    { name: 'word/styles.xml', data: styles },
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

/* --------------------------------------------------------------------- PDF */
/** Minimal PDF 1.4 writer: Helvetica, A4, wrapped lines, multiple pages. Latin-1 only. */
export function buildPDF(title, text) {
  const W = 595, H = 842, M = 56, LH = 15, FS = 11, maxChars = 92;
  const clean = (s) => s.replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const lines = [];
  for (const p of text.split('\n')) {
    if (!p.trim()) { lines.push(''); continue; }
    let cur = '';
    for (const w of p.split(/\s+/)) { if ((cur + ' ' + w).trim().length > maxChars) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
    lines.push(cur);
  }
  const perPage = Math.floor((H - 2 * M - 30) / LH);
  const pages = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += perPage) pages.push(lines.slice(i, i + perPage));
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  pages.forEach((pl, pi) => {
    let s = 'BT\n';
    if (pi === 0) s += `/F2 18 Tf ${M} ${H - M} Td (${clean(title)}) Tj\n/F1 ${FS} Tf 0 -30 Td\n`; else s += `/F1 ${FS} Tf ${M} ${H - M} Td\n`;
    for (const l of pl) s += `(${clean(l)}) Tj 0 -${LH} Td\n`;
    s += `ET\nBT /F1 8 Tf ${W - M - 60} 30 Td (JARVIS-X  ${pi + 1}/${pages.length}) Tj ET`;
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
    const contentId = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
