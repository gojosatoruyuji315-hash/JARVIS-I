/**
 * Identity. JARVIS-X is free with every feature, so there are no plans or
 * billing — only who the person is, per platform:
 *
 *  server      Accounts on the JARVIS-X server (sync across devices, API keys).
 *  host        The viewer's claude.ai identity.
 *  standalone  No account: a personal copy on this device.
 * @module core/license
 */
import { bus } from './bus.js';
import { store } from './store.js';
import { platform } from './platform.js';
import { api } from './api.js';

let me = null; // server: public user object from /api/auth/me

export const license = {
  async init() {
    if (platform.isServer) { try { me = (await api.get('/api/auth/me')).user; } catch { me = null; } }
    bus.emit('auth:ready', me);
  },
  get accountsAvailable() { return platform.isServer; },

  /** Current person: { id, email, name, … } or null. */
  user() {
    if (platform.isServer) return me;
    if (platform.isHost) { const m = platform.host.me; return m?.id ? { id: m.id, name: m.name || store.get('profile.name'), email: m.email, avatarUrl: m.avatarUrl, host: true } : null; }
    return null;
  },

  // Single free plan — kept for code that displays it
  plan: () => 'free',
  planName: () => 'Free',
  isAtLeast: () => true,

  async refresh() { if (platform.isServer) me = (await api.get('/api/auth/me')).user; return me; },
  async register({ email, password, name }) { me = (await api.post('/api/auth/register', { email, password, name })).user; bus.emit('auth:change', me); return me; },
  async login({ email, password }) { me = (await api.post('/api/auth/login', { email, password })).user; bus.emit('auth:change', me); return me; },
  async logout() { await api.post('/api/auth/logout').catch(() => {}); me = null; bus.emit('auth:change', null); },
  async forgot(email) { return api.post('/api/auth/forgot', { email }); },
  async reset(token, password) { me = (await api.post('/api/auth/reset', { token, password })).user; bus.emit('auth:change', me); return me; },
  async changePassword(current, next) { await api.post('/api/auth/password', { current, next }); },
  async updateProfile(patch) { me = (await api.patch('/api/auth/me', patch)).user; return me; },
  async deleteAccount(password) { await api.post('/api/auth/delete', { password }); me = null; bus.emit('auth:change', null); },
  sessions: () => api.get('/api/auth/sessions'),
  revokeSession: (id) => api.del(`/api/auth/sessions/${encodeURIComponent(id)}`),
  revokeOthers: () => api.post('/api/auth/sessions/revoke-others'),
};

bus.on('platform:ready', () => license.init());
