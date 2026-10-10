# Roadmap & Performance Notes

## Future upgrade ideas

### Done in 2.0
A real backend: accounts, an AI proxy with tools, an encrypted sync vault, live news, quotes and FX, a Docker code runner, media generation, and the Developer API. In the browser: Claude-hosted AI with tools, cloud sync via the Claude data store, real DOCX export, and WebAuthn unlock.

### Done in 2.1
Everything is free (plans and payments removed). A plugin store with 19 built-in plugins, including Image Studio, Video Studio and the Godot Engine kit. Music search and streaming across Audius, iTunes, Internet Archive, live radio and YouTube, with a queue, likes, playlists and history.

### Done in 2.2
No keys or server needed for media: Video Studio makes story videos in the browser, Image Studio can AI-paint, YouTube search works through public mirrors, and the AI Composer writes original songs that play offline and inside Claude.

### Near term
- **Web Push** (VAPID) so reminders arrive with the tab closed.
- **Calendar sync** (Google, Microsoft Graph, CalDAV) and email integration.
- **Semantic memory:** embeddings for notes, files and chats, stored with the vault, replacing keyword retrieval in `retrieveKB()`.
- **Streaming tool loop** on the server path, so tool-using answers stream token by token.
- **Shared workspaces** for teams and families.
- **Admin console:** users, usage charts and fair-use settings.
- **Plugin registry:** publish and discover community plugins with signed manifests.

### Medium term
- **Real multi-agent orchestration**: a planner that delegates to agents with tools, shared scratchpads and critique loops.
- **In-browser compilers** (WebAssembly `clang.wasm`, a JVM) so Java and C++ also run offline.
- **Team collaboration**: shared workspaces using CRDTs (Yjs) over WebSocket, with presence and comments.
- A media gallery view in the File Manager for generated images and videos.
- **Plugin marketplace backend**: signed plugin manifests, a permission prompt per capability, and a sandboxed iframe runtime.
- **Native shells**: Tauri or Electron desktop builds for global hotkeys, system tray and real CPU/RAM metrics; Capacitor for mobile.

### Long term
- Proactive assistant (calendar- and habit-aware suggestions), screen understanding, personal fine-tuned personas, an enterprise admin console with SSO (SAML/OIDC), audit logs and data residency.

## Performance optimization notes

### What's already done
| Area | Technique |
|---|---|
| Startup | Only `app.js`, core services and the dashboard load eagerly. The other 13 modules are lazy `import()`s, and `router.prefetch()` warms Assistant and Productivity in idle time. |
| Rendering | No virtual DOM. Small `h()` factory, targeted re-renders on store path subscriptions (`store.on('tasks', …)`). |
| Persistence | Debounced (400 ms) encrypted writes, plus a flush on `visibilitychange`. Blobs live in IndexedDB, outside the vault. |
| Animation | CSS transforms only (GPU-composited rings). Particles are capped at ~45 fps and 110 particles, pause on hidden tabs, and turn off with reduced motion. |
| Timers | One shared 1 s scheduler tick drives clocks, timers, reminders, Pomodoro and idle detection, instead of dozens of intervals. |
| Audio | Lookahead scheduler (25 ms tick, 120 ms horizon) for glitch-free synthesis. The analyser is shared by every visualizer. |
| Code execution | Web Worker isolation with a hard 5 s kill. The main thread never blocks. |
| Offline | Service worker caches the app shell and uses stale-while-revalidate for same-origin GETs. |
| Memory | Window modules return cleanup functions that unsubscribe listeners, cancel `requestAnimationFrame` and revoke object URLs. |

### Recommendations for scale
- **Bundle for production** (esbuild or Vite) to minify and fingerprint assets. Keep dynamic imports as split points.
- **Split the vault** into per-section encrypted records in IndexedDB once data grows past ~2 MB, so saves re-encrypt only what changed.
- **Virtualize long lists** (tasks, files, conversations) past ~500 items with an IntersectionObserver window.
- **Move heavy work off the main thread**: summarisation, quiz generation and search indexing can run in a worker.
- **Fonts**: self-host the subsetted WOFF2 files and preload the display face to avoid layout shift.
- **Measure**: watch Web Vitals (LCP, INP, CLS) and long tasks through `PerformanceObserver`; budget under 150 KB of JS for first load.
