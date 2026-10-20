/**
 * Internet — the online-mode layout of JARVIS-X.
 *
 *  ┌ tabs ─────────────────────────────────────────────┐
 *  │ ← → ⟳ ⌂ │ address / search bar │ ☆ 📖 ↗           │
 *  ├───────────────────────────────────────────────────┤
 *  │ Start page: search, quick links, today's news,     │
 *  │ Wikipedia featured, Hacker News, bookmarks, history│
 *  │   — or —  a web page / search results / reader view│
 *  └───────────────────────────────────────────────────┘
 *
 * Pages open inside the app when the site allows it. Many big sites (Google, Instagram…)
 * refuse to be shown inside other apps; for those, JARVIS-X offers Reader view (clean
 * article text through your JARVIS-X server) or opens the page in a real browser tab.
 * Search runs in-app: instant answer (DuckDuckGo), Wikipedia and YouTube videos, plus
 * one-tap "search the whole web" on Google / DuckDuckGo / Bing / Brave.
 * @module modules/internet
 */
import { h, clear, toast, fmt, uid } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import { platform } from '../core/platform.js';
import { needsInternet } from '../core/fullversion.js';

const ENGINES = {
  ddg: { label: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  google: { label: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  bing: { label: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  brave: { label: 'Brave', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
};
const DEFAULT_QUICK = [
  ['Wikipedia', 'https://en.wikipedia.org/wiki/Main_Page'], ['YouTube', 'https://www.youtube.com'], ['Gmail', 'https://mail.google.com'],
  ['WhatsApp', 'https://web.whatsapp.com'], ['GitHub', 'https://github.com'], ['Khan Academy', 'https://www.khanacademy.org'],
  ['Google Maps', 'https://maps.google.com'], ['News', 'https://news.google.com'], ['Godot Docs', 'https://docs.godotengine.org'], ['OpenStreetMap', 'https://www.openstreetmap.org'],
].map(([title, url]) => ({ title, url }));
/** Sites known to refuse being shown inside other apps → go straight to the "can't embed" card. */
const NO_FRAME = /(^|\.)(google\.[a-z.]+|gmail\.com|youtube\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|whatsapp\.com|linkedin\.com|github\.com|reddit\.com|amazon\.[a-z.]+|flipkart\.com|netflix\.com|chatgpt\.com|openai\.com|claude\.ai|microsoft\.com|live\.com|apple\.com|duckduckgo\.com|bing\.com|brave\.com|stackoverflow\.com|medium\.com|khanacademy\.org|spotify\.com|discord\.com)$/i;

const W = () => store.get('web') || {};
const setW = (patch) => store.set('web', { ...W(), ...patch });
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const favicon = (u) => `https://icons.duckduckgo.com/ip3/${host(u)}.ico`;

/** Turn what was typed into { kind: 'url', url } or { kind: 'search', q }. */
export function interpret(input) {
  const s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return { kind: 'url', url: s };
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s) && !/\s/.test(s)) return { kind: 'url', url: `https://${s}` };
  return { kind: 'search', q: s };
}
/** Rewrite links to an embeddable form where one exists. */
export function embeddable(url) {
  try {
    const u = new URL(url);
    const yt = u.hostname.endsWith('youtube.com') && u.searchParams.get('v') || (u.hostname === 'youtu.be' && u.pathname.slice(1));
    if (yt) return { url: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1`, frame: true };
    if (u.hostname.endsWith('youtube.com') && u.pathname.startsWith('/embed/')) return { url, frame: true };
    if (/(^|\.)wikipedia\.org$/.test(u.hostname) && !u.hostname.includes('.m.')) { u.hostname = u.hostname.replace('.wikipedia.org', '.m.wikipedia.org'); return { url: u.href, frame: true }; }
    return { url, frame: !NO_FRAME.test(u.hostname.replace(/^www\./, '')) };
  } catch { return { url, frame: false }; }
}
function jsonp(url, cbParam = 'callback') {
  return new Promise((resolve, reject) => {
    const cb = `__jx_${Math.random().toString(36).slice(2)}`; const s = document.createElement('script');
    const done = (f, v) => { delete window[cb]; s.remove(); clearTimeout(t); f(v); };
    window[cb] = (d) => done(resolve, d); s.onerror = () => done(reject, new Error('failed'));
    s.src = `${url}&${cbParam}=${cb}`; const t = setTimeout(() => done(reject, new Error('timeout')), 8000); document.head.append(s);
  });
}
const getJSON = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };

export default {
  mount(el, ctx) {
    if (!platform.hasNetwork) { el.append(h('div.stack', { style: 'max-width:720px' }, needsInternet('The Internet app'))); return; }
    let tabs = (W().tabs || []).filter((t) => t.url || t.q).map((t) => ({ ...t, back: [], fwd: [] }));
    let activeId = 'home';
    const tabBar = h('div.net-tabs', { role: 'tablist' });
    const addr = h('input.net-addr', { placeholder: 'Search or type a web address', 'aria-label': 'Search or address', autocomplete: 'off', spellcheck: false });
    const engineSel = h('select.select.net-engine', { 'aria-label': 'Search engine', onchange: (e) => setW({ engine: e.target.value }) }, Object.entries(ENGINES).map(([k, e]) => h('option', { value: k, selected: k === (W().engine || 'ddg') }, e.label)));
    const star = h('button.btn.ghost.icon', { title: 'Bookmark this page', 'aria-label': 'Bookmark' }, icon('star'));
    const readerBtn = h('button.btn.ghost.icon', { title: 'Reader view — clean article text', 'aria-label': 'Reader view' }, icon('book'));
    const outBtn = h('button.btn.ghost.icon', { title: 'Open in a new browser tab', 'aria-label': 'Open outside' }, icon('external'));
    const backBtn = h('button.btn.ghost.icon', { 'aria-label': 'Back', title: 'Back' }, icon('prev'));
    const fwdBtn = h('button.btn.ghost.icon', { 'aria-label': 'Forward', title: 'Forward' }, icon('next'));
    const reloadBtn = h('button.btn.ghost.icon', { 'aria-label': 'Reload', title: 'Reload' }, icon('refresh'));
    const homeBtn = h('button.btn.ghost.icon', { 'aria-label': 'Start page', title: 'Start page' }, icon('home'));
    const view = h('div.net-view');
    const tab = () => tabs.find((t) => t.id === activeId);
    const persist = () => setW({ tabs: tabs.slice(-12).map(({ id, url, q, title, mode }) => ({ id, url, q, title, mode })) });
    const remember = (url, title) => { if (!url) return; setW({ history: [{ url, title: title || host(url), ts: Date.now() }, ...(W().history || []).filter((x) => x.url !== url)].slice(0, 200) }); };

    /* ---------------- navigation */
    const go = (input, { newTab = false } = {}) => {
      const it = typeof input === 'string' ? interpret(input) : input; if (!it) return;
      let t = tab();
      if (!t || newTab) { t = { id: uid('t'), back: [], fwd: [] }; tabs.push(t); }
      if (t.url || t.q) { t.back.push({ url: t.url, q: t.q, title: t.title, mode: t.mode }); t.fwd = []; }
      Object.assign(t, it.kind === 'search' ? { q: it.q, url: null, title: it.q, mode: 'search' } : { url: it.url, q: null, title: host(it.url), mode: 'page' });
      if (it.mode) t.mode = it.mode;
      activeId = t.id; persist(); render();
      if (t.url) remember(t.url, t.title);
    };
    const restore = (from, to) => { const t = tab(); if (!t || !from.length) return; to.push({ url: t.url, q: t.q, title: t.title, mode: t.mode }); Object.assign(t, from.pop()); persist(); render(); };
    backBtn.onclick = () => restore(tab()?.back || [], tab()?.fwd || []);
    fwdBtn.onclick = () => restore(tab()?.fwd || [], tab()?.back || []);
    reloadBtn.onclick = () => render(true);
    homeBtn.onclick = () => { activeId = 'home'; render(); };
    addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { go(addr.value, { newTab: activeId === 'home' || e.ctrlKey || e.metaKey }); addr.blur(); } });
    addr.addEventListener('focus', () => addr.select());
    outBtn.onclick = () => { const t = tab(); const u = t?.url || (t?.q && ENGINES[W().engine || 'ddg'].url(t.q)); if (u) window.open(u, '_blank', 'noopener'); };
    star.onclick = () => {
      const t = tab(); if (!t?.url) return toast('Open a page to bookmark it.', { timeout: 2000 });
      const bm = W().bookmarks || []; const has = bm.some((b) => b.url === t.url);
      setW({ bookmarks: has ? bm.filter((b) => b.url !== t.url) : [{ title: t.title || host(t.url), url: t.url }, ...bm] });
      toast(has ? 'Bookmark removed' : 'Bookmarked ★', { timeout: 1500 }); paintToolbar();
    };
    readerBtn.onclick = () => { const t = tab(); if (!t?.url) return; t.mode = t.mode === 'reader' ? 'page' : 'reader'; persist(); render(); };

    /* ---------------- chrome */
    function paintTabs() {
      tabBar.replaceChildren(
        h('button.net-tab', { class: activeId === 'home' ? 'active' : '', role: 'tab', onclick: () => { activeId = 'home'; render(); } }, icon('home', { size: 14 }), h('span', 'Start')),
        ...tabs.map((t) => h('div.net-tab', { class: t.id === activeId ? 'active' : '', role: 'tab', title: t.url || t.q, onclick: () => { activeId = t.id; render(); } },
          t.url ? h('img', { src: favicon(t.url), alt: '', width: 14, height: 14, onerror: (e) => { e.target.replaceWith(icon('globe', { size: 14 })); } }) : icon('search', { size: 14 }),
          h('span', t.title || 'New tab'),
          h('button.net-x', { 'aria-label': 'Close tab', onclick: (e) => { e.stopPropagation(); const i = tabs.indexOf(t); tabs.splice(i, 1); if (activeId === t.id) activeId = tabs[i]?.id || tabs[i - 1]?.id || 'home'; persist(); render(); } }, '×'))),
        h('button.net-tab.net-new', { 'aria-label': 'New tab', title: 'New tab', onclick: () => { activeId = 'home'; render(); addr.focus(); } }, '+'));
    }
    function paintToolbar() {
      const t = tab();
      addr.value = t ? (t.url || t.q || '') : '';
      backBtn.disabled = !t?.back.length; fwdBtn.disabled = !t?.fwd.length;
      const bm = (W().bookmarks || []).some((b) => b.url === t?.url);
      star.classList.toggle('on', bm); star.disabled = !t?.url; readerBtn.disabled = !t?.url; readerBtn.classList.toggle('on', t?.mode === 'reader'); outBtn.disabled = !t;
    }
    function render(force) {
      paintTabs(); paintToolbar();
      const t = tab();
      if (!t) return startPage();
      if (t.mode === 'search') return searchPage(t.q);
      if (t.mode === 'reader') return readerPage(t);
      return pageView(t, force);
    }

    /* ---------------- start page */
    function startPage() {
      const big = h('input.net-big', { placeholder: 'Search the web or type an address…', 'aria-label': 'Search the web', onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) go(e.target.value, { newTab: true }); } });
      const hour = new Date().getHours(); const hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      const quick = W().quick || DEFAULT_QUICK;
      const tiles = h('div.net-tiles', quick.map((q, i) => h('div.net-tile', { role: 'link', tabindex: 0, title: q.url, onclick: () => go(q.url, { newTab: true }), onkeydown: (e) => e.key === 'Enter' && go(q.url, { newTab: true }) },
        h('img', { src: favicon(q.url), alt: '', width: 28, height: 28, onerror: (e) => { e.target.replaceWith(h('div.net-tile-letter', q.title[0])); } }), h('span', q.title),
        h('button.net-x', { 'aria-label': `Remove ${q.title}`, onclick: (e) => { e.stopPropagation(); setW({ quick: quick.filter((_, j) => j !== i) }); startPage(); } }, '×'))),
        h('button.net-tile.net-add', { onclick: addQuick }, h('div.net-tile-letter', '+'), h('span', 'Add site')));
      const news = h('div.list'); const wiki = h('div.stack'); const hn = h('div.list');
      const bms = (W().bookmarks || []).slice(0, 12); const hist = (W().history || []).slice(0, 10);
      const linkItem = (x, sub) => h('button.item', { style: 'cursor:pointer;color:var(--fg);text-align:left', onclick: () => go(x.url, { newTab: true }) }, h('img', { src: favicon(x.url), alt: '', width: 16, height: 16, onerror: (e) => { e.target.replaceWith(icon('globe', { size: 16 })); } }), h('span.grow', { style: 'min-width:0' }, h('div.small', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, x.title), h('div.xs.muted', sub || host(x.url))));
      clear(view).append(h('div.net-start',
        h('div.net-hero', h('div.small.dim', `${hi}, ${store.get('profile.name') || 'there'} — you're online`), big, h('div.row', { style: 'gap:6px;justify-content:center' }, h('span.xs.muted', 'Search with'), engineSel)),
        h('div.section-title', 'Your sites'), tiles,
        h('div.net-cols',
          h('section.glass.widget.stack', h('div.w-title', icon('news', { size: 14 }), "Today's news"), news),
          h('section.glass.widget.stack', h('div.w-title', icon('globe', { size: 14 }), 'From Wikipedia today'), wiki),
          h('section.glass.widget.stack', h('div.w-title', icon('code', { size: 14 }), 'Tech — Hacker News'), hn)),
        h('div.net-cols',
          h('section.glass.widget.stack', h('div.w-title', icon('star', { size: 14 }), 'Bookmarks'), bms.length ? h('div.list', bms.map((b) => linkItem(b))) : h('div.small.muted', 'Tap ☆ on any page to keep it here.')),
          h('section.glass.widget.stack', h('div.w-title', icon('clock', { size: 14 }), 'Recently visited'), hist.length ? h('div.list', hist.map((x) => linkItem(x, `${host(x.url)} · ${fmt.rel(x.ts)}`))) : h('div.small.muted', 'Pages you open show up here.'),
            hist.length ? h('button.btn.ghost.sm', { style: 'justify-self:start', onclick: () => { setW({ history: [] }); startPage(); } }, 'Clear history') : null))));
      setTimeout(() => big.focus(), 30);
      loadNews(news); loadWiki(wiki); loadHN(hn);
    }
    function addQuick() {
      const t = tab(); const url = null;
      import('../core/dom.js').then(({ modal }) => {
        const title = h('input.input', { placeholder: 'Name, e.g. My school', value: t?.title || '' }); const link = h('input.input', { placeholder: 'https://…', value: t?.url || url || '' });
        modal({ title: 'Add a site', titleIcon: 'plus', body: h('div.stack', title, link), actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: (close) => { const it = interpret(link.value); if (it?.kind !== 'url') return toast('Enter a web address', { type: 'warn' }); setW({ quick: [...(W().quick || DEFAULT_QUICK), { title: title.value.trim() || host(it.url), url: it.url }] }); close(); startPage(); } }] });
      });
    }
    async function loadNews(box) {
      box.replaceChildren(h('div.small.dim', 'Loading…'));
      try {
        let items;
        if (platform.isServer) items = (await (await import('../core/api.js')).api('/api/data/news')).items.slice(0, 7).map((x) => ({ title: x.title, url: x.link, sub: x.source }));
        else {
          const d = new Date(); const j = await getJSON(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
          items = (j.news || []).slice(0, 6).map((n) => ({ title: n.story.replace(/<[^>]+>/g, ''), url: n.links?.[0]?.content_urls?.desktop?.page || 'https://en.wikipedia.org/wiki/Portal:Current_events', sub: 'Wikipedia · In the news' }));
        }
        box.replaceChildren(...items.map((x) => h('button.item', { style: 'cursor:pointer;color:var(--fg);text-align:left', onclick: () => go(x.url, { newTab: true }) }, h('span.grow', h('div.small', x.title), h('div.xs.muted', x.sub || host(x.url))))));
      } catch { box.replaceChildren(h('div.small.muted', 'News is unavailable right now.')); }
    }
    async function loadWiki(box) {
      box.replaceChildren(h('div.small.dim', 'Loading…'));
      try {
        const d = new Date();
        const j = await getJSON(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
        const tfa = j.tfa; const otd = (j.onthisday || [])[0];
        box.replaceChildren(
          tfa ? h('button.item', { style: 'cursor:pointer;color:var(--fg);text-align:left;align-items:flex-start', onclick: () => go(tfa.content_urls.desktop.page, { newTab: true }) },
            tfa.thumbnail ? h('img', { src: tfa.thumbnail.source, alt: '', style: 'width:64px;height:64px;object-fit:cover;border-radius:8px;flex:none' }) : null,
            h('span.grow', h('div.xs.muted', 'Featured article'), h('b.small', tfa.normalizedtitle || tfa.title), h('div.xs.dim', (tfa.extract || '').slice(0, 160) + '…'))) : null,
          otd ? h('div.small', h('span.xs.muted', `On this day · ${otd.year}`), h('div', otd.text)) : null);
      } catch { box.replaceChildren(h('div.small.muted', 'Wikipedia is unavailable right now.')); }
    }
    async function loadHN(box) {
      box.replaceChildren(h('div.small.dim', 'Loading…'));
      try {
        const ids = (await getJSON('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 6);
        const items = await Promise.all(ids.map((id) => getJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
        box.replaceChildren(...items.filter(Boolean).map((x) => { const url = x.url || `https://news.ycombinator.com/item?id=${x.id}`; return h('button.item', { style: 'cursor:pointer;color:var(--fg);text-align:left', onclick: () => go(url, { newTab: true }) }, h('span.grow', h('div.small', x.title), h('div.xs.muted', `${host(url)} · ${x.score} points`))); }));
      } catch { box.replaceChildren(h('div.small.muted', 'Hacker News is unavailable right now.')); }
    }

    /* ---------------- search results (in-app) */
    async function searchPage(q) {
      const answer = h('div'); const wiki = h('div.list'); const vids = h('div.net-vids');
      const webBtns = h('div.row', { style: 'gap:6px' }, h('span.small.dim', 'Search the whole web:'), Object.entries(ENGINES).map(([k, e]) => h('button.btn.sm', { class: k === (W().engine || 'ddg') ? 'primary' : '', onclick: () => window.open(e.url(q), '_blank', 'noopener') }, icon('external', { size: 12 }), e.label)));
      clear(view).append(h('div.net-results', h('h2', { style: 'margin:0' }, q), webBtns, answer, h('div.section-title', 'Wikipedia'), wiki, h('div.section-title', 'Videos'), vids,
        h('div.xs.muted', 'Full web results open in a real browser tab because search engines don’t allow other apps to show them.')));
      // Instant answer
      jsonp(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`).then((j) => {
        const text = j.AbstractText || j.Answer || j.Definition; if (!text) return;
        answer.replaceChildren(h('div.glass.widget.stack', h('div.xs.muted', `Instant answer${j.AbstractSource ? ` · ${j.AbstractSource}` : ''}`), h('div', text), j.AbstractURL ? h('button.btn.ghost.sm', { style: 'justify-self:start', onclick: () => go(j.AbstractURL) }, 'Read more') : null));
      }).catch(() => {});
      getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=6&format=json&origin=*`).then((j) => {
        const r = j.query?.search || [];
        wiki.replaceChildren(...(r.length ? r.map((x) => h('button.item', { style: 'cursor:pointer;color:var(--fg);text-align:left', onclick: () => go(`https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`) }, icon('book', { size: 14 }), h('span.grow', h('b.small', x.title), h('div.xs.dim', { html: x.snippet.replace(/<(?!\/?span)[^>]+>/g, '') + '…' })))) : [h('div.small.muted', 'No Wikipedia articles.')]));
      }).catch(() => wiki.replaceChildren(h('div.small.muted', 'Wikipedia unavailable.')));
      vids.replaceChildren(h('div.small.dim', 'Finding videos…'));
      import('../core/music-sources.js').then(({ SOURCES }) => SOURCES.youtube.search(q)).then((list) => {
        vids.replaceChildren(...list.slice(0, 8).map((v) => h('button.net-vid', { onclick: () => go(`https://www.youtube.com/watch?v=${v.youtubeId}`) }, h('img', { src: v.artwork, alt: '', loading: 'lazy' }), h('div.small', v.title), h('div.xs.muted', v.artist))));
      }).catch(() => vids.replaceChildren(h('div.small.muted', 'Video search is busy — use the YouTube button above.')));
    }

    /* ---------------- web page */
    function pageView(t, force) {
      const e = embeddable(t.url);
      if (!e.frame) {
        clear(view).append(h('div.net-blocked', h('img', { src: favicon(t.url), alt: '', width: 40, height: 40, onerror: (ev) => { ev.target.replaceWith(icon('globe', { size: 40 })); } }),
          h('h3', host(t.url)), h('div.small.dim', 'This site doesn’t allow other apps to show it inside them. You can open it in a real browser tab, or read it here in Reader view.'),
          h('div.row', { style: 'justify-content:center' }, h('button.btn.primary', { onclick: () => window.open(t.url, '_blank', 'noopener') }, icon('external'), 'Open in new tab'),
            h('button.btn', { onclick: () => { t.mode = 'reader'; persist(); render(); } }, icon('book'), 'Reader view'))));
        return;
      }
      const frame = h('iframe.net-frame', { src: e.url, title: t.title || 'Web page', referrerpolicy: 'strict-origin-when-cross-origin', allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads' });
      const hint = h('div.net-hint', 'Page stays blank? Some sites block being shown in apps — ', h('button.linklike', { onclick: () => { t.mode = 'reader'; persist(); render(); } }, 'Reader view'), ' or ', h('button.linklike', { onclick: () => window.open(t.url, '_blank', 'noopener') }, 'open in a new tab'), '.');
      clear(view).append(frame, hint);
      if (force) frame.src = e.url;
    }

    /* ---------------- reader view */
    async function readerPage(t) {
      const box = h('article.net-reader', h('div.small.dim', 'Getting the article…'));
      clear(view).append(box);
      try {
        let data;
        const wikiM = t.url.match(/^https?:\/\/(\w+)\.(?:m\.)?wikipedia\.org\/wiki\/([^#?]+)/);
        if (wikiM) {
          const j = await getJSON(`https://${wikiM[1]}.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&explaintext=1&piprop=thumbnail&pithumbsize=600&titles=${wikiM[2]}&format=json&origin=*`);
          const p = Object.values(j.query.pages)[0];
          data = { title: p.title, site: 'Wikipedia', image: p.thumbnail?.source, blocks: (p.extract || '').split('\n').filter(Boolean).map((x) => (/^=+ .* =+$/.test(x) ? { t: 'h', x: x.replace(/=/g, '').trim() } : { t: 'p', x })) };
        } else if (platform.isServer) {
          data = await (await import('../core/api.js')).api(`/api/web/read?url=${encodeURIComponent(t.url)}`);
        } else throw new Error('Reader view for this site needs the JARVIS-X server (it fetches the page for you). Wikipedia articles work everywhere.');
        t.title = data.title || t.title; persist(); paintTabs();
        box.replaceChildren(h('div.xs.muted', data.site || host(t.url)), h('h1', data.title),
          data.image ? h('img', { src: data.image, alt: '', loading: 'lazy' }) : null,
          ...(data.blocks || []).map((b) => (b.t === 'h' ? h('h2', b.x) : b.t === 'li' ? h('p', `• ${b.x}`) : b.t === 'q' ? h('blockquote', b.x) : b.t === 'pre' ? h('pre.code', b.x) : h('p', b.x))),
          h('div.row', h('button.btn.ghost.sm', { onclick: () => window.open(t.url, '_blank', 'noopener') }, icon('external', { size: 13 }), 'Original page'),
            h('button.btn.ghost.sm', { onclick: () => { store.unshift('notes', { id: uid('n'), title: data.title, body: `# ${data.title}\n\nSource: ${t.url}\n\n${(data.blocks || []).map((b) => (b.t === 'h' ? `## ${b.x}` : b.x)).join('\n\n').slice(0, 30000)}`, format: 'md', pinned: false, updated: Date.now() }); toast('Saved to Notes', { type: 'ok' }); } }, icon('note', { size: 13 }), 'Save to Notes'),
            h('button.btn.ghost.sm', { onclick: () => bus.emit('home:ask', { text: `Summarise this article in 5 bullet points:\n\n${data.title}\n\n${(data.blocks || []).map((b) => b.x).join('\n').slice(0, 12000)}` }) }, icon('sparkles', { size: 13 }), 'Summarise with AI')));
      } catch (e) {
        box.replaceChildren(h('div.net-blocked', h('h3', 'Reader view unavailable'), h('div.small.dim', e.message), h('button.btn.primary', { onclick: () => window.open(t.url, '_blank', 'noopener') }, icon('external'), 'Open in new tab')));
      }
    }

    el.append(h('div.net', tabBar, h('div.net-bar', backBtn, fwdBtn, reloadBtn, homeBtn, h('div.net-addr-wrap', icon('search', { size: 15 }), addr), star, readerBtn, outBtn), view));
    if (ctx?.params?.url || ctx?.params?.q) go(ctx.params.url || ctx.params.q, { newTab: true }); else render();
    this.update = (p) => { if (p?.url || p?.q) go(p.url || p.q, { newTab: true }); };
  },
};
