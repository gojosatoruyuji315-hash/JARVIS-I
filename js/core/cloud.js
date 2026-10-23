/**
 * Accounts for the website edition (GitHub Pages or any static host) — email sign up /
 * sign in, email confirmation, password reset, and your progress saved to your account
 * so it follows you to every device. Backed by Supabase (Auth + one row per person,
 * protected by row-level security). Configure it in js/config.js; see docs/ACCOUNTS.md.
 *
 * API keys you paste into JARVIS-X (the `secrets` section) never leave the device.
 * @module core/cloud
 */
import { CLOUD } from '../config.js';
import { bus } from './bus.js';

const SESSION_KEY = 'jx-cloud-session';
const conf = () => {
  let o = {}; try { o = JSON.parse(localStorage.getItem('jx-cloud-config') || '{}'); } catch { /* */ } // developer override
  return { url: (o.url || CLOUD.url || '').replace(/\/$/, ''), key: o.key || CLOUD.key || '' };
};
export const configured = () => { const c = conf(); return /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(c.url) && !!c.key; };

let session = null; // { access_token, refresh_token, expires_at, user }
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }
const save = (s) => { session = s; try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* */ } };

export class CloudError extends Error { constructor(status, message) { super(message); this.status = status; } }

/** Friendlier wording for Supabase Auth messages. */
function friendly(msg = '', status) {
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first — open the link we sent you (check spam too).';
  if (/user already registered|already been registered/i.test(msg)) return 'An account with this email already exists. Sign in instead.';
  if (/password should be at least|weak password/i.test(msg)) return 'Choose a stronger password — at least 8 characters.';
  if (/rate limit|too many/i.test(msg) || status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/unable to validate email|invalid email/i.test(msg)) return 'That email address doesn\'t look right.';
  if (/same.*password|different from the old/i.test(msg)) return 'Your new password must be different from the old one.';
  return msg || `Something went wrong (${status}).`;
}

async function req(path, opts = {}) {
  const { method = 'GET', body, auth = true, headers = {}, signal, retried } = opts;
  const c = conf();
  if (!configured()) throw new CloudError(0, 'Accounts aren\'t set up on this site yet.');
  if (auth && session && Date.now() / 1000 > session.expires_at - 60) await refresh().catch(() => {});
  const bearer = auth && session ? session.access_token : (/^eyJ/.test(c.key) ? c.key : null);
  let r;
  try {
    r = await fetch(c.url + path, { method, signal, headers: { apikey: c.key, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) { if (e.name === 'AbortError') throw e; throw new CloudError(0, 'Can\'t reach the account server. Check your internet connection.'); }
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = text; }
  if (!r.ok) {
    if (r.status === 401 && auth && session && !retried && path.startsWith('/rest/')) { await refresh(); return req(path, { ...opts, retried: true }); }
    throw new CloudError(r.status, friendly(j?.msg || j?.error_description || j?.message || j?.error || '', r.status));
  }
  return j;
}

function fromToken(j) {
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (+j.expires_in || 3600), user: j.user };
}
export const publicUser = (u = session?.user) => (u ? { id: u.id, email: u.email, name: u.user_metadata?.name || '', created: u.created_at, confirmed: !!(u.email_confirmed_at || u.confirmed_at), cloud: true } : null);
export const user = () => publicUser();
export const accessToken = () => session?.access_token;
const redirect = () => location.origin + location.pathname;

let refreshing = null;
export async function refresh() {
  if (!session?.refresh_token) throw new CloudError(401, 'Not signed in');
  return (refreshing ||= req('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: session.refresh_token } })
    .then((j) => { save(fromToken(j)); return session; })
    .catch((e) => { if (e.status === 400 || e.status === 401) signOutLocal(); throw e; })
    .finally(() => { refreshing = null; }));
}

/** On startup: restore and refresh the saved session. Returns the user or null. */
export async function init() {
  if (!configured() || !session) return null;
  try { if (Date.now() / 1000 > session.expires_at - 300) await refresh(); else { const u = await req('/auth/v1/user'); save({ ...session, user: u }); } }
  catch (e) { if (e.status === 0) return user(); /* offline: stay signed in */ }
  return user();
}

/** Create an account. Returns { user, needsConfirm }. */
export async function signUp({ email, password, name }) {
  if (String(password).length < 8) throw new CloudError(400, 'Choose a password with at least 8 characters.');
  const j = await req(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirect())}`, { method: 'POST', auth: false, body: { email: email.trim(), password, data: { name: (name || '').trim().slice(0, 60) } } });
  if (j?.access_token) { save(fromToken(j)); bus.emit('auth:change', user()); return { user: user(), needsConfirm: false }; }
  // Supabase hides whether the email exists; an empty identities list means it was already registered.
  if (j && Array.isArray(j.identities) && !j.identities.length) throw new CloudError(400, 'An account with this email already exists. Sign in instead.');
  return { user: publicUser(j?.user || j), needsConfirm: true };
}
export async function signIn({ email, password }) {
  const j = await req('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: email.trim(), password } });
  save(fromToken(j)); bus.emit('auth:change', user()); return user();
}
export async function resendConfirmation(email) {
  return req(`/auth/v1/resend?redirect_to=${encodeURIComponent(redirect())}`, { method: 'POST', auth: false, body: { type: 'signup', email: email.trim() } });
}
export async function forgot(email) {
  return req(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirect())}`, { method: 'POST', auth: false, body: { email: email.trim() } });
}
export async function updatePassword(password) {
  if (String(password).length < 8) throw new CloudError(400, 'Choose a password with at least 8 characters.');
  const u = await req('/auth/v1/user', { method: 'PUT', body: { password } }); save({ ...session, user: u }); return user();
}
export async function updateProfile({ name }) {
  const u = await req('/auth/v1/user', { method: 'PUT', body: { data: { name: String(name || '').slice(0, 60) } } }); save({ ...session, user: u }); return user();
}
function signOutLocal() { const was = !!session; save(null); try { localStorage.removeItem('jx-cloud-synced'); } catch { /* */ } if (was) bus.emit('auth:change', null); }
export async function signOut({ everywhere = false } = {}) {
  await req(`/auth/v1/logout?scope=${everywhere ? 'global' : 'local'}`, { method: 'POST' }).catch(() => {});
  signOutLocal();
}
/** Is this the signed-in person's password? (Doesn't change the session.) */
export async function verifyPassword(password) {
  await req('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: session?.user?.email, password } }).catch(() => { throw new CloudError(400, 'That password isn\'t right.'); });
}
/** Check the password, then delete the account and its saved data. */
export async function deleteAccount(password) {
  await verifyPassword(password);
  await req('/rest/v1/rpc/delete_my_account', { method: 'POST', body: {} });
  signOutLocal();
}

/**
 * Handle the link from a confirmation or password-reset email
 * (#access_token=…&refresh_token=…&type=signup|recovery, or #error=…).
 * Returns { type, user } or { error }.
 */
export async function consumeRedirect(hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (p.get('error') || p.get('error_description')) {
    const d = p.get('error_description') || p.get('error');
    return { error: /expired|invalid/i.test(d) ? 'That link has expired or was already used. Ask for a new one.' : d.replace(/\+/g, ' ') };
  }
  if (!p.get('access_token')) return { error: 'That sign-in link is incomplete.' };
  save(fromToken({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_at: +p.get('expires_at') || undefined, expires_in: p.get('expires_in') }));
  try { save({ ...session, user: await req('/auth/v1/user') }); } catch (e) { save(null); return { error: e.message }; }
  bus.emit('auth:change', user());
  return { type: p.get('type') || 'signup', user: user() };
}
export const isAuthRedirect = (hash) => /(^#|&)(access_token|error_description|error_code)=/.test(hash || '');

/* --------------------------------------------------------- saved progress */
/** Read this person's saved state: { state, version } or null when nothing is saved yet. */
export async function loadVault() {
  const rows = await req(`/rest/v1/jarvis_vault?select=state,version&user_id=eq.${session.user.id}`);
  return rows?.[0] || null;
}
/**
 * Save with optimistic versioning: only replaces the row if it is still at baseVersion.
 * Returns { version } or throws { status: 409, current }.
 */
export async function saveVault(state, baseVersion) {
  const uid = session.user.id;
  if (baseVersion == null) {
    try {
      const rows = await req('/rest/v1/jarvis_vault', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { user_id: uid, state, version: 1 } });
      return { version: rows[0].version };
    } catch (e) {
      if (e.status !== 409) throw e;
      throw Object.assign(new CloudError(409, 'conflict'), { current: await loadVault() });
    }
  }
  const rows = await req(`/rest/v1/jarvis_vault?user_id=eq.${uid}&version=eq.${baseVersion}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { state, version: baseVersion + 1, updated_at: new Date().toISOString() } });
  if (!rows?.length) throw Object.assign(new CloudError(409, 'conflict'), { current: await loadVault() });
  return { version: rows[0].version };
}
