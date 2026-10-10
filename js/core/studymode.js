/**
 * Study mode — turns the whole app into a focused study space.
 *
 *  • The sidebar keeps only study tools (Study, Tasks & Notes, Files, Assistant).
 *  • The assistant becomes a patient tutor: it guides step by step and checks understanding
 *    instead of just handing over answers (see buildSystemPrompt in core/ai.js).
 *  • A session timer (subject, goal, length) sits in the top bar, with break reminders
 *    every 25 minutes (Pomodoro), and optional calm study music made by the AI Composer.
 *  • Non-urgent notifications are held until the session ends.
 *  • When the session ends, the minutes are logged to Study → Progress.
 * State lives in store.studyMode, so a session survives reloads and syncs to your devices.
 * @module core/studymode
 */
import { h, modal, toast, fmt } from './dom.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { bus } from './bus.js';

/** Modules visible in the sidebar while studying. */
export const STUDY_MODULES = new Set(['home', 'assistant', 'study', 'productivity', 'files', 'settings']);
const BREAK_EVERY = 25 * 60e3, BREAK_LEN = 5 * 60e3;
const S = () => store.get('studyMode') || {};
const todayKey = () => new Date().toISOString().slice(0, 10);
let ticker = null;

export const studyMode = {
  get active() { return !!S().active; },
  get session() { return S(); },
  /** Milliseconds of study so far (pauses excluded). */
  elapsed() { const s = S(); if (!s.active) return 0; return (s.accum || 0) + (s.paused ? 0 : Date.now() - (s.resumedAt || s.startedAt)); },
  remaining() { const s = S(); return Math.max(0, (s.minutes || 0) * 60e3 - this.elapsed()); },

  start({ subject = '', goal = '', minutes = 50, tutor = true, focus = true, music = false } = {}) {
    store.set('studyMode', { active: true, subject: subject.trim(), goal: goal.trim(), minutes, tutor, focus, startedAt: Date.now(), resumedAt: Date.now(), accum: 0, paused: false, nextBreak: BREAK_EVERY, onBreakUntil: 0, held: [] });
    document.documentElement.classList.toggle('study-mode', true);
    bus.emit('studymode:change', true);
    toast(`Study mode on${subject ? ` — ${subject}` : ''}. ${minutes} minutes. You've got this.`, { type: 'ok' });
    if (music) this.playMusic();
    bus.emit('open', { id: 'study', params: { tab: 'teacher', ...(tutor && subject.trim() ? { begin: { topic: subject.trim(), goal: goal.trim() } } : {}) } });
    startTicker();
  },
  pause() { const s = S(); if (!s.active || s.paused) return; store.set('studyMode', { ...s, paused: true, accum: (s.accum || 0) + Date.now() - (s.resumedAt || s.startedAt) }); bus.emit('studymode:tick'); },
  resume() { const s = S(); if (!s.active || !s.paused) return; store.set('studyMode', { ...s, paused: false, resumedAt: Date.now() }); bus.emit('studymode:tick'); },
  async playMusic() {
    try {
      const [{ compose }, { engine }] = await Promise.all([import('./composer.js'), import('./audio.js')]);
      const t = await compose('calm focus music for studying', { style: 'lofi' }); // on-device, no AI call
      store.set('music.composed', [t, ...(store.get('music.composed') || [])].slice(0, 50));
      engine.setRepeat('one'); engine.playTrack(t);
    } catch { /* music is optional */ }
  },
  /** End the session; logs minutes and shows a summary. */
  end({ silent = false } = {}) {
    const s = S(); if (!s.active) return;
    const mins = Math.round(this.elapsed() / 6e4);
    if (mins > 0) {
      const k = todayKey();
      store.set(['study', 'minutesByDay', k], (store.get(['study', 'minutesByDay', k]) || 0) + mins);
      store.push('study.sessions', { ts: Date.now(), kind: 'study-mode', subject: s.subject, goal: s.goal, minutes: mins });
    }
    const held = s.held || [];
    store.set('studyMode', { active: false, last: { subject: s.subject, minutes: s.minutes, tutor: s.tutor, focus: s.focus } });
    document.documentElement.classList.toggle('study-mode', false);
    stopTicker();
    bus.emit('studymode:change', false);
    if (silent) return;
    modal({
      title: 'Session complete', titleIcon: 'check',
      body: h('div.stack',
        h('div', h('b', `${mins} minute${mins === 1 ? '' : 's'}`), ` of focused study${s.subject ? ` on ${s.subject}` : ''} — logged in Study → Progress.`),
        s.goal ? h('div.small.dim', `Your goal: ${s.goal}`) : null,
        held.length ? h('div.small', `${held.length} notification${held.length === 1 ? '' : 's'} arrived while you studied:`, h('ul.small', held.slice(0, 8).map((n) => h('li', `${n.title}${n.body ? ` — ${n.body}` : ''}`)))) : null),
      actions: [{ label: 'Close' }, { label: 'Quiz me on it', kind: 'primary', icon: 'sparkles', onClick: (close) => { close(); bus.emit('home:ask', { text: `Give me a 5-question quiz on ${s.subject || 'what I just studied'}${s.goal ? ` (goal: ${s.goal})` : ''}. Ask one question at a time and wait for my answer.` }); } }],
    });
  },
  /** Called by the notifier: hold non-urgent notifications during focus sessions. */
  hold(title, body, type) {
    const s = S(); if (!s.active || !s.focus || type === 'warn' || type === 'error') return false;
    store.set('studyMode', { ...s, held: [...(s.held || []), { title, body, ts: Date.now() }].slice(-30) });
    return true;
  },
  /** Lesson context for the teacher persona (subject, goal, plan progress). */
  lessonContext() {
    const s = S(); if (!s.active) return '';
    const plan = (s.plan || []).map((p, i) => `${i + 1}. [${p.done ? 'x' : ' '}] ${p.text}`).join('\n');
    return [`Study session${s.subject ? ` — subject: ${s.subject}` : ''}${s.goal ? `; the student's goal: ${s.goal}` : ''}; ${Math.round(this.elapsed() / 6e4)} of ${s.minutes} minutes done.`,
      plan && `Lesson plan:\n${plan}`, 'You can create flashcards for the student with your tools when useful.'].filter(Boolean).join('\n');
  },
  /** The start dialog. */
  openDialog() {
    if (this.active) return sessionDialog();
    const last = S().last || {};
    const subject = h('input.input', { placeholder: 'e.g. Physics — laws of motion', value: last.subject || '' });
    const goal = h('input.input', { placeholder: 'e.g. Finish chapter 4 exercises' });
    let minutes = last.minutes || 50;
    const lens = h('div.row', { style: 'gap:6px' });
    const paintLens = () => lens.replaceChildren(...[25, 50, 90, 120].map((m) => h('button.btn.sm', { class: m === minutes ? 'primary' : '', onclick: () => { minutes = m; paintLens(); } }, `${m} min`)));
    paintLens();
    const box = (checked) => h('input', { type: 'checkbox', checked });
    const tutor = box(last.tutor ?? true), focus = box(last.focus ?? true), music = box(false);
    modal({
      title: 'Start study mode', titleIcon: 'book',
      body: h('div.stack',
        h('label.stack', h('span.small', 'What are you studying?'), subject),
        h('label.stack', h('span.small', 'Goal for this session (optional)'), goal),
        h('div.stack', h('span.small', 'How long?'), lens),
        h('label.row.small', tutor, 'Teacher — JARVIS-X teaches you like a teacher (lesson plan, examples, checks your answers)'),
        h('label.row.small', focus, 'Focus — show only study tools and hold non-urgent notifications'),
        h('label.row.small', music, 'Play calm study music (made on your device)'),
        h('div.xs.muted', 'A 5-minute break is suggested every 25 minutes. Your study time is logged in Study → Progress.')),
      actions: [{ label: 'Cancel' }, { label: 'Start studying', kind: 'primary', icon: 'play', onClick: (close) => { close(); this.start({ subject: subject.value, goal: goal.value, minutes, tutor: tutor.checked, focus: focus.checked, music: music.checked }); } }],
    });
  },
  /** Top-bar chip while a session runs. */
  chip() {
    if (!this.active) return null;
    const s = S();
    const label = h('span.mono'); const update = () => { label.textContent = s.paused ? 'Paused' : fmt.dur(this.remaining()); };
    update();
    const el = h('button.btn.sm.study-chip', { onclick: () => sessionDialog(), title: 'Study session' }, icon('book', { size: 14 }), h('span.hide-sm', s.subject ? s.subject.slice(0, 18) : 'Studying'), label);
    el._tick = update;
    return el;
  },
};

function sessionDialog() {
  const s = S();
  const info = h('div.stack', h('div', h('b', s.subject || 'Study session'), s.goal ? h('div.small.dim', `Goal: ${s.goal}`) : null),
    h('div.small', `${fmt.dur(studyMode.elapsed())} studied · ${fmt.dur(studyMode.remaining())} left${s.paused ? ' · paused' : ''}`));
  modal({
    title: 'Study mode', titleIcon: 'book', body: info,
    actions: [
      s.paused ? { label: 'Resume', icon: 'play', onClick: (c) => { studyMode.resume(); c(); } } : { label: 'Pause', icon: 'pause', onClick: (c) => { studyMode.pause(); c(); } },
      { label: 'Open Study', icon: 'book', onClick: (c) => { c(); bus.emit('open', { id: 'study' }); } },
      { label: 'End session', kind: 'primary', icon: 'check', onClick: (c) => { c(); studyMode.end(); } },
    ],
  });
}

function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    const s = S(); if (!s.active) return stopTicker();
    bus.emit('studymode:tick');
    if (s.paused) return;
    const el = studyMode.elapsed();
    if (studyMode.remaining() <= 0) { chime(); studyMode.end(); return; }
    if (el >= (s.nextBreak || BREAK_EVERY) && !s.onBreakUntil) {
      chime();
      store.set('studyMode', { ...s, onBreakUntil: Date.now() + BREAK_LEN });
      toast('Time for a 5-minute break — stand up, stretch, drink some water. The timer keeps running.', { type: 'ok', timeout: 12000 });
    } else if (s.onBreakUntil && Date.now() > s.onBreakUntil) {
      store.set('studyMode', { ...s, onBreakUntil: 0, nextBreak: el + BREAK_EVERY });
      toast('Break over — back to it!', { timeout: 5000 });
    }
  }, 1000);
}
function stopTicker() { clearInterval(ticker); ticker = null; }
function chime() {
  try { const c = new AudioContext(); [660, 880].forEach((f, i) => { const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, c.currentTime + i * 0.18); g.gain.exponentialRampToValueAtTime(0.15, c.currentTime + i * 0.18 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + i * 0.18 + 0.5); o.connect(g); g.connect(c.destination); o.start(c.currentTime + i * 0.18); o.stop(c.currentTime + i * 0.18 + 0.55); }); setTimeout(() => c.close(), 1500); } catch { /* */ }
}

/** Restore a running session after reload. */
export function initStudyMode() {
  if (studyMode.active) { document.documentElement.classList.add('study-mode'); startTicker(); }
}
