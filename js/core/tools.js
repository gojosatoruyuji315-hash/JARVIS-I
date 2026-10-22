/**
 * Assistant tools: real app actions the AI can call (tasks, calendar,
 * reminders, notes, memory, timers, focus, music, themes, flashcards,
 * routines, knowledge base). One definition feeds every provider:
 *   - Claude viewer `sample` tools  → { name, description, inputSchema, execute }
 *   - Anthropic Messages tools      → { name, description, input_schema }
 * Destructive actions are undoable from a toast.
 * @module core/tools
 */
import { store } from './store.js';
import { bus } from './bus.js';
import { uid, todayKey, fmt, toast } from './dom.js';
import { addReminder, timerService } from './scheduler.js';
import { evaluate } from './mathx.js';
import { plugins } from './plugins.js';
import { WEB_TOOLS, liveWebOn } from './liveweb.js';
import { platform } from './platform.js';

const S = (properties, required = []) => ({ type: 'object', properties, required });
const str = (d) => ({ type: 'string', description: d });
const int = (d) => ({ type: 'integer', description: d });
const clip = (s, n = 200) => String(s ?? '').slice(0, n);
const undo = (label, path, before) => toast(label, { action: { label: 'Undo', run: () => store.set(path, before) }, timeout: 8000 });

export const TOOLS = [
  { name: 'get_agenda', description: 'Returns today\'s date/time plus open tasks, upcoming events (14 days), pending reminders, goals and habits. Call this before planning or answering questions about the user\'s schedule.',
    run() {
      const s = store.state; const t = todayKey(); const in14 = todayKey(new Date(Date.now() + 14 * 864e5));
      return {
        now: new Date().toString(),
        openTasks: s.tasks.filter((x) => !x.done).slice(0, 40).map(({ id, title, due, priority, list }) => ({ id, title, due, priority, list })),
        events: s.events.filter((e) => e.date >= t && e.date <= in14).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(({ id, title, date, time }) => ({ id, title, date, time })),
        reminders: s.reminders.filter((r) => !r.done).map((r) => ({ text: r.text, at: new Date(r.at).toString(), repeat: r.repeat })),
        goals: s.goals.map((g) => ({ title: g.title, progress: g.progress, target: g.target, unit: g.unit })),
        habitsDoneToday: s.habits.map((h) => ({ name: h.name, done: !!h.log[t] })),
      };
    } },
  { name: 'add_task', description: 'Create a task. Returns the created task.', schema: S({ title: str('Task title'), due: str('Due date YYYY-MM-DD (optional)'), priority: { type: 'string', enum: ['low', 'med', 'hi'] }, list: str('List name (optional)') }, ['title']),
    run(i) { const task = { id: uid('t'), title: clip(i.title, 300), done: false, priority: ['low', 'med', 'hi'].includes(i.priority) ? i.priority : 'med', due: /^\d{4}-\d{2}-\d{2}$/.test(i.due || '') ? i.due : null, list: clip(i.list || 'Personal', 40), created: Date.now() }; store.unshift('tasks', task); return task; } },
  { name: 'update_task', description: 'Update a task by id: rename, complete/uncomplete, change due date or priority. Returns the updated task.', schema: S({ id: str('Task id'), title: str(''), done: { type: 'boolean' }, due: str('YYYY-MM-DD or empty to clear'), priority: { type: 'string', enum: ['low', 'med', 'hi'] } }, ['id']),
    run(i) {
      const t = store.findById('tasks', String(i.id)); if (!t) throw new Error('No task with that id');
      const patch = {}; if (i.title) patch.title = clip(i.title, 300); if (typeof i.done === 'boolean') { patch.done = i.done; patch.doneAt = Date.now(); }
      if (i.due !== undefined) patch.due = i.due || null; if (i.priority) patch.priority = i.priority;
      store.patchById('tasks', t.id, patch); return { ...t, ...patch };
    } },
  { name: 'delete_task', description: 'Delete a task by id (the user can undo).', schema: S({ id: str('Task id') }, ['id']),
    run(i) { const before = store.get('tasks'); const t = before.find((x) => x.id === String(i.id)); if (!t) throw new Error('No task with that id'); store.removeById('tasks', t.id); undo(`Deleted task "${t.title}"`, 'tasks', before); return { deleted: t.title }; } },
  { name: 'add_event', description: 'Add a calendar event. Returns the event.', schema: S({ title: str('Event title'), date: str('YYYY-MM-DD'), time: str('HH:MM 24h (optional)'), notes: str('optional') }, ['title', 'date']),
    run(i) { if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date || '')) throw new Error('date must be YYYY-MM-DD'); const ev = { id: uid('e'), title: clip(i.title), date: i.date, time: /^\d{2}:\d{2}$/.test(i.time || '') ? i.time : '', notes: clip(i.notes, 1000) }; store.push('events', ev); return ev; } },
  { name: 'set_reminder', description: 'Schedule a reminder notification. Give either at (local ISO datetime like 2026-10-10T18:30) or in_minutes.', schema: S({ text: str('What to remind about'), at: str('Local datetime YYYY-MM-DDTHH:MM'), in_minutes: { type: 'number' }, repeat: { type: 'string', enum: ['none', 'daily', 'weekly'] } }, ['text']),
    run(i) {
      const at = i.in_minutes != null ? Date.now() + Number(i.in_minutes) * 6e4 : new Date(String(i.at)).getTime();
      if (!Number.isFinite(at)) throw new Error('Provide a valid `at` or `in_minutes`');
      addReminder(clip(i.text, 300), at, i.repeat && i.repeat !== 'none' ? i.repeat : null);
      return { scheduledFor: new Date(at).toString(), relative: fmt.rel(at) };
    } },
  { name: 'search_notes', description: 'Search the user\'s notes. Returns up to 10 matches with id, title and a snippet.', schema: S({ query: str('Words to search for; empty lists recent notes') }),
    run(i) { const q = String(i.query || '').toLowerCase(); return store.get('notes').filter((n) => !q || (n.title + ' ' + n.body).toLowerCase().includes(q)).sort((a, b) => b.updated - a.updated).slice(0, 10).map((n) => ({ id: n.id, title: n.title, snippet: n.body.replace(/<[^>]+>/g, ' ').slice(0, 160), updated: new Date(n.updated).toDateString() })); } },
  { name: 'read_note', description: 'Read a note\'s full text by id.', schema: S({ id: str('Note id') }, ['id']),
    run(i) { const n = store.findById('notes', String(i.id)); if (!n) throw new Error('No note with that id'); return { title: n.title, body: n.body.slice(0, 20000) }; } },
  { name: 'save_note', description: 'Create a Markdown note, or replace an existing note\'s body when id is given. Returns the note id.', schema: S({ title: str('Note title'), body: str('Markdown body'), id: str('Existing note id (optional)') }, ['title', 'body']),
    run(i) {
      if (i.id && store.findById('notes', String(i.id))) { store.patchById('notes', String(i.id), { title: clip(i.title, 120), body: String(i.body), updated: Date.now() }); return { id: i.id, updated: true }; }
      const n = { id: uid('n'), title: clip(i.title, 120), body: String(i.body), format: 'md', pinned: false, updated: Date.now() }; store.unshift('notes', n); return { id: n.id, created: true };
    } },
  { name: 'remember', description: 'Save a durable fact or preference about the user to long-term memory.', schema: S({ text: str('The fact, in third person, e.g. "Prefers metric units"') }, ['text']),
    run(i) { store.push('memory.facts', { id: uid('m'), text: clip(i.text, 500), tags: ['ai'], ts: Date.now() }); return { saved: true }; } },
  { name: 'forget', description: 'Remove memory facts containing the given text (the user can undo).', schema: S({ match: str('Text to match') }, ['match']),
    run(i) { const before = store.get('memory.facts'); const m = String(i.match).toLowerCase(); const keep = before.filter((f) => !f.text.toLowerCase().includes(m)); store.set('memory.facts', keep); if (keep.length !== before.length) undo(`Forgot ${before.length - keep.length} memory item(s)`, 'memory.facts', before); return { removed: before.length - keep.length }; } },
  { name: 'start_timer', description: 'Start a countdown timer.', schema: S({ minutes: { type: 'number' }, label: str('optional') }, ['minutes']),
    run(i) { const ms = Math.max(1, Number(i.minutes)) * 6e4; timerService.start(ms, clip(i.label || `${i.minutes} min timer`, 60)); return { started: fmt.dur(ms) }; } },
  { name: 'start_focus', description: 'Start a Pomodoro focus session and open the focus view.', schema: S({ minutes: int('Default 25') }),
    run(i) { bus.emit('open', { id: 'productivity', params: { tab: 'pomodoro', autostart: Number(i.minutes) || 25 } }); return { started: true }; } },
  { name: 'open_module', description: 'Open a part of the app for the user.', schema: S({ module: { type: 'string', enum: ['home', 'tasks', 'notes', 'calendar', 'reminders', 'planner', 'goals', 'habits', 'flashcards', 'quiz', 'study', 'dev', 'files', 'music', 'memory', 'automation', 'analytics', 'settings', 'plugins', 'workspace', 'account'] } }, ['module']),
    run(i) {
      const map = { tasks: ['productivity', 'tasks'], notes: ['productivity', 'notes'], calendar: ['productivity', 'calendar'], reminders: ['productivity', 'reminders'], planner: ['productivity', 'planner'], goals: ['productivity', 'goals'], habits: ['productivity', 'habits'], flashcards: ['study', 'flashcards'], quiz: ['study', 'quiz'] };
      const [id, tab] = map[i.module] || [i.module]; bus.emit('open', { id, params: tab ? { tab } : {} }); return { opened: i.module };
    } },
  { name: 'set_theme', description: 'Change the visual theme.', schema: S({ skin: { type: 'string', enum: ['arc', 'silver', 'daylight', 'aurum', 'nebula', 'obsidian'] } }, ['skin']),
    run(i) { bus.emit('theme:set', { skin: i.skin }); return { theme: i.skin }; } },
  { name: 'control_music', description: 'Control the music player.', schema: S({ action: { type: 'string', enum: ['play', 'pause', 'next', 'prev'] } }, ['action']),
    run(i) { bus.emit('music', { cmd: i.action }); return { ok: true }; } },
  { name: 'compose_song', description: 'Compose an original instrumental song (AI writes tempo, key, chords and melody; the built-in synthesiser plays it) and start playing it. Works offline. Styles: lofi, ambient, synthwave, dance, cinematic, chiptune, piano, indian.', schema: S({ description: { type: 'string' }, style: { type: 'string', enum: ['auto', 'lofi', 'ambient', 'synthwave', 'dance', 'cinematic', 'chiptune', 'piano', 'indian'] }, title: { type: 'string' }, bpm: { type: 'number' }, scale: { type: 'string', enum: ['major', 'minor', 'dorian', 'pentatonic', 'bhairav', 'yaman'] }, chords: { type: 'array', items: { type: 'integer' }, description: '4 or 8 scale degrees 1-7, one per bar' }, melody: { type: 'array', items: { type: 'integer' }, description: '32 scale degrees (0 = rest), 8 per bar' } }, ['description']),
    async run(i) {
      const { arrange, compose } = await import('./composer.js'); const { engine } = await import('./audio.js');
      const t = i.chords?.length ? arrange({ title: i.title || i.description, bpm: i.bpm, scale: i.scale, chords: i.chords, melody: i.melody, style: i.style && i.style !== 'auto' ? i.style : 'lofi', root: 57 }) : await compose(i.description, { style: i.style || 'auto' });
      store.set('music.composed', [t, ...(store.get('music.composed') || [])].slice(0, 50)); engine.playTrack(t);
      return { playing: t.title, style: t.artist, bpm: t.bpm };
    } },
  { name: 'play_song', needsNetwork: true, description: 'Search music (YouTube full songs, Audius, iTunes previews, Internet Archive) for a song, artist or genre and start playing the best match.', schema: S({ query: { type: 'string', description: 'Song title and/or artist, or a genre/mood' } }, ['query']),
    async run(i) { const { engine } = await import('./audio.js'); const t = await engine.searchAndPlay(i.query); return { playing: t.title, artist: t.artist, source: t.source, preview: !!t.preview }; } },
  { name: 'create_flashcards', description: 'Add flashcards to a deck (created if missing). Use for study requests.', schema: S({ deck: str('Deck name'), cards: { type: 'array', items: S({ q: str('Front'), a: str('Back') }, ['q', 'a']), maxItems: 40 } }, ['deck', 'cards']),
    run(i) {
      const decks = store.get('study.decks'); let d = decks.find((x) => x.name.toLowerCase() === String(i.deck).toLowerCase());
      const cards = (Array.isArray(i.cards) ? i.cards : []).slice(0, 40).map((c) => ({ id: uid('c'), q: clip(c.q, 500), a: clip(c.a, 1000), box: 1, due: 0 }));
      if (d) store.set('study.decks', decks.map((x) => (x.id === d.id ? { ...x, cards: [...x.cards, ...cards] } : x)));
      else { d = { id: uid('d'), name: clip(i.deck, 60), cards }; store.push('study.decks', d); }
      return { deck: d.name, added: cards.length };
    } },
  { name: 'run_routine', description: 'Run one of the user\'s automation routines by name.', schema: S({ name: str('Routine name') }, ['name']),
    run(i) { const r = store.get('automation.routines').find((x) => x.name.toLowerCase() === String(i.name).toLowerCase()); if (!r) throw new Error(`No routine named "${i.name}". Available: ${store.get('automation.routines').map((x) => x.name).join(', ')}`); bus.emit('routine:run', { id: r.id }); return { running: r.name }; } },
  { name: 'calculate', description: 'Evaluate a math expression exactly (supports + - * / ^ %, sqrt, sin, cos, log, ln, pi, e).', schema: S({ expression: str('Expression') }, ['expression']),
    run(i) { return { result: evaluate(String(i.expression)) }; } },
  { name: 'search_knowledge_base', description: 'Search the user\'s personal knowledge-base documents for relevant passages.', schema: S({ query: str('What to look for') }, ['query']),
    async run(i) { const { retrieveKB } = await import('./assistant.js'); return retrieveKB(String(i.query), 4).map((c) => ({ title: c.title, text: c.text.slice(0, 1200) })); } },
];

/** Tools in the Claude viewer `sample` format. */
const allTools = () => [...TOOLS.filter((t) => (!t.needsNetwork || platform.hasNetwork)), ...(liveWebOn() ? WEB_TOOLS : []), ...plugins.tools()];
export function sampleTools(max = 64) {
  return allTools().slice(0, max).map((t) => ({ name: t.name, description: t.description, ...(t.schema ? { inputSchema: t.schema } : {}),
    execute: async (input) => { const r = await t.run(input || {}); bus.emit('assistant:tool', { name: t.name, input }); return r; } }));
}
/** Tools in the Anthropic Messages format. */
export function anthropicTools() { return allTools().map((t) => ({ name: t.name, description: t.description, input_schema: t.schema || { type: 'object', properties: {} } })); }
/** Execute a tool call from an Anthropic-format response. */
export async function runTool(name, input) {
  const t = allTools().find((x) => x.name === name); if (!t) throw new Error(`Unknown tool ${name}`);
  const r = await t.run(input || {}); bus.emit('assistant:tool', { name, input }); return r;
}
