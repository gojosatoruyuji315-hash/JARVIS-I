/**
 * Natural-language command layer. Runs before any AI provider so that
 * "add task …", "remind me …", "open …" etc. work offline and instantly.
 * Returns { reply } when a command was handled, or null.
 * @module core/commands
 */
import { store } from './store.js';
import { bus } from './bus.js';
import { uid, todayKey, fmt } from './dom.js';
import { addReminder, timerService } from './scheduler.js';
import { withinLimit } from './gate.js';
import { plugins } from './plugins.js';

const MODULE_ALIASES = {
  home: 'home', dashboard: 'home', assistant: 'assistant', chat: 'assistant', tasks: 'productivity:tasks', 'to-do': 'productivity:tasks', todo: 'productivity:tasks',
  notes: 'productivity:notes', calendar: 'productivity:calendar', pomodoro: 'productivity:pomodoro', reminders: 'productivity:reminders', habits: 'productivity:habits', goals: 'productivity:goals', planner: 'productivity:planner', clipboard: 'productivity:clipboard', sticky: 'productivity:sticky',
  study: 'study', flashcards: 'study:flashcards', quiz: 'study:quiz', developer: 'dev', code: 'dev', 'dev workspace': 'dev', files: 'files', 'file manager': 'files', music: 'music', player: 'music',
  memory: 'memory', automation: 'automation', routines: 'automation', settings: 'settings', preferences: 'settings', plugins: 'plugins', 'plugin store': 'plugins', marketplace: 'plugins', account: 'account', workspace: 'workspace', analytics: 'analytics',
};
const SKINS = { arc: 'arc', blue: 'arc', default: 'arc', silver: 'silver', midnight: 'silver', light: 'daylight', daylight: 'daylight', aurum: 'aurum', gold: 'aurum', nebula: 'nebula', obsidian: 'obsidian' };

function parseWhen(s) {
  s = s.toLowerCase().trim();
  const now = new Date();
  let m = s.match(/in\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)\b/);
  if (m) { const n = parseFloat(m[1]); const u = m[2][0]; return now.getTime() + n * (u === 's' ? 1e3 : u === 'm' ? 6e4 : u === 'h' ? 36e5 : 864e5); }
  m = s.match(/(tomorrow\s+)?at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m) {
    let h = parseInt(m[2]); const min = parseInt(m[3] || '0');
    if (m[4] === 'pm' && h < 12) h += 12; if (m[4] === 'am' && h === 12) h = 0;
    const d = new Date(now); d.setHours(h, min, 0, 0);
    if (m[1] || d <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (/tomorrow/.test(s)) { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); }
  return null;
}

const URLISH = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/** Track usage for "frequently used commands" memory. */
function track(name) { store.set(['memory', 'commandUsage', name], (store.get(['memory', 'commandUsage', name]) || 0) + 1); store.set('usage.totals.commands', store.get('usage.totals.commands') + 1); }

export function runCommand(input) {
  const raw = input.trim(); const q = raw.toLowerCase().replace(/[.!]$/, '');
  let m;

  // Plugin-provided commands take priority (see core/plugins.js)
  for (const c of plugins.commands()) {
    if (c.match?.test(raw)) {
      try { return { reply: Promise.resolve(c.run(raw, c.plugin.api)).then((r) => String(r ?? 'Done.')).catch((e) => `${c.plugin.name}: ${e.message}`) }; }
      catch (e) { return { reply: `${c.plugin.name}: ${e.message}` }; }
    }
  }

  if ((m = raw.match(/^(?:add|create|new)\s+(?:a\s+)?task\s*:?\s+(.+)/i))) {
    let title = m[1]; let due = null; let priority = 'med';
    if (/\btomorrow\b/i.test(title)) { const d = new Date(); d.setDate(d.getDate() + 1); due = todayKey(d); title = title.replace(/\btomorrow\b/i, ''); }
    else if (/\btoday\b/i.test(title)) { due = todayKey(); title = title.replace(/\btoday\b/i, ''); }
    if (/(!high|urgent|important)/i.test(title)) { priority = 'hi'; title = title.replace(/(!high|urgent|important)/gi, ''); }
    title = title.replace(/\s{2,}/g, ' ').trim();
    store.unshift('tasks', { id: uid('t'), title, done: false, priority, due, list: 'Personal', created: Date.now() }); track('add task');
    return { reply: `Task added: **${title}**${due ? ` (due ${due === todayKey() ? 'today' : 'tomorrow'})` : ''}${priority === 'hi' ? ' — high priority' : ''}.` };
  }
  if ((m = raw.match(/^remind me\s+(.+?)\s+to\s+(.+)$/i)) || (m = raw.match(/^remind me to\s+(.+?)\s+((?:in|at|tomorrow)\s+.+)$/i))) {
    const [when, what] = /^(in|at|tomorrow)/i.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    const at = parseWhen(when);
    if (!at) return { reply: 'I couldn\'t read the time. Try "remind me in 20 minutes to stretch" or "remind me at 6pm to call Sam".' };
    if (!withinLimit('reminders', store.get('reminders').filter((r) => !r.done).length, 'reminders')) return { reply: 'Reminder limit reached on your current plan.' };
    addReminder(what, at); track('reminder');
    return { reply: `Reminder set for **${fmt.dt(at)}** (${fmt.rel(at)}): ${what}.` };
  }
  if ((m = raw.match(/^(?:take a\s+)?note\s*:?\s+(.+)/i)) || (m = raw.match(/^jot down\s+(.+)/i))) {
    store.unshift('notes', { id: uid('n'), title: m[1].slice(0, 48), body: m[1], format: 'md', pinned: false, updated: Date.now() }); track('note');
    return { reply: `Saved a note: "${m[1].slice(0, 80)}".` };
  }
  if ((m = raw.match(/^(?:add|schedule)\s+(?:an?\s+)?(?:event|meeting)\s+(.+?)(?:\s+(today|tomorrow|on\s+\d{4}-\d{2}-\d{2}))?(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i))) {
    const d = new Date(); if (/tomorrow/i.test(m[2] || '')) d.setDate(d.getDate() + 1);
    const date = /on\s+(\d{4}-\d{2}-\d{2})/i.exec(m[2] || '')?.[1] || todayKey(d);
    let time = '';
    if (m[3]) { let h = +m[3]; if (m[5]?.toLowerCase() === 'pm' && h < 12) h += 12; time = `${String(h).padStart(2, '0')}:${m[4] || '00'}`; }
    store.push('events', { id: uid('e'), title: m[1], date, time, notes: '' }); track('event');
    return { reply: `Added **${m[1]}** to your calendar on ${date}${time ? ' at ' + time : ''}.` };
  }
  if ((m = q.match(/^(?:remember|memorize)\s+(?:that\s+)?(.+)/))) {
    if (!withinLimit('memoryFacts', store.get('memory.facts').length, 'memory')) return { reply: 'Memory is full on your current plan.' };
    store.push('memory.facts', { id: uid('m'), text: raw.replace(/^(remember|memorize)\s+(that\s+)?/i, ''), tags: [], ts: Date.now() }); track('remember');
    return { reply: 'Got it — saved to long-term memory. Ask "what do you remember?" any time.' };
  }
  if (/^(what do you (remember|know)( about me)?|recall|show (my )?memor(y|ies)|list memories)\b/.test(q)) {
    const f = store.get('memory.facts');
    return { reply: f.length ? `Here's what I remember:\n\n${f.slice(-15).map((x) => `- ${x.text}`).join('\n')}` : 'My memory is empty. Tell me "remember that …".' };
  }
  if ((m = q.match(/^forget\s+(?:that\s+)?(.+)/))) {
    const facts = store.get('memory.facts'); const keep = facts.filter((f) => !f.text.toLowerCase().includes(m[1]));
    store.set('memory.facts', keep);
    return { reply: facts.length === keep.length ? `Nothing in memory matched "${m[1]}".` : `Forgot ${facts.length - keep.length} item(s).` };
  }
  if ((m = q.match(/^(?:set\s+(?:a\s+)?)?timer\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(s|sec|seconds?|m|min|minutes?|h|hours?)?/)) || (m = q.match(/^(\d+)\s*(min|minute|minutes|sec|seconds|hour|hours)\s+timer/))) {
    const n = parseFloat(m[1]); const u = (m[2] || 'm')[0];
    const ms = n * (u === 's' ? 1e3 : u === 'h' ? 36e5 : 6e4);
    timerService.start(ms, `${m[1]} ${u === 's' ? 'sec' : u === 'h' ? 'hour' : 'min'} timer`); track('timer');
    return { reply: `Timer started: **${fmt.dur(ms)}**.` };
  }
  if ((m = q.match(/^(?:start|begin)\s+(?:a\s+)?(?:pomodoro|focus(?:\s+session)?)(?:\s+(\d+))?/))) {
    bus.emit('open', { id: 'productivity', params: { tab: 'pomodoro', autostart: +(m[1] || 25) } }); track('pomodoro');
    return { reply: `Focus session started — ${m[1] || 25} minutes. I'll let you know when it's break time.` };
  }
  if ((m = raw.match(/^(?:compose|write|make|create)\s+(?:me\s+)?(?:a|an)\s+(?:new\s+)?(?:song|tune|track|beat|melody)(?:\s+(?:about|for|that sounds like|like|with))?\s*(.*)$/i))) {
    track('music');
    const d = m[1] || 'a relaxing tune';
    return { reply: Promise.all([import('./composer.js'), import('./audio.js'), import('./assistant.js')]).then(async ([c, a, as]) => {
      const t = await c.compose(d, { ask: async (p) => (await as.ask(p, { conversation: false, commands: false, tools: false, history: [{ role: 'user', content: p }], system: 'You are a composer. Reply with JSON only.' })).text });
      store.set('music.composed', [t, ...(store.get('music.composed') || [])].slice(0, 50)); a.engine.playTrack(t);
      return `Composed **${t.title}** (${t.artist}, ${t.bpm} BPM) — playing now. Find it in Music → Compose, where you can download it as a WAV.`;
    }).catch((e) => e.message) };
  }
  if (/^(start|begin|enter|turn on|switch to|open)?\s*(a\s+)?study (mode|session)( on)?$|^let'?s study$|^i want to study/.test(q)) {
    const subj = raw.match(/study(?: mode| session)? (?:for|on|about) (.+)$/i)?.[1];
    import('./studymode.js').then(({ studyMode }) => (subj ? studyMode.start({ subject: subj }) : studyMode.openDialog()));
    return { reply: subj ? `Study mode on — ${subj}. I'll tutor you step by step.` : 'Opening study mode — pick a subject and how long.' };
  }
  if (/^(start|begin)\s+studying\s+(.+)$|^study (?:mode )?(?:for|on) (.+)$/.test(q)) {
    const subj = raw.match(/(?:studying|for|on)\s+(.+)$/i)?.[1] || '';
    import('./studymode.js').then(({ studyMode }) => studyMode.start({ subject: subj }));
    return { reply: `Study mode on${subj ? ` — ${subj}` : ''}. I'll tutor you step by step; a break is suggested every 25 minutes.` };
  }
  if (/^(stop|end|exit|finish|turn off|quit)\s+(the\s+)?study(ing)?( mode| session)?$/.test(q)) {
    import('./studymode.js').then(({ studyMode }) => studyMode.end());
    return { reply: 'Study session ended — your minutes are logged in Study → Progress.' };
  }
  if ((m = raw.match(/^(?:search(?: the web| online| internet)? for|google|look up online|browse(?: to)?|web search)\s+(.+)$/i))) {
    bus.emit('open', { id: 'internet', params: { q: m[1] } }); track('web search');
    return { reply: `Searching the web for **${m[1]}**.` };
  }
  if (/^(play|resume)\s+(some\s+)?music|^play$/.test(q)) { bus.emit('music', { cmd: 'play' }); track('music'); return { reply: 'Playing music.' }; }
  {
    const m = raw.replace(/[.!]$/, '').match(/^play\s+(?:the\s+)?(?:song\s+)?(.{2,80}?)(?:\s+on\s+music)?$/i);
    if (m && !/^(some\s+)?music$|^(my\s+)?(liked|queue|playlist)/i.test(m[1])) {
      track('music');
      return { reply: import('./audio.js').then(({ engine }) => engine.searchAndPlay(m[1])).then((t) => `Playing **${t.title}** by ${t.artist}${t.preview ? ' (30-second preview)' : ''}. Open Music to pick a different version or queue more.`).catch((e) => e.message) };
    }
  }
  if (/^(pause|stop)\s+(the\s+)?music|^pause$/.test(q)) { bus.emit('music', { cmd: 'pause' }); return { reply: 'Music paused.' }; }
  if (/^(next|skip)\s*(track|song)?$/.test(q)) { bus.emit('music', { cmd: 'next' }); return { reply: 'Next track.' }; }
  if ((m = q.match(/^(?:switch|change|set)\s+(?:the\s+)?(?:theme|skin)\s+(?:to\s+)?(\w+)/)) || (m = q.match(/^(light|dark)\s+mode$/))) {
    const skin = m[1] === 'dark' ? 'arc' : SKINS[m[1]];
    if (!skin) return { reply: `I don't know the "${m[1]}" theme. Try arc, silver, daylight, aurum, nebula or obsidian.` };
    bus.emit('theme:set', { skin }); track('theme');
    return { reply: `Switching theme to **${skin}**.` };
  }
  if (/^(lock|lock (the )?(screen|system))$/.test(q)) { bus.emit('system', { cmd: 'lock' }); return { reply: 'Locking.' }; }
  if (/^(shut ?down|power off|go to sleep)$/.test(q)) { bus.emit('system', { cmd: 'shutdown' }); return { reply: 'Powering down. See you soon.' }; }
  if (/^(clear|new) (chat|conversation)$/.test(q)) { bus.emit('chat:new'); return { reply: 'Started a new conversation.' }; }
  if ((m = q.match(/^(?:search|google|look up|find)\s+(?:for\s+)?(.+)/))) { bus.emit('search:open', { q: m[1] }); track('search'); return { reply: `Searching for "${m[1]}".` }; }
  if ((m = q.match(/^(?:open|launch|go to|show)\s+(?:the\s+)?(.+)/))) {
    const target = m[1].replace(/\s+(app|module|panel|page)$/, '');
    const mod = MODULE_ALIASES[target];
    if (mod) { const [id, tab] = mod.split(':'); bus.emit('open', { id, params: tab ? { tab } : {} }); track('open ' + target); return { reply: `Opening ${target}.` }; }
    if (URLISH.test(target)) { const url = /^https?:/.test(target) ? target : 'https://' + target; bus.emit('open:url', { url }); track('open site'); return { reply: `Opening [${target}](${url}).` }; }
    const sites = { youtube: 'https://youtube.com', github: 'https://github.com', gmail: 'https://mail.google.com', maps: 'https://www.openstreetmap.org', wikipedia: 'https://wikipedia.org', news: 'https://news.google.com', 'stack overflow': 'https://stackoverflow.com' };
    if (sites[target]) { bus.emit('open:url', { url: sites[target] }); track('open site'); return { reply: `Opening [${target}](${sites[target]}).` }; }
  }
  if ((m = q.match(/^run\s+(?:the\s+)?(?:routine\s+)?(.+?)(?:\s+routine)?$/))) {
    const r = store.get('automation.routines').find((x) => x.name.toLowerCase() === m[1]);
    if (r) { bus.emit('routine:run', { id: r.id }); return { reply: `Running routine **${r.name}**.` }; }
  }
  return null;
}
