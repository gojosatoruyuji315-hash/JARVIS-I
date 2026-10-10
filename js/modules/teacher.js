/**
 * Teacher — the heart of study mode. A one-to-one lesson with an AI teacher:
 *  • plans the lesson as checkpoints (from your topic, goal and optional notes),
 *  • teaches each step, gives examples, asks you to try, checks your answers,
 *  • one-tap help: "Explain simpler", "Example", "Test me", "I'm stuck", "Summarise",
 *  • turns the lesson into flashcards, reads replies aloud if you like,
 *  • keeps the lesson (and progress) so you can pick it up later.
 * Lesson state lives in store.study.lesson (synced).
 * @module modules/teacher
 */
import { h, clear, toast, pickFiles } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import { renderMarkdown } from '../core/markdown.js';
import { ask } from '../core/assistant.js';
import { buildSystemPrompt, activeProviderId } from '../core/ai.js';
import { studyMode } from '../core/studymode.js';

const L = () => store.get('study.lesson') || null;
const saveL = (patch) => store.set('study.lesson', { ...(L() || {}), ...patch, updated: Date.now() });

const QUICK = [
  ['next', 'Next step', 'next', 'I understand — let\'s move on to the next step of the lesson.'],
  ['simpler', 'Explain simpler', 'sparkles', 'Can you explain that again more simply, like I\'m new to this?'],
  ['example', 'Another example', 'layers', 'Please give me another worked example.'],
  ['test', 'Test me', 'target', 'Test me with a question on what we just covered. Wait for my answer before giving the solution.'],
  ['stuck', 'I\'m stuck', 'alert', 'I\'m stuck. Give me a hint, not the full answer.'],
  ['summary', 'Summarise', 'note', 'Summarise what we have covered so far as short revision notes.'],
];

export function Teacher(el, params = {}) {
  let busy = false; let ctrl = null;
  const root = h('div.teacher');
  el.append(root);

  const sys = () => buildSystemPrompt({ persona: 'teacher', memoryLimit: 50, tools: true });
  const lessonContext = (l) => `Lesson topic: ${l.topic}${l.goal ? `\nStudent's goal: ${l.goal}` : ''}${l.level ? `\nLevel: ${l.level}` : ''}${l.plan?.length ? `\nLesson plan:\n${l.plan.map((p, i) => `${i + 1}. [${p.done ? 'x' : ' '}] ${p.text}`).join('\n')}\nCurrent step: ${(l.plan.findIndex((p) => !p.done) + 1) || 'all done — review'}` : ''}${l.material ? `\n\nThe student's own material (teach from this):\n"""\n${l.material.slice(0, 12000)}\n"""` : ''}`;

  /* ---------------- start screen */
  function startScreen() {
    const s = studyMode?.session || {};
    const topic = h('input.input', { placeholder: 'What do you want to learn? e.g. Newton\'s laws of motion', value: s.subject || '' });
    const goal = h('input.input', { placeholder: 'Goal (optional) e.g. solve chapter 4 problems, prepare for Friday\'s test', value: s.goal || '' });
    const level = h('select.select', { style: 'width:auto' }, ['Primary school', 'Middle school', 'High school', 'University', 'Beginner adult', 'Expert refresher'].map((x) => h('option', { selected: x === (L()?.level || 'High school') }, x)));
    const material = h('textarea.textarea', { placeholder: 'Optional: paste your notes, a textbook paragraph or homework questions — the teacher will teach from them.', style: 'min-height:90px' });
    const attach = h('button.btn.ghost.sm', { onclick: async () => { const fs = await pickFiles({ accept: '.txt,.md,.csv,.json,text/*', multiple: false }); if (fs[0]) { material.value = (await fs[0].text()).slice(0, 20000); toast(`Loaded ${fs[0].name}`, { type: 'ok' }); } } }, icon('upload'), 'Load notes file');
    const go = h('button.btn.primary', icon('play'), 'Start the lesson');
    go.onclick = () => { if (!topic.value.trim()) return topic.focus(); begin({ topic: topic.value.trim(), goal: goal.value.trim(), level: level.value, material: material.value.trim() }); };
    const prev = L();
    clear(root).append(h('div.stack', { style: 'max-width:820px' },
      h('div.teacher-hero', icon('book', { size: 28 }), h('div', h('h2', { style: 'margin:0' }, 'Your teacher'), h('div.small.dim', 'Learn anything step by step. Your teacher plans the lesson, explains, gives examples, asks you to try, and checks your answers.'))),
      prev?.messages?.length ? h('button.item', { style: 'cursor:pointer;color:var(--fg);text-align:left', onclick: () => lessonScreen() }, icon('refresh', { size: 16 }), h('span.grow', h('b', `Continue: ${prev.topic}`), h('div.xs.dim', `${(prev.plan || []).filter((p) => p.done).length}/${(prev.plan || []).length} steps done`))) : null,
      h('label.stack', h('span.small', 'Topic'), topic),
      h('label.stack', h('span.small', 'Goal'), goal),
      h('div.row', h('span.small', 'Level'), level, h('span.grow'), attach),
      material,
      h('div.row', go, activeProviderId() === 'local' ? h('span.xs', { style: 'color:var(--warn)' }, 'The teacher needs an AI engine — inside Claude it uses Claude; elsewhere connect one in Settings → AI.') : null)));
    setTimeout(() => topic.focus(), 50);
  }

  /* ---------------- begin: plan + first step */
  async function begin(info) {
    saveL({ ...info, plan: [], messages: [], started: Date.now() });
    lessonScreen();
    setStatus('Planning your lesson…');
    try {
      const r = await ask(`Plan a lesson for me.\n${lessonContext(L())}\n\nReturn ONLY JSON: {"plan": ["step 1", "step 2", ...]} with 3 to 6 short checkpoint titles in teaching order.`, { conversation: false, commands: false, tools: false, history: [{ role: 'user', content: `Plan a lesson on ${info.topic}` }], system: sys() });
      const j = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1));
      saveL({ plan: (j.plan || []).slice(0, 8).map((t) => ({ text: String(t), done: false })) });
    } catch { saveL({ plan: [{ text: `Understand the basics of ${info.topic}`, done: false }, { text: 'Worked examples', done: false }, { text: 'Practice and check', done: false }] }); }
    paintPlan();
    if (studyMode?.active) store.set('studyMode', { ...studyMode.session, plan: L().plan });
    await say('Please start teaching me. Begin with the first step of the plan.', { hidden: true });
  }

  /* ---------------- lesson screen */
  let planEl, logEl, input, statusEl, speakBox;
  function lessonScreen() {
    const l = L(); if (!l) return startScreen();
    planEl = h('div.teacher-plan'); logEl = h('div.teacher-log', { 'aria-live': 'polite' }); statusEl = h('div.small.dim');
    input = h('textarea.textarea', { placeholder: 'Answer your teacher, or ask a question…  (Enter to send, Shift+Enter for a new line)', rows: 2, style: 'min-height:54px' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    speakBox = h('input', { type: 'checkbox', checked: !!store.get('study.teacherSpeak'), onchange: (e) => store.set('study.teacherSpeak', e.target.checked) });
    clear(root).append(h('div.teacher-grid',
      h('aside.teacher-side.stack',
        h('div', h('div.xs.muted', 'LESSON'), h('b', l.topic), l.goal ? h('div.xs.dim', l.goal) : null),
        planEl,
        h('div.stack', { style: 'gap:6px' },
          h('button.btn.sm', { onclick: makeCards }, icon('layers', { size: 14 }), 'Make flashcards'),
          h('button.btn.sm.ghost', { onclick: () => { if (!busy) startScreen(); } }, icon('plus', { size: 14 }), 'New lesson'),
          h('label.row.xs', speakBox, 'Read replies aloud'))),
      h('section.teacher-main',
        logEl,
        h('div.teacher-quick', QUICK.map(([id, label, ic, text]) => h('button.btn.sm.ghost', { onclick: () => { if (id === 'next') markStep(); say(text); } }, icon(ic, { size: 13 }), label))),
        h('div.row', { style: 'align-items:flex-end' }, h('div.grow', input), h('button.btn.primary', { onclick: send, 'aria-label': 'Send' }, icon('send'))),
        statusEl)));
    paintPlan(); paintLog();
  }
  function setStatus(t) { if (statusEl) statusEl.textContent = t || ''; }
  function paintPlan() {
    const l = L(); if (!planEl || !l) return;
    const plan = l.plan || [];
    const cur = plan.findIndex((p) => !p.done);
    planEl.replaceChildren(h('div.xs.muted', `PLAN · ${plan.filter((p) => p.done).length}/${plan.length}`), ...plan.map((p, i) => h('label.teacher-step', { class: `${p.done ? 'done' : ''} ${i === cur ? 'current' : ''}` },
      h('input', { type: 'checkbox', checked: p.done, onchange: (e) => { const pl = [...L().plan]; pl[i] = { ...pl[i], done: e.target.checked }; saveL({ plan: pl }); syncSession(); paintPlan(); } }),
      h('span', p.text))));
    if (plan.length && plan.every((p) => p.done)) planEl.append(h('div.small', { style: 'color:var(--ok)' }, 'Lesson complete — try “Test me” or make flashcards to revise.'));
  }
  function syncSession() { if (studyMode?.active) store.set('studyMode', { ...studyMode.session, plan: L().plan }); }
  function markStep() { const l = L(); const i = (l.plan || []).findIndex((p) => !p.done); if (i < 0) return; const pl = [...l.plan]; pl[i] = { ...pl[i], done: true }; saveL({ plan: pl }); syncSession(); paintPlan(); }
  function bubble(m) {
    return m.role === 'user'
      ? h('div.t-msg.t-you', h('div.t-who', 'You'), h('div', m.content))
      : h('div.t-msg.t-teacher', h('div.t-who', icon('book', { size: 13 }), 'Teacher'), h('div.md', { html: renderMarkdown(m.content || '…') }));
  }
  function paintLog() {
    const msgs = (L()?.messages || []).filter((m) => !m.hidden);
    logEl.replaceChildren(...(msgs.length ? msgs.map(bubble) : [h('div.small.dim', 'Your teacher is getting ready…')]));
    logEl.scrollTop = logEl.scrollHeight;
  }
  async function send() { const t = input.value.trim(); if (!t) return; input.value = ''; await say(t); }

  /** Send a student turn and stream the teacher's reply. */
  async function say(text, { hidden = false } = {}) {
    if (busy) { toast('Your teacher is still answering…', { timeout: 1500 }); return; }
    const l = L(); if (!l) return;
    busy = true; ctrl = new AbortController();
    const messages = [...(l.messages || []), { role: 'user', content: text, hidden }];
    saveL({ messages }); paintLog();
    const live = bubble({ role: 'assistant', content: '' }); logEl.append(live); logEl.scrollTop = logEl.scrollHeight;
    setStatus('Teacher is writing…');
    const history = [{ role: 'user', content: `${lessonContext(l)}\n\n(Lesson context above — keep it in mind.)` }, { role: 'assistant', content: 'Understood. Let\'s learn this together.' },
      ...messages.slice(-16).map(({ role, content }) => ({ role, content }))];
    try {
      const r = await ask(text, { conversation: false, commands: false, tools: true, history, system: sys(), signal: ctrl.signal,
        onChunk: (t) => { live.querySelector('.md').innerHTML = renderMarkdown(t); logEl.scrollTop = logEl.scrollHeight; } });
      saveL({ messages: [...messages, { role: 'assistant', content: r.text }] });
      if (store.get('study.teacherSpeak')) import('../core/voice.js').then(({ voice }) => voice.speak(r.text.replace(/[#*_`>|]/g, '')));
    } catch (e) { toast(e.message, { type: 'error' }); }
    finally { busy = false; setStatus(''); paintLog(); }
  }

  async function makeCards() {
    const l = L(); if (!l?.messages?.length) return toast('Have a bit of the lesson first, then make flashcards.', { timeout: 3000 });
    setStatus('Making flashcards…');
    try {
      const r = await ask('From our lesson so far, create 8 flashcards. Return ONLY JSON: {"cards":[{"q":"question","a":"short answer"}]}', { conversation: false, commands: false, tools: false, history: [...l.messages.slice(-14).map(({ role, content }) => ({ role, content })), { role: 'user', content: 'Make flashcards (JSON only).' }], system: sys() });
      const j = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1));
      const cards = (j.cards || []).filter((c) => c.q && c.a).map((c, i) => ({ id: `c${Date.now().toString(36)}${i}`, q: String(c.q), a: String(c.a), box: 1, due: 0 }));
      if (!cards.length) throw new Error('No cards came back — try again.');
      const decks = store.get('study.decks') || [];
      const existing = decks.find((d) => d.name === l.topic);
      if (existing) store.set('study.decks', decks.map((d) => (d === existing ? { ...d, cards: [...d.cards, ...cards] } : d)));
      else store.set('study.decks', [...decks, { id: `d${Date.now().toString(36)}`, name: l.topic.slice(0, 60), cards }]);
      toast(`Added ${cards.length} flashcards to “${l.topic.slice(0, 40)}” — open the Flashcards tab to revise.`, { type: 'ok', timeout: 5000 });
    } catch (e) { toast(e.message || 'Could not make flashcards.', { type: 'error' }); }
    finally { setStatus(''); }
  }

  const off = bus.on('teacher:begin', (info) => begin(info));
  if (params.begin?.topic) { const b = params.begin; delete params.begin; begin({ level: L()?.level || 'High school', material: '', ...b }); }
  else if (L()?.messages?.length) lessonScreen(); else startScreen();
  return () => { off(); ctrl?.abort(); };
}
