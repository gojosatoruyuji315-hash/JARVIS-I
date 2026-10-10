/**
 * Built-in plugin catalog. Metadata is listed here so the store renders
 * instantly; each plugin's code is only downloaded when it's installed.
 * `hasPanel` → opens in its own window and gets a dock icon when pinned.
 * @module plugins/catalog
 */
const pick = (path, name) => () => import(path).then((m) => ({ default: name ? m[name] : m.default }));

const P = (id, name, icon, category, needs, description, load, extra = {}) => ({ id, name, icon, category, needs, description, load, version: '1.0.0', author: 'JARVIS-X', hasPanel: true, settingsCount: 0, toolCount: 0, tags: [], ...extra });

export const CATALOG = [
  /* Creative */
  P('image-studio', 'Image Studio', 'image', 'Creative', [], 'Generate images from text with Pollinations FLUX (free, no key), OpenAI or Replicate — or let the AI paint them, which works everywhere, even inside Claude. Saves to your Files and lets the assistant create images when you ask.', pick('./image-studio.js'), { settingsCount: 4, toolCount: 1, featured: true, tags: ['image', 'art', 'generate', 'ai', 'picture', 'flux'] }),
  P('video-studio', 'Video Studio', 'video', 'Creative', [], 'Make videos from a sentence: the AI writes a storyboard, creates a picture for every scene and animates them with captions and music — free, in your browser, even inside Claude. Optional AI video models (MiniMax, Wan, Kling, Luma) on the server.', pick('./video-studio.js'), { settingsCount: 2, toolCount: 1, featured: true, tags: ['video', 'clip', 'generate', 'ai', 'animation', 'reels', 'shorts', 'story'] }),
  P('svg-illustrator', 'AI Illustrator', 'wand', 'Creative', ['ai'], 'The AI draws vector illustrations, icons, logos and diagrams as crisp SVG. Works with any AI engine, including Claude. Export SVG or PNG.', pick('./svg-illustrator.js'), { toolCount: 1, tags: ['svg', 'vector', 'icon', 'logo', 'drawing'] }),
  P('voice-studio', 'Voice Studio', 'volume', 'Creative', [], 'Turn scripts, notes and lessons into speech. Preview with your device voices, or render natural MP3 narration on the JARVIS-X server.', pick('./voice-studio.js'), { tags: ['tts', 'speech', 'narration', 'audio'] }),
  P('color-palette', 'Color Palette', 'palette', 'Creative', [], 'Generate harmonious palettes (analogous, complementary, triadic, monochrome), check WCAG contrast, and export CSS variables.', pick('./utilities.js', 'colors'), { tags: ['color', 'design', 'contrast', 'css'] }),

  /* Developer */
  P('godot', 'Godot Engine', 'gamepad', 'Developer', [], 'Make games with Godot 4: ready-to-run projects from templates (2D platformer, top-down, 3D first-person, menus), AI GDScript, Godot 3 → 4 upgrades, snippets, and an AI assistant dock inside the Godot editor.', pick('./godot.js'), { toolCount: 2, featured: true, tags: ['game', 'gamedev', 'gdscript', 'engine', '3d', '2d'] }),
  P('github', 'GitHub', 'code', 'Developer', ['network'], 'See your repos, issues and pull requests, search GitHub, and let the assistant file issues for you.', pick('./github.js'), { settingsCount: 1, toolCount: 2, tags: ['git', 'issues', 'repos', 'code'] }),
  P('text-tools', 'Text Toolkit', 'note', 'Utilities', [], 'Word and character counts, reading time, case conversion, sort and dedupe lines, regex find & replace, Base64/URL encoding, and a side-by-side diff.', pick('./utilities.js', 'textTools'), { tags: ['text', 'regex', 'diff', 'base64', 'case'] }),

  /* Language & knowledge */
  P('translator', 'Translator', 'translate', 'Language', ['ai'], 'Translate text between 20+ languages, including Indian languages, with tone control. Uses your AI engine, so it works inside Claude too.', pick('./language.js', 'translator'), { featured: true, tags: ['translate', 'hindi', 'tamil', 'language'] }),
  P('dictionary', 'Dictionary & Thesaurus', 'book', 'Language', ['network'], 'Definitions with pronunciation audio, synonyms, antonyms and rhymes. Type "define serendipity" or "synonyms for happy" in the command bar.', pick('./language.js', 'dictionary'), { tags: ['words', 'define', 'synonyms', 'english'] }),
  P('wikipedia', 'Wikipedia Reader', 'globe', 'Knowledge', ['network'], 'Search and read Wikipedia in any language, save articles to notes, and let the assistant look up facts with sources.', pick('./language.js', 'wikipedia'), { settingsCount: 1, toolCount: 1, tags: ['wiki', 'facts', 'research', 'encyclopedia'] }),

  /* Productivity */
  P('slides', 'Slides from Notes', 'layers', 'Productivity', [], 'Present any Markdown note as full-screen slides (split on --- or headings), or ask the AI to draft a deck from a topic.', pick('./lifestyle.js', 'slides'), { tags: ['presentation', 'deck', 'slides'] }),
  P('world-clock', 'World Clock & Meeting Planner', 'globe', 'Productivity', [], 'Track cities across time zones and find meeting slots that fall inside everyone\'s working hours.', pick('./utilities.js', 'worldClock'), { tags: ['time', 'timezone', 'meeting'] }),
  P('qr-codes', 'QR Codes', 'grid', 'Utilities', [], 'Make QR codes for links, text, Wi-Fi logins, UPI payments and contacts — download as PNG or SVG. Scan QR codes from images too.', pick('./utilities.js', 'qr'), { tags: ['qr', 'upi', 'wifi', 'scan'] }),

  /* Finance */
  P('expenses', 'Expense Tracker', 'dollar', 'Finance', [], 'Log spending in seconds ("spent 250 on lunch"), set a monthly budget, see where money goes by category and export CSV. The assistant can log and summarise for you.', pick('./lifestyle.js', 'expenses'), { settingsCount: 2, toolCount: 2, featured: true, tags: ['money', 'budget', 'spending'] }),
  P('finance-calc', 'Finance Calculators', 'calc', 'Finance', [], 'Loan EMI with amortisation, SIP and lump-sum growth, GST add/remove, and bill splitting. Try "emi 500000 at 8.5% for 5 years".', pick('./utilities.js', 'finance'), { tags: ['emi', 'sip', 'gst', 'loan', 'split'] }),

  /* Wellbeing & fun */
  P('focus-sounds', 'Focus Sounds', 'music', 'Wellbeing', [], 'Mix rain, ocean, wind, fireplace, white/pink/brown noise and a binaural focus tone — generated live, works offline. Includes a sleep timer.', pick('./lifestyle.js', 'ambient'), { tags: ['noise', 'focus', 'sleep', 'ambient'] }),
  P('journal', 'Daily Journal', 'edit', 'Wellbeing', [], 'A private daily journal with mood tracking, gentle prompts and an AI weekly reflection on what went well and what to try next.', pick('./lifestyle.js', 'journal'), { tags: ['diary', 'mood', 'reflection'] }),
  P('fun-random', 'Fun & Random', 'sparkles', 'Fun', [], 'Dice (any notation like 3d6+2), coin flips, a random picker, strong password generator and countdowns. Try "roll 2d20" or "flip a coin".', pick('./utilities.js', 'fun'), { tags: ['dice', 'coin', 'random', 'password'] }),
];

export const CATEGORIES = ['All', ...new Set(CATALOG.map((p) => p.category))];
