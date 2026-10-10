/**
 * File Manager: a virtual file system stored in IndexedDB (metadata + blobs).
 * Upload (button / drag & drop), download, folders, search, rename, move,
 * delete, recent files, favorites and previews (image, text, audio, PDF).
 * @module modules/files
 */
import { h, clear, fmt, uid, toast, confirmDialog, promptDialog, pickFiles, download, modal, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { idb } from '../core/idb.js';
import { engine } from '../core/audio.js';

const MAX_FILE = 50 * 1024 * 1024;

/** All file metadata (used by Smart Search). */
export async function fileIndex() {
  const keys = await idb.keys('files').catch(() => []);
  return (await Promise.all(keys.map((k) => idb.get('files', k)))).filter(Boolean);
}
async function saveFile(file, folder) {
  if (file.size > MAX_FILE) { toast(`${file.name} is larger than 50 MB and was skipped.`, { type: 'warn' }); return null; }
  const meta = { id: uid('f'), name: file.name, type: file.type || guessType(file.name), size: file.size, folder, created: Date.now(), modified: file.lastModified || Date.now(), accessed: Date.now() };
  await idb.set('blobs', meta.id, file); await idb.set('files', meta.id, meta);
  return meta;
}
const guessType = (n) => ({ md: 'text/markdown', txt: 'text/plain', json: 'application/json', csv: 'text/csv', js: 'text/javascript', py: 'text/x-python', mp3: 'audio/mpeg', wav: 'audio/wav', png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' })[n.split('.').pop().toLowerCase()] || 'application/octet-stream';
const kindIcon = (t) => (t.startsWith('image/') ? 'image' : t.startsWith('audio/') ? 'music' : t.startsWith('video/') ? 'video' : /json|javascript|python|x-/.test(t) ? 'code' : t.startsWith('text/') ? 'note' : 'file');

export default {
  flush: true,
  async mount(el, ctx) {
    let folder = '/'; let view = 'folder'; let q = ''; let selected = ctx.params?.select || null; const thumbs = [];
    const folders = () => store.get('files.folders') || ['/', '/Documents', '/Images', '/Music'];
    const favs = () => new Set(store.get('files.favorites') || []);
    const aside = h('aside'); const main = h('main');
    el.append(h('div.split', aside, main));

    const renderAside = () => clear(aside).append(
      h('button.btn.primary', { onclick: upload }, icon('upload'), 'Upload'),
      h('button.btn', { onclick: async () => { const n = await promptDialog('New folder name'); if (n) { const p = (folder === '/' ? '' : folder) + '/' + n.replace(/\//g, '-'); store.set('files.folders', [...new Set([...folders(), p])]); folder = p; view = 'folder'; render(); } } }, icon('folder'), 'New folder'),
      h('div.section-title', 'Library'),
      [['recent', 'clock', 'Recent'], ['favorites', 'star', 'Favorites'], ['all', 'layers', 'All files']].map(([v, ic, l]) => h('button.item', { class: view === v ? 'active' : '', style: 'cursor:pointer;color:var(--fg)', onclick: () => { view = v; render(); } }, icon(ic, { size: 15 }), h('span.grow.small', l))),
      h('div.section-title', 'Folders'),
      folders().sort().map((f) => h('button.item', { class: view === 'folder' && folder === f ? 'active' : '', style: `cursor:pointer;color:var(--fg);padding-left:${10 + (f.split('/').length - 2) * 12}px`, onclick: () => { folder = f; view = 'folder'; render(); },
        ondragover: (e) => e.preventDefault(), ondrop: async (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/jx-file'); if (id) { const m = await idb.get('files', id); await idb.set('files', id, { ...m, folder: f }); toast(`Moved to ${f}`, { type: 'ok' }); render(); } } },
        icon('folder', { size: 15 }), h('span.grow.small', f === '/' ? 'Home' : f.split('/').pop()))),
      h('div.section-title', 'This computer'),
      h('button.item', { style: 'cursor:pointer;color:var(--fg)', onclick: browseLocal }, icon('device', { size: 15 }), h('span.grow.small', 'Browse a local folder')));

    async function browseLocal() {
      // Placeholder for local file indexing via the File System Access API (Chromium only).
      if (!window.showDirectoryPicker) { toast('Local folder access needs a Chromium browser outside sandboxed frames. Use Upload instead.', { type: 'warn' }); return; }
      try {
        const dir = await window.showDirectoryPicker(); const names = [];
        for await (const [name, handle] of dir.entries()) { names.push(`${handle.kind === 'directory' ? '[dir]' : '     '} ${name}`); if (names.length > 200) break; }
        modal({ title: `Local: ${dir.name}`, body: h('pre.console', { style: 'height:300px' }, names.join('\n')), actions: [{ label: 'Close' }] });
      } catch (e) { if (e.name !== 'AbortError') toast(`Couldn't open folder: ${e.message}`, { type: 'error' }); }
    }
    async function upload(files) {
      const list = files instanceof Array ? files : await pickFiles();
      let n = 0; for (const f of list) if (await saveFile(f, view === 'folder' ? folder : '/')) n++;
      if (n) toast(`Uploaded ${n} file${n === 1 ? '' : 's'}`, { type: 'ok' });
      render();
    }
    async function open(meta) {
      await idb.set('files', meta.id, { ...meta, accessed: Date.now() });
      const blob = await idb.get('blobs', meta.id); if (!blob) return toast('File data is missing.', { type: 'error' });
      const url = URL.createObjectURL(blob); thumbs.push(url);
      let body;
      if (meta.type.startsWith('image/')) body = h('img', { src: url, alt: meta.name, style: 'max-height:60vh;margin:auto;display:block;border-radius:8px' });
      else if (meta.type.startsWith('audio/')) body = h('div.stack', h('audio', { src: url, controls: true, style: 'width:100%' }), h('button.btn', { onclick: () => { engine.addFile(new File([blob], meta.name, { type: meta.type }), { fileId: meta.id, play: true }); toast('Playing in Music', { type: 'ok' }); } }, icon('music'), 'Play in Music'));
      else if (meta.type.startsWith('video/')) body = h('video', { src: url, controls: true, style: 'width:100%;max-height:60vh' });
      else if (meta.type === 'application/pdf') body = h('div.stack', h('div.small.dim', 'PDF preview opens in a new tab.'), h('a.btn', { href: url, target: '_blank', rel: 'noopener' }, icon('external'), 'Open PDF'));
      else if (meta.size < 2e6 && /^text\/|json|javascript|python|xml|csv/.test(meta.type)) { const txt = await blob.text(); body = h('pre.console', { style: 'height:50vh' }, txt.slice(0, 200000)); }
      else body = h('div.empty', 'No preview for this file type.');
      modal({ title: meta.name, wide: true, body: h('div.stack', body, h('div.xs.muted', `${fmt.bytes(meta.size)} · ${meta.type} · ${meta.folder}`)), actions: [
        { label: 'Download', icon: 'download', onClick: () => download(meta.name, blob) }, { label: 'Close', kind: 'primary' }] });
      render();
    }

    async function render() {
      renderAside();
      const all = await fileIndex(); const fv = favs();
      let items = all;
      if (q) items = all.filter((f) => f.name.toLowerCase().includes(q));
      else if (view === 'folder') items = all.filter((f) => f.folder === folder);
      else if (view === 'favorites') items = all.filter((f) => fv.has(f.id));
      else if (view === 'recent') items = [...all].sort((a, b) => b.accessed - a.accessed).slice(0, 24);
      items.sort((a, b) => (view === 'recent' ? 0 : a.name.localeCompare(b.name)));
      thumbs.splice(0).forEach((u) => URL.revokeObjectURL(u));
      const used = all.reduce((a, f) => a + f.size, 0);
      const sel = all.find((f) => f.id === selected);
      const search = h('input.input', { placeholder: 'Search all files', value: q, style: 'max-width:280px', 'aria-label': 'Search files' });
      search.addEventListener('input', () => { q = search.value.toLowerCase(); render().then(() => { const s = main.querySelector('input'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); });
      const subfolders = view === 'folder' && !q ? folders().filter((f) => f !== folder && f.startsWith(folder === '/' ? '/' : folder + '/') && f.slice((folder === '/' ? 0 : folder.length) + 1).split('/').length === 1 && f !== '/') : [];
      const grid = h('div.file-grid');
      for (const f of subfolders) grid.append(h('button.file-tile', { ondblclick: () => { folder = f; render(); }, onclick: () => { folder = f; render(); } }, icon('folder'), h('span.nm', f.split('/').pop())));
      for (const f of items) {
        let thumb = icon(kindIcon(f.type));
        if (f.type.startsWith('image/') && f.size < 8e6) { const b = await idb.get('blobs', f.id); if (b) { const u = URL.createObjectURL(b); thumbs.push(u); thumb = h('img', { src: u, alt: '' }); } }
        grid.append(h('button.file-tile', { class: f.id === selected ? 'sel' : '', draggable: true, title: f.name, ondragstart: (e) => e.dataTransfer.setData('text/jx-file', f.id), onclick: () => { selected = f.id; render(); }, ondblclick: () => open(f) },
          fv.has(f.id) ? h('span.fav', '★') : null, thumb, h('span.nm', f.name), h('span.xs.muted', fmt.bytes(f.size))));
      }
      const actions = sel ? h('div.row',
        h('span.small', { style: 'font-weight:600' }, sel.name),
        h('button.btn.sm', { onclick: () => open(sel) }, icon('eye'), 'Open'),
        h('button.btn.sm', { onclick: async () => download(sel.name, await idb.get('blobs', sel.id)) }, icon('download'), 'Download'),
        h('button.btn.sm', { onclick: async () => { const n = await promptDialog('Rename file', { value: sel.name }); if (n) { await idb.set('files', sel.id, { ...sel, name: n, modified: Date.now() }); render(); } } }, icon('edit'), 'Rename'),
        h('button.btn.sm', { onclick: () => { const s = favs(); s.has(sel.id) ? s.delete(sel.id) : s.add(sel.id); store.set('files.favorites', [...s]); render(); } }, icon('star'), favs().has(sel.id) ? 'Unfavorite' : 'Favorite'),
        h('select.select.sm', { style: 'width:auto', 'aria-label': 'Move to folder', onchange: async (e) => { await idb.set('files', sel.id, { ...sel, folder: e.target.value }); toast(`Moved to ${e.target.value}`, { type: 'ok' }); render(); } }, h('option', { value: sel.folder }, 'Move to…'), folders().map((f) => h('option', { value: f }, f))),
        h('button.btn.danger.sm', { onclick: async () => { if (await confirmDialog(`Delete "${sel.name}"? This can't be undone.`, { danger: true, okLabel: 'Delete' })) { await idb.del('files', sel.id); await idb.del('blobs', sel.id); selected = null; render(); } } }, icon('trash'), 'Delete')) : null;
      const drop = h('div.dropzone', icon('upload', { size: 22 }), h('div', 'Drag & drop files here, or ', h('button.btn.sm', { onclick: upload }, 'browse')), h('div.xs.muted', `${all.length} files · ${fmt.bytes(used)} stored locally in your browser${idb.isFallback ? ' (memory only — IndexedDB unavailable)' : ''}`));
      for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
      for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]); });
      const crumbs = view === 'folder' ? folder.split('/').filter(Boolean).reduce((acc, part) => { const p = (acc.at(-1)?.p || '') + '/' + part; acc.push({ p, part }); return acc; }, []) : [];
      clear(main).append(
        h('div.row', view === 'folder' ? [h('button.btn.ghost.sm', { onclick: () => { folder = '/'; render(); } }, 'Home'), crumbs.map((c) => [h('span.muted', '/'), h('button.btn.ghost.sm', { onclick: () => { folder = c.p; render(); } }, c.part)])] : h('h3', { recent: 'Recent', favorites: 'Favorites', all: 'All files' }[view]), h('span.grow'), search),
        drop, actions, items.length || subfolders.length ? grid : h('div.empty', q ? 'No files match your search.' : 'This folder is empty.'));
    }
    // Drag files anywhere in the window
    el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    el.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length && !e.target.closest('.dropzone')) { e.preventDefault(); upload([...e.dataTransfer.files]); } });
    await render();
    this.update = (p) => { if (p.select) { selected = p.select; q = ''; view = 'all'; render(); } };
    return () => thumbs.forEach((u) => URL.revokeObjectURL(u));
  },
};
