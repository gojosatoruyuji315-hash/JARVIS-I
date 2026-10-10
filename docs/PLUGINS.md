# Plugins

Plugins add windows, command-bar commands and assistant tools to JARVIS-X. Open **Plugins** in the dock to browse the store, install, pin to the dock, change settings or uninstall. Every plugin is free.

## Built-in plugins

| Plugin | Category | Needs | What it does |
|---|---|---|---|
| **Image Studio** | Creative | — | Text-to-image with Pollinations FLUX (free, no key), OpenAI `gpt-image-1` (server key or your own), Replicate FLUX via the server, or **AI-painted** (the AI paints an SVG that is rendered to PNG — the automatic choice without internet, e.g. inside Claude). Saves to Files → `/Generated/Images`. Tool: `generate_image`. Command: "generate image of …". |
| **Video Studio** | Creative | — | **Story video** (free, in the browser): AI storyboard → a picture per scene (FLUX online, AI-painted offline) → animated with captions, title card and generated music → MP4/WebM via MediaRecorder; 16:9, 9:16 or 1:1. Optional **AI video models** (MiniMax, Wan, Kling, Luma) through the server's Replicate relay. Saves to `/Generated/Videos`. Tool: `generate_video`. Command: "make a video about …". |
| **AI Illustrator** | Creative | AI | The AI draws sanitised SVG illustrations, icons, logos and diagrams; export SVG/PNG. Works inside Claude. Tool: `draw_svg`. |
| **Voice Studio** | Creative | — | Speak scripts with device voices; render MP3 narration on the server (OpenAI TTS). |
| **Color Palette** | Creative | — | Harmonies, WCAG contrast check, CSS variables. |
| **Godot Engine** | Developer | — | See below. Tools: `godot_new_project`, `godot_upgrade_script`. Command: "make a godot game called …". |
| **GitHub** | Developer | internet | Repos, issues, PRs and search with your token. Tools: `github_list_issues`, `github_create_issue`. |
| **Text Toolkit** | Utilities | — | Counts, case, sort/dedupe, regex replace, Base64/URL, diff. |
| **QR Codes** | Utilities | — | Links, Wi-Fi, UPI, contact cards; PNG/SVG; scan from image. |
| **Translator** | Language | AI | 20+ languages including Indian languages, tone control. |
| **Dictionary & Thesaurus** | Language | internet | Definitions, audio, synonyms, antonyms, rhymes. Commands: "define …", "synonyms for …". |
| **Wikipedia Reader** | Knowledge | internet | Search/read any language, save to notes. Tool: `wikipedia_lookup`. |
| **Slides from Notes** | Productivity | — | Present Markdown notes as slides; AI-drafted decks; PDF handout. |
| **World Clock & Meeting Planner** | Productivity | — | Time zones and overlapping working hours. |
| **Expense Tracker** | Finance | — | "spent 250 on lunch", budgets, categories, CSV. Tools: `log_expense`, `spending_summary`. |
| **Finance Calculators** | Finance | — | EMI with amortisation, SIP, GST, bill split. Command: "emi 500000 at 8.5% for 5 years". |
| **Focus Sounds** | Wellbeing | — | Synthesised rain, ocean, wind, fire, noise colours, binaural tone, sleep timer. |
| **Daily Journal** | Wellbeing | — | Mood tracking, prompts, AI weekly reflection. |
| **Fun & Random** | Fun | — | Dice notation, coin, picker, passwords, countdowns. |

*Needs:* **internet** — not available inside the Claude viewer; **server** — needs the JARVIS-X server; **AI** — uses whichever AI engine is active (works inside Claude).

## Godot Engine plugin

- **New project** — downloads a complete Godot 4.3+ project (`.zip`) from a template: *2D Platformer*, *Top-down Collector*, *3D First-Person*, or *Main Menu + Game Scene*. Includes `project.godot` (GL Compatibility renderer), an `InputSetup` autoload that registers WASD/arrow/jump bindings, scenes, typed GDScript, an icon and a README. Unzip, then Godot → **Import** → `project.godot` → **F5**. A copy is saved to Files → `/Godot`.
- **Script helper** — describe a behaviour, pick a node type, and the AI writes Godot 4 GDScript (tabs, typed, `@export`/`@onready`, `await`, signal `.emit()`/`.connect()`).
- **Godot 3 → 4** — an instant on-device upgrader (export/onready, `yield` → `await`, string `connect`, `emit_signal`, `move_and_slide(v)` → built-in `velocity`, `KinematicBody2D` → `CharacterBody2D`, `Spatial` → `Node3D`, Pool arrays, renamed helpers…) plus an AI upgrade for the rest.
- **Snippets** — signals, tweens, spawning, save/load, autoloads, raycasts, state machines, screen shake, pause menus.
- **Editor add-on** — `addons/jarvis_x`: an AI dock inside the Godot editor that talks to your JARVIS-X server (`/v1/chat` with a Developer API key) or directly to Anthropic, and inserts generated code at the cursor.
- Adds **GDScript** to the Developer Workspace editor.

## Write your own

A plugin is an ES module whose default export is a manifest:

```js
export default {
  id: 'pomodoro-stats', name: 'Pomodoro Stats', version: '1.0.0', author: 'You',
  description: 'Shows focus minutes per day.', icon: 'chart', category: 'Productivity',
  needs: [],                                  // 'network' | 'server' | 'ai'
  settings: [{ key: 'goal', label: 'Daily goal (min)', type: 'number', default: 120 }],

  panel(el, api) {                            // optional window (pinned to the dock)
    const { h } = api;
    el.append(h('h2', `Goal: ${api.setting('goal')} min`));
    return () => {};                          // optional cleanup
  },
  commands: [{ match: /^focus stats$/i, run: (text, api) => 'You focused 95 minutes today.' }],
  tools: [{ name: 'focus_goal', description: 'Get the user\'s daily focus goal.',
            schema: { type: 'object', properties: {} }, run: (input, api) => ({ goal: api.setting('goal') }) }],
  activate(api) {}, deactivate(api) {},
};
```

Install it from **Plugins → Build a plugin → Install from URL** (persisted), or at runtime with `JX.plugins.register(manifest)`.

### The `api` object

| Member | Purpose |
|---|---|
| `h`, `icon`, `toast`, `modal`, `copyText`, `fmt`, `uid` | UI helpers |
| `setting(key)` / `setSetting(key, value)` | values from the plugin's settings page |
| `get(key, fallback)` / `set(key, value)` | private storage, encrypted and synced |
| `ask(prompt, { system, onText, signal, tier })` | one-shot AI call on the active engine (Claude, server, your key or offline) |
| `json(url, opts)` | `fetch` returning JSON with friendly errors |
| `download(name, data, mime)` | save a file (uses the Claude viewer's downloads capability when hosted) |
| `saveToFiles(blob, name, folder)` | store into the File Manager |
| `open(moduleId, params)`, `openPanel()` | navigation |
| `bus`, `platform` | events and environment (`platform.isServer`, `isHost`, `hasNetwork`) |

Commands are tried before built-in commands. Tools are offered to the assistant only when the plugin's `needs` are met. Only install plugin URLs you trust — plugins run with the page's permissions.
