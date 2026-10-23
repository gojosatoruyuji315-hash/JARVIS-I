/**
 * Cloud sync. Each top-level state section (tasks, notes, settings…) carries a
 * last-modified time; the newer copy of a section wins when devices meet.
 *
 *  server  PUT/GET /api/sync with optimistic versions (409 → merge → retry).
 *          Pulls on focus and every 60 s, so Developer-API writes appear too.
 *  cloud   Website accounts (Supabase): one row per person, same optimistic
 *          versions as the server. Pulls on focus and every 60 s.
 *  host    The Claude viewer's private per-user store: one document per section
 *          at data/users/<id>/<section>, live across devices via onSnapshot.
 * Secrets (API keys) and device-local bookkeeping never leave the device.
 * @module core/sync
 */
import { store, LOCAL_ONLY } from './store.js';
import { bus } from './bus.js';
import { platform } from './platform.js';
import { license } from './license.js';
import { api } from './api.js';
import { debounce } from './dom.js';
import * as cloud from './cloud.js';

const DOC_LIMIT = 240 * 1024; // stay under the 256 KiB document cap
const status = { state: 'off', last: null, error: null, target: null };
const setStatus = (s, error = null) => { status.state = s; status.error = error; if (s === 'synced') status.last = Date.now(); bus.emit('sync:status', { ...status }); };

const snapshotSections = () => Object.fromEntries(store.syncable().map((k) => [k, store.get(k)]));
/** Merge remote sections that are newer than ours. Returns true if anything changed locally. */
function mergeRemote(remoteState) {
  if (!remoteState) return false;
  const rts = remoteState.meta?.ts || {}; const lts = store.get('meta.ts');
  const newer = {}; const ts = {};
  for (const [k, v] of Object.entries(remoteState)) {
    if (LOCAL_ONLY.has(k) || v == null) continue;
    if ((rts[k] || 0) > (lts[k] || 0)) { newer[k] = v; ts[k] = rts[k]; }
  }
  if (!Object.keys(newer).length) return false;
  store.applyRemote(newer, ts);
  bus.emit('theme:apply');
  return true;
}
const localIsNewer = (remoteState) => { const rts = remoteState?.meta?.ts || {}; const lts = store.get('meta.ts'); return store.syncable().some((k) => (lts[k] || 0) > (rts[k] || 0)); };

/* ------------------------------------------------------------------ server */
const serverSync = {
  version: null, pushing: false, again: false,
  async pull() {
    const r = await api.get('/api/sync');
    this.version = r.version;
    mergeRemote(r.state);
    if (!r.state || localIsNewer(r.state)) await this.push();
    else setStatus('synced');
  },
  async push() {
    if (this.pushing) { this.again = true; return; }
    this.pushing = true; setStatus('syncing');
    try {
      for (let i = 0; i < 4; i++) {
        try {
          const r = await api.put('/api/sync', { state: { ...snapshotSections(), meta: { ts: store.get('meta.ts') } }, baseVersion: this.version });
          this.version = r.version; setStatus('synced'); break;
        } catch (e) {
          if (e.status !== 409) throw e;
          this.version = e.data.current?.version ?? null;
          mergeRemote(e.data.current?.state);
        }
      }
    } catch (e) { setStatus('error', e.message); }
    finally { this.pushing = false; if (this.again) { this.again = false; this.push(); } }
  },
};

/* ------------------------------------------------------------------- cloud */
const cloudSync = {
  version: null, pushing: false, again: false,
  async pull() {
    const r = await cloud.loadVault();
    this.version = r?.version ?? null;
    // First sign-in on this device: the account's saved progress wins over whatever is in this browser
    const uid = license.user()?.id; let seen = null; try { seen = localStorage.getItem('jx-cloud-synced'); } catch { /* */ }
    if (r?.state && seen !== uid) {
      const rts = r.state.meta?.ts || {}; const all = {}; const ts = {};
      for (const [k, v] of Object.entries(r.state)) if (!LOCAL_ONLY.has(k) && v != null) { all[k] = v; ts[k] = Math.max(rts[k] || 0, store.get(['meta', 'ts', k]) || 0) + 1; }
      store.applyRemote(all, ts); bus.emit('theme:apply');
    } else mergeRemote(r?.state);
    try { localStorage.setItem('jx-cloud-synced', uid); } catch { /* */ }
    if (!r || localIsNewer(r.state)) await this.push();
    else setStatus('synced');
  },
  async push() {
    if (this.pushing) { this.again = true; return; }
    this.pushing = true; setStatus('syncing');
    try {
      for (let i = 0; i < 4; i++) {
        try { const r = await cloud.saveVault({ ...snapshotSections(), meta: { ts: store.get('meta.ts') } }, this.version); this.version = r.version; setStatus('synced'); break; }
        catch (e) { if (e.status !== 409) throw e; this.version = e.current?.version ?? null; mergeRemote(e.current?.state); }
      }
    } catch (e) { setStatus('error', /jarvis_vault|relation|schema cache/i.test(e.message) ? 'The account database isn\'t set up yet — run supabase/setup.sql (see docs/ACCOUNTS.md).' : e.message); }
    finally { this.pushing = false; if (this.again) { this.again = false; this.push(); } }
  },
};
const remoteSync = () => (platform.isServer ? serverSync : license.isCloud && license.user() ? cloudSync : null);

/* -------------------------------------------------------------------- host */
const hostSync = {
  uid: null, unsub: null, writing: new Map(), lastWritten: {},
  col() { return platform.host.db.collection(`data/users/${this.uid}`); },
  encode(k, v) {
    let json = JSON.stringify(v);
    if (k === 'chat' && json.length > DOC_LIMIT) { // keep the newest conversations that fit
      const convs = [...v.conversations]; while (convs.length > 1 && JSON.stringify({ ...v, conversations: convs }).length > DOC_LIMIT) convs.pop();
      json = JSON.stringify({ ...v, conversations: convs });
    }
    return json.length > DOC_LIMIT ? null : { json, ts: store.get(['meta', 'ts', k]) || Date.now() };
  },
  async writeSection(k) {
    if (this.writing.get(k)) { this.writing.set(k, 'again'); return; }
    this.writing.set(k, true);
    try {
      const body = this.encode(k, store.get(k));
      if (!body) { setStatus('error', `“${k}” is too large to sync (256 KB limit per section).`); return; }
      this.lastWritten[k] = body.ts;
      await this.col().doc(k).set(body);
      setStatus('synced');
    } catch (e) { setStatus('error', e.code === 'invalid_argument' ? 'You don\'t have permission to save data in this workspace.' : e.message); }
    finally { const again = this.writing.get(k) === 'again'; this.writing.delete(k); if (again) this.writeSection(k); }
  },
  async start() {
    this.uid = await platform.host.user?.id().catch(() => null);
    if (!this.uid || !platform.host.db) { setStatus('off'); return; }
    status.target = 'Claude'; setStatus('syncing');
    let first = true;
    this.unsub = this.col().onSnapshot((snap) => {
      const remote = {}; const ts = {};
      for (const d of snap.docs) {
        const b = d.data(); if (!b?.json || LOCAL_ONLY.has(d.id)) continue;
        if (d.metadata.hasPendingWrites || this.lastWritten[d.id] === b.ts) continue;
        try { remote[d.id] = JSON.parse(b.json); ts[d.id] = b.ts; } catch { /* skip */ }
      }
      mergeRemote({ ...remote, meta: { ts } });
      if (first) { // push sections that are newer here (or never synced)
        first = false;
        const have = new Set(snap.docs.map((d) => d.id));
        for (const k of store.syncable()) if (!have.has(k) || (store.get(['meta', 'ts', k]) || 0) > (ts[k] || 0)) this.writeSection(k);
        setStatus('synced');
      }
    }, (e) => setStatus('error', e.message));
  },
};

/* ------------------------------------------------------------------ public */
const dirty = new Set();
const flush = debounce(() => {
  if (status.state === 'off') return;
  if (remoteSync()) remoteSync().push();
  else if (platform.isHost) for (const k of dirty) hostSync.writeSection(k);
  dirty.clear();
}, 1500);

export const sync = {
  get status() { return { ...status }; },
  async start() {
    if (!store.get('settings.sync')) { setStatus('off'); return; }
    if (platform.isServer && license.user()) {
      status.target = 'JARVIS-X Cloud';
      try { setStatus('syncing'); await serverSync.pull(); } catch (e) { setStatus('error', e.message); }
    } else if (license.isCloud && license.user()) {
      status.target = license.user().email;
      try { setStatus('syncing'); await cloudSync.pull(); } catch (e) { setStatus('error', e.message); }
    } else if (platform.isHost) await hostSync.start();
    else setStatus('off');
  },
  stop() { hostSync.unsub?.(); hostSync.unsub = null; cloudSync.version = null; status.target = null; setStatus('off'); },
  async now() { if (remoteSync()) return remoteSync().pull(); if (platform.isHost) for (const k of store.syncable()) await hostSync.writeSection(k); },
};

bus.on('store:dirty', (k) => { if (store.get('settings.privacy.privacyMode') && k === 'chat') return; dirty.add(k); flush(); });
bus.on('auth:change', (u) => { if (u) sync.start(); else sync.stop(); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && remoteSync() && status.state !== 'off') remoteSync().pull().catch(() => {}); });
setInterval(() => { if (remoteSync() && status.state === 'synced' && document.visibilityState === 'visible') remoteSync().pull().catch(() => {}); }, 60e3);
