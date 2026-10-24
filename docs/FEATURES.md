# JARVIS-X Feature Guide

**Everything here is free for everyone.** There is a single plan with every feature — no payments, no locks and no usage limits (a server owner may set an optional fair-use cap on AI requests).

## Interface & HUD
| Feature | Notes |
|---|---|
| Holographic core | Five animated SVG rings, tick scale, a voice-level arc and states (standby, listening, processing, speaking). Click it to talk. |
| HUD designs | Classic, Minimal, Reactor and Prime (gold halo) |
| Startup / shutdown | Diagnostic boot log, CRT-collapse shutdown, quick mode and the *Prime* sequence. |
| Particle field | Canvas particles with proximity links that follow the cursor. Pauses when hidden, capped at about 45 fps. |
| Glass panels, neon glow, corner brackets | All driven by tokens in `css/tokens.css` |
| Themes | Arc Blue, Midnight Silver, Daylight Lab, Aurum, Nebula, Obsidian Prime · custom accent color |
| Command palette, Smart search | `Ctrl+P` / `Ctrl+K`, fully keyboard driven |

## Google Gemini (free key)

- **Settings → AI → Google Gemini:** paste a free key from aistudio.google.com/apikey (step-by-step instructions are shown). JARVIS-X checks it and switches to Gemini.
- **Choose a model:** Gemini 3.8 Flash (default), 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, Gemini 4 Argon (paid tier), plus any other chat model your key can use (loaded live from Google).
- Streams answers, uses every JARVIS-X action (tasks, reminders, notes, music…) and searches the **live web** with JARVIS-X's free search tools, ending with a Sources list.
- The key is encrypted in the browser's vault and never synced. Server owners can set `GEMINI_API_KEY` / `GEMINI_MODEL` instead.

## Live web (the AI goes online)
With **Live web** on (top-bar **LIVE WEB** chip, the Assistant's *Live web* button, or Settings → AI), the assistant looks things up on the real internet before answering anything current or factual — news, prices, scores, weather, people in office, release dates — and answers with the actual information plus a **Sources** list.
- **JARVIS-X server with an Anthropic key, or your own Anthropic key:** Claude uses Anthropic's own *web search* and *web fetch* tools — it searches, reads pages and cites them (searches are billed by Anthropic at about $10 per 1,000). If web search is switched off for the API account, JARVIS-X falls back to its free search automatically.
- **Other engines:** JARVIS-X's free tools — *search_web* (DuckDuckGo results through your server; DuckDuckGo instant answers + Wikipedia in the browser) and *read_webpage* (the server's reader; Wikipedia anywhere). OpenAI-compatible keys get the search results handed to them first.
- **No AI engine at all:** factual questions are answered straight from live search results, with sources.
- You see what it's doing while it works ("Searching the web for …", "Reading …").
- Inside the Claude viewer pages can't go online, so the chip shows OFFLINE and offers the full version.

## Internet (online mode)
A browser built into JARVIS-X, in the sidebar under **Internet**:
- **Tabs** with back, forward, reload, start page, bookmarks (☆) and history.
- **One bar for everything:** type a question to search, or an address to open it.
- **Start page:** big search box, your sites as tiles (add/remove your own), today's news (Google News on the server, Wikipedia *In the news* elsewhere), Wikipedia's featured article and *On this day*, Hacker News, bookmarks and recently visited.
- **In-app search results:** instant answer, Wikipedia articles and YouTube videos that play right there — plus one-tap Google / DuckDuckGo / Bing / Brave for full web results.
- **Pages open inside the app** when the site allows it (Wikipedia, YouTube videos, docs, blogs…). Sites that refuse to be shown inside other apps (Google, Instagram, WhatsApp…) get a card with **Open in new tab** and **Reader view**.
- **Reader view:** clean article text with *Save to Notes* and *Summarise with AI* (any site on the JARVIS-X server, which fetches the page safely for you; Wikipedia everywhere).
- Links you open from the assistant, commands ("open wikipedia.org") or routines open here; "search the web for …" searches here.

## Sidebar
Every item has a name and a hover description, grouped into **Work & study**, **Create & play** and **Extras**, with your pinned plugins below. Collapse it to icons with **Collapse** (it starts collapsed on narrower screens); on phones it becomes a labelled bottom bar.

## How JARVIS-X talks
Normally JARVIS-X talks **sweetly** — warm, gentle and encouraging, like a caring friend (Settings → AI → Personality: *Sweet & caring*, the default). In study mode it switches to a **teacher** voice automatically, and back when the session ends.

## Study mode
Switch it on from the sidebar, the Study window, the command palette, or by saying "start study mode" / "study for chemistry". Pick a subject, a goal and a length (25–120 min):
- **Your teacher (Study → Teacher):** tell it what you want to learn (and optionally paste your notes or load a notes file). It plans the lesson as checkpoints, teaches one step at a time with examples, asks you to try, checks your answers and corrects mistakes kindly. One-tap help: *Next step*, *Explain simpler*, *Another example*, *Test me*, *I'm stuck*, *Summarise*. **Make flashcards** turns the lesson into a deck; replies can be read aloud; the lesson is saved so you can continue later. The Teacher tab works any time, not only in study mode.
- **Teacher voice everywhere:** while study mode is on, JARVIS-X talks like a teacher in every chat — clear, structured, hints before answers, one question back to you each time.
- **Focus:** the sidebar shows only study tools, and non-urgent notifications wait until the session ends (reminders still come through).
- **Timer & breaks:** a countdown sits in the top bar with pause/resume; a 5-minute break is suggested every 25 minutes.
- **Study music (optional):** calm lo-fi made on your device by the AI Composer.
- **Summary:** when you finish, your minutes are logged in Study → Progress, held notifications are listed, and **Quiz me on it** starts a quiz on the subject.

## Dashboard widgets
- **Clock** with world times.
- **Weather** from live Open-Meteo data, using GPS or a city search.
- **Calendar**, **Tasks**, and **Notes** (a scratchpad).
- **System diagnostics:** estimated CPU load from event-loop lag, JS heap, battery, and network type and speed.
- **Location.**
- **News:** live Google News, with a topic you choose (server).
- **Markets:** live delayed quotes for a watchlist you edit, e.g. `RELIANCE.NS, ^NSEI, AAPL` (server).
- **Music**, **Stopwatch** with laps and multiple **timers**, **Calculator**, **Quick launcher**, and **Daily insight**.

Widgets that need something this environment lacks are hidden by default. If you turn one on, it says what's needed.

## AI assistant
- Streaming chat, conversation history and a configurable context window
- Unlimited requests (instant commands never touch the AI at all)
- Long-term memory injected into context
- Personalities: Balanced, Concise, Mentor, Witty, Executive and Custom
- Document analysis (upload txt/md/csv/json/code → summary)
- Export a conversation to Markdown, PDF or Word
- Save a reply as a note, pin it to memory, speak it, copy it
- Knowledge-base retrieval in chat

**Engines.** Inside Claude, answers come from Claude on your own account. On the server, they come from the server's Anthropic or OpenAI key. Standalone, you can use a free Gemini key, a downloadable built-in model, or your own Anthropic/OpenAI key. All of them can **use the app's tools**: create, update and delete tasks; add events; set reminders; search, read and save notes; remember and forget; start timers and focus sessions; open modules; change themes; control music and **search and play any song**; create flashcards; run routines; calculate; and search the knowledge base. Installed plugins add their own tools (generate images and videos, create Godot projects, log expenses, look things up on Wikipedia, file GitHub issues…).

**Offline engine.** This is the fallback when no model is reachable. It covers greetings with a daily briefing, "plan my day" (time blocks), math, linear and quadratic equation solving with steps, unit and currency conversion, extractive summaries with key terms, a 26-topic explainer pack, brainstorming (SCAMPER lenses), email and essay templates, text tightening, a phrasebook translator, static code review and homework guidance.

## Voice
Push-to-talk (hold `Space` or click the core or mic) · live partial transcripts · text-to-speech with **sentence streaming** while the reply is generated · interruption (speaking or `Esc` stops TTS) · adjustable speed and pitch · system voice picker · 8 recognition languages · profiles: Standard, Calm, Brisk, Deep, Bright and Custom · wake word (experimental).

## Productivity
Task manager (lists, priorities, due dates, filters, inline edit) · Notes (Markdown with live split preview, or rich text with a toolbar; pin, search, export) · Calendar (month grid, day panel, event reminders) · Reminders (once, daily or weekly; snooze; desktop notifications) · Pomodoro (focus, short and long breaks, custom length; runs in the background and logs focus minutes) · Daily planner (hourly blocks, top priority, gratitude) · Goals with progress · Habit tracker with 7-day grid and streaks · Draggable sticky notes · Clipboard manager (paste to capture, pin, copy).

## Study mode
Flashcards with Leitner spaced repetition (5 boxes) and import/export · Quiz generator from decks or pasted notes (cloze) · MCQ generator with distractors and export · Homework helper (Socratic hint mode; equations solved offline) · **Exam mode** with countdown, no feedback until the end, and fullscreen · Revision planner (learn, then review at +1, +3 and +7 days, then mock exams; adds to the calendar) · **Mind maps** from an indented outline, exported as SVG · Progress dashboard · Study timer.

## Developer workspace
An editor with syntax highlighting, line numbers, smart indent and Tab support for **JavaScript, HTML, CSS, Python, Java, C++, SQL, JSON and Markdown** — plus **GDScript** when the Godot plugin is installed.
- **Run:** JS runs in an isolated Web Worker. Python runs via Pyodide in the browser, or on the server. **Java, C, C++ and Python run on the server's Docker sandbox runner.** **SQL** runs on the server's real SQLite, or a mini engine offline. HTML and CSS render in a sandboxed preview. JSON shows a tree view. Markdown shows a preview.
- **Analyze:** static checks for `var`, `==`, `eval`, `innerHTML`, bare `except`, `SELECT *`, deep nesting, nested loops and bracket balance.
- **AI:** Explain · Debug · Optimize · Write tests · AI coding studio project generator.
- API tester (method, headers, body, timing, JSON tree, history) · JSON viewer (pretty, minify, validate) · Storage inspector (vault size, encryption mode, sections, quota).

## Smart search
Instant calculator, unit and currency conversion · notes, tasks, events, memory, conversations and files · async Wikipedia summary and dictionary definition · links out to web, image, video, map, Wikipedia and dictionary search · "Ask JARVIS-X" fallback.

## Personal memory
Long-term facts (tagged, inline-editable, capacity meter) · preferences · favorite prompts (also listed in the palette) · recent conversations · projects · frequently used commands · JSON backup and restore · cloud sync (server or Claude).

## Automation
Routines built from steps: speak, notify, open module, open website, add task, start focus, music, set theme, wait, ask AI and conditional **If** branches. Triggers can be manual, by voice ("run morning focus") or daily at a set time. Includes a visual **workflow builder**.

## File manager
IndexedDB virtual file system · upload through the button or drag & drop · folders and nested folders · breadcrumbs · drag a file onto a folder to move it · search · rename · delete · favorites · recent · previews for images, text and code, audio (play in Music, kept in your queue), video and PDF · download · read-only browsing of a local folder via the File System Access API (Chromium).

## Music
**Search real music and play whatever you pick.**
| Source | What you get | Needs |
|---|---|---|
| **Audius** | Full-length tracks from independent artists | nothing |
| **Internet Archive** | Public-domain and Creative Commons recordings (78s, live concerts, classical, old-time radio) | nothing |
| **Live radio** | 30,000+ stations worldwide (radio-browser.info) | nothing |
| **iTunes** | 30-second previews of almost any mainstream song, with album art | nothing |
| **YouTube** | Full songs and music videos in the official YouTube player | nothing — searches go through public Piped/Invidious mirrors (an optional API key or your own mirror can be added) |
| **Your files** | Any audio you upload or keep in the File Manager | — |
| **AI Composer** | Original songs the AI writes for you (8 styles incl. lo-fi, synthwave, cinematic, chiptune, Indian classical-inspired), performed live by the synthesiser; download as WAV | nothing — works offline and inside Claude |
| **Generative** | Three original tracks synthesised live with Web Audio | — |

- Play now, **play next**, add to queue, reorder and remove, clear, save the queue as a playlist.
- **Liked songs**, **playlists** and **recently played**, synced across devices.
- Shuffle, repeat all / one / off, seek, volume, a real-time visualizer, album artwork, MediaSession (lock screen and media keys).
- Say or type **"play <song or artist>"** or **"compose a song about <anything>"** anywhere, or let the assistant pick or write music for you.
- Inside the Claude viewer (no network) search is off, so Music opens on the AI Composer; your files and the generative tracks also work.

## Full internet
The Claude viewer keeps pages offline. Inside it, JARVIS-X shows a **Full internet** button that opens the full version — the same app as a normal web page with your real connection — and **brings your data along** (tasks, notes, chats, memory, music library, settings; never keys or passwords). The full version can be your hosted copy (GitHub Pages / your server) or the copy on your computer, started with the one-click launcher for Windows, Mac or Linux. **Download for my computer** builds the app and launchers as a zip right from the page.

## Plugins
Install from **Plugins** in the dock. Plugins with a window are pinned to the dock; all can add command-bar commands and assistant tools. See [PLUGINS.md](PLUGINS.md) for the full list and how to build your own.
- **Image Studio** — text-to-image with Pollinations FLUX (free, no key), OpenAI or Replicate, or **AI-painted** (works everywhere, including inside Claude).
- **Video Studio** — **story videos made in your browser**: the AI writes a storyboard, each scene gets a picture (FLUX or AI-painted), and scenes are animated with zoom/pan, crossfades, captions, a title card and a generated soundtrack, then recorded to MP4/WebM in 16:9, 9:16 or 1:1. Optional AI video models (MiniMax, Wan, Kling, Luma) via Replicate on the server.
- **Godot Engine** — ready-to-run Godot 4 projects (2D platformer, top-down, 3D first-person, menu), AI GDScript, Godot 3 → 4 upgrader, snippets, docs and an AI assistant dock for the Godot editor.
- **AI Illustrator**, **Voice Studio**, **Color Palette**, **GitHub**, **Text Toolkit**, **Translator**, **Dictionary & Thesaurus**, **Wikipedia Reader**, **Slides from Notes**, **World Clock & Meeting Planner**, **QR Codes**, **Expense Tracker**, **Finance Calculators**, **Focus Sounds**, **Daily Journal** and **Fun & Random**.

## Workspace
- **Multi-agent workspace:** up to 6 agents work in parallel, then a coordinator synthesises their answers.
- **Custom assistants.**
- **Personal knowledge base:** uploads, pasted text and notes, retrieved automatically in chat and through a tool.
- **Project board** with drag and drop.
- **Developer REST API** with per-user keys (also used by the Godot editor add-on).

## Analytics
Productivity score, completion rate, focus minutes, AI usage and command counts, 14-day charts, a weekday × hour activity heatmap with a "most active" insight, study mastery per deck, and knowledge stats.

## Accounts (server)
Sign-up and sign-in, password reset by email, password change, a list of signed-in devices with remote sign-out, Developer API keys and account deletion. Inside Claude, your claude.ai account is your identity. A static personal copy needs no account.

## Settings, security & accessibility
Themes, accent, font, text size, HUD, animations, particles, startup · voice options · AI provider, endpoint, model, encrypted key, temperature, context, personality · 5 UI languages · notifications and sounds · high contrast, readable font, reduced motion, screen-reader live regions, full keyboard navigation, voice control · privacy mode, history toggle, data erase · password lock, session timeout, **WebAuthn biometric unlock**, permission status · rebindable shortcuts.


## Built-in AI (no key, no install)

Settings → AI → **Built-in AI** offers 26 downloadable open models in five groups — Everyday (Qwen 3.5 2B recommended, Gemma 4 E2B, Qwen 3 1.7B, Llama 3.2 3B, Ministral 3 3B…), Light (Gemma 3 1B, Llama 3.2 1B, Qwen 3.5 0.8B), Smarter (Qwen 3.5 4B, Qwen 3 4B, Phi-4 mini, Phi 3.5 mini), Biggest (Qwen 3.5 9B, Qwen 3 8B, Llama 3.1 8B, Gemma 2 9B, Mistral 7B, Hermes 3 8B) and Specialists (Qwen 2.5 Coder, DeepSeek R1, Qwen 2.5 Math). Each downloads once into the browser's cache and runs on the graphics chip with WebLLM (WebGPU). No API key, account, install or server. With Live web on, JARVIS-X searches DuckDuckGo/Wikipedia first and gives the results to the model, which answers with a Sources list. Needs Chrome or Edge on a computer (WebGPU); not available inside the Claude viewer.
