/**
 * Encrypted, path-addressable application state.
 *
 *   store.get('settings.theme')            -> value
 *   store.set('settings.theme', 'aurum')   -> persists (debounced) + notifies
 *   store.update('tasks', list => [...])   -> functional update
 *   store.on('tasks', fn)                  -> subscribe to a path prefix
 *
 * Persistence: the whole state is serialised to JSON and encrypted with
 * AES-GCM (device key or password-derived key) into localStorage.
 * If storage is unavailable the app keeps working in memory for the session.
 * @module core/store
 */
import { bus } from './bus.js';
import { debounce, uid, todayKey } from './dom.js';
import { getDeviceKey, deriveKey, encryptJSON, decryptJSON, randomBytes, b64, unb64, hasSubtle, hashPassword, safeEqual } from './crypto.js';

const VAULT_KEY = 'jx.vault.v1';
/** Never leaves this device (keys, sync bookkeeping). */
export const LOCAL_ONLY = new Set(['secrets', 'meta', 'version']);
export const SCHEMA_VERSION = 1;

/* --------------------------------------------------------------- defaults */
const now = Date.now();
export function defaultState() {
  const t = todayKey();
  return {
    version: SCHEMA_VERSION,
    profile: { name: 'Operator', created: now },
    settings: {
      skin: 'arc', accent: null, font: 'plex', fontScale: 1, highContrast: false,
      motion: 'auto',           // auto | full | reduced
      particles: true, particleDensity: 1, hud: 'classic', startup: 'standard',
      language: 'en', notifications: true, sounds: true,
      voice: { rate: 1, pitch: 1, profile: 'default', voiceURI: '', autoSpeak: false, wakeWord: false, wakePhrase: 'jarvis', lang: 'en-US' },
      privacy: { privacyMode: false, saveHistory: true, analytics: true },
      security: { lockEnabled: false, timeoutMin: 15, passHash: null, biometric: false },
      ai: { provider: 'auto', keyProvider: 'anthropic', tier: 'default', endpoint: '', model: '', personality: 'sweet', temperature: 0.7, maxContext: 16 },
      watchlist: ['^NSEI', '^BSESN', 'AAPL', 'BTC-USD'],
      newsTopic: '',
      sync: true,
      shortcuts: null,          // null = defaults (see core/shortcuts.js)
      widgets: null,            // null = default layout (see modules/dashboard.js)
      location: null,           // {lat, lon, name}
      units: 'metric',
    },
    chat: { conversations: [], activeId: null },
    memory: {
      facts: [],
      prompts: [
        { id: uid('p'), title: 'Explain like a mentor', text: 'Explain this step by step, then give one practice question:', uses: 0 },
        { id: uid('p'), title: 'Tighten my writing', text: 'Rewrite the following to be clearer and shorter, keep my voice:', uses: 0 },
        { id: uid('p'), title: 'Plan my week', text: 'Look at my tasks and calendar and propose a realistic plan for this week:', uses: 0 },
      ],
      commandUsage: {},
      projects: [],
    },
    tasks: [],
    taskLists: ['Personal', 'Study', 'Work'],
    reminders: [],
    events: [],
    notes: [
      { id: uid('n'), title: 'Getting started', format: 'md', pinned: true, updated: now,
        body: '# Getting started\n\n- **Talk or type** in the command bar on the home screen. Try *"add a task to call the bank tomorrow"* or *"remind me at 6pm to stretch"*.\n- `Ctrl+K` searches everything, `Ctrl+P` lists every action, hold `Space` to talk.\n- Tell me about yourself — *"remember that I study best in the morning"* — and I\'ll use it in every answer.\n- Your data is encrypted on this device and syncs when you\'re signed in.\n\nDelete this note whenever you like.' },
    ],
    sticky: [],
    clipboard: [],
    goals: [],
    habits: [],
    planner: {},
    study: { decks: [], sessions: [], quizzes: [], plans: [], minutesByDay: {} },
    dev: { lang: 'javascript', files: {}, apiHistory: [] },
    automation: { routines: [
      { id: uid('r'), name: 'Morning focus', enabled: true, trigger: { type: 'manual', time: '08:00' }, lastRun: null,
        steps: [{ type: 'speak', value: 'Good morning. Here is your focus plan.' }, { type: 'open', value: 'tasks' }, { type: 'pomodoro', value: '25' }] },
    ] },
    music: { volume: 0.7, current: 0, shuffle: false, repeat: 'all', queue: null, liked: [], playlists: [], recent: [], composed: [], sources: ['youtube', 'audius', 'itunes', 'archive'] },
    files: { favorites: [], recent: [] },
    kb: { docs: [] },
    plugins: { installed: [], pinned: [], config: {}, data: {}, urls: [] },
    usage: { aiDay: t, aiCount: 0, byDay: {}, totals: { messages: 0, voice: 0, commands: 0, focusMin: 0 } },
    studyMode: { active: false },
    web: { engine: 'ddg', tabs: [], bookmarks: [], history: [] },
    secrets: { aiKey: '', youtubeKey: '' },
    meta: { ts: {}, sync: {} },
    seen: { onboarding: false },
  };
}

/* ----------------------------------------------------------------- helpers */
const split = (path) => (Array.isArray(path) ? path : String(path).split('.').filter(Boolean));
function getIn(obj, path) { return split(path).reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setIn(obj, path, value) {
  const keys = split(path); const last = keys.pop();
  let o = obj; for (const k of keys) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  o[last] = value;
}
/** Deep-merge saved state over defaults so new fields appear after upgrades. */
function mergeDefaults(def, saved) {
  if (Array.isArray(def) || typeof def !== 'object' || def === null) return saved === undefined ? def : saved;
  const out = { ...def };
  for (const k of Object.keys(saved || {})) out[k] = k in def ? mergeDefaults(def[k], saved[k]) : saved[k];
  return out;
}
/** Merge saved data over defaults and drop fields from older versions. */
function hydrate(saved) { const s = mergeDefaults(defaultState(), saved || {}); delete s.license; return s; }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

/* ------------------------------------------------------------------- store */
let state = defaultState();
let key = null;              // active CryptoKey
let mode = 'device';         // 'device' | 'password' | 'plain'
let salt = null;             // base64 salt for password mode
let persistent = true;
const subs = new Set();

async function writeVault() {
  if (!persistent) return;
  // Privacy mode: never persist conversations
  const snapshot = state.settings.privacy.privacyMode || !state.settings.privacy.saveHistory
    ? { ...state, chat: { conversations: [], activeId: null } } : state;
  try {
    if (mode === 'plain' || !key) { lsSet(VAULT_KEY, JSON.stringify({ mode: 'plain', data: snapshot, ts: Date.now() })); return; }
    const payload = await encryptJSON(key, snapshot);
    if (!lsSet(VAULT_KEY, JSON.stringify({ mode, salt, ...payload, ts: Date.now() }))) persistent = false;
  } catch (e) { console.warn('[store] save failed', e); }
}
const saveSoon = debounce(writeVault, 400);

function notify(path) {
  const p = split(path).join('.');
  for (const s of subs) if (!s.prefix || p.startsWith(s.prefix) || s.prefix.startsWith(p)) { try { s.fn(p); } catch (e) { console.error(e); } }
  bus.emit('store:change', { path: p });
}

export const store = {
  get state() { return state; },
  get persistent() { return persistent; },
  get mode() { return mode; },

  /** Load the vault. Resolves { locked } — locked=true means a password is required. */
  async init() {
    const raw = lsGet(VAULT_KEY);
    if (raw === null && !testStorage()) { persistent = false; }
    if (!hasSubtle()) mode = 'plain';
    if (!raw) { if (mode !== 'plain') { try { key = await getDeviceKey(); } catch { mode = 'plain'; } } await writeVault(); return { locked: false, fresh: true }; }
    let vault; try { vault = JSON.parse(raw); } catch { return { locked: false, corrupt: true }; }
    if (vault.mode === 'plain') { mode = hasSubtle() ? 'device' : 'plain'; state = hydrate(vault.data); if (mode === 'device') key = await getDeviceKey(); return { locked: false }; }
    if (vault.mode === 'password') { mode = 'password'; salt = vault.salt; this._pending = vault; return { locked: true }; }
    try { key = await getDeviceKey(); state = hydrate(await decryptJSON(key, vault)); mode = 'device'; return { locked: false }; }
    catch { return { locked: false, corrupt: true }; }
  },

  /** Unlock a password-protected vault. */
  async unlock(password) {
    try {
      const k = await deriveKey(password, unb64(salt));
      const data = await decryptJSON(k, this._pending);
      key = k; state = hydrate(data); delete this._pending;
      return true;
    } catch { return false; }
  },

  /** Verify password for the in-session lock screen. */
  async verifyPassword(password) {
    const ph = state.settings.security.passHash;
    if (!ph) return true;
    const { hash } = await hashPassword(password, ph.salt);
    return safeEqual(hash, ph.hash);
  },

  /** Enable/disable password encryption. Pass null to remove the password. */
  async setPassword(password) {
    if (!hasSubtle()) throw new Error('Secure context required for encryption');
    if (password) {
      const s = randomBytes(16); salt = b64(s); key = await deriveKey(password, s); mode = 'password';
      state.settings.security.passHash = await hashPassword(password);
      state.settings.security.lockEnabled = true;
    } else {
      key = await getDeviceKey(); mode = 'device'; salt = null;
      state.settings.security.passHash = null; state.settings.security.lockEnabled = false;
    }
    await writeVault(); notify('settings.security');
  },

  get(path) { return path ? getIn(state, path) : state; },
  set(path, value) {
    setIn(state, path, value);
    const section = split(path)[0];
    if (section && !LOCAL_ONLY.has(section)) { state.meta.ts[section] = Date.now(); bus.emit('store:dirty', section); }
    saveSoon(); notify(path); return value;
  },
  /** Apply sections received from cloud sync (keeps their timestamps, no echo). */
  applyRemote(sections, ts) {
    for (const [k, v] of Object.entries(sections)) { if (LOCAL_ONLY.has(k)) continue; state[k] = mergeDefaults(defaultState()[k], v); state.meta.ts[k] = ts[k] ?? Date.now(); }
    saveSoon(); notify('');
  },
  /** Sections that sync between devices, with their last-modified times. */
  syncable() { return Object.keys(state).filter((k) => !LOCAL_ONLY.has(k)); },
  update(path, fn) { return this.set(path, fn(structuredClone(getIn(state, path)))); },
  push(path, item) { const arr = getIn(state, path) || []; return this.set(path, [...arr, item]) && item; },
  unshift(path, item) { const arr = getIn(state, path) || []; this.set(path, [item, ...arr]); return item; },
  removeById(path, id) { this.set(path, (getIn(state, path) || []).filter((x) => x.id !== id)); },
  patchById(path, id, patch) { this.set(path, (getIn(state, path) || []).map((x) => (x.id === id ? { ...x, ...patch } : x))); },
  findById(path, id) { return (getIn(state, path) || []).find((x) => x.id === id); },

  /** Subscribe to changes under a path prefix ('' = everything). Returns unsubscribe fn. */
  on(prefix, fn) { const s = { prefix: prefix || '', fn }; subs.add(s); return () => subs.delete(s); },

  saveNow: writeVault,
  export() { const s = structuredClone(state); delete s.secrets; delete s.meta; return JSON.stringify(s, null, 2); },
  import(json) { const data = JSON.parse(json); delete data.secrets; state = hydrate({ ...data, secrets: state.secrets, meta: state.meta }); for (const k of this.syncable()) state.meta.ts[k] = Date.now(); writeVault(); notify(''); },
  async reset() { lsDel(VAULT_KEY); state = defaultState(); mode = hasSubtle() ? 'device' : 'plain'; salt = null; if (mode === 'device') key = await getDeviceKey(); await writeVault(); notify(''); },
  /** Size of the persisted vault in bytes. */
  vaultSize() { return (lsGet(VAULT_KEY) || '').length; },
};

function testStorage() { try { localStorage.setItem('jx.t', '1'); localStorage.removeItem('jx.t'); return true; } catch { return false; } }

// Persist on tab hide so nothing is lost
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeVault(); });
