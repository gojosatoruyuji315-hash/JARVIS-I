/**
 * Settings: appearance, voice, AI provider, language, notifications,
 * accessibility, privacy, security, keyboard shortcuts and about.
 * @module modules/settings
 */
import { h, clear, toast, tabs, toggle, confirmDialog, modal, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { SKINS, FONTS, HUDS, applyTheme } from '../core/theme.js';
import { particles } from '../core/particles.js';
import { voice, VOICE_PROFILES } from '../core/voice.js';
import { providers, PERSONALITIES, activeProviderId } from '../core/ai.js';
import { platform } from '../core/platform.js';
import { biometricAvailable, registerBiometric } from '../core/boot.js';
import { LANGUAGES } from '../core/i18n.js';
import { getShortcuts, comboFromEvent, DEFAULT_SHORTCUTS } from '../core/shortcuts.js';
import { requestNotificationPermission } from '../core/scheduler.js';
import { allowed, gate, planBadge, featureBadge } from '../core/gate.js';
import { license } from '../core/license.js';

const row = (label, help, ...ctl) => h('div.set-row', h('div.lbl', h('span', label), help ? h('small', help) : null), h('div.ctl', ...ctl));
const section = (...c) => h('div.glass.set-section', ...c);
const set = (path, v, apply = true) => { store.set(path, v); if (apply) { applyTheme(); particles.sync(); } };
const select = (value, opts, onchange, label) => h('select.select', { 'aria-label': label, onchange: (e) => onchange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));

function Appearance(el) {
  const s = store.get('settings');
  const sw = h('div.skin-swatches', SKINS.map((k) => h('button.swatch', { 'aria-pressed': String(s.skin === k.id), onclick: () => { if (k.feature && !gate(k.feature)) return; set('settings.skin', k.id); particles.refreshColor(); el.replaceChildren(); Appearance(el); } },
    h('div.chips', k.colors.map((c) => h('i', { style: `background:${c}` }))), h('div.row', h('span.small', k.name), k.plan !== 'free' ? planBadge(k.plan, { locked: !allowed(k.feature) }) : null))));
  const accent = h('input', { type: 'color', value: s.accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2ad4ff', 'aria-label': 'Accent color', oninput: (e) => { set('settings.accent', e.target.value); particles.refreshColor(); } });
  el.append(h('div.stack',
    section(h('h3', 'Theme'), sw),
    section(
      row('Accent color', 'Overrides the theme accent', accent, h('button.btn.ghost.sm', { onclick: () => { set('settings.accent', null); particles.refreshColor(); el.replaceChildren(); Appearance(el); } }, 'Reset')),
      row('Font', 'Body text typeface', select(s.font, Object.entries(FONTS).map(([k, f]) => [k, f.label]), (v) => set('settings.font', v), 'Font')),
      row('Text size', `${Math.round(s.fontScale * 100)}%`, h('input', { type: 'range', min: 0.85, max: 1.4, step: 0.05, value: s.fontScale, 'aria-label': 'Text size', oninput: (e) => { set('settings.fontScale', +e.target.value); e.target.closest('.set-row').querySelector('small').textContent = `${Math.round(e.target.value * 100)}%`; } })),
      row('HUD design', 'The holographic core on the home screen', select(s.hud, HUDS.map((x) => [x.id, x.name + (x.feature && !allowed(x.feature) ? ` (${x.plan === 'master' ? 'Master' : 'Pro'})` : '')]), (v) => { const x = HUDS.find((y) => y.id === v); if (x.feature && !gate(x.feature)) { el.replaceChildren(); Appearance(el); return; } set('settings.hud', v); }, 'HUD design')),
      row('Animations', 'Auto follows your system setting', select(s.motion, [['auto', 'Auto'], ['full', 'Full'], ['reduced', 'Reduced']], (v) => set('settings.motion', v), 'Animations')),
      row('Particle field', null, toggle('', s.particles, (v) => set('settings.particles', v)), h('input', { type: 'range', min: 0.3, max: 1.6, step: 0.1, value: s.particleDensity, 'aria-label': 'Particle density', style: 'max-width:110px', onchange: (e) => set('settings.particleDensity', +e.target.value) })),
      row('Startup sequence', 'Played when JARVIS-X boots', select(s.startup, [['standard', 'Standard'], ['quick', 'Quick'], ['prime', `Prime${allowed('startup.exclusive') ? '' : ' (Master)'}`]], (v) => { if (v === 'prime' && !gate('startup.exclusive')) { el.replaceChildren(); Appearance(el); return; } set('settings.startup', v, false); }, 'Startup'), h('button.btn.ghost.sm', { onclick: async () => { const { startup } = await import('../core/boot.js'); startup(store.get('settings.startup') === 'prime' && allowed('startup.exclusive') ? 'prime' : store.get('settings.startup')); } }, 'Preview')),
      row('Dashboard widgets', 'Show or hide home widgets', h('button.btn.sm', { onclick: () => bus.emit('dashboard:customize') }, icon('grid'), 'Customize')))));
}

function Voice(el) {
  const v = store.get('settings.voice');
  const voices = voice.voices();
  const status = h('div.row', h('span.pill', { class: voice.supported.stt ? 'ok' : 'hi' }, `Speech recognition: ${voice.supported.stt ? 'available' : 'not supported'}`), h('span.pill', { class: voice.supported.tts ? 'ok' : 'hi' }, `Text-to-speech: ${voice.supported.tts ? `${voices.length} voices` : 'not supported'}`));
  const maxProfiles = allowed('voice.advanced') ? 5 : 2;
  el.append(h('div.stack', section(status,
    row('Voice', 'System voices installed on this device', select(v.voiceURI, [['', 'Default'], ...voices.map((x) => [x.voiceURI, `${x.name} (${x.lang})`])], (x) => store.set('settings.voice.voiceURI', x), 'Voice')),
    row('Voice profile', 'Preset speaking styles; Custom uses your own speed and pitch', select(v.profile, Object.entries(VOICE_PROFILES).map(([k, p]) => [k, p.label + (p.plan === 'pro' && !allowed('voice.advanced') ? ' (Pro)' : p.plan === 'master' && !allowed('voice.custom') ? ' (Master)' : '')]), (x) => {
      const p = VOICE_PROFILES[x];
      if (p.plan === 'pro' && !gate('voice.advanced')) return Voice.re(el); if (p.plan === 'master' && !gate('voice.custom')) return Voice.re(el);
      store.set('settings.voice.profile', x);
    }, 'Voice profile')),
    row('Speed', `${v.rate.toFixed(2)}×`, h('input', { type: 'range', min: 0.5, max: 2, step: 0.05, value: v.rate, 'aria-label': 'Speech speed', oninput: (e) => { store.set('settings.voice.rate', +e.target.value); e.target.closest('.set-row').querySelector('small').textContent = `${(+e.target.value).toFixed(2)}×`; } })),
    row('Pitch', `${v.pitch.toFixed(2)}`, h('input', { type: 'range', min: 0.5, max: 1.8, step: 0.05, value: v.pitch, 'aria-label': 'Speech pitch', oninput: (e) => { store.set('settings.voice.pitch', +e.target.value); e.target.closest('.set-row').querySelector('small').textContent = (+e.target.value).toFixed(2); } })),
    row('Test', null, h('button.btn.sm', { onclick: () => voice.speak(`Hello ${store.get('profile.name')}. All systems are running smoothly.`) }, icon('volume'), 'Speak sample'), h('button.btn.ghost.sm', { onclick: () => voice.cancelSpeech() }, 'Stop')),
    row('Speak replies automatically', 'Streams speech sentence by sentence; Esc or talking interrupts', toggle('', v.autoSpeak, (x) => store.set('settings.voice.autoSpeak', x))),
    row('Recognition language', null, select(v.lang, [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'], ['ja-JP', 'Japanese']], (x) => store.set('settings.voice.lang', x), 'Recognition language')),
    row(h('span', 'Wake word ', featureBadge('voice.advanced')), 'Experimental — listens continuously for the phrase while this tab is open', toggle('', v.wakeWord, (x) => {
      if (x && !gate('voice.advanced')) return Voice.re(el);
      store.set('settings.voice.wakeWord', x);
      x ? voice.startWakeWord((rest) => bus.emit('home:ask', { text: rest || 'hello' })) : voice.stopWakeWord();
    }), h('input.input', { value: v.wakePhrase, style: 'width:110px', 'aria-label': 'Wake phrase', onchange: (e) => store.set('settings.voice.wakePhrase', e.target.value.toLowerCase()) })),
    row('Push-to-talk', 'Hold Space anywhere outside a text field, or click the core', h('kbd', 'Space')))));
}
Voice.re = (el) => { el.replaceChildren(); Voice(el); };

function AI(el) {
  const a = store.get('settings.ai');
  const active = activeProviderId();
  const key = h('input.input', { type: 'password', placeholder: store.get('secrets.aiKey') ? '•••••••• (saved on this device)' : 'Paste your API key', autocomplete: 'off', 'aria-label': 'API key' });
  const result = h('div.small');
  const re = () => { el.replaceChildren(); AI(el); };
  const opts = [['auto', `Automatic (now: ${providers[active].label})`],
    ...(providers.claude.available() ? [['claude', providers.claude.label]] : []),
    ...(platform.isServer ? [['server', providers.server.label + (license.user() ? '' : ' — sign in first')]] : []),
    ['gemini', providers.gemini.label], ['browser', providers.browser.label], ['anthropic', providers.anthropic.label], ['openai', providers.openai.label], ['local', providers.local.label]];
  const usesKey = a.provider === 'anthropic' || a.provider === 'openai' || (a.provider === 'auto' && !providers.claude.available() && !providers.server.available() && active !== 'gemini' && active !== 'browser');
  const keyProv = a.provider === 'openai' || (a.provider === 'auto' && a.keyProvider === 'openai') ? 'openai' : 'anthropic';
  const showOwn = !platform.isHost && ['auto', 'gemini', 'browser'].includes(a.provider || 'auto') || active === 'gemini' || active === 'browser';
  el.append(h('div.stack', showOwn ? geminiPanel(re, active === 'gemini') : null, showOwn ? browserAIPanel(re, active === 'browser') : null, section(
    row('AI engine', active === 'claude' ? 'Running inside Claude: answers use your Claude account, no key needed.' : active === 'server' ? 'Answers come from your JARVIS-X server; keys stay on the server.' : active === 'gemini' ? 'Answers come from Google Gemini with your free key — smart, with live web search and JARVIS-X actions.' : active === 'browser' ? 'Answers come from the built-in AI running in this browser — free, no key, nothing to install.' : active === 'local' ? 'Offline engine only. Add a free Gemini key or download a built-in model above for full answers.' : 'Calls go straight from this browser with your key.',
      select(a.provider, opts, (v) => { store.set('settings.ai.provider', v); re(); }, 'AI engine')),
    active === 'claude' || a.provider === 'claude' ? row('Response mode', 'Fast answers immediately; Deep thinks longest for hard problems', select(a.tier, [['quick', 'Fast'], ['default', 'Balanced'], ['complex', 'Deep']], (v) => store.set('settings.ai.tier', v), 'Response mode')) : null,
    usesKey ? row('Key provider', null, select(keyProv, [['anthropic', 'Anthropic'], ['openai', 'OpenAI-compatible']], (v) => { store.set('settings.ai.keyProvider', v); if (a.provider !== 'auto') store.set('settings.ai.provider', v); re(); }, 'Key provider')) : null,
    usesKey ? row('Endpoint', keyProv === 'openai' ? 'Base URL — https://api.openai.com/v1, https://openrouter.ai/api/v1, https://api.groq.com/openai/v1…' : 'Leave empty for https://api.anthropic.com', h('input.input', { value: a.endpoint, placeholder: keyProv === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com', onchange: (e) => store.set('settings.ai.endpoint', e.target.value.trim()) })) : null,
    usesKey ? row('Model', null, h('input.input', { value: a.model, placeholder: keyProv === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-5', onchange: (e) => store.set('settings.ai.model', e.target.value.trim()) })) : null,
    usesKey ? row('API key', 'Encrypted in this browser\'s vault and never synced. For a public deployment use the server instead.', key, h('button.btn.sm', { onclick: () => { if (key.value) { store.set('secrets.aiKey', key.value.trim()); key.value = ''; toast('API key saved on this device', { type: 'ok' }); re(); } } }, 'Save'), h('button.btn.ghost.sm', { onclick: () => { store.set('secrets.aiKey', ''); re(); } }, 'Remove')) : null,
    row('Test', null, h('button.btn.sm', { onclick: async () => {
      result.textContent = 'Asking…'; result.style.color = '';
      try { const out = await providers[activeProviderId()].run([{ role: 'user', content: 'Reply with exactly: Systems online.' }], { system: 'Be brief.', tools: false, tier: 'quick' }); result.textContent = `✔ ${providers[activeProviderId()].label}: ${out.slice(0, 80)}`; result.style.color = 'var(--ok)'; }
      catch (e) { result.textContent = `✖ ${e.message.slice(0, 200)}`; result.style.color = 'var(--danger)'; }
    } }, 'Test AI'), result),
    row('Creativity', `Temperature ${a.temperature} (your-key engines)`, h('input', { type: 'range', min: 0, max: 1.2, step: 0.1, value: a.temperature, 'aria-label': 'Temperature', onchange: (e) => store.set('settings.ai.temperature', +e.target.value) })),
    row('Conversation memory', `Last ${a.maxContext} messages are sent with each request`, h('input.input', { type: 'number', min: 2, max: 60, value: a.maxContext, style: 'width:80px', onchange: (e) => store.set('settings.ai.maxContext', +e.target.value) })),
    row('Live web', 'The AI searches the internet and reads pages for current information, and shows its sources', toggle('', a.web !== false, (x) => store.set('settings.ai.web', x))),
    row(h('span', 'Personality ', featureBadge('ai.personalities')), null, select(a.personality, Object.entries(PERSONALITIES).map(([k, p]) => [k, p.label]), (v) => { if (PERSONALITIES[v].plan !== 'free' && !gate('ai.personalities')) { re(); return; } store.set('settings.ai.personality', v); re(); }, 'Personality')),
    a.personality === 'custom' ? row('Custom persona', 'Describe how JARVIS-X should behave', h('textarea.textarea', { value: a.customPersona || '', placeholder: 'e.g. You are a calm British butler who loves astronomy…', onchange: (e) => store.set('settings.ai.customPersona', e.target.value) })) : null)));
}

/** Google Gemini with the person's own free key. */
function geminiPanel(re, inUse) {
  const box = h('div.glass.widget.stack');
  const paint = async () => {
    const g = await import('../core/gemini.js');
    const has = g.configured();
    const keyIn = h('input.input', { type: 'password', placeholder: has ? '•••••••• (saved on this device)' : 'Paste your Gemini API key (starts with AIza…)', autocomplete: 'off', 'aria-label': 'Gemini API key', style: 'flex:1;min-width:200px' });
    const msg = h('div.small');
    const save = async () => {
      const v = keyIn.value.trim(); if (!v) return;
      store.set('secrets.geminiKey', v); keyIn.value = ''; msg.textContent = 'Checking the key…'; msg.style.color = '';
      try {
        const out = await providers.gemini.run([{ role: 'user', content: 'Reply with exactly: Systems online.' }], { system: 'Be brief.', tools: false });
        if ((store.get('settings.ai.provider') || 'auto') !== 'auto') store.set('settings.ai.provider', 'gemini'); // you chose another engine before: switch to Gemini
        toast('Gemini is connected', { type: 'ok' }); bus.emit('ai:provider', activeProviderId()); msg.textContent = `✔ ${out.slice(0, 60)}`; re();
      } catch (e) { msg.textContent = `✖ ${e.message}`; msg.style.color = 'var(--danger)'; }
    };
    const models = has ? await g.listModels() : g.MODELS;
    const cur = g.model();
    const sel = h('select.select', { style: 'width:auto;max-width:100%', 'aria-label': 'Gemini model', onchange: (e) => { store.set('settings.ai.geminiModel', e.target.value); toast(`Using ${e.target.value}`, { timeout: 1500 }); } },
      (models.some(([id]) => id === cur) ? models : [[cur, cur], ...models]).map(([id, label]) => h('option', { value: id, selected: id === cur }, label)));
    box.replaceChildren(...[
      h('div.row', icon('sparkles'), h('b.grow', 'Google Gemini — smart, free key'), has ? h('span.pill.ok', inUse ? 'In use' : 'Key saved') : null),
      h('div.small.dim', 'One of the smartest AIs, free with your own key. It can search the live web and use JARVIS-X actions (tasks, reminders, notes, music…).'),
      has ? null : h('ol.small', { style: 'margin:0' },
        h('li', 'Open ', h('a', { href: g.KEY_URL, target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'), ' and sign in with your Google account.'),
        h('li', 'Click ', h('b', 'Create API key'), ', then copy it.'),
        h('li', 'Paste it below and press ', h('b', 'Save'), '.')),
      h('div.row', keyIn, h('button.btn.primary.sm', { onclick: save }, 'Save'), has ? h('button.btn.ghost.sm', { onclick: () => { store.set('secrets.geminiKey', ''); if (store.get('settings.ai.provider') === 'gemini') store.set('settings.ai.provider', 'auto'); re(); } }, 'Remove') : null),
      msg,
      h('div.row', h('span.small', 'Model'), sel),
      h('div.xs.muted', 'The key is stored encrypted in this browser only and is never synced or uploaded. Free keys have daily limits; on the free tier Google may use your chats to improve its products.')].filter(Boolean));
  };
  paint();
  return box;
}

/** Built-in AI: a real model that runs inside the browser (WebLLM / WebGPU) — no key, no install. */
function browserAIPanel(re, inUse) {
  const box = h('div.glass.widget.stack');
  const paint = async () => {
    const wl = await import('../core/webllm.js');
    const headTitle = h('b.grow', 'Built-in AI — downloadable models, no key');
    if (!wl.supported()) {
      box.replaceChildren(h('div.row', icon('cpu'), headTitle, h('span.pill', { style: 'color:var(--warn)' }, 'Not supported here')),
        h('div.small', 'This browser has no WebGPU, which the built-in AI needs. Open JARVIS-X in ', h('b', 'Chrome or Edge'), ' on a Windows, Mac or Linux computer (or recent Chrome on Android). Until then the offline engine answers from live web search results.'));
      return;
    }
    box.replaceChildren(h('div.row', icon('cpu'), headTitle, h('span.small.dim', 'Checking…')));
    const models = await wl.availableModels();
    const chosen = wl.chosenModel() || models[0]?.[0];
    const cached = Object.fromEntries(await Promise.all(models.map(async ([id]) => [id, await wl.isCached(id)])));
    const bar = h('progress', { max: 1, value: 0, style: 'width:100%', hidden: true }); const prog = h('div.small.dim');
    const start = async (id) => {
      store.set('settings.ai.browserModel', id); bar.hidden = false; prog.textContent = cached[id] ? 'Starting…' : 'Downloading — this happens only once…';
      try {
        await wl.load(id, (p) => { bar.value = p.progress || 0; prog.textContent = p.text; });
        store.set('settings.ai.provider', 'browser');
        toast('Built-in AI is ready', { type: 'ok' }); bus.emit('ai:provider', activeProviderId()); re();
      } catch (e) { bar.hidden = true; prog.textContent = `Couldn't start: ${e.message}`; prog.style.color = 'var(--danger)'; }
    };
    const loaded = wl.loadedModel();
    box.replaceChildren(...[
      h('div.row', icon('cpu'), headTitle, loaded ? h('span.pill.ok', 'Running') : inUse ? h('span.pill', 'Starts with your first message') : null),
      h('div.small.dim', 'Real AI models that run inside this browser on your own graphics chip. No key, no install, no account — download once, then they also work offline. With ', h('b', 'Live web'), ' on, JARVIS-X searches the internet and gives the results to the model, so answers are current and come with sources.'),
      ...wl.GROUPS.map(([g, title]) => {
        const items = models.filter((m) => m[4] === g); if (!items.length) return null;
        const open = g === 'everyday' || items.some(([id]) => cached[id] || id === loaded);
        return h('details', { open }, h('summary.small', h('b', title), h('span.xs.muted', ` · ${items.length} model${items.length === 1 ? '' : 's'}`)),
          h('div.list', { style: 'margin-top:6px' }, items.map(([id, name, desc, size]) => h('div.item', h('span.grow', h('b.small', name), h('div.xs.dim', desc)), h('span.xs.muted', cached[id] ? 'Downloaded' : size),
            id === loaded ? h('span.pill.ok', 'In use') : h('button.btn.sm', { class: id === chosen && !loaded ? 'primary' : '', onclick: () => start(id) }, icon(cached[id] ? 'play' : 'download', { size: 13 }), cached[id] ? 'Use' : 'Download & use'),
            cached[id] ? h('button.btn.ghost.sm', { 'aria-label': `Delete ${name}`, onclick: async () => { if (!(await confirmDialog(`Delete ${name} from this browser?`))) return; await wl.remove(id); if (wl.chosenModel() === id) { store.set('settings.ai.browserModel', ''); store.set('settings.ai.browserReady', false); } paint(); } }, icon('trash', { size: 13 })) : null))));
      }),
      bar, prog,
      h('div.xs.muted', 'Tip: start with Qwen 3.5 · 2B. If it runs smoothly, try a bigger one. Each model downloads once, then starts in seconds and works offline. These run on your own computer, so they are less clever than Gemini — Live web helps a lot with facts.')].filter(Boolean));
  };
  paint();
  return box;
}

function General(el) {
  const s = store.get('settings');
  el.append(h('div.stack',
    section(h('h3', 'Language'), row('Interface language', 'Navigation & core labels', select(s.language, Object.entries(LANGUAGES), (v) => { set('settings.language', v); toast('Language updated — reopen windows to refresh labels.'); location.hash = ''; }, 'Language'))),
    section(h('h3', 'Notifications'),
      row('In-app notifications', 'Reminders, timers, focus sessions', toggle('', s.notifications, (v) => store.set('settings.notifications', v))),
      row('Desktop notifications', `Browser permission: ${'Notification' in window ? Notification.permission : 'unsupported'}`, h('button.btn.sm', { onclick: async () => toast(`Permission: ${await requestNotificationPermission()}`) }, icon('bell'), 'Request permission')),
      row('Sounds', 'Chime on reminders and timers', toggle('', s.sounds, (v) => store.set('settings.sounds', v))))));
}

function Accessibility(el) {
  const s = store.get('settings');
  el.append(h('div.stack', section(
    row('High contrast', 'Maximum contrast, no glass blur', toggle('', s.highContrast, (v) => set('settings.highContrast', v))),
    row('Text size', `${Math.round(s.fontScale * 100)}%`, h('div.row', [0.9, 1, 1.15, 1.3].map((x) => h('button.btn.sm', { class: s.fontScale === x ? 'primary' : '', onclick: () => { set('settings.fontScale', x); el.replaceChildren(); Accessibility(el); } }, `${Math.round(x * 100)}%`)))),
    row('Reduce motion', 'Stops rotating rings, particles and transitions', toggle('', s.motion === 'reduced', (v) => set('settings.motion', v ? 'reduced' : 'auto'))),
    row('Readable font', 'Wider letter and word spacing', toggle('', s.font === 'dyslexic', (v) => set('settings.font', v ? 'dyslexic' : 'plex'))),
    row('Screen readers', 'All controls are labelled; module changes and replies are announced via live regions', h('span.pill.ok', 'Enabled')),
    row('Keyboard navigation', 'Tab through everything; Esc closes; Ctrl+P lists every action', h('button.btn.sm', { onclick: () => bus.emit('open', { id: 'settings', params: { tab: 'shortcuts' } }) }, 'Shortcuts')),
    row('Voice control', 'Say commands such as "open tasks", "start pomodoro", "lock"', h('button.btn.sm', { onclick: () => bus.emit('voice:toggle') }, icon('mic'), 'Try it')))));
}

function Privacy(el) {
  const p = store.get('settings.privacy');
  el.append(h('div.stack', section(
    row('Privacy mode', 'Conversations are kept in memory only and never written to storage', toggle('', p.privacyMode, (v) => { store.set('settings.privacy.privacyMode', v); bus.emit('privacy', v); })),
    row('Save conversation history', null, toggle('', p.saveHistory, (v) => store.set('settings.privacy.saveHistory', v))),
    row('Local usage analytics', 'Counts stay on this device and power the Analytics page', toggle('', p.analytics, (v) => store.set('settings.privacy.analytics', v))),
    row('Where data lives', 'Everything is stored in this browser, encrypted with AES-GCM. Nothing is sent anywhere unless you connect an AI provider or use web search.', h('span.pill.ok', icon('shield', { size: 12 }), 'Local-first')),
    row('Clear conversations', null, h('button.btn.danger.sm', { onclick: async () => { if (await confirmDialog('Delete all conversations?', { danger: true, okLabel: 'Delete' })) { store.set('chat', { conversations: [], activeId: null }); toast('Conversations deleted', { type: 'ok' }); } } }, 'Clear')),
    row('Erase all data', 'Removes the vault, files and keys from this device', h('button.btn.danger.sm', { onclick: async () => { if (await confirmDialog('This permanently deletes everything JARVIS-X stores on this device, including files and your account.', { title: 'Erase all data?', danger: true, okLabel: 'Erase everything' })) { const { idb } = await import('../core/idb.js'); await Promise.all(['files', 'blobs', 'keys'].map((s) => idb.clear(s).catch(() => {}))); await store.reset(); location.reload(); } } }, 'Erase')))));
}

async function Security(el) {
  const sec = store.get('settings.security');
  const pw1 = h('input.input', { type: 'password', placeholder: 'New password (8+ characters)', autocomplete: 'new-password' });
  const pw2 = h('input.input', { type: 'password', placeholder: 'Confirm password', autocomplete: 'new-password' });
  const perms = h('div.row');
  for (const name of ['microphone', 'notifications', 'geolocation', 'camera']) {
    let state = 'unknown'; try { state = (await navigator.permissions.query({ name })).state; } catch { /* unsupported */ }
    perms.append(h('span.pill', { class: state === 'granted' ? 'ok' : state === 'denied' ? 'hi' : '' }, `${name}: ${state}`));
  }
  const bio = await biometricAvailable();
  el.append(h('div.stack',
    section(h('h3', 'Password lock & encryption'),
      h('div.small.dim', sec.lockEnabled ? 'Your vault is encrypted with a key derived from your password (PBKDF2, 310,000 iterations → AES-256-GCM). Without the password, the data cannot be read.' : 'Currently encrypted with a device key stored non-extractably in this browser. Add a password to require it at startup and after inactivity.'),
      h('div.row', pw1, pw2, h('button.btn.primary', { onclick: async () => {
        if (pw1.value.length < 8) return toast('Use at least 8 characters.', { type: 'warn' });
        if (pw1.value !== pw2.value) return toast('Passwords don\'t match.', { type: 'warn' });
        try { await store.setPassword(pw1.value); toast('Password lock enabled. Keep your password safe — it cannot be recovered.', { type: 'ok', timeout: 7000 }); el.replaceChildren(); Security(el); } catch (e) { toast(e.message, { type: 'error' }); }
      } }, icon('lock'), sec.lockEnabled ? 'Change password' : 'Enable lock')),
      sec.lockEnabled ? h('button.btn.danger.sm', { style: 'justify-self:start', onclick: async () => { if (await confirmDialog('Remove the password? Data will be encrypted with the device key instead.')) { await store.setPassword(null); el.replaceChildren(); Security(el); } } }, 'Remove password') : null),
    section(
      row('Session timeout', 'Lock after this many idle minutes (requires a password)', h('input.input', { type: 'number', min: 1, max: 240, value: sec.timeoutMin, style: 'width:80px', onchange: (e) => store.set('settings.security.timeoutMin', +e.target.value) })),
      row('Biometric unlock', bio ? 'Unlock the session lock screen with Touch ID, Windows Hello or your phone\'s biometrics. After a reload the password is still required to decrypt your data.' : 'No fingerprint/face authenticator is available here.', h('span.pill', { class: sec.bioCred ? 'ok' : '' }, sec.bioCred ? 'On' : bio ? 'Off' : 'Unavailable'),
        bio ? toggle('', !!sec.bioCred, async (v) => {
          if (!v) { store.set('settings.security.bioCred', null); el.replaceChildren(); Security(el); return; }
          if (!sec.lockEnabled) { toast('Set a password lock first.', { type: 'warn' }); el.replaceChildren(); Security(el); return; }
          try { const id = await registerBiometric(store.get('profile.name')); store.set('settings.security.bioCred', id); toast('Biometric unlock enabled', { type: 'ok' }); }
          catch (e) { toast(e.name === 'NotAllowedError' ? 'Biometric setup was canceled or isn\'t allowed in this frame.' : `Couldn't set up biometrics: ${e.message}`, { type: 'warn' }); }
          el.replaceChildren(); Security(el);
        }) : null),
      row('Session security', platform.isServer ? 'Signed-in sessions use an httpOnly, SameSite cookie that page scripts can\'t read; revoke devices from Account.' : platform.isHost ? 'Identity is handled by your Claude account.' : 'No account on this device; API keys are kept inside the encrypted vault.', h('span.pill.ok', icon('key', { size: 12 }), platform.label())),
      row('Permissions', 'Managed by your browser — change them in site settings', perms))));
}

function Shortcuts(el) {
  const map = getShortcuts();
  const tbl = h('div.list');
  for (const [id, sc] of Object.entries(map)) {
    const btn = h('button.btn.sm.mono', { onclick: () => {
      btn.textContent = 'Press keys…';
      const cap = (e) => { e.preventDefault(); e.stopPropagation(); const combo = comboFromEvent(e); if (!combo || ['Ctrl', 'Alt', 'Shift'].includes(combo)) return; removeEventListener('keydown', cap, true); store.set(['settings', 'shortcuts'], { ...(store.get('settings.shortcuts') || {}), [id]: [combo] }); el.replaceChildren(); Shortcuts(el); };
      addEventListener('keydown', cap, true);
    } }, sc.keys.join('  /  '));
    tbl.append(h('div.item', h('span.grow', sc.label), btn, JSON.stringify(sc.keys) !== JSON.stringify(DEFAULT_SHORTCUTS[id].keys) ? h('button.btn.ghost.sm', { onclick: () => { const c = { ...(store.get('settings.shortcuts') || {}) }; delete c[id]; store.set('settings.shortcuts', c); el.replaceChildren(); Shortcuts(el); } }, 'Reset') : null));
  }
  el.append(h('div.stack', h('div.small.dim', 'Click a shortcut to rebind it. Some browsers reserve Ctrl+N and Ctrl+T, so Alt alternatives are included.'), tbl));
}

function About(el) {
  el.append(h('div.stack', section(
    h('h3', 'JARVIS-X 1.0.0'),
    h('div.small.dim', 'An original, local-first AI operating system for the browser. Modular ES-module architecture with lazy-loaded features, encrypted storage and pluggable AI providers.'),
    row('Plan', 'One free plan with every feature — no payments, no limits', h('span.pill.ok', 'Free · everything included')),
    row('Storage', `${fmt.bytes(store.vaultSize())} encrypted vault · ${store.persistent ? 'persistent' : 'session only'}`),
    row('Offline support', 'Service worker caches the app shell when served over HTTP(S)', h('span.pill', 'serviceWorker' in navigator ? 'Supported' : 'Unavailable')),
    row('Documentation', 'See README.md and the docs/ folder in the project source'))));
}

export default {
  flush: true,
  mount(el, ctx) {
    const t = tabs([
      { id: 'appearance', label: 'Appearance', icon: 'palette', render: Appearance },
      { id: 'voice', label: 'Voice', icon: 'mic', render: Voice },
      { id: 'ai', label: 'AI', icon: 'sparkles', render: AI },
      { id: 'general', label: 'Language & notifications', icon: 'globe', render: General },
      { id: 'accessibility', label: 'Accessibility', icon: 'eye', render: Accessibility },
      { id: 'privacy', label: 'Privacy', icon: 'eyeoff', render: Privacy },
      { id: 'security', label: 'Security', icon: 'shield', render: (b) => { Security(b); } },
      { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard', render: Shortcuts },
      { id: 'about', label: 'About', icon: 'hud', render: About },
    ], { initial: ctx.params?.tab });
    el.append(t.el);
    this.update = (p) => t.select(p.tab || t.current);
  },
};
