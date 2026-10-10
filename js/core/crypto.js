/**
 * Cryptography helpers built on the Web Crypto API.
 *
 *  - Device key: AES-GCM-256, generated once, NON-EXTRACTABLE, kept in IndexedDB.
 *    Encrypts the local vault when no password lock is set.
 *  - Password key: PBKDF2-SHA256 (310k iterations) -> AES-GCM-256.
 *    Encrypts the vault when the password lock is enabled (data unreadable without it).
 *  - Signing key: HMAC-SHA256 (non-extractable) for local license tokens.
 *
 * NOTE: Client-side crypto protects data at rest on this device. It does not
 * replace server-side security; see docs/ARCHITECTURE.md → Security.
 * @module core/crypto
 */
import { idb } from './idb.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
export const PBKDF2_ITERATIONS = 310_000;

export const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
export const randomBytes = (n = 16) => crypto.getRandomValues(new Uint8Array(n));
export const hasSubtle = () => !!globalThis.crypto?.subtle;

/** Load (or create) the per-device AES key. */
export async function getDeviceKey() {
  let key = await idb.get('keys', 'device').catch(() => null);
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idb.set('keys', 'device', key).catch(() => {});
  }
  return key;
}

/** Load (or create) the HMAC signing key used for local tokens. */
export async function getSigningKey() {
  let key = await idb.get('keys', 'sign').catch(() => null);
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    await idb.set('keys', 'sign', key).catch(() => {});
  }
  return key;
}

/** Derive an AES-GCM key from a password and salt. */
export async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Hash a password for verification (PBKDF2 → 256 bits, base64). */
export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : randomBytes(16);
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, base, 256);
  return { hash: b64(bits), salt: b64(salt) };
}

/** Constant-time-ish string compare. */
export function safeEqual(a = '', b = '') {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Encrypt any JSON-serialisable value. Returns { iv, ct } (base64). */
export async function encryptJSON(key, value) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
  return { iv: b64(iv), ct: b64(ct) };
}
/** Decrypt a payload produced by encryptJSON. Throws on wrong key / tampering. */
export async function decryptJSON(key, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
  return JSON.parse(dec.decode(pt));
}

/** HMAC sign / verify for compact tokens (header.payload.sig). */
export async function signToken(payload) {
  const key = await getSigningKey();
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JXT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(String.fromCharCode(...new Uint8Array(sig)))}`;
}
export async function verifyToken(token) {
  try {
    const [head, body, sig] = token.split('.');
    const key = await getSigningKey();
    const raw = Uint8Array.from(unb64url(sig), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, raw, enc.encode(`${head}.${body}`));
    if (!ok) return null;
    const payload = JSON.parse(unb64url(body));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

/** SHA-256 hex digest (used for device fingerprint ids, cache keys). */
export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
