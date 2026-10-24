/**
 * JARVIS-X service worker — offline support.
 * Strategy: precache the app shell; stale-while-revalidate for same-origin GETs;
 * network-only for cross-origin (APIs, fonts fall back gracefully).
 * Bump CACHE when shipping a new version.
 */
const CACHE = 'jarvis-x-v2.12.1';
const SHELL = [
  './', 'index.html', 'sandbox.html', 'manifest.webmanifest', 'assets/icons/logo.svg',
  'css/tokens.css', 'css/base.css', 'css/hud.css', 'css/components.css', 'css/modules.css',
  'js/app.js',
  'js/core/ai.js', 'js/core/assistant.js', 'js/core/audio.js', 'js/core/boot.js', 'js/core/bus.js', 'js/core/commands.js',
  'js/core/crypto.js', 'js/core/dom.js', 'js/core/exporters.js', 'js/core/gate.js', 'js/core/highlight.js', 'js/core/hud.js', 'js/core/i18n.js',
  'js/core/icons.js', 'js/core/idb.js', 'js/core/license.js', 'js/core/markdown.js', 'js/core/mathx.js', 'js/core/palette.js',
  'js/core/particles.js', 'js/core/plans.js', 'js/core/router.js', 'js/core/scheduler.js',
  'js/core/shortcuts.js', 'js/core/store.js', 'js/core/theme.js', 'js/core/voice.js',
  'js/core/platform.js', 'js/core/api.js', 'js/core/tools.js', 'js/core/sync.js', 'js/core/zip.js',
  'js/modules/dashboard.js', 'js/modules/assistant.js', 'js/modules/productivity.js', 'js/modules/study.js',
  'js/modules/devspace.js', 'js/modules/files.js', 'js/modules/music.js', 'js/modules/memory.js', 'js/modules/automation.js',
  'js/modules/analytics.js', 'js/modules/workspace.js', 'js/modules/settings.js', 'js/modules/account.js',
  'js/core/music-sources.js', 'js/core/composer.js', 'js/core/net.js', 'js/core/fullversion.js', 'js/core/studymode.js', 'js/modules/teacher.js', 'js/modules/internet.js', 'js/core/liveweb.js', 'js/core/webllm.js', 'js/core/gemini.js', 'js/core/cloud.js', 'js/config.js', 'js/core/filelist.js', 'js/core/plugins.js',
  'js/modules/plugins.js', 'js/modules/plugin-host.js',
  'js/plugins/catalog.js', 'js/plugins/github.js', 'js/plugins/godot-templates.js', 'js/plugins/godot.js', 'js/plugins/image-studio.js', 'js/plugins/language.js', 'js/plugins/lifestyle.js', 'js/plugins/svg-illustrator.js', 'js/plugins/utilities.js', 'js/plugins/video-studio.js', 'js/plugins/voice-studio.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin || /\/(api|v1)(\/|$)/.test(u.pathname)) return; // never cache API calls
  if (u.pathname.endsWith('/js/config.js')) { // site settings: always try the newest first
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || network;
  }));
});
