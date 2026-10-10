# JARVIS-X Architecture

## Design principles

1. **Zero build, zero dependencies.** Native ES modules, so the source you read is the source that runs.
2. **Local-first, cloud-synced.** State lives in the browser, encrypted at rest. When a server or Claude host is available it syncs section by section. Network calls go only to services you've configured.
3. **Lazy by default.** Only the shell, core services and the home dashboard load at startup. Each feature module is a dynamic `import()` the first time it opens, and then it is cached.
4. **One pipeline per concern.** Every "ask the AI" goes through `core/assistant.js`, every gate goes through `core/gate.js`, and every persistent write goes through `core/store.js`.
5. **One app, three platforms.** `core/platform.js` picks real backends for the self-hosted server, the Claude viewer, or a static host. Each feature degrades honestly and never fakes data.

## Boot sequence (`js/app.js`)

```
store.init()  ──► locked? ──► lockScreen(vault) ──► store.unlock(pw)
     │
applyTheme() ─► startup animation (parallel) ─► renderShell()
     │                                           ├─ top bar, dock
     │                                           └─ home (modules/dashboard.js)
particles.init() · wire bus · installShortcuts() · startScheduler()
     │
deep link (#module) · router.prefetch() · license.verify() · renewal reminder
wake word (opt-in) · plugin re-activation · service worker
```

## Core services

| Module | Responsibility |
|---|---|
| `store.js` | One JSON state tree with dot-path `get/set/update/push/patchById`, prefix subscriptions, debounced encrypted persistence, schema-merge on upgrade, export/import |
| `crypto.js` | AES-256-GCM encrypt/decrypt, PBKDF2-SHA256 (310k) key derivation and password hashing, HMAC-SHA256 token sign/verify, non-extractable device keys in IndexedDB |
| `idb.js` | Promise wrapper over IndexedDB (`keys`, `files`, `blobs` stores), with an in-memory fallback |
| `bus.js` | Pub/sub for decoupling (`open`, `plugins:change`, `hud:state`, `tick`, `music`, `assistant:reply`…) |
| `router.js` | Module registry and single-window manager, lazy import, `#hash` deep links |
| `assistant.js` | `ask()`: command layer → optional fair-use cap → context (history, memory, knowledge base) → provider stream → persistence → events |
| `ai.js` | Provider adapters (`local`, `openai`, `anthropic`) as async generators, SSE parsing, system prompt builder, offline engine |
| `commands.js` | Regex-based intent parser for tasks, reminders, notes, events, memory, timers, focus, music, themes, navigation, routines and plugin commands |
| `voice.js` | SpeechRecognition (push-to-talk, toggle, wake word), speechSynthesis with profiles, sentence-level streaming and interruption |
| `scheduler.js` | 1-second tick: timers, reminders (once/daily/weekly), daily routines, idle-timeout lock; notifications plus a synthesised chime |
| `license.js` | Identity per platform: server accounts and sessions, claude.ai identity, or none. Everyone has every feature (`plans.js` / `gate.js` remain as always-true shims for old call sites). |
| `plugins.js` | Plugin runtime: catalog, install/uninstall, lazy activation, scoped plugin API, plugin commands and assistant tools, dock pinning |
| `audio.js` | Music engine: play queue, stream playback (analysed element with a plain fallback for streams without CORS), YouTube IFrame player, generative tracks, likes, playlists, recent, MediaSession |
| `music-sources.js` | Search adapters with one track shape: YouTube (API key, server, or Piped/Invidious mirrors), Audius, iTunes, Internet Archive, radio-browser; lazy URL resolution |
| `net.js` | One door to the internet: `getJSON`/`getText`/`getMany`. Plain `fetch` wherever JARVIS-X runs as a normal page. |
| `fullversion.js` | **Full internet** overlay for the Claude viewer (which keeps pages offline): opens the full version (hosted URL or `localhost:8765`) carrying the workspace in the URL fragment (`#jx-import=`, gzip + base64url, never sent to a server), rebuilds the app + launchers as a zip from its own files, and imports carried data on the receiving side. |
| `composer.js` | AI Composer: the AI returns a song plan (title, bpm, key, scale, chords, melody); `arrange()` turns it into bass, pad, arpeggio, lead and drum voices for the synth; `renderTrackWav()` in `audio.js` exports WAV offline |
| `palette.js` | Keyboard-driven overlay list that powers both the command palette and Smart Search |

## Module contract

```js
// js/modules/example.js
export default {
  flush: false,                 // true = no padding (full-bleed layouts)
  mount(el, ctx) {              // ctx = { params, close(), setActions(...nodes) }
    el.append(/* your UI */);
    const off = store.on('tasks', render);   // subscribe
    return () => off();         // cleanup on close
  },
  update(params) {}             // optional: re-opened with new params
};
```

Register it in `core/router.js → MODULES` with an icon. Add a label in `core/i18n.js`. That's all.

## Data model (abridged)

```js
{
  profile: { name },
  settings: { skin, accent, font, fontScale, highContrast, motion, hud, startup, language,
              voice: { rate, pitch, profile, voiceURI, autoSpeak, wakeWord, wakePhrase, lang },
              ai: { provider, endpoint, model, personality, temperature, maxContext },
              privacy: { privacyMode, saveHistory }, security: { lockEnabled, timeoutMin, passHash } },
  chat: { conversations: [{ id, title, messages: [{ role, content, ts }] }], activeId },
  memory: { facts, prompts, commandUsage, projects },
  tasks, taskLists, reminders, events, notes, sticky, clipboard, goals, habits, planner,
  study: { decks: [{ cards: [{ q, a, box, due }] }], quizzes, sessions, plans, minutesByDay },
  automation: { routines: [{ trigger, steps }] },
  music: { volume, shuffle, repeat, queue, liked, playlists, recent, sources },
  plugins: { installed, pinned, config, data, urls },
  kb: { docs }, usage: { aiDay, aiCount, byDay, totals },
  secrets: { aiKey, youtubeKey },                          // device-only, never synced
  meta: { ts: { [section]: lastModified } }    // sync bookkeeping, device-only
}
```

File blobs live in IndexedDB (`files` holds metadata, `blobs` holds contents), not in the vault.

## Platform adapters

| Concern | server | host (Claude viewer) | standalone |
|---|---|---|---|
| AI (`core/ai.js`) | `server` provider → `/api/ai/chat` (Anthropic-format tool loop) | `claude` provider → `sample` capability with page tools | `anthropic` (tool loop) / `openai` (stream) with your key, else `local` |
| Identity (`core/license.js`) | `/api/auth/*`, httpOnly cookie | `user` capability (claude.ai account) | none |
| Music | search direct, with `/api/music/search` proxy for iTunes/YouTube | search off (no network); AI Composer, your files, generative | search direct (JSONP fallback for iTunes) |
| Plugins | all | those whose `needs` are met (no `network`/`server`) | all but `server`-only |
| Sync (`core/sync.js`) | `/api/sync` with optimistic versions | `db` capability: `data/users/<id>/<section>` docs, `onSnapshot` | off |
| Downloads | browser download | `downloads` capability (viewer confirms) | browser download |
| Live data | `/api/data/*` proxies | none (no network) | direct (Open-Meteo, Frankfurter) |

**Sync model.** `store.set()` stamps the top-level section it touches (`meta.ts[section]`). When two copies meet, the newer section wins. That's coarse but predictable, and it never interleaves half-edits. `secrets` (API keys) and `meta` never leave the device.

**Tool use.** `core/tools.js` defines each action once: its name, description, JSON schema and `run()`. The Claude viewer gets these as `sample` tools. Anthropic-format providers get them as `tools` plus a client-side loop (up to 6 rounds) that runs `tool_use` blocks and returns `tool_result`s. Read-only tools are silent; mutating tools show a toast, and destructive ones offer Undo.

## Security model

| Threat | Mitigation |
|---|---|
| Someone reads browser storage | The local vault is AES-256-GCM. The key is a non-extractable `CryptoKey` (device mode) or PBKDF2-SHA256 (310k iterations) from your password. |
| Device left unattended | Idle timeout → lock screen. WebAuthn platform authenticator (Touch ID, Windows Hello) can unlock it. After a reload, the password is required to decrypt. |
| Stolen session | httpOnly, SameSite=Lax, Secure cookie holding an HS256 JWT bound to a session row. Revoke one device or all of them; changing the password bumps `token_version`, which invalidates every token. |
| CSRF | Every cookie-authenticated state change must carry the `X-JX: 1` header. Browsers can't send it cross-site without a CORS preflight, which the server never grants. |
| Third-party plugins | Plugins run in the page with a scoped API; only install module URLs you trust. Built-in plugins never send keys anywhere except the provider they belong to. |
| Password attacks | scrypt (N=16384) with a per-user salt. Per-IP and per-email rate limits. Generic error messages. Reset tokens are stored hashed, single-use and expire in 1 hour. |
| XSS | Escape-first Markdown and an allow-list sanitiser for rich text. Strict CSP on the server (no inline scripts). User HTML previews run in an opaque-origin sandbox (`sandbox.html`). |
| Server data theft | Synced vaults are AES-256-GCM-encrypted with `VAULT_SECRET`. API keys are stored as SHA-256 hashes. Passwords use scrypt. |
| Untrusted code | Docker containers with no network, 256 MB, 0.5 CPU, read-only FS, a PID limit, a timeout and capped output. SQL runs in an in-memory SQLite database with ATTACH and extensions blocked. |
| AI keys | Server keys never reach the browser. A bring-your-own key in standalone mode stays inside the encrypted local vault and is never synced. |

## Extending

### Add an AI provider
Add an entry to `providers` in `core/ai.js` with `available()` and `async run(messages, { system, signal, onText, tools })`. For Anthropic-shaped APIs, reuse `anthropicLoop()` to get tool use for free.

### Add an assistant tool
Append to `TOOLS` in `core/tools.js` with a name, a description, a schema and `run(input)`. Every provider picks it up automatically.

## Plugins

See [PLUGINS.md](PLUGINS.md). In short: a plugin is an ES module whose default export is a manifest (`id`, `name`, `icon`, `category`, `needs`, `settings`, `panel(el, api)`, `commands`, `tools`, `activate`, `deactivate`). Built-ins are listed in `js/plugins/catalog.js` and loaded only when installed. `JX.plugins.register(manifest)` and **Install from URL** add third-party plugins.

`window.JX` exposes `bus`, `store`, `router`, `voice`, `ask`, `license`, `providers`, `platform`, `sync` and `plugins`.
