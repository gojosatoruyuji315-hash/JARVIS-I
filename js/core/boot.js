/**
 * Cinematic sequences: startup, shutdown and the lock screen.
 * Startup variants: standard | quick | prime (Master exclusive).
 * @module core/boot
 */
import { h, $, sleep } from './dom.js';
import { icon } from './icons.js';
import { createHUD } from './hud.js';
import { prefersReducedMotion } from './theme.js';
import { store } from './store.js';

const LINES = {
  standard: ['Power bus nominal', 'Mounting encrypted vault', 'Calibrating holographic display', 'Loading cognitive modules', 'Linking voice subsystem', 'Synchronising chronometer', 'Interface ready'],
  prime: ['PRIME protocol engaged', 'Authenticating Master credentials', 'Spinning up agent cluster ×6', 'Indexing personal knowledge base', 'Projecting exclusive HUD layer', 'Gold channel stabilised', 'All systems exceptional'],
};

/** Plays the startup sequence. Resolves when finished. */
export async function startup(variant = 'standard') {
  if (variant === 'quick' || prefersReducedMotion()) variant = 'quick';
  const prime = variant === 'prime';
  const log = h('div.boot-log', { 'aria-hidden': 'true' });
  const bar = h('i');
  const el = h('div.boot', { role: 'status', 'aria-label': 'Starting JARVIS-X' },
    h('div.boot-inner',
      h('div', { html: `<svg class="boot-rings" viewBox="0 0 180 180"><circle class="b1" cx="90" cy="90" r="86" ${prime ? 'style="stroke:var(--gold)"' : ''}/><circle class="b2" cx="90" cy="90" r="68"/><circle class="b3" cx="90" cy="90" r="50"/></svg>` }),
      h('div.boot-title', { class: prime ? 'master' : '' }, 'JARVIS-X'),
      variant !== 'quick' && log,
      h('div.boot-bar', bar)));
  document.body.append(el);
  const lines = LINES[prime ? 'prime' : 'standard'];
  if (variant === 'quick') { bar.style.width = '100%'; await sleep(350); }
  else {
    for (let i = 0; i < lines.length; i++) {
      log.append(h('div', lines[i]));
      bar.style.width = `${((i + 1) / lines.length) * 100}%`;
      await sleep(prime ? 260 : 190);
    }
    await sleep(250);
  }
  el.classList.add('done');
  setTimeout(() => el.remove(), 700);
}

/** Shutdown animation; shows a restart button. */
export async function shutdown(onRestart) {
  document.documentElement.classList.add('app-off');
  await store.saveNow();
  await sleep(prefersReducedMotion() ? 0 : 500);
  const el = h('div.shutdown', h('div.line'),
    h('div.off', h('div', 'SYSTEM OFFLINE'),
      h('button.btn.round', { onclick: () => { el.remove(); document.documentElement.classList.remove('app-off'); onRestart?.(); } }, icon('power'), 'Power on')));
  document.body.append(el);
  setTimeout(() => el.querySelector('button')?.focus(), 1300);
}

/**
 * Lock screen.
 * mode 'vault'   → password decrypts the vault (app not yet loaded)
 * mode 'session' → password verifies against stored hash
 * verify(password) must resolve true/false.
 */
export function lockScreen({ mode = 'session', verify, onUnlock, onReset }) {
  if ($('.lock')) return;
  const input = h('input.input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const msg = h('div.small.muted', mode === 'vault' ? 'Your data is encrypted. Enter your password to decrypt it.' : 'Session locked for your security.');
  const hud = createHUD({ variant: 'minimal' }); hud.setState({ state: 'locked' });
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      msg.textContent = 'Verifying…';
      if (await verify(input.value)) { el.remove(); hud.destroy(); onUnlock?.(); }
      else { msg.textContent = 'Incorrect password. Try again.'; card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); input.select(); }
    },
  }, input, h('button.btn.primary', { type: 'submit' }, icon('unlock'), 'Unlock'));
  const cred = store.get('settings.security.bioCred');
  const bio = mode === 'session' && cred ? h('button.btn.ghost.sm', { type: 'button', onclick: async () => {
    msg.textContent = 'Waiting for your fingerprint, face or device PIN…';
    if (await verifyBiometric(cred)) { el.remove(); hud.destroy(); onUnlock?.(); }
    else msg.textContent = 'Biometric check didn\'t complete. Use your password.';
  } }, icon('fingerprint'), 'Unlock with biometrics') : null;
  const card = h('div.lock-card', hud, h('h2', 'JARVIS-X'), msg, form, bio,
    mode === 'vault' && onReset ? h('button.btn.ghost.sm', { type: 'button', onclick: onReset }, 'Forgot password? Reset all data') : null);
  const el = h('div.lock', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Locked' }, card);
  document.body.append(el);
  setTimeout(() => input.focus(), 50);
}

/* ------------------------------------------------------------ biometrics */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export async function biometricAvailable() {
  try { return !!(await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()); } catch { return false; }
}
/**
 * Register this device's platform authenticator (Touch ID, Windows Hello, Android biometrics).
 * Used as a local unlock gate for the session lock screen; the encrypted vault still
 * needs the password after a reload. Returns the credential id or throws.
 */
export async function registerBiometric(name) {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'JARVIS-X' },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: name || 'jarvis-x-user', displayName: name || 'JARVIS-X user' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000, attestation: 'none',
  } });
  return b64u(cred.rawId);
}
export async function verifyBiometric(credId) {
  try {
    const r = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: unb64u(credId) }], userVerification: 'required', timeout: 60000 } });
    return !!r && (r.response.authenticatorData && (new Uint8Array(r.response.authenticatorData)[32] & 0x04) !== 0); // UV flag set
  } catch { return false; }
}
