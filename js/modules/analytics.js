/**
 * Analytics (Pro) and the advanced analytics dashboard (Master).
 * All numbers are computed locally from your own data — nothing leaves the device.
 * @module modules/analytics
 */
import { h, todayKey } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { lockOverlay, featureBadge } from '../core/gate.js';

const lastDays = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1) + i); return todayKey(d); });
function bars(title, days, values, unit = '') {
  const max = Math.max(1, ...values);
  return h('div.glass.widget', h('div.w-title', title),
    h('div.bars', days.map((d, i) => h('div.b', { title: `${d}: ${values[i]}${unit}` }, h('i', { style: `height:${(values[i] / max) * 100}%` }), h('span', d.slice(8))))),
    h('div.stat-row', { style: 'margin-top:6px' }, h('span.dim.xs', `Total ${values.reduce((a, b) => a + b, 0)}${unit}`), h('span.dim.xs', `Peak ${max}${unit}`)));
}

export default {
  mount(el) {
    const s = store.state; const days = lastDays(14);
    const ai = days.map((d) => s.usage.byDay[d] || 0);
    const focus = days.map((d) => s.study.minutesByDay[d] || 0);
    const doneByDay = days.map((d) => s.tasks.filter((t) => t.done && t.doneAt && todayKey(new Date(t.doneAt)) === d).length);
    const doneRate = s.tasks.length ? Math.round((s.tasks.filter((t) => t.done).length / s.tasks.length) * 100) : 0;
    const habitsToday = s.habits.filter((x) => x.log[todayKey()]).length;
    const score = Math.min(100, Math.round(doneRate * 0.4 + Math.min(60, focus.at(-1)) * 0.6 + habitsToday * 5));

    const pro = h('div.stack',
      h('div.grid3', [['Productivity score', `${score}`], ['Task completion', `${doneRate}%`], ['Focus minutes (14 d)', focus.reduce((a, b) => a + b, 0)], ['AI requests (14 d)', ai.reduce((a, b) => a + b, 0)], ['Voice sessions', s.usage.totals.voice], ['Commands run', s.usage.totals.commands]].map(([k, v]) => h('div.glass.widget', h('div.w-title', k), h('div.w-big', String(v))))),
      h('div.grid2', bars('AI requests per day', days, ai), bars('Focus minutes per day', days, focus, 'm'), bars('Tasks completed per day', days, doneByDay)));

    // Master: activity heatmap (weekday × hour) from message and task timestamps
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    const stamp = (ts) => { if (!ts) return; const d = new Date(ts); grid[d.getDay()][d.getHours()]++; };
    s.chat.conversations.forEach((c) => c.messages.forEach((m) => m.role === 'user' && stamp(m.ts)));
    s.tasks.forEach((t) => { stamp(t.created); stamp(t.doneAt); });
    s.study.sessions.forEach((x) => stamp(x.ts));
    const max = Math.max(1, ...grid.flat());
    const heat = h('div', { style: 'display:grid;grid-template-columns:34px repeat(24,minmax(10px,1fr));gap:2px;font-size:10px;overflow-x:auto' },
      h('span'), Array.from({ length: 24 }, (_, i) => h('span.muted', { style: 'text-align:center' }, i % 3 === 0 ? String(i) : '')),
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, di) => [h('span.muted', d), grid[di].map((v, hi) => h('i', { title: `${d} ${hi}:00 — ${v} events`, style: `aspect-ratio:1;border-radius:3px;background:var(--accent);opacity:${v ? 0.15 + (v / max) * 0.85 : 0.05}` }))]));
    const busiest = grid.flatMap((r, di) => r.map((v, hi) => ({ v, di, hi }))).sort((a, b) => b.v - a.v)[0];
    const master = h('div.stack', h('h3', 'Advanced analytics ', featureBadge('analytics.master')),
      h('div.glass.widget', h('div.w-title', 'Activity heatmap — when you work'), heat,
        h('div.small.dim', { style: 'margin-top:8px' }, busiest?.v ? `You're most active on ${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][busiest.di]} around ${busiest.hi}:00. Schedule deep work there.` : 'Use JARVIS-X for a few days to see your patterns.')),
      h('div.grid2',
        h('div.glass.widget', h('div.w-title', 'Study mastery'), ...s.study.decks.map((d) => { const m = d.cards.filter((c) => (c.box || 1) >= 4).length; return h('div', h('div.stat-row', h('span.small', d.name), h('b', `${m}/${d.cards.length}`)), h('div.meter', h('i', { style: `width:${d.cards.length ? (m / d.cards.length) * 100 : 0}%` }))); })),
        h('div.glass.widget', h('div.w-title', 'Memory & knowledge'), h('div.stat-row', h('span.dim', 'Facts remembered'), h('b', String(s.memory.facts.length))), h('div.stat-row', h('span.dim', 'Knowledge-base docs'), h('b', String(s.kb.docs.length))), h('div.stat-row', h('span.dim', 'Notes'), h('b', String(s.notes.length))), h('div.stat-row', h('span.dim', 'Conversations'), h('b', String(s.chat.conversations.length))))));

    el.append(h('div.stack', { style: 'gap:22px' }, h('div.small.dim', icon('shield', { size: 12 }), ' Computed on-device from your own activity.'), lockOverlay(pro, 'analytics'), lockOverlay(master, 'analytics.master')));
  },
};
