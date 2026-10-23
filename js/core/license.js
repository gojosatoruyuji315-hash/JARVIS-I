/**
 * Identity. JARVIS-X is free with every feature, so there are no plans or
 * billing — only who the person is, per platform:
 *
 *  server      Accounts on the JARVIS-X server (sync across devices, API keys).
 *  host        The viewer's claude.ai identity.
 *  standalone  Email accounts through Supabase when js/config.js is set up (core/cloud.js),
 *              otherwise no account: a personal copy on this device.
 * @module core/license
 */
import { bus } from './bus.js';
import { store } from './store.js';
import { platform } from './platform.js';
import { api } from './api.js';
import * as cloud from './cloud.js';

const useCloud = () => !platform.isServer && !platform.isHost && cloud.configured();

let me = null; // server: public user object from /api/auth/me

export const license = {
  async init() {
    if (platform.isServer) { try { me = (await api.get('/api/auth/me')).user; } catch { me = null; } }
    else if (useCloud()) me = await cloud.init();
    bus.emit('auth:ready', me);
  },
  get accountsAvailable() { return platform.isServer || useCloud(); },
  /** Accounts come from the website's Supabase project (not the JARVIS-X server). */
  get isCloud() { return useCloud(); },

  /** Current person: { id, email, name, … } or null. */
  user() {
    if (platform.isServer) return me;
    if (useCloud()) return cloud.user();
    if (platform.isHost) { const m = platform.host.me; return m?.id ? { id: m.id, name: m.name || store.get('profile.name'), email: m.email, avatarUrl: m.avatarUrl, host: true } : null; }
    return null;
  },

  // Single free plan — kept for code that displays it
  plan: () => 'free',
  planName: () => 'Free',
  isAtLeast: () => true,

  async refresh() { if (platform.isServer) me = (await api.get('/api/auth/me')).user; else if (useCloud()) me = await cloud.init(); return me; },
  /** Returns the user; with cloud accounts may return { needsConfirm: true } until the email is confirmed. */
  async register({ email, password, name }) {
    if (useCloud()) { const r = await cloud.signUp({ email, password, name }); if (r.needsConfirm) return { needsConfirm: true, email }; return (me = r.user); }
    me = (await api.post('/api/auth/register', { email, password, name })).user; bus.emit('auth:change', me); return me;
  },
  async login({ email, password }) { if (useCloud()) return (me = await cloud.signIn({ email, password })); me = (await api.post('/api/auth/login', { email, password })).user; bus.emit('auth:change', me); return me; },
  async logout(opts) { if (useCloud()) { await cloud.signOut(opts); me = null; return; } await api.post('/api/auth/logout').catch(() => {}); me = null; bus.emit('auth:change', null); },
  async forgot(email) { return useCloud() ? cloud.forgot(email) : api.post('/api/auth/forgot', { email }); },
  async resendConfirmation(email) { return cloud.resendConfirmation(email); },
  async reset(token, password) { if (useCloud()) return (me = await cloud.updatePassword(password)); me = (await api.post('/api/auth/reset', { token, password })).user; bus.emit('auth:change', me); return me; },
  async changePassword(current, next) {
    if (useCloud()) { await cloud.verifyPassword(current); await cloud.updatePassword(next); return; }
    await api.post('/api/auth/password', { current, next });
  },
  async updateProfile(patch) { if (useCloud()) return (me = await cloud.updateProfile(patch)); me = (await api.patch('/api/auth/me', patch)).user; return me; },
  async deleteAccount(password) { if (useCloud()) { await cloud.deleteAccount(password); me = null; return; } await api.post('/api/auth/delete', { password }); me = null; bus.emit('auth:change', null); },
  sessions: () => api.get('/api/auth/sessions'),
  revokeSession: (id) => api.del(`/api/auth/sessions/${encodeURIComponent(id)}`),
  revokeOthers: () => api.post('/api/auth/sessions/revoke-others'),
};

bus.on('platform:ready', () => license.init());
