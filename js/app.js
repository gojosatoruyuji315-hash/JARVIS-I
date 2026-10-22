/**
 * JARVIS-X — application bootstrap.
 *
 *  1. Unlock / load the encrypted vault          (core/store)
 *  2. Apply theme + accessibility settings        (core/theme)
 *  3. Render the shell: top bar, dock, home HUD   (this file + modules/dashboard)
 *  4. Startup sequence, shortcuts, scheduler, voice, service worker
 *
 * Feature modules are lazy-loaded by core/router when first opened.
 * A small public API is exposed on window.JX for plugins and debugging.
 */
import { h, $, clear, append, toast, confirmDialog, modal } from './core/dom.js';
import { icon, logoSVG } from './core/icons.js';
import { bus } from './core/bus.js';
import { store } from './core/store.js';
import { applyTheme, SKINS } from './core/theme.js';
import { particles } from './core/particles.js';
import { startup, shutdown, lockScreen } from './core/boot.js';
import { router, MODULES, moduleById } from './core/router.js';
import { installShortcuts } from './core/shortcuts.js';
import { startScheduler, notify } from './core/scheduler.js';
import { voice } from './core/voice.js';
import { ask, newConversation, quota } from './core/assistant.js';
import { license } from './core/license.js';
import { studyMode, STUDY_MODULES, initStudyMode } from './core/studymode.js';
import { overlayChip, consumeImport } from './core/fullversion.js';
import { plugins } from './core/plugins.js';
import { openPalette, openSearch } from './core/palette.js';
import { t } from './core/i18n.js';
import { renderHome } from './modules/dashboard.js';
import { engine as musicEngine } from './core/audio.js';
import { providers } from './core/ai.js';
import { platform } from './core/platform.js';
import { sync } from './core/sync.js';
/** Captured before the router rewrites the hash: data carried from the Claude viewer. */
const CARRIED = location.hash.startsWith('#jx-import=') ? location.hash : null;
import { refreshFX } from './core/mathx.js';

/* ------------------------------------------------------------------ shell */
let home = null;
function renderShell() {
  const root = clear($('#jx-root'));
  const dock = h('nav.jx-dock', { 'aria-label': 'Modules' });
  const stage = h('main.jx-stage', { id: 'jx-stage' });
  const layer = h('div.win-layer');
  const top = h('header.jx-top');
  root.append(h('div.jx-shell', top, dock, stage));
  renderTop(top); renderDock(dock);
  home = renderHome(stage, { onVoice: toggleVoice });
  stage.append(layer);
  router.init(layer);
  bus.on('module:open', ({ id, params }) => { const key = id === 'plugin' ? `plugin:${params?.plugin}` : id; for (const b of dock.querySelectorAll('.nav-item')) b.classList.toggle('active', b.dataset.id === key); });
}

/** Sidebar: named, grouped navigation. Collapsible to icons; trims to study tools in study mode. */
const NAV = [
  { items: ['home', 'assistant', 'internet'] },
  { title: 'Work & study', items: ['productivity', 'study', 'files', 'memory'] },
  { title: 'Create & play', items: ['music', 'dev', 'automation'] },
  { title: 'Extras', items: ['plugins', 'analytics', 'workspace'] },
];
const HINTS = {
  home: 'Your dashboard and widgets', internet: 'Browse the web: tabs, search, bookmarks, reader view', assistant: 'Chat — ask JARVIS-X anything or tell it to do things',
  productivity: 'Tasks, notes, calendar, reminders, habits, Pomodoro', study: 'Flashcards, quizzes, mind maps, exam mode, progress',
  files: 'Your files and generated images, videos and music', memory: 'What JARVIS-X remembers about you',
  music: 'Search and play music, or compose songs with AI', dev: 'Write, run and debug code',
  automation: 'Routines that do several steps for you', plugins: 'Add tools: image & video studio, Godot, translator…',
  analytics: 'Charts of your productivity and study', workspace: 'AI agents, knowledge base, projects, developer API',
  settings: 'Themes, voice, AI, privacy and shortcuts',
};
function renderDock(dock) {
  clear(dock);
  const pref = store.get('settings.sidebar'); const compact = pref ? pref === 'compact' : innerWidth < 1100;
  document.querySelector('.jx-shell')?.classList.toggle('dock-compact', compact);
  const studying = studyMode.active && studyMode.session.focus;
  const item = (id, ic, label, onclick, extra = {}) => h('button.nav-item', { dataset: { id }, title: HINTS[id] || label, 'aria-label': label, class: id === router.current ? 'active' : '', onclick, ...extra }, icon(ic), h('span.nav-label', label));
  for (const g of NAV) {
    const ids = g.items.filter((id) => !studying || STUDY_MODULES.has(id));
    if (!ids.length) continue;
    if (g.title) dock.append(h('div.nav-group', g.title));
    for (const id of ids) { const m = moduleById(id); dock.append(item(id, m.icon, t(id), () => router.open(id))); }
  }
  const pinned = studying ? [] : plugins.installed().filter((p) => p.hasPanel !== false && plugins.isPinned(p.id));
  if (pinned.length) {
    dock.append(h('div.nav-group', 'Your plugins'));
    for (const p of pinned) dock.append(h('button.nav-item', { dataset: { id: `plugin:${p.id}` }, title: p.description || p.name, 'aria-label': p.name, onclick: () => plugins.openPanel(p.id) }, icon(p.icon || 'plug'), h('span.nav-label', p.name)));
  }
  if (studying) dock.append(h('div.nav-note', 'Other apps are hidden while you study'));
  dock.append(h('div.nav-spacer'));
  dock.append(h('button.nav-item.study-toggle', { class: studyMode.active ? 'on' : '', title: studyMode.active ? 'Study mode is on — open the session' : 'Focus on studying: tutor AI, timer, fewer distractions', 'aria-pressed': String(studyMode.active), onclick: () => studyMode.openDialog() },
    icon('book'), h('span.nav-label', studyMode.active ? 'Study mode: on' : 'Study mode'), h('i.switch', { 'aria-hidden': 'true' })));
  dock.append(item('settings', 'settings', t('settings'), () => router.open('settings')));
  dock.append(h('button.nav-item.nav-collapse', { title: compact ? 'Show names' : 'Hide names', 'aria-label': compact ? 'Expand sidebar' : 'Collapse sidebar', onclick: () => { store.set('settings.sidebar', compact ? 'full' : 'compact'); renderDock(dock); } }, icon(compact ? 'next' : 'prev'), h('span.nav-label', 'Collapse')));
}

function renderTop(top) {
  clear(top);
  const clock = h('span.mono');
  const webOn = store.get('settings.ai.web') !== false;
  const canWeb = platform.directNetwork && navigator.onLine;
  const net = h('button.chip.hide-sm.live-chip', { class: canWeb && webOn ? 'on' : '', title: !canWeb ? 'Offline — the AI answers from what it knows' : webOn ? 'Live web is ON — the AI searches the internet for current information. Click to turn off.' : 'Live web is OFF — click so the AI can search the internet', 'aria-pressed': String(canWeb && webOn),
    onclick: () => { if (!canWeb) { if (platform.isHost) import('./core/fullversion.js').then((m) => m.showOverlay({ reason: 'Live web needs a normal browser tab — the Claude viewer keeps pages offline.' })); return; } store.set('settings.ai.web', !webOn); renderTop($('.jx-top')); toast(!webOn ? 'Live web on — the AI will look things up online.' : 'Live web off — the AI answers from what it knows.', { timeout: 2500 }); } },
    h('i.dot', { class: canWeb ? '' : 'off' }), !canWeb ? 'OFFLINE' : webOn ? 'LIVE WEB' : 'ONLINE');
  const q = quota();
  const user = license.user();
  append(top, [
    h('div.jx-brand', { html: `${logoSVG}<span>JARVIS-X</span><small>AI&nbsp;OS</small>` }),
    h('div.jx-status', net, h('span.chip', icon('clock', { size: 12 }), clock)),
    h('div.spacer'),
    h('button.btn.ghost.sm', { onclick: () => openSearch(), title: 'Smart search (Ctrl+K)', 'aria-label': 'Search' }, icon('search'), h('span.hide-sm', t('search')), h('kbd.hide-sm', 'Ctrl K')),
    h('button.btn.ghost.icon.hide-sm', { onclick: openPalette, title: 'Command palette (Ctrl+P)', 'aria-label': 'Command palette' }, icon('menu')),
    studyMode.chip(),
    overlayChip(),
    syncChip(),
    q.max !== Infinity ? h('span.pill.hide-sm', { title: 'AI requests left today' }, `${Math.max(0, q.left)}/${q.max} AI`) : null,
    h('button.btn.ghost.icon', { onclick: () => router.open('account'), title: user ? (user.email || user.name || 'Account') : platform.isServer ? 'Sign in' : 'Profile', 'aria-label': 'Account' }, user?.avatarUrl ? h('img', { src: user.avatarUrl, alt: '', style: 'width:22px;height:22px;border-radius:50%' }) : icon('user')),
    h('button.btn.ghost.icon', { onclick: () => lockNow(), title: 'Lock (Alt+L)', 'aria-label': 'Lock' }, icon('lock')),
    h('button.btn.ghost.icon', { onclick: () => powerOff(), title: 'Shut down', 'aria-label': 'Shut down' }, icon('power')),
  ]);
  const upd = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  upd(); clearInterval(renderTop.t); renderTop.t = setInterval(upd, 1000);
  const netUpd = () => { net.replaceChildren(h('i.dot', { class: navigator.onLine ? '' : 'off' }), navigator.onLine ? 'ONLINE' : 'OFFLINE'); };
  addEventListener('online', netUpd); addEventListener('offline', netUpd);
}

function syncChip() {
  const st = sync.status;
  if (st.state === 'off') return null;
  const label = { syncing: 'Syncing…', synced: 'Synced', error: 'Sync issue' }[st.state] || '';
  return h('button.pill.hide-sm', { class: st.state === 'error' ? 'hi' : st.state === 'synced' ? 'ok' : '', style: 'background:none;cursor:pointer', title: st.error || `Synced with ${st.target}${st.last ? ' at ' + new Date(st.last).toLocaleTimeString() : ''}`, onclick: () => router.open('account') }, icon('cloud', { size: 12 }), label);
}

/* ------------------------------------------------------------------ voice */
let voiceBusy = false;
async function startListening() {
  if (platform.isHost) { toast('Voice input isn\'t available inside the Claude viewer. Type instead — replies can still be spoken (Settings → Voice).', { type: 'warn' }); return; }
  if (!voice.supported.stt) { toast('Voice input needs Chrome, Edge or Safari. You can still type commands.', { type: 'warn' }); return; }
  if (voiceBusy) return; voiceBusy = true;
  try {
    const text = await voice.listen({ onPartial: (p) => home?.showPartial(p) });
    voiceBusy = false;
    if (text) await askAndShow(text, { speak: true });
    else home?.showPartial('');
  } catch (e) { voiceBusy = false; toast(e.message, { type: 'error' }); home?.showPartial(''); }
}
function toggleVoice() { if (voice.listening) voice.stop(); else startListening(); }

/** Ask the assistant from home/voice and render the reply in the HUD card. */
async function askAndShow(text, { speak = store.get('settings.voice.autoSpeak') } = {}) {
  if (router.current === 'assistant') { bus.emit('assistant:ask', { text }); return; }
  const tts = speak && voice.supported.tts ? voice.speakStream() : null;
  home?.showReply(text, '');
  const res = await ask(text, { onChunk: (full) => { home?.showReply(text, full); tts?.push(full); } });
  tts?.end();
  renderTop($('.jx-top'));
  return res;
}

/* ---------------------------------------------------------------- system */
function lockNow() {
  const sec = store.get('settings.security');
  if (!sec.lockEnabled) {
    modal({ title: 'Set up a password lock', titleIcon: 'lock', body: 'Protect JARVIS-X with a password. Your data will be encrypted with a key derived from it, and the app will lock after inactivity.', actions: [
      { label: 'Not now', kind: 'ghost' },
      { label: 'Open security settings', kind: 'primary', onClick: (c) => { c(); router.open('settings', { tab: 'security' }); } },
    ] });
    return;
  }
  voice.cancelSpeech();
  lockScreen({ mode: 'session', verify: (pw) => store.verifyPassword(pw) });
}
async function powerOff() {
  voice.cancelSpeech(); musicEngine.pause();
  await shutdown(async () => { await startup(startupVariant()); });
}
const startupVariant = () => { const v = store.get('settings.startup'); return v === 'prime' && !allowed('startup.exclusive') ? 'standard' : v; };

/* -------------------------------------------------------------- bus wiring */
function wire() {
  bus.on('open', ({ id, params }) => router.open(id, params));
  bus.on('open:url', ({ url, external }) => {
    if (!external && platform.hasNetwork) return router.open('internet', { url }); // online mode: open in the Internet app
    let w = null; try { w = window.open(url, '_blank'); if (w) w.opener = null; } catch { /* */ }
    if (!w) toast(h('span', 'Open link: ', h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url)), { timeout: 9000 });
  });
  bus.on('assistant:ask', ({ text }) => {
    if (router.current === 'assistant') return; // the chat module handles it
    router.open('assistant', { ask: text });
  });
  bus.on('chat:new', () => newConversation());
  bus.on('theme:set', ({ skin }) => {
    store.set('settings.skin', skin); applyTheme(); particles.refreshColor();
  });
  bus.on('theme:apply', () => { applyTheme(); particles.sync(); });
  bus.on('system', ({ cmd }) => { if (cmd === 'lock') lockNow(); if (cmd === 'shutdown') powerOff(); });
  bus.on('voice:toggle', toggleVoice);
  bus.on('voice:say', ({ text }) => { if (store.get('settings.voice.autoSpeak')) voice.speak(text, { interrupt: false }); });
  bus.on('privacy', (on) => { document.documentElement.classList.toggle('privacy', on); toast(on ? 'Privacy mode on — conversations are not saved.' : 'Privacy mode off.', { type: 'info' }); });
  bus.on('plan:change', () => { applyTheme(); renderTop($('.jx-top')); renderDock($('.jx-dock')); home?.refresh(); });
  bus.on('sync:status', () => renderTop($('.jx-top')));
  bus.on('plugins:change', () => renderDock($('.jx-dock')));
  bus.on('studymode:change', () => { renderDock($('.jx-dock')); renderTop($('.jx-top')); });
  bus.on('studymode:tick', () => $('.study-chip')?._tick?.());
  bus.on('platform:ready', () => { if (platform.isHost) { sync.start(); if (!store.get('profile.name') || store.get('profile.name') === 'Operator') { const n = platform.host.me?.name; if (n) store.set('profile.name', n.split(' ')[0]); } } renderTop($('.jx-top')); });
  bus.on('ai:usage', () => renderTop($('.jx-top')));
  bus.on('routine:run', async ({ id }) => { const { runRoutine } = await import('./modules/automation.js'); runRoutine(id); });
  bus.on('home:ask', ({ text }) => askAndShow(text));
}

function shortcuts() {
  installShortcuts({
    voice: (phase) => { if (phase === 'down') startListening(); else voice.stop(); },
    search: () => openSearch(),
    palette: () => openPalette(),
    memory: () => router.open('memory'),
    notes: () => router.open('productivity', { tab: 'notes' }),
    tasks: () => router.open('productivity', { tab: 'tasks' }),
    home: () => router.close(),
    assistant: () => router.open('assistant'),
    settings: () => router.open('settings'),
    music: () => musicEngine.toggle(),
    nextTrack: () => musicEngine.next(),
    lock: () => lockNow(),
    close: () => {
      if (document.querySelector('.palette')) { document.querySelector('.palette').remove(); return; }
      if (document.querySelector('.modal-backdrop')) { import('./core/dom.js').then((d) => d.closeTopModal()); return; }
      if (voice.speaking) { voice.cancelSpeech(); return; }
      router.close();
    },
  });
}

/* ------------------------------------------------------------------- main */
async function main() {
  const res = await store.init();
  if (res.locked) {
    await new Promise((resolve) => lockScreen({ mode: 'vault', verify: (pw) => store.unlock(pw), onUnlock: resolve,
      onReset: async () => { if (await confirmDialog('This permanently deletes all JARVIS-X data on this device.', { title: 'Reset all data?', okLabel: 'Delete everything', danger: true })) { await store.reset(); location.reload(); } } }));
  }
  applyTheme();
  const boot = startup(startupVariant());
  await platform.detect();
  await license.init();
  applyTheme();
  renderShell();
  particles.init();
  wire(); shortcuts(); startScheduler();
  if (res.corrupt) toast('Saved data could not be decrypted on this device, so JARVIS-X started fresh.', { type: 'warn', timeout: 9000 });
  if (!store.persistent) toast('Storage is unavailable here. Your changes will last for this session only.', { type: 'warn', timeout: 9000 });
  await boot;

  await handleHashActions();
  router.prefetch();
  if (!platform.isHost) sync.start();          // host sync starts when its capabilities arrive
  refreshFX({ server: platform.isServer, network: platform.hasNetwork });
  bus.on('platform:net', () => { renderTop($('.jx-top')); if (platform.hasNetwork) { refreshFX({ network: true }); home?.refresh(); } });

  // Wake word (experimental)
  if (store.get('settings.voice.wakeWord') && !platform.isHost) voice.startWakeWord((rest) => (rest ? askAndShow(rest, { speak: true }) : startListening()));

  if (!store.get('seen.onboarding') && !CARRIED) onboarding();

  plugins.init();
  initStudyMode();
  // One-time: the new default voice is "Sweet & caring" (only replaces the old default).
  if (!store.get('settings.ai.sweetSet')) { if (store.get('settings.ai.personality') === 'balanced') store.set('settings.ai.personality', 'sweet'); store.set('settings.ai.sweetSet', true); }

  // Offline support (not available in every sandbox)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

/** One-off URL actions: payment returns, password reset links, deep links. */
async function handleHashActions() {
  const hash = location.hash.slice(1);
  const clearHash = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* */ } };
  if (CARRIED) consumeImport(CARRIED);
  else if (hash.startsWith('billing-')) clearHash();
  else if (hash.startsWith('reset-')) { clearHash(); router.open('account', { reset: hash.slice(6) }); }
  else if (hash && MODULES.some((m) => m.id === hash)) router.open(hash);
}

/** First-run setup: name, theme, notifications. */
function onboarding() {
  const name = h('input.input', { value: license.user()?.name || '', placeholder: 'What should I call you?', 'aria-label': 'Your name' });
  const skins = h('div.row', SKINS.map((k) => h('button.btn.sm', { onclick: () => bus.emit('theme:set', { skin: k.id }) }, h('i', { style: `width:12px;height:12px;border-radius:50%;background:${k.colors[2]};display:inline-block` }), k.name)));
  const where = { server: 'Sign in from the account menu to sync across devices and unlock your plan.', host: 'You\'re running inside Claude: answers come from Claude and your data syncs to your Claude account.', standalone: 'Everything stays in this browser, encrypted. Add an AI key in Settings → AI for full answers.' }[platform.mode];
  modal({ title: 'Welcome to JARVIS-X', titleIcon: 'hud', dismissable: false, body: h('div.stack',
    h('label.field', 'Your name', name), h('div.field.xs.dim', 'Theme'), skins,
    h('div.small.dim', where),
    h('div.small.dim', 'Hold ', h('kbd', 'Space'), ' to talk · ', h('kbd', 'Ctrl K'), ' search · ', h('kbd', 'Ctrl P'), ' every action')),
  actions: [{ label: 'Get started', kind: 'primary', onClick: (close) => {
    if (name.value.trim()) store.set('profile.name', name.value.trim().slice(0, 60));
    store.set('seen.onboarding', true); close();
    import('./core/scheduler.js').then((m) => m.requestNotificationPermission());
    home?.refresh();
  } }] });
}

/* ------------------------------------------------- public plugin/debug API */
window.JX = {
  version: '2.8.0', bus, store, router, voice, ask, license, providers, platform, sync,
  /** Plugin API — see js/core/plugins.js and docs/PLUGINS.md. */
  plugins,
};

main().catch((e) => {
  console.error(e);
  $('#jx-root').append(h('div.empty', { style: 'margin:40px' }, `JARVIS-X failed to start: ${e.message}`));
});
