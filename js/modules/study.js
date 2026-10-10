/**
 * Study Mode: flashcards (Leitner spaced repetition), quiz & MCQ generators,
 * homework helper, exam mode (Pro), revision planner, mind maps (Pro),
 * progress tracking and a study timer.
 * @module modules/study
 */
import { h, clear, fmt, uid, todayKey, toast, tabs, promptDialog, confirmDialog, download } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { renderMarkdown } from '../core/markdown.js';
import { ask } from '../core/assistant.js';
import { keywords } from '../core/ai.js';
import { solveEquation } from '../core/mathx.js';
import { gate, lockOverlay, featureBadge, allowed } from '../core/gate.js';
import { Teacher } from './teacher.js';

const BOX_DAYS = [0, 0, 1, 3, 7, 14];
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const logMinutes = (m) => { if (m <= 0) return; const k = todayKey(); store.set(['study', 'minutesByDay', k], (store.get(['study', 'minutesByDay', k]) || 0) + m); };

/* ============================================================= FLASHCARDS */
function Flashcards(el) {
  let deckId = store.get('study.decks')[0]?.id; let studying = false; let queue = []; let flipped = false;
  const root = h('div.stack'); el.append(root);
  const deck = () => store.findById('study.decks', deckId);
  const saveDeck = (d) => store.set('study.decks', store.get('study.decks').map((x) => (x.id === d.id ? d : x)));
  const render = () => {
    clear(root);
    const decks = store.get('study.decks');
    root.append(h('div.row', decks.map((d) => h('button.btn.sm', { class: d.id === deckId ? 'primary' : '', onclick: () => { deckId = d.id; studying = false; render(); } }, d.name, h('span.pill', { style: 'margin-left:4px' }, d.cards.length))),
      h('button.btn.ghost.sm', { onclick: async () => { const n = await promptDialog('Deck name'); if (n) { const d = { id: uid('d'), name: n, cards: [] }; store.push('study.decks', d); deckId = d.id; render(); } } }, icon('plus'), 'Deck')));
    const d = deck(); if (!d) { root.append(h('div.empty', 'Create a deck to get started.')); return; }
    if (studying) return renderStudy(d);
    const due = d.cards.filter((c) => (c.due || 0) <= Date.now());
    const q = h('input.input.grow', { placeholder: 'Front (question / term)' }); const a = h('input.input.grow', { placeholder: 'Back (answer / definition)' });
    const add = () => { if (!q.value.trim() || !a.value.trim()) return; d.cards.push({ id: uid('c'), q: q.value.trim(), a: a.value.trim(), box: 1, due: 0 }); saveDeck(d); q.value = a.value = ''; q.focus(); render(); };
    a.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    root.append(
      h('div.row', h('button.btn.primary', { disabled: !d.cards.length, onclick: () => { queue = shuffle(due.length ? due : d.cards); studying = true; flipped = false; render(); } }, icon('play'), due.length ? `Study ${due.length} due` : 'Review all'),
        h('button.btn', { onclick: () => bus.emit('open', { id: 'study', params: { tab: 'quiz', deck: d.id } }) }, icon('target'), 'Quiz me'),
        h('button.btn.ghost', { onclick: async () => { const txt = await promptDialog('Import cards — one per line as "front :: back"', { multiline: true, placeholder: 'Mitochondria :: Powerhouse of the cell' }); if (!txt) return; let n = 0; for (const line of txt.split('\n')) { const [f, b] = line.split(/::|\t| - /); if (f?.trim() && b?.trim()) { d.cards.push({ id: uid('c'), q: f.trim(), a: b.trim(), box: 1, due: 0 }); n++; } } saveDeck(d); toast(`Imported ${n} cards`, { type: 'ok' }); render(); } }, icon('upload'), 'Import'),
        h('button.btn.ghost', { onclick: () => download(`${d.name}.txt`, d.cards.map((c) => `${c.q} :: ${c.a}`).join('\n')) }, icon('download'), 'Export'),
        h('span.grow'),
        h('button.btn.ghost.sm', { onclick: async () => { if (await confirmDialog(`Delete deck "${d.name}"?`, { danger: true, okLabel: 'Delete' })) { store.removeById('study.decks', d.id); deckId = store.get('study.decks')[0]?.id; render(); } } }, icon('trash'), 'Delete deck')),
      h('div.row', q, a, h('button.btn', { onclick: add }, icon('plus'), 'Add card')),
      h('div.row', [1, 2, 3, 4, 5].map((b) => h('span.pill', `Box ${b}: ${d.cards.filter((c) => (c.box || 1) === b).length}`)), h('span.xs.muted', 'Cards move up a box when you know them; higher boxes come back less often.')),
      h('div.list', d.cards.map((c) => h('div.item', h('b.small', { style: 'flex:1;min-width:0' }, c.q), h('span.grow.small.dim', c.a), h('span.pill', `Box ${c.box || 1}`),
        h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete card', onclick: () => { d.cards = d.cards.filter((x) => x.id !== c.id); saveDeck(d); render(); } }, icon('trash'))))));
  };
  const started = Date.now();
  const renderStudy = (d) => {
    const c = queue[0];
    if (!c) { logMinutes(Math.round((Date.now() - started) / 6e4)); store.push('study.sessions', { ts: Date.now(), kind: 'flashcards', deck: d.name }); root.append(h('div.result-page', icon('check', { size: 48 }), h('h3', 'Session complete'), h('button.btn.primary', { onclick: () => { studying = false; render(); } }, 'Back to deck'))); return; }
    const card = h('div.flashcard', { tabindex: 0, role: 'button', 'aria-label': 'Flip card', class: flipped ? 'flipped' : '', onclick: () => { flipped = !flipped; card.classList.toggle('flipped', flipped); grade.hidden = !flipped; }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); } } },
      h('div.inner', h('div.face.glass', c.q), h('div.face.back.glass', c.a)));
    const rate = (r) => {
      const box = r === 'again' ? 1 : r === 'good' ? Math.min(5, (c.box || 1) + 1) : Math.min(5, (c.box || 1) + 2);
      d.cards = d.cards.map((x) => (x.id === c.id ? { ...x, box, due: Date.now() + BOX_DAYS[box] * 864e5 } : x)); saveDeck(d);
      queue.shift(); if (r === 'again') queue.push(c); flipped = false; render();
    };
    const grade = h('div.row', { hidden: !flipped, style: 'justify-content:center' }, h('button.btn.danger', { onclick: () => rate('again') }, 'Again'), h('button.btn', { onclick: () => rate('good') }, 'Good'), h('button.btn.primary', { onclick: () => rate('easy') }, 'Easy'));
    root.append(h('div.row', h('span.small.dim', `${queue.length} card(s) left`), h('span.grow'), h('button.btn.ghost.sm', { onclick: () => { studying = false; render(); } }, 'End session')), card, h('div.small.muted', { style: 'text-align:center' }, 'Click or press Enter to flip'), grade);
  };
  render();
}

/* ================================================================ QUIZ ENGINE */
/** Build MCQs from cards: options are other cards' answers. */
export function mcqFromCards(cards, n = 10) {
  if (cards.length < 2) return [];
  return shuffle(cards).slice(0, n).map((c) => {
    const distract = shuffle(cards.filter((x) => x.id !== c.id).map((x) => x.a)).slice(0, 3);
    return { q: c.q, options: shuffle([c.a, ...distract]), answer: c.a, explain: `${c.q} → ${c.a}` };
  });
}
/** Cloze MCQs from free text: blank a key term per sentence. */
export function mcqFromText(text, n = 8) {
  const kws = keywords(text, 30);
  const sentences = (text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]/g) || []).map((s) => s.trim()).filter((s) => s.split(' ').length > 5);
  const qs = [];
  for (const s of shuffle(sentences)) {
    const term = kws.find((k) => new RegExp(`\\b${k}\\b`, 'i').test(s)); if (!term) continue;
    const distract = shuffle(kws.filter((k) => k !== term)).slice(0, 3);
    if (distract.length < 2) continue;
    qs.push({ q: s.replace(new RegExp(`\\b${term}\\b`, 'i'), '_____'), options: shuffle([term, ...distract]), answer: term, explain: s });
    if (qs.length >= n) break;
  }
  return qs;
}
/** Generic quiz runner. exam=true hides feedback until the end and adds a countdown. */
function runQuiz(root, questions, { exam = false, minutes = 10, title = 'Quiz', onDone } = {}) {
  let i = 0, score = 0; const answers = []; const start = Date.now(); let timer;
  const draw = () => {
    clear(root);
    if (i >= questions.length) return finish();
    const q = questions[i];
    const clock = h('span.mono.small');
    if (exam) { const tickFn = () => { const left = minutes * 6e4 - (Date.now() - start); clock.textContent = fmt.dur(left); if (left <= 0) { i = questions.length; draw(); } }; tickFn(); clearInterval(timer); timer = setInterval(tickFn, 500); }
    const opts = q.options.map((o) => h('button.btn.mcq-opt', { onclick: (e) => {
      answers[i] = o; const ok = o === q.answer; if (ok) score++;
      if (exam) { i++; draw(); return; }
      for (const b of opts) { b.disabled = true; if (b.textContent === q.answer) b.classList.add('correct'); }
      if (!ok) e.currentTarget.classList.add('wrong');
      root.append(h('div.small.dim', ok ? 'Correct.' : `Answer: ${q.answer}`), h('button.btn.primary', { onclick: () => { i++; draw(); } }, i + 1 < questions.length ? 'Next' : 'See results'));
    } }, o));
    root.append(h('div.row', h('b', title), h('span.pill', `${i + 1} / ${questions.length}`), exam ? h('span.pill.med', icon('timer', { size: 12 }), clock) : null, h('span.grow'), h('span.small.dim', exam ? 'Exam mode — no feedback until the end' : `Score ${score}`)),
      h('div.meter', h('i', { style: `width:${(i / questions.length) * 100}%` })),
      h('h3', { style: 'margin:10px 0' }, q.q), h('div.stack', opts));
  };
  const finish = () => {
    clearInterval(timer);
    const pct = Math.round((score / questions.length) * 100);
    store.push('study.quizzes', { ts: Date.now(), score, total: questions.length, exam, title });
    logMinutes(Math.round((Date.now() - start) / 6e4));
    clear(root).append(h('div.result-page', h('div.w-big', `${pct}%`), h('div', `${score} of ${questions.length} correct`),
      h('div.small.dim', pct >= 80 ? 'Excellent — move these cards up and schedule a light review.' : pct >= 50 ? 'Solid base. Revisit the misses below tomorrow.' : 'Review the material again, then retake this quiz.'),
      h('button.btn.primary', { onclick: () => onDone?.() }, 'Done')),
      h('div.list', questions.map((q, k) => h('div.item', icon(answers[k] === q.answer ? 'check' : 'x', { size: 14 }), h('span.grow.small', q.q), h('span.small', { style: `color:var(${answers[k] === q.answer ? '--ok' : '--danger'})` }, answers[k] ?? '—'), answers[k] !== q.answer ? h('span.small.dim', `→ ${q.answer}`) : null))));
  };
  draw();
  return () => clearInterval(timer);
}

function Quiz(el, params) {
  const root = h('div.stack'); el.append(root);
  let stop;
  const setup = () => {
    clear(root);
    const decks = store.get('study.decks');
    const sel = h('select.select', { style: 'width:auto' }, decks.map((d) => h('option', { value: d.id, selected: d.id === params.deck }, `${d.name} (${d.cards.length})`)));
    const txt = h('textarea.textarea', { placeholder: 'Or paste study notes here and generate a fill-in-the-blank quiz…', style: 'min-height:140px' });
    root.append(h('h3', 'Quiz generator'),
      h('div.row', h('span.small', 'From flashcards:'), sel, h('button.btn.primary', { onclick: () => { const d = store.findById('study.decks', sel.value); const qs = mcqFromCards(d?.cards || []); if (!qs.length) return toast('Add at least two cards to this deck first.', { type: 'warn' }); stop = runQuiz(root, qs, { title: d.name, onDone: setup }); } }, icon('play'), 'Start')),
      txt, h('div.row', h('button.btn', { onclick: () => { const qs = mcqFromText(txt.value); if (qs.length < 2) return toast('Paste a longer passage (a few paragraphs) to generate questions.', { type: 'warn' }); stop = runQuiz(root, qs, { title: 'Notes quiz', onDone: setup }); } }, icon('sparkles'), 'Generate from text')));
  };
  setup();
  return () => stop?.();
}

function MCQ(el) {
  const inp = h('textarea.textarea', { style: 'min-height:160px', placeholder: 'Paste notes, or terms as "term: definition" per line', value: 'Photosynthesis: process converting light energy into chemical energy\nMitosis: cell division producing two identical daughter cells\nOsmosis: diffusion of water across a semi-permeable membrane\nEnzyme: biological catalyst that speeds up reactions\nATP: main energy currency of the cell' });
  const out = h('div.stack');
  let last = [];
  const gen = () => {
    const lines = inp.value.split('\n').map((l) => l.split(/:\s+| - /)).filter((p) => p.length >= 2 && p[0].trim() && p[1].trim());
    last = lines.length >= 3 ? mcqFromCards(lines.map(([q, ...a]) => ({ id: uid(), q: `What is ${q.trim()}?`, a: a.join(': ').trim() })), 20) : mcqFromText(inp.value, 15);
    clear(out).append(last.length ? last.map((q, i) => h('div.glass.widget', h('b', `${i + 1}. ${q.q}`), h('ol', { type: 'A', style: 'margin:6px 0' }, q.options.map((o) => h('li', { style: o === q.answer ? 'color:var(--ok)' : '' }, o))))) : h('div.empty', 'Not enough material to build questions.'));
  };
  el.append(h('div.stack', h('div.small.dim', 'Generates multiple-choice questions with plausible distractors. Correct answers are highlighted.'), inp,
    h('div.row', h('button.btn.primary', { onclick: gen }, icon('sparkles'), 'Generate MCQs'), h('button.btn', { onclick: () => last.length && runQuiz(out, last, { title: 'MCQ practice', onDone: gen }) }, icon('play'), 'Practice them'),
      h('button.btn.ghost', { onclick: () => last.length && download('mcq.md', last.map((q, i) => `${i + 1}. ${q.q}\n${q.options.map((o, k) => `   ${'ABCD'[k]}. ${o}`).join('\n')}\n   Answer: ${q.answer}`).join('\n\n'), 'text/markdown') }, icon('download'), 'Export')), out));
  gen();
}

function Homework(el) {
  const subj = h('select.select', { style: 'width:auto' }, ['Math', 'Physics', 'Chemistry', 'Biology', 'History', 'Literature', 'Computer science', 'Languages', 'Other'].map((s) => h('option', s)));
  const level = h('select.select', { style: 'width:auto' }, ['Middle school', 'High school', 'University'].map((s) => h('option', { selected: s === 'High school' }, s)));
  const q = h('textarea.textarea', { placeholder: 'Type or paste your question. For equations, e.g. 3x + 7 = 22 or x^2 - 5x + 6 = 0', style: 'min-height:120px' });
  const out = h('div.md.glass.widget', { hidden: true });
  const hints = h('label.switch', h('input', { type: 'checkbox', checked: true }), h('span.track'), 'Guide me with hints first (don\'t just give the answer)');
  const go = async () => {
    const text = q.value.trim(); if (!text) return;
    out.hidden = false; out.innerHTML = '<span class="typing"></span>';
    const sol = /=/.test(text) ? solveEquation(text.replace(/^solve\s+/i, '')) : null;
    const guided = hints.querySelector('input').checked;
    const system = `You are a patient ${level.value} ${subj.value} tutor. ${guided ? 'Use the Socratic method: give the first step and a hint, ask the student to try the next step, and only reveal the full answer at the end under a "Full solution" heading.' : 'Explain the solution step by step.'} Use Markdown and LaTeX-free plain math.`;
    const res = await ask(sol ? `solve ${text}` : `help me with homework: ${text}`, { conversation: false, system, history: [{ role: 'user', content: sol ? `solve ${text}` : text }], onChunk: (full) => { out.innerHTML = renderMarkdown(full); } });
    if (!res.text) out.hidden = true;
  };
  el.append(h('div.stack', h('div.row', subj, level, hints), q, h('div.row', h('button.btn.primary', { onclick: go }, icon('sparkles'), 'Help me'), h('span.xs.muted', 'Counts as one AI request. Equations are solved offline with full steps.')), out));
}

function Exam(el) {
  const wrap = h('div.stack', { style: 'min-height:300px' });
  const decks = store.get('study.decks');
  const sel = h('select.select', { multiple: true, size: Math.min(5, Math.max(2, decks.length)), style: 'width:auto;min-width:220px', 'aria-label': 'Decks' }, decks.map((d, i) => h('option', { value: d.id, selected: i === 0 }, d.name)));
  const mins = h('input.input', { type: 'number', value: 10, min: 1, style: 'width:90px', 'aria-label': 'Minutes' });
  const count = h('input.input', { type: 'number', value: 15, min: 2, style: 'width:90px', 'aria-label': 'Questions' });
  let stop;
  const setup = () => clear(wrap).append(h('h3', 'Exam mode ', featureBadge('study.exam')), h('div.small.dim', 'Timed, no hints, no feedback until you finish — just like the real thing.'),
    h('div.row', h('label.field', 'Decks', sel), h('label.field', 'Minutes', mins), h('label.field', 'Questions', count)),
    h('button.btn.primary', { style: 'justify-self:start', onclick: () => {
      if (!gate('study.exam')) return;
      const cards = [...sel.selectedOptions].flatMap((o) => store.findById('study.decks', o.value)?.cards || []);
      const qs = mcqFromCards(cards, +count.value); if (qs.length < 2) return toast('Pick decks with at least two cards.', { type: 'warn' });
      document.documentElement.requestFullscreen?.().catch(() => {});
      stop = runQuiz(wrap, qs, { exam: true, minutes: +mins.value, title: 'Exam', onDone: () => { document.fullscreenElement && document.exitFullscreen?.(); setup(); } });
    } }, icon('timer'), 'Begin exam'));
  setup(); el.append(lockOverlay(wrap, 'study.exam'));
  return () => stop?.();
}

function Planner(el) {
  const name = h('input.input', { placeholder: 'Exam name, e.g. Physics final' });
  const date = h('input.input', { type: 'date', value: todayKey(new Date(Date.now() + 14 * 864e5)), style: 'width:auto' });
  const hours = h('input.input', { type: 'number', value: 2, min: 0.5, step: 0.5, style: 'width:90px' });
  const topics = h('textarea.textarea', { placeholder: 'One topic per line', value: 'Kinematics\nNewton\'s laws\nWork & energy\nMomentum\nCircular motion\nGravitation' });
  const out = h('div.stack');
  const render = () => clear(out).append(store.get('study.plans').slice().reverse().map((p) => h('div.glass.widget', h('div.w-head', icon('calendar'), h('h3.w-title', `${p.name} — ${p.date}`), h('button.btn.ghost.sm', { onclick: () => { for (const d of p.days) store.push('events', { id: uid('e'), title: `Study: ${d.items.join(', ')}`, date: d.date, time: '17:00', notes: p.name }); toast('Added study blocks to your calendar', { type: 'ok' }); } }, icon('calendar'), 'Add to calendar'), h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete plan', onclick: () => { store.removeById('study.plans', p.id); render(); } }, icon('trash'))),
    h('div.table-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Date'), h('th', 'Focus'), h('th', 'Hours'))), h('tbody', p.days.map((d) => h('tr', h('td.mono', d.date), h('td', d.items.join(' · ')), h('td', String(d.hours))))))))));
  const build = () => {
    const list = topics.value.split('\n').map((x) => x.trim()).filter(Boolean);
    const end = new Date(date.value + 'T12:00'); const start = new Date(); start.setHours(12, 0, 0, 0);
    const nDays = Math.max(1, Math.round((end - start) / 864e5));
    const days = Array.from({ length: nDays }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return { date: todayKey(d), items: [], hours: +hours.value }; });
    const learnDays = Math.max(1, nDays - 2); // final two days = full review
    list.forEach((tp, i) => {
      const di = Math.floor((i * learnDays) / list.length);
      days[di].items.push(`Learn: ${tp}`);
      for (const gap of [1, 3, 7]) if (days[di + gap] && di + gap < learnDays) days[di + gap].items.push(`Review: ${tp}`);
    });
    for (let i = learnDays; i < nDays; i++) days[i].items.push(i === nDays - 1 ? 'Light review + rest' : 'Full mock exam & weak spots');
    store.push('study.plans', { id: uid('sp'), name: name.value || 'Exam', date: date.value, days: days.filter((d) => d.items.length) });
    render();
  };
  el.append(h('div.stack', h('div.small.dim', 'Builds a spaced-repetition schedule: each topic is learned once and reviewed after 1, 3 and 7 days, with mock exams at the end.'),
    h('div.row', name, h('label.field', 'Exam date', date), h('label.field', 'Hours / day', hours)), topics, h('button.btn.primary', { style: 'justify-self:start', onclick: build }, icon('sparkles'), 'Build revision plan'), out));
  render();
}

function MindMap(el) {
  const src = h('textarea.textarea.mono', { style: 'min-height:200px', value: 'Machine learning\n  Supervised\n    Regression\n    Classification\n  Unsupervised\n    Clustering\n    Dimensionality reduction\n  Reinforcement\n    Rewards\n    Policies\n  Evaluation\n    Accuracy\n    Overfitting' });
  const view = h('div.mindmap');
  const draw = () => {
    const lines = src.value.split('\n').filter((l) => l.trim());
    if (!lines.length) { clear(view); return; }
    const root = { label: lines[0].trim(), children: [], depth: 0 }; const stack = [{ node: root, indent: -1 }];
    for (const l of lines.slice(1)) {
      const indent = l.match(/^\s*/)[0].length; const node = { label: l.trim(), children: [] };
      while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();
      stack.at(-1).node.children.push(node); stack.push({ node, indent });
    }
    const leaves = (n) => (n.children.length ? n.children.reduce((a, c) => a + leaves(c), 0) : 1);
    const W = 900, Hh = Math.max(420, leaves(root) * 34), cx = W / 2, cy = Hh / 2;
    let svg = '';
    const place = (n, depth, a0, a1) => {
      const a = (a0 + a1) / 2; const r = depth * 150;
      n.x = cx + r * Math.cos(a) * (depth ? 1.25 : 0); n.y = cy + r * Math.sin(a) * 0.75;
      const total = leaves(n); let cur = a0;
      for (const c of n.children) { const span = ((a1 - a0) * leaves(c)) / total; place(c, depth + 1, cur, cur + span); cur += span; }
    };
    place(root, 0, -Math.PI, Math.PI);
    const edges = (n) => { for (const c of n.children) { svg += `<path d="M${n.x},${n.y} C${(n.x + c.x) / 2},${n.y} ${(n.x + c.x) / 2},${c.y} ${c.x},${c.y}"/>`; edges(c); } };
    const esc = (s) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const nodes = (n, depth) => { const w = Math.min(190, n.label.length * 7 + 22); svg += `<g class="node ${depth === 0 ? 'root' : ''}"><rect x="${n.x - w / 2}" y="${n.y - 14}" width="${w}" height="28" rx="14"/><text x="${n.x}" y="${n.y + 4}" text-anchor="middle">${esc(n.label.slice(0, 26))}</text></g>`; n.children.forEach((c) => nodes(c, depth + 1)); };
    edges(root); nodes(root, 0);
    view.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" width="100%" style="min-width:640px" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  };
  src.addEventListener('input', draw);
  const wrap = h('div.stack', h('div.small.dim', 'Write an indented outline (two spaces per level). The map updates live.'), h('div.grid2', { style: 'grid-template-columns:minmax(220px,1fr) minmax(0,2.4fr);align-items:start' }, src, view),
    h('div.row', h('button.btn', { onclick: () => download('mind-map.svg', view.innerHTML, 'image/svg+xml') }, icon('download'), 'Export SVG')));
  el.append(lockOverlay(wrap, 'study.mindmap'));
  draw();
}

function Progress(el) {
  const s = store.get('study');
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); return todayKey(d); });
  const max = Math.max(10, ...days.map((d) => s.minutesByDay[d] || 0));
  const cards = s.decks.flatMap((d) => d.cards);
  const avg = s.quizzes.length ? Math.round(s.quizzes.reduce((a, q) => a + q.score / q.total, 0) / s.quizzes.length * 100) : 0;
  const total = Object.values(s.minutesByDay).reduce((a, b) => a + b, 0);
  el.append(h('div.stack',
    h('div.grid3', [['Study minutes', total], ['Quizzes taken', s.quizzes.length], ['Average score', `${avg}%`], ['Cards mastered', `${cards.filter((c) => (c.box || 1) >= 4).length}/${cards.length}`]].map(([k, v]) => h('div.glass.widget', h('div.w-title', k), h('div.w-big', String(v))))),
    h('div.glass.widget', h('div.w-title', 'Minutes per day (last 14 days)'), h('div.bars', days.map((d) => h('div.b', { title: `${d}: ${s.minutesByDay[d] || 0} min` }, h('i', { style: `height:${((s.minutesByDay[d] || 0) / max) * 100}%` }), h('span', d.slice(8)))))),
    h('div.glass.widget', h('div.w-title', 'Recent quizzes'), h('div.list', s.quizzes.slice(-8).reverse().map((q) => h('div.item', h('span.grow.small', q.title + (q.exam ? ' (exam)' : '')), h('b.mono', `${q.score}/${q.total}`), h('span.xs.muted', fmt.rel(q.ts))))), !s.quizzes.length ? h('div.empty', 'No quizzes yet.') : null)));
}

function Timer(el) {
  let running = false, start = 0, acc = 0;
  const subject = h('input.input', { placeholder: 'What are you studying?', style: 'max-width:320px' });
  const disp = h('div.w-big', { style: 'font-size:56px' }, '00:00');
  const btn = h('button.btn.primary');
  const now = () => acc + (running ? Date.now() - start : 0);
  const draw = () => { disp.textContent = fmt.dur(now()); btn.replaceChildren(icon(running ? 'pause' : 'play'), running ? 'Pause' : 'Start'); };
  btn.onclick = () => { if (running) { acc = now(); running = false; } else { start = Date.now(); running = true; } draw(); };
  const save = () => { const m = Math.round(now() / 6e4); logMinutes(m); store.push('study.sessions', { ts: Date.now(), kind: 'timer', subject: subject.value, minutes: m }); acc = 0; running = false; draw(); toast(`Logged ${m} minute(s) of study`, { type: 'ok' }); };
  const off = bus.on('tick', draw);
  draw();
  el.append(h('div.pomo', subject, disp, h('div.row', btn, h('button.btn', { onclick: save }, icon('check'), 'Finish & log')), h('div.small.dim', 'Sessions are added to your progress chart. For structured focus blocks use Productivity → Pomodoro.')));
  return off;
}

export default {
  flush: true,
  mount(el, ctx) {
    let cleanup;
    const wrap = (fn) => (body) => { try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } cleanup = fn(body, ctx.params || {}); };
    const t = tabs([
      { id: 'teacher', label: 'Teacher', icon: 'book', render: wrap(Teacher) },
      { id: 'flashcards', label: 'Flashcards', icon: 'layers', render: wrap(Flashcards) },
      { id: 'quiz', label: 'Quiz', icon: 'target', render: wrap(Quiz) },
      { id: 'mcq', label: 'MCQ generator', icon: 'tasks', render: wrap(MCQ) },
      { id: 'homework', label: 'Homework helper', icon: 'sparkles', render: wrap(Homework) },
      { id: 'exam', label: 'Exam mode', icon: 'timer', badge: allowed('study.exam') ? null : featureBadge('study.exam'), render: wrap(Exam) },
      { id: 'planner', label: 'Revision planner', icon: 'calendar', render: wrap(Planner) },
      { id: 'mindmap', label: 'Mind maps', icon: 'hud', badge: allowed('study.mindmap') ? null : featureBadge('study.mindmap'), render: wrap(MindMap) },
      { id: 'progress', label: 'Progress', icon: 'chart', render: wrap(Progress) },
      { id: 'timer', label: 'Study timer', icon: 'clock', render: wrap(Timer) },
    ], { initial: ctx.params?.tab });
    el.append(t.el);
    this.update = (p) => { ctx.params = p; t.select(p.tab || t.current); };
    // Study mode control in the window header
    const sm = { mod: null };
    const paintAction = () => { const m = sm.mod; if (!m || !ctx.setActions) return;
      ctx.setActions(m.studyMode.active
        ? h('button.btn.sm.study-chip', { onclick: () => m.studyMode.openDialog() }, icon('book', { size: 14 }), `Studying · ${fmt.dur(m.studyMode.remaining())} left`)
        : h('button.btn.sm.primary', { onclick: () => m.studyMode.openDialog(), title: 'Tutor AI, session timer, breaks and fewer distractions' }, icon('play', { size: 14 }), 'Start study mode')); };
    import('../core/studymode.js').then((m) => { sm.mod = m; paintAction(); });
    const offs = [bus.on('studymode:change', paintAction), bus.on('studymode:tick', () => sm.mod?.studyMode.active && paintAction())];
    return () => { offs.forEach((o) => o()); try { typeof cleanup === 'function' && cleanup(); } catch { /* */ } };
  },
};
