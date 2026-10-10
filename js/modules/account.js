/**
 * Account: sign up / sign in / password reset (server), profile, devices &
 * sessions, password change, Developer API keys, cloud sync status, account deletion.
 * Inside a Claude viewer the identity is the viewer's claude.ai account.
 * @module modules/account
 */
import { h, clear, fmt, toast, modal, confirmDialog, promptDialog, copyText } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { license } from '../core/license.js';
import { platform } from '../core/platform.js';
import { sync } from '../core/sync.js';
import { api } from '../core/api.js';

/** Sign-in / registration dialog (server mode). Resolves true when signed in. */
export function authDialog({ reason, mode = 'register' } = {}) {
  if (!platform.isServer) { toast('Accounts are provided by the JARVIS-X server.', { type: 'warn' }); return Promise.resolve(false); }
  return new Promise((resolve) => {
    let m; let current = mode;
    const name = h('input.input', { placeholder: 'Your name', autocomplete: 'name' });
    const email = h('input.input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email', required: true });
    const pw = h('input.input', { type: 'password', placeholder: 'At least 8 characters', autocomplete: 'current-password' });
    const err = h('div.small', { style: 'color:var(--danger);min-height:18px', role: 'alert' });
    const tabsEl = h('div.billing-toggle', { style: 'justify-self:center' });
    const form = h('form.stack', { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        if (current === 'forgot') { await license.forgot(email.value); err.style.color = 'var(--ok)'; err.textContent = 'If that email has an account, a reset link is on its way.'; btn.disabled = false; return; }
        if (current === 'register') await license.register({ email: email.value, password: pw.value, name: name.value });
        else await license.login({ email: email.value, password: pw.value });
        if (name.value && current === 'register') store.set('profile.name', name.value.trim());
        toast(current === 'register' ? 'Account created. Welcome aboard.' : `Welcome back${license.user()?.name ? ', ' + license.user().name : ''}.`, { type: 'ok' });
        m.close(true);
      } catch (ex) { err.style.color = 'var(--danger)'; err.textContent = ex.message; btn.disabled = false; }
    } });
    const draw = () => {
      pw.autocomplete = current === 'register' ? 'new-password' : 'current-password';
      clear(tabsEl).append(['register', 'login'].map((k) => h('button', { type: 'button', 'aria-pressed': String(current === k), onclick: () => { current = k; draw(); } }, k === 'register' ? 'Create account' : 'Sign in')));
      clear(form).append(current === 'register' ? h('label.field', 'Name', name) : null, h('label.field', 'Email', email),
        current !== 'forgot' ? h('label.field', 'Password', pw) : null, err,
        h('button.btn.primary', { type: 'submit' }, { register: 'Create free account', login: 'Sign in', forgot: 'Send reset link' }[current]),
        current === 'login' ? h('button.btn.ghost.sm', { type: 'button', onclick: () => { current = 'forgot'; draw(); } }, 'Forgot password?') : null,
        current === 'forgot' ? h('button.btn.ghost.sm', { type: 'button', onclick: () => { current = 'login'; draw(); } }, 'Back to sign in') : null);
    };
    draw();
    m = modal({ title: 'JARVIS-X account', titleIcon: 'user', body: h('div.stack', reason ? h('div.small.dim', reason) : null, tabsEl, form), onClose: (r) => resolve(!!r) });
  });
}

const card = (ic, title, ...body) => h('div.glass.widget', h('div.w-head', icon(ic), h('h3.w-title', title)), ...body);

function syncCard() {
  const st = sync.status;
  const label = { off: 'Off', syncing: 'Syncing…', synced: `Up to date${st.last ? ' · ' + fmt.time(st.last) : ''}`, error: `Problem: ${st.error}` }[st.state];
  return card('cloud', 'Cloud sync',
    h('div.stat-row', h('span.dim', 'Status'), h('b', { style: `color:var(${st.state === 'error' ? '--danger' : st.state === 'synced' ? '--ok' : '--fg'})` }, label)),
    st.target ? h('div.stat-row', h('span.dim', 'Synced with'), h('b', st.target)) : null,
    h('div.xs.muted', { style: 'margin:6px 0' }, platform.isHost ? 'Your data is stored privately under your Claude account — only you can read it, on any device where you open this page.' : platform.isServer ? 'Your data is encrypted at rest on the server and merged section-by-section across devices.' : 'Sync needs a JARVIS-X server or the Claude-hosted page. Data here stays in this browser.'),
    h('div.row', st.state !== 'off' ? h('button.btn.sm', { onclick: async () => { await sync.now(); toast('Synced', { type: 'ok' }); } }, icon('refresh'), 'Sync now') : null,
      h('label.switch.xs', h('input', { type: 'checkbox', checked: store.get('settings.sync'), onchange: (e) => { store.set('settings.sync', e.target.checked); e.target.checked ? sync.start() : sync.stop(); } }), h('span.track'), 'Sync this device')));
}

export default {
  async mount(el, ctx) {
    const render = async () => {
      clear(el);
      if (ctx.params?.reset) return renderReset(ctx.params.reset);
      const u = license.user();

      if (platform.isHost) {
        const me = platform.host.me;
        el.append(h('div.stack',
          card('user', 'You', h('div.row', me?.avatarUrl ? h('img', { src: me.avatarUrl, alt: '', style: 'width:52px;height:52px;border-radius:50%' }) : icon('user', { size: 40 }),
            h('div.grow', h('h2', me?.name || store.get('profile.name')), me?.email ? h('div.small.dim', me.email) : null, h('div.xs.muted', 'Signed in with your Claude account')))),
          syncCard(),
          profileCard()));
        return;
      }
      if (!platform.isServer) {
        el.append(h('div.stack',
          card('user', 'Personal copy', h('div.small.dim', 'Everything stays in this browser, encrypted. Every feature is free. Run the JARVIS-X server to get accounts and sync across devices.')),
          profileCard(), syncCard(),
          card('plug', 'Connect a server', h('div.small.dim', 'Run the included JARVIS-X server (`npm start`) to get accounts, paid plans with Razorpay or Stripe, AI without keys in the browser, sync across devices, live news and markets, and server-side code execution. See server/README.md.'))));
        return;
      }
      if (!u) {
        el.append(h('div.result-page', icon('user', { size: 44 }), h('h2', 'Sign in to JARVIS-X'),
          h('div.dim', { style: 'max-width:460px' }, 'Your account syncs your workspace across devices and holds your plan. The app works signed-out too, with data kept on this device.'),
          h('div.row', h('button.btn.primary', { onclick: async () => { if (await authDialog()) render(); } }, 'Create account'), h('button.btn', { onclick: async () => { if (await authDialog({ mode: 'login' })) render(); } }, 'Sign in'))));
        return;
      }
      const sessionsEl = h('div.list', h('div.small.dim', 'Loading…'));
      const keysEl = h('div.stack');
      el.append(h('div.stack',
        h('div.glass.widget', h('div.row', h('div', { style: 'width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-family:var(--font-display);font-size:22px;border:1px solid var(--line-hi);box-shadow:var(--glow)' }, (u.name || u.email)[0].toUpperCase()),
          h('div.grow', h('h2', u.name || store.get('profile.name')), h('div.dim.small', u.email), h('div.xs.muted', `Member since ${fmt.date(u.created, { month: 'long', year: 'numeric' })}`)),
          h('button.btn.ghost', { onclick: async () => { if (await confirmDialog('Sign out of this device?')) { await license.logout(); render(); } } }, icon('power'), 'Sign out'))),
        h('div.grid2',
          syncCard()),
        card('device', 'Signed-in devices', sessionsEl),
        card('key', 'Password', h('button.btn.sm', { onclick: changePassword }, 'Change password'), h('div.xs.muted', { style: 'margin-top:6px' }, 'Changing your password signs out every other device.')),
        card('terminal', 'Developer API keys', keysEl),
        profileCard(),
        card('alert', 'Delete account', h('div.small.dim', 'Permanently deletes your account, synced data, API keys and payment history from this server. Cancel any subscription first.'),
          h('button.btn.danger.sm', { style: 'margin-top:8px', onclick: async () => {
            const pw = await promptDialog('Confirm with your password', { label: 'Password' }); if (!pw) return;
            try { await license.deleteAccount(pw); toast('Your account was deleted.'); render(); } catch (e) { toast(e.message, { type: 'error' }); }
          } }, 'Delete my account'))));
      // sessions
      license.sessions().then(({ sessions, limit }) => {
        clear(sessionsEl).append(sessions.map((s) => h('div.item', icon('device', { size: 14 }), h('span.grow.small', s.device, s.current ? h('span.pill.ok', { style: 'margin-left:6px' }, 'This device') : null), h('span.xs.muted', `${s.ip || ''} · active ${fmt.rel(s.last_seen)}`),
          !s.current ? h('button.btn.ghost.sm', { onclick: async () => { await license.revokeSession(s.id); render(); } }, 'Sign out') : null)),
          h('div.row', h('span.xs.muted.grow', `${sessions.length} device${sessions.length === 1 ? '' : 's'} signed in`), sessions.length > 1 ? h('button.btn.ghost.sm', { onclick: async () => { await license.revokeOthers(); toast('Signed out of all other devices', { type: 'ok' }); render(); } }, 'Sign out everywhere else') : null));
      }).catch((e) => clear(sessionsEl).append(h('div.small', e.message)));
      // api keys
      const drawKeys = async () => {
        const { keys } = await api.get('/api/keys');
        clear(keysEl).append(h('div.list', keys.length ? keys.map((k) => h('div.item', icon('key', { size: 14 }), h('span.grow.small', `${k.name} · ${k.prefix}…`), h('span.xs.muted', k.last_used ? `used ${fmt.rel(k.last_used)}` : 'never used'),
          h('button.btn.ghost.sm', { onclick: async () => { if (await confirmDialog(`Revoke "${k.name}"? Scripts using it will stop working.`, { danger: true, okLabel: 'Revoke' })) { await api.del(`/api/keys/${k.id}`); drawKeys(); } } }, 'Revoke'))) : h('div.small.dim', 'No keys yet.')),
          h('button.btn.sm', { onclick: async () => {
            const name = await promptDialog('Name this key', { placeholder: 'e.g. Home automation' }); if (!name) return;
            try { const { key } = await api.post('/api/keys', { name }); modal({ title: 'Your new API key', titleIcon: 'key', body: h('div.stack', h('div.small.dim', 'Copy it now — it won\'t be shown again.'), h('pre.console', { style: 'height:auto' }, key), h('pre.console', { style: 'height:auto' }, `curl -H "Authorization: Bearer ${key}" ${location.origin}/v1/tasks`)), actions: [{ label: 'Copy key', onClick: () => copyText(key) }, { label: 'Done', kind: 'primary' }] }); drawKeys(); }
            catch (e) { toast(e.message, { type: 'error' }); }
          } }, icon('plus'), 'Create key'));
      };
      drawKeys().catch(() => {});
    };

    function profileCard() {
      return card('user', 'Profile', h('label.field', 'What JARVIS-X calls you', h('input.input', { value: store.get('profile.name'), style: 'max-width:320px', onchange: async (e) => {
        const v = e.target.value.trim() || 'Operator'; store.set('profile.name', v);
        if (platform.isServer && license.user()) await license.updateProfile({ name: v }).catch(() => {});
      } })));
    }
    async function changePassword() {
      const cur = h('input.input', { type: 'password', autocomplete: 'current-password' }); const next = h('input.input', { type: 'password', autocomplete: 'new-password' });
      const err = h('div.small', { style: 'color:var(--danger)' });
      modal({ title: 'Change password', titleIcon: 'key', body: h('div.stack', h('label.field', 'Current password', cur), h('label.field', 'New password', next), err), actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Change password', kind: 'primary', onClick: async (close) => { try { await license.changePassword(cur.value, next.value); toast('Password changed. Other devices were signed out.', { type: 'ok' }); close(); } catch (e) { err.textContent = e.message; } } }] });
    }
    function renderReset(token) {
      const pw = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (8+ characters)' });
      const err = h('div.small', { style: 'color:var(--danger)' });
      el.append(h('div.result-page', icon('key', { size: 40 }), h('h2', 'Choose a new password'),
        h('form.stack', { style: 'width:min(360px,100%)', onsubmit: async (e) => { e.preventDefault(); try { await license.reset(token, pw.value); toast('Password updated — you\'re signed in.', { type: 'ok' }); ctx.params = {}; render(); } catch (ex) { err.textContent = ex.message; } } },
          pw, err, h('button.btn.primary', { type: 'submit' }, 'Save password'))));
    }

    await render();
    this.update = (p) => { ctx.params = p; render(); };
    const offs = [bus.on('plan:change', render), bus.on('auth:change', render)];
    return () => offs.forEach((o) => o());
  },
};
