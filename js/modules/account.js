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

/** Sign-in / sign-up dialog (server or website accounts). Resolves true when signed in. */
export function authDialog({ reason, mode = 'register', name: presetName = '' } = {}) {
  if (!license.accountsAvailable) { toast('Accounts aren\'t set up on this copy of JARVIS-X.', { type: 'warn' }); return Promise.resolve(false); }
  return new Promise((resolve) => {
    let m; let current = mode; let sentTo = null;
    const name = h('input.input', { placeholder: 'Your name', autocomplete: 'name', value: presetName || (store.get('profile.name') !== 'Operator' ? store.get('profile.name') || '' : '') });
    const email = h('input.input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email', required: true });
    const pw = h('input.input', { type: 'password', placeholder: 'At least 8 characters', autocomplete: 'current-password', minlength: 8, style: 'flex:1;min-width:0' });
    const show = h('button.btn.ghost.sm', { type: 'button', 'aria-label': 'Show password', onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; show.textContent = pw.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
    const err = h('div.small', { style: 'color:var(--danger);min-height:18px', role: 'alert' });
    const tabsEl = h('div.billing-toggle', { style: 'justify-self:center' });
    const body = h('div.auth-card');
    const form = h('form.stack', { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; const label = btn.textContent; btn.textContent = 'Please wait…';
      try {
        if (current === 'forgot') { await license.forgot(email.value); err.style.color = 'var(--ok)'; err.textContent = 'If that email has an account, a reset link is on its way. Check your inbox (and spam).'; return; }
        if (current === 'register') {
          const r = await license.register({ email: email.value, password: pw.value, name: name.value });
          if (name.value.trim()) store.set('profile.name', name.value.trim().slice(0, 60));
          if (r?.needsConfirm) { sentTo = email.value.trim(); current = 'sent'; draw(); return; }
        } else await license.login({ email: email.value, password: pw.value });
        const u = license.user();
        if (u?.name && (!store.get('profile.name') || store.get('profile.name') === 'Operator')) store.set('profile.name', u.name.split(' ')[0]);
        toast(current === 'register' ? 'Account created — your progress now saves to your account.' : `Welcome back${u?.name ? ', ' + u.name.split(' ')[0] : ''}. Loading your progress…`, { type: 'ok' });
        m.close(true);
      } catch (ex) { err.style.color = 'var(--danger)'; err.textContent = ex.message; }
      finally { btn.disabled = false; btn.textContent = label; }
    } });
    const draw = () => {
      if (current === 'sent') {
        const note = h('div.small.dim');
        clear(body).append(h('div.auth-sent', icon('mail', { size: 40 }), h('h3', 'Check your email'),
          h('div.small', 'We sent a confirmation link to ', h('b', sentTo), '. Open it on this device to finish creating your account — you\'ll come straight back here, signed in.'),
          h('div.xs.muted', 'Nothing there? Check spam or promotions. It can take a minute.'),
          h('div.row', h('button.btn.sm', { onclick: async () => { try { await license.resendConfirmation(sentTo); note.textContent = 'Sent again.'; } catch (e) { note.textContent = e.message; } } }, 'Send again'),
            h('button.btn.ghost.sm', { onclick: () => { current = 'login'; email.value = sentTo; draw(); } }, 'I\'ve confirmed — sign in')), note));
        return;
      }
      pw.autocomplete = current === 'register' ? 'new-password' : 'current-password';
      clear(tabsEl).append(['login', 'register'].map((k) => h('button', { type: 'button', 'aria-pressed': String(current === k), onclick: () => { current = k; err.textContent = ''; draw(); } }, k === 'register' ? 'Create account' : 'Sign in')));
      clear(form).append(...[current === 'register' ? h('label.field', 'Name', name) : null, h('label.field', 'Email', email),
        current !== 'forgot' ? h('label.field', 'Password', h('div.row', { style: 'gap:6px;flex-wrap:nowrap' }, pw, show)) : null, err,
        h('button.btn.primary', { type: 'submit' }, { register: 'Create free account', login: 'Sign in', forgot: 'Send reset link' }[current]),
        current === 'login' ? h('button.btn.ghost.sm', { type: 'button', onclick: () => { current = 'forgot'; err.textContent = ''; draw(); } }, 'Forgot password?') : null,
        current === 'forgot' ? h('button.btn.ghost.sm', { type: 'button', onclick: () => { current = 'login'; err.textContent = ''; draw(); } }, 'Back to sign in') : null].filter(Boolean));
      clear(body).append(...[reason ? h('div.small.dim', reason) : null, current === 'forgot' ? h('div.small.dim', 'Enter your email and we\'ll send you a link to choose a new password.') : tabsEl, form,
        h('div.auth-note', current === 'register' ? 'Free, with every feature. Your tasks, notes, chats, study progress and settings save to your account and follow you to any device.' : 'Sign in to load your saved progress on this device.')].filter(Boolean));
      setTimeout(() => (current === 'register' && !name.value ? name : email.value ? pw : email).focus(), 30);
    };
    draw();
    m = modal({ title: 'Your JARVIS-X account', titleIcon: 'user', body, onClose: (r) => resolve(!!r) });
  });
}

const card = (ic, title, ...body) => h('div.glass.widget', h('div.w-head', icon(ic), h('h3.w-title', title)), ...body);

function syncCard() {
  const st = sync.status;
  const label = { off: 'Off', syncing: 'Syncing…', synced: `Up to date${st.last ? ' · ' + fmt.time(st.last) : ''}`, error: `Problem: ${st.error}` }[st.state];
  return card('cloud', 'Cloud sync',
    h('div.stat-row', h('span.dim', 'Status'), h('b', { style: `color:var(${st.state === 'error' ? '--danger' : st.state === 'synced' ? '--ok' : '--fg'})` }, label)),
    st.target ? h('div.stat-row', h('span.dim', 'Synced with'), h('b', st.target)) : null,
    h('div.xs.muted', { style: 'margin:6px 0' }, platform.isHost ? 'Your data is stored privately under your Claude account — only you can read it, on any device where you open this page.' : platform.isServer ? 'Your data is encrypted at rest on the server and merged section-by-section across devices.' : license.isCloud && license.user() ? 'Your progress saves to your account automatically and loads on any device where you sign in. API keys you paste stay on this device only.' : license.isCloud ? 'Sign in to save your progress to your account.' : 'Data here stays in this browser.'),
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
      if (!platform.isServer && !license.isCloud) {
        el.append(h('div.stack',
          card('user', 'Personal copy', h('div.small.dim', 'Everything stays in this browser, encrypted. Every feature is free.')),
          profileCard(), syncCard(),
          card('plug', 'Turn on accounts', h('div.small.dim', 'Website owners: connect a free Supabase project in js/config.js to let people sign up with their email and save their progress to their account (docs/ACCOUNTS.md). Or run the included JARVIS-X server (npm start) for accounts, AI without keys and sync.'))));
        return;
      }
      if (ctx.params?.recovery) return renderRecovery();
      if (!u) {
        el.append(h('div.result-page', icon('user', { size: 44 }), h('h2', 'Sign in to JARVIS-X'),
          h('div.dim', { style: 'max-width:460px' }, 'Sign in to save your progress — tasks, notes, chats, study sessions, music and settings — and continue on any device. JARVIS-X works signed-out too, with everything kept in this browser.'),
          h('div.row', h('button.btn.primary', { onclick: async () => { if (await authDialog()) render(); } }, 'Create account'), h('button.btn', { onclick: async () => { if (await authDialog({ mode: 'login' })) render(); } }, 'Sign in'))));
        return;
      }
      if (license.isCloud) return renderCloudAccount(u);
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
        if ((platform.isServer || license.isCloud) && license.user()) await license.updateProfile({ name: v }).catch(() => {});
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

    /** Signed in with a website account (Supabase). */
    function renderCloudAccount(u) {
      const initial = (u.name || u.email)[0].toUpperCase();
      el.append(h('div.stack',
        h('div.glass.widget', h('div.row', h('div', { style: 'width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-family:var(--font-display);font-size:22px;border:1px solid var(--line-hi);box-shadow:var(--glow)' }, initial),
          h('div.grow', h('h2', u.name || store.get('profile.name')), h('div.dim.small', u.email), u.created ? h('div.xs.muted', `Member since ${fmt.date(u.created, { month: 'long', year: 'numeric' })}`) : null),
          h('button.btn.ghost', { onclick: signOut }, icon('power'), 'Sign out'))),
        syncCard(),
        card('key', 'Password', h('div.row', h('button.btn.sm', { onclick: changePassword }, 'Change password'),
          h('button.btn.ghost.sm', { onclick: async () => { if (!(await confirmDialog('Sign out on every device, including this one?'))) return; await license.logout({ everywhere: true }); toast('Signed out everywhere.', { type: 'ok' }); render(); } }, 'Sign out on all devices'))),
        profileCard(),
        card('alert', 'Delete account', h('div.small.dim', 'Permanently deletes your account and the progress saved to it. What\'s in this browser stays until you clear it.'),
          h('button.btn.danger.sm', { style: 'margin-top:8px', onclick: async () => {
            const pw = await promptDialog('Confirm with your password', { label: 'Password', type: 'password' }); if (!pw) return;
            try { await license.deleteAccount(pw); toast('Your account was deleted.'); render(); } catch (e) { toast(e.message, { type: 'error' }); }
          } }, 'Delete my account'))));
    }
    async function signOut() {
      const wipe = h('input', { type: 'checkbox', checked: true });
      const ok = await new Promise((res) => modal({ title: 'Sign out?', titleIcon: 'power', onClose: (r) => res(!!r), body: h('div.stack',
        h('div.small.dim', 'Your progress is saved to your account — sign in again on any device to get it back.'),
        h('label.row.small', wipe, 'Also remove my data from this browser (recommended on shared computers)')),
        actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Sign out', kind: 'primary', onClick: (c) => c(true) }] }));
      if (!ok) return;
      if (wipe.checked) {
        try { await sync.now(); } catch { /* checked below */ }
        if (sync.status.state !== 'synced' && !(await confirmDialog('Your latest changes couldn\'t be saved to your account yet (no connection?). Remove them from this browser anyway?', { danger: true, okLabel: 'Remove anyway' }))) return;
      }
      await license.logout();
      if (wipe.checked) { await store.reset(); location.reload(); return; }
      toast('Signed out. Your data stays in this browser.', { type: 'ok' }); render();
    }
    function renderRecovery() {
      const pw = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (8+ characters)' });
      const err = h('div.small', { style: 'color:var(--danger)' });
      el.append(h('div.result-page', icon('key', { size: 40 }), h('h2', 'Choose a new password'),
        h('form.stack', { style: 'width:min(360px,100%)', onsubmit: async (e) => { e.preventDefault(); try { await license.reset(null, pw.value); toast('Password updated — you\'re signed in.', { type: 'ok' }); ctx.params = {}; render(); } catch (ex) { err.textContent = ex.message; } } },
          pw, err, h('button.btn.primary', { type: 'submit' }, 'Save password'))));
    }

    await render();
    this.update = (p) => { ctx.params = p; render(); };
    const offs = [bus.on('plan:change', render), bus.on('auth:change', render)];
    return () => offs.forEach((o) => o());
  },
};
