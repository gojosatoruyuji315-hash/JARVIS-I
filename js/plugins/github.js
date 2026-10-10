/**
 * GitHub plugin — your repositories, issues and pull requests; search GitHub;
 * create issues. Uses the GitHub REST API directly (token optional for public data).
 */
const GH = 'https://api.github.com';
async function gh(api, path, opts = {}) {
  const token = api.setting('token');
  return api.json(GH + path, { ...opts, headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
}

export default {
  id: 'github', name: 'GitHub', version: '1.0.0', author: 'JARVIS-X',
  icon: 'code', category: 'Developer', needs: ['network'],
  description: 'See your repos, issues and pull requests, search GitHub, and let the assistant file issues for you.',
  settings: [{ key: 'token', label: 'Personal access token', type: 'password', placeholder: 'github_pat_…', help: 'Fine-grained token with Issues read/write. Optional for public search.' }],
  tools: [
    { name: 'github_list_issues', description: 'List open issues of a GitHub repository (owner/name).', schema: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
      async run({ repo }, api) { const j = await gh(api, `/repos/${repo}/issues?state=open&per_page=20`); return j.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name), url: i.html_url })); } },
    { name: 'github_create_issue', description: 'Create an issue in a GitHub repository the user can write to.', schema: { type: 'object', properties: { repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } }, required: ['repo', 'title'] },
      async run({ repo, title, body }, api) { if (!api.setting('token')) throw new Error('Add a GitHub token in the plugin settings first.'); const j = await gh(api, `/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title, body }) }); return { number: j.number, url: j.html_url }; } },
  ],
  panel(el, api) {
    const { h, icon, fmt } = api;
    const out = h('div.list'); const status = h('div.small.dim');
    const q = h('input.input.grow', { placeholder: 'Search repositories, e.g. "godot multiplayer"' });
    const show = (items) => out.replaceChildren(...(items.length ? items : [h('div.empty', 'Nothing found.')]));
    const repoRow = (r) => h('a.item', { href: r.html_url, target: '_blank', rel: 'noopener', style: 'text-decoration:none;color:var(--fg)' }, icon('folder', { size: 14 }), h('span.grow', h('b.small', r.full_name), h('div.xs.dim', r.description || '')), h('span.pill', `★ ${r.stargazers_count}`), r.language ? h('span.pill', r.language) : null);
    const run = async (fn) => { status.textContent = 'Loading…'; try { await fn(); status.textContent = ''; } catch (e) { status.textContent = e.message; } };
    const mine = () => run(async () => { if (!api.setting('token')) throw new Error('Add a token in Settings to see your repositories.'); show((await gh(api, '/user/repos?sort=updated&per_page=30')).map(repoRow)); });
    const issues = () => run(async () => { if (!api.setting('token')) throw new Error('Add a token in Settings to see your issues.'); show((await gh(api, '/issues?filter=assigned&state=open&per_page=30')).map((i) => h('a.item', { href: i.html_url, target: '_blank', rel: 'noopener', style: 'text-decoration:none;color:var(--fg)' }, icon(i.pull_request ? 'code' : 'alert', { size: 14 }), h('span.grow.small', `${i.repository?.full_name} #${i.number} — ${i.title}`), h('span.xs.muted', fmt.rel(Date.parse(i.updated_at)))))); });
    const search = () => q.value.trim() && run(async () => show((await gh(api, `/search/repositories?q=${encodeURIComponent(q.value)}&per_page=25`)).items.map(repoRow)));
    q.addEventListener('keydown', (e) => e.key === 'Enter' && search());
    el.append(h('div.stack', h('div.row', q, h('button.btn.primary', { onclick: search }, icon('search'), 'Search')), h('div.row', h('button.btn.sm', { onclick: mine }, 'My repositories'), h('button.btn.sm', { onclick: issues }, 'Assigned to me')), status, out));
    if (api.setting('token')) mine();
  },
};
