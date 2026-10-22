# JARVIS-X

JARVIS-X is a browser-based AI operating system. It's a holographic command center with:
- a tool-using AI assistant
- voice control
- productivity, study and developer workspaces
- a file manager, automation and a music player that searches and streams real music
- a plugin store: image and video generation, a Godot game-dev kit, translation, QR codes, finance and more

**Everything is free.** There is one plan with every feature, no payments and no limits (a server owner can set an optional fair-use cap on AI requests).

The front end is plain HTML, CSS and ES modules with no build step. The server is plain Node with no npm dependencies.

> **Original work.** JARVIS-X is inspired by the *feel* of cinematic AI assistants. It contains no film or franchise assets, characters or dialogue. If you publish it, check the product name for trademark conflicts in your market.

## Three ways to run it

| | **Self-hosted server** | **Inside Claude** (the published artifact) | **Static / personal** |
|---|---|---|---|
| Start | `npm start` | Open the artifact link | Any static host, e.g. `python3 -m http.server` |
| AI | Your server's Anthropic or OpenAI key, with tools | **Claude, on the viewer's own account**, with tools | Your own key (Anthropic, OpenAI, OpenRouter or Ollama), or the offline engine |
| Accounts | Email and password accounts, sessions, devices, password reset | Your claude.ai identity | None (single person) |
| Sync | Encrypted server vault, merged across devices | Your private Claude data store, live across devices | This browser only (encrypted) |
| Music | Search YouTube, Audius, Internet Archive, live radio and iTunes previews — no keys needed — plus the AI Composer | AI Composer, your files and generative tracks; **Full internet** opens the full version for search | Same as server |
| Plugins | All 19 | 16 of 19 — Image Studio and Video Studio switch to AI-painted pictures; only Dictionary, Wikipedia and GitHub need the web | All 19 (Video Studio's optional AI-model mode needs the server) |
| Internet | Direct | The viewer keeps pages offline — the **Full internet** button opens the full version (hosted or on your computer) and carries your data across | Direct |
| Live data | News, stock quotes, exchange rates, weather | In the full version | Weather and exchange rates |
| Code | Python, Java, C, C++ and JS in Docker sandboxes, plus real SQLite | JS (Web Worker) | JS, Python (Pyodide) |

The app detects which environment it is in at startup (`js/core/platform.js`) and switches backends automatically.

## Run it on your computer (full internet, no install)

Unzip, then double-click:
- **Windows:** `Start JARVIS-X (Windows).bat` — needs nothing installed (uses built-in PowerShell; uses Node.js if you have it)
- **Mac:** `Start JARVIS-X (Mac).command` — uses Node.js, Python 3 or Ruby, whichever the Mac has (if macOS says it's from an unidentified developer: right-click → Open)
- **Linux:** `./start-jarvis-x.sh`

It opens `http://localhost:8765` in your browser with direct internet. Use the browser's **Install app** button to keep it in your dock / Start menu. Inside Claude, the **Full internet** button opens this copy (or your hosted one) and brings your data with it.

## Put it on the web (GitHub Pages)

Push this folder to a GitHub repository, then in the repo: **Settings → Pages → Source: GitHub Actions**. The included workflow (`.github/workflows/pages.yml`) publishes the app to `https://<you>.github.io/<repo>/` on every push. Paste that address into **Full internet** inside Claude once and it's remembered.

## Quick start (server)

```bash
git clone … && cd jarvis-x
cp .env.example .env       # add ANTHROPIC_API_KEY and PUBLIC_URL (everything else is optional)
npm start                  # Node ≥ 22.13, nothing to install
open http://localhost:8080
```

Production: `docker compose up -d --build` behind HTTPS. **[server/README.md](server/README.md)** covers deployment, the code runner, media keys and the API reference.

Run the tests (with mocked AI and media providers) using `npm test`.

## Highlights

- **The assistant takes actions.** "Remind me at 6 to call Sam", "move my dentist task to Friday", "make flashcards from this chapter" and "play some lo-fi" all happen in the app through 21 built-in tools. Installed plugins add more (generate an image, make a Godot project, log an expense, look something up on Wikipedia…). Destructive actions can be undone.
- **Music you choose.** Search YouTube (full songs in the official player — no API key needed), Audius (full tracks from independent artists), Internet Archive (public-domain and Creative Commons recordings), 30,000+ live radio stations and iTunes (30-second previews). Play now, play next, queue, like, build playlists — all synced. Say "play Bohemian Rhapsody" anywhere.
- **AI Composer.** Describe a song ("rainy evening lo-fi", "calm raga", "8-bit adventure") and the AI writes an original one — tempo, key, chords, melody — that the built-in synthesiser performs live. Works offline and inside Claude; download as WAV.
- **Ollama.** Run AI on your own computer: JARVIS-X detects Ollama, lets you download and pick models, and tool-capable models can use every JARVIS-X action and the live web.
- **Live web.** Turn on LIVE WEB and the AI searches the internet and reads pages before answering current questions, with real facts and a Sources list (Anthropic web search/fetch when you use an Anthropic key; free DuckDuckGo/Wikipedia search otherwise).
- **Internet.** A built-in browser for online mode: tabs, one bar for search and addresses, a start page with your sites, news, Wikipedia and Hacker News, in-app search results with playable videos, bookmarks, history and Reader view.
- **Study mode.** One switch turns JARVIS-X into a study space: a personal **Teacher** that plans the lesson, teaches step by step, checks your answers and makes flashcards; the assistant talks like a teacher (and sweetly the rest of the time); a session timer with Pomodoro breaks, only study tools in the sidebar, held notifications and a summary that logs your minutes.
- **Plugins.** Image and video generation live in plugins. **Video Studio** turns a sentence into a captioned, scored video right in your browser (AI storyboard → a picture per scene → animation → MP4), with optional AI video models on the server. **Image Studio** uses free FLUX or lets the AI paint the picture, so both work without keys — even inside Claude. Alongside them is the **Godot Engine** plugin — ready-to-run Godot 4 projects from templates, AI GDScript, Godot 3 → 4 upgrades, snippets and an AI dock for the Godot editor — and 16 more. Anyone can build one; see [docs/PLUGINS.md](docs/PLUGINS.md).
- **Security works in layers:**
  - A local vault (AES-256-GCM; device key or a PBKDF2-derived password key).
  - Server data encrypted at rest.
  - scrypt password hashing, httpOnly session cookies, CSRF header checks, rate limits and a strict CSP.
  - WebAuthn biometric unlock for the lock screen.
- **Offline first.** A service worker and the offline engine keep it working without a network, and sync catches up when you reconnect.
- **Exports are genuine files.** Markdown, real `.docx` (Office Open XML), PDF, SVG/PNG, ZIP.
- **Nothing is fake.** No sample headlines, simulated tickers or placeholder exchange rates. Widgets show live data or say plainly why it isn't available.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Hold `Space` | Push-to-talk (outside text fields) |
| `Ctrl+K` / `Ctrl+P` | Smart search / command palette |
| `Ctrl+M`/`Alt+M`, `Ctrl+N`/`Alt+N`, `Ctrl+T`/`Alt+T` | Memory, notes, tasks |
| `Alt+H`, `Alt+A`, `Alt+S` | Home, assistant, settings |
| `Alt+P`, `Alt+→` | Play/pause music, next track |
| `Shift+←/→`, `Shift+↑/↓` | Previous/next track, volume (in Music) |
| `Alt+L` | Lock |
| `Esc` | Close dialog or window, stop speech |
| `Ctrl+Enter` | Run code |

You can rebind these in Settings → Shortcuts.

## Folder structure

```
jarvis-x/
├── index.html · sandbox.html · manifest.webmanifest · sw.js
├── css/                 tokens (6 themes + high contrast), base, hud, components, modules
├── js/
│   ├── app.js           boot, shell, dock (incl. pinned plugins), voice loop, onboarding
│   ├── core/
│   │   ├── platform.js  environment detection (server / Claude host / standalone)
│   │   ├── ai.js        providers (Claude, server, Anthropic, OpenAI-compatible, offline) + tool loop
│   │   ├── tools.js     the assistant's app actions (+ plugin tools)
│   │   ├── plugins.js   plugin runtime: install, activate, scoped API, commands, tools
│   │   ├── audio.js     music engine: queue, streams, YouTube player, likes, playlists
│   │   ├── music-sources.js  YouTube (key or mirrors), Audius, iTunes, Internet Archive, radio search
│   │   ├── composer.js  AI Composer: song plan → bass, chords, arpeggio, lead, drums
│   │   ├── license.js   identity per platform (everyone gets every feature)
│   │   ├── sync.js      cross-device sync (server vault or Claude data store)
│   │   ├── store.js     encrypted local state with per-section timestamps
│   │   └── …            api, exporters, zip, crypto, idb, router, voice, scheduler, commands, palette, theme, hud, boot…
│   ├── modules/         lazy-loaded features (assistant, productivity, study, devspace, files, music, memory,
│   │                    automation, analytics, workspace, plugins, plugin-host, account, settings, dashboard)
│   └── plugins/         catalog.js + built-in plugins (image-studio, video-studio, godot, …)
├── server/
│   ├── index.js         HTTP server, routing, CSRF, static files
│   ├── lib/             config, SQLite, auth (scrypt/JWT/sessions), http helpers, mail
│   ├── routes/          auth, ai, sync (+ /v1 API), data, run, media (images, speech, Replicate, music search)
│   └── test/            integration tests + provider mocks
├── docs/                ARCHITECTURE.md · FEATURES.md · PLUGINS.md · ROADMAP.md
├── .env.example · Dockerfile · docker-compose.yml · package.json
```

## Documentation

- [docs/FEATURES.md](docs/FEATURES.md): every feature
- [docs/PLUGINS.md](docs/PLUGINS.md): the built-in plugins and how to write your own
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): data flow, platform adapters, security model, how to extend
- [docs/ROADMAP.md](docs/ROADMAP.md): what's next and performance notes
- [server/README.md](server/README.md): deployment, media keys, API

## Browser support

The latest Chrome, Edge, Safari and Firefox are supported. Voice input needs Chrome, Edge or Safari. The Claude viewer blocks the microphone and the network, but spoken replies, Claude-powered AI, the AI Composer, AI-painted images, story videos and every offline plugin still work there. Encryption requires `https://` or `localhost`.
