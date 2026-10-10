# Assets

JARVIS-X ships almost no binary assets on purpose. The UI is generated with code:

| Asset | Where it comes from |
|---|---|
| Logo / emblem | `icons/logo.svg` (original concentric-ring mark) and `logoSVG` in `js/core/icons.js` |
| UI icons | Original line-icon set in `js/core/icons.js` (24×24, stroke `currentColor`) |
| HUD core | Generated SVG in `js/core/hud.js` |
| Album artwork | Generative canvas art per track (`drawArtwork` in `js/core/audio.js`) |
| Music | Three original generative tracks synthesised live with Web Audio (`SYNTH_TRACKS` in `js/core/audio.js`) |
| Sounds | Notification chime synthesised in `js/core/scheduler.js` |
| Fonts | Oxanium (display), IBM Plex Sans (body), JetBrains Mono (data) via Google Fonts (OFL) |

## Placeholder slots

Drop your own files here if you want them. The app runs without them.

```
assets/
├── icons/
│   ├── logo.svg            ✔ included
│   ├── icon-192.png        ☐ PWA raster icon (add to manifest.webmanifest)
│   └── icon-512.png        ☐ PWA raster icon
├── audio/                  ☐ optional bundled tracks (register them with engine.addFile)
├── images/                 ☐ marketing screenshots, onboarding art
└── fonts/                  ☐ self-hosted WOFF2 subsets (recommended for production)
```

Keep everything original or properly licensed. Don't add film or franchise artwork, logos, voices or sound effects.
