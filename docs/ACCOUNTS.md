# Accounts on your JARVIS-X website

When accounts are on, people can **create an account with their email and a password**, **sign in on any device** and find their **progress saved**: tasks, notes, chats, study sessions, music, settings and everything else. Without accounts, JARVIS-X works as before and keeps everything in the browser.

Accounts run on **Supabase**, which has a free plan. You need one free Supabase project. Setup takes about 5 minutes and doesn't need a server.

## 1. Create the project
1. Go to **supabase.com** and sign up (you can use GitHub).
2. Click **New project**.
3. Pick a name (e.g. `jarvis-x`), a database password (save it somewhere) and the region nearest you (e.g. Mumbai).
4. Wait a minute for it to start.

## 2. Create the table that stores progress
1. In the project, open **SQL Editor → New query**.
2. Paste everything from [`supabase/setup.sql`](../supabase/setup.sql) and press **Run**.
3. It should say "Success". This makes one private row per person. Row-level security means each person can only ever read or change their own row.

## 3. Tell Supabase where your site lives
Open **Authentication → URL Configuration** and set:
- **Site URL:** `https://gojosatoruyuji315-hash.github.io/JARVIS-I/`
- **Redirect URLs:** add the same address. Also add `http://localhost:8765/` if you use the launcher.

Confirmation and password-reset emails bring people back to this address.

## 4. Copy two values into `js/config.js`
In **Project Settings → API Keys** (or the **Connect** button), copy:
- the **Project URL**, which looks like `https://abcdefghijklm.supabase.co`
- the **publishable key** (`sb_publishable_…`). The older long **anon** key (`eyJ…`) works too.

Put them in `js/config.js`:

```js
export const CLOUD = {
  url: 'https://abcdefghijklm.supabase.co',
  key: 'sb_publishable_…',
};
```

Both values are meant to be public, so it's safe to commit them. **Never** put the `service_role` / secret key here.

Commit and push. A **Sign in** button now appears at the top of your site.

## Email confirmation
By default Supabase asks new people to confirm their email address before they can sign in. Supabase's built-in email sender only sends a few emails per hour.
- **Small or personal site:** turn **Confirm email** off in **Authentication → Sign In / Providers → Email**. People are signed in right after creating their account.
- **Public site:** keep it on and add your own email sender under **Authentication → Emails → SMTP Settings**. Resend, Brevo or your Gmail SMTP all work.

## Good to know
- **Inactive projects pause.** On the free plan, a project with no activity for a week is paused. Open the Supabase dashboard and click **Restore**, and nothing is lost.
- **Keys stay on the device.** AI keys pasted into JARVIS-X are never uploaded.
- **New devices load your account.** Signing in on a new device loads the account's saved progress. After that, the newest change to each section wins on every device.
- **Signing out** offers to remove the data from that browser, which is useful on shared computers.
- **Deleting an account** (Account → Delete account) removes the account and its saved progress.
