/**
 * Assistant (chat) module: conversations, streaming replies, voice in/out,
 * favorite prompts, personalities, document analysis (Pro), exports.
 * @module modules/assistant
 */
import { h, clear, fmt, toast, copyText, uid, pickFiles, confirmDialog } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { ask, newConversation, activeConversation, quota } from '../core/assistant.js';
import { renderMarkdown } from '../core/markdown.js';
import { voice } from '../core/voice.js';
import { PERSONALITIES, providers, activeProviderId } from '../core/ai.js';
import { gate, allowed, featureBadge, withinLimit } from '../core/gate.js';
import { exportMarkdown, exportPDF, exportWord } from '../core/exporters.js';

export default {
  flush: true,
  mount(el, ctx) {
    let controller = null; let speakReplies = store.get('settings.voice.autoSpeak');
    const listEl = h('div.list');
    const log = h('div.chat-log', { role: 'log', 'aria-live': 'polite' });
    const input = h('textarea.textarea', { placeholder: 'Message JARVIS-X — Enter to send, Shift+Enter for a new line', rows: 1, 'aria-label': 'Message' });
    const sendBtn = h('button.btn.primary.icon', { 'aria-label': 'Send', onclick: () => send() }, icon('send'));
    const mic = h('button.btn.icon.mic', { 'aria-label': 'Voice input', title: 'Voice input', onclick: () => dictate() }, icon('mic'));
    const status = h('span.xs.muted');

    /* ---------- sidebar */
    const renderList = () => {
      const { conversations, activeId } = store.get('chat');
      clear(listEl).append(conversations.length ? conversations.map((c) => h('div.item', { class: c.id === activeId ? 'active' : '', style: 'cursor:pointer', onclick: () => { store.set('chat.activeId', c.id); renderLog(); renderList(); } },
        icon('chat', { size: 14 }), h('span.grow.small', c.title), h('button.btn.ghost.icon.sm', { 'aria-label': 'Delete conversation', onclick: async (e) => { e.stopPropagation(); if (await confirmDialog(`Delete "${c.title}"?`, { okLabel: 'Delete', danger: true })) { store.removeById('chat.conversations', c.id); renderList(); renderLog(); } } }, icon('trash')))) : h('div.empty', 'No conversations yet'));
    };

    /* ---------- messages */
    const bubble = (m, i) => {
      const body = h('div.md', { html: renderMarkdown(m.content) || '<span class="typing"></span>' });
      const meta = h('div.meta', fmt.time(m.ts),
        m.role === 'assistant' ? [
          h('button', { onclick: () => copyText(m.content) }, 'Copy'),
          voice.supported.tts ? h('button', { onclick: () => voice.speak(m.content) }, 'Speak') : null,
          h('button', { onclick: () => { store.unshift('notes', { id: uid('n'), title: (m.content.split('\n')[0] || 'From assistant').replace(/[#*]/g, '').slice(0, 50), body: m.content, format: 'md', updated: Date.now() }); toast('Saved to notes', { type: 'ok' }); } }, 'Save as note'),
          h('button', { onclick: () => { store.push('memory.facts', { id: uid('m'), text: m.content.slice(0, 200), tags: ['from-chat'], ts: Date.now() }); toast('Pinned to memory', { type: 'ok' }); } }, 'Remember'),
        ] : null,
        m.provider && m.provider !== 'local' ? h('span', providers[m.provider]?.label) : null);
      return h('div.msg', { class: m.role }, h('div.avatar', m.role === 'user' ? (store.get('profile.name')[0] || 'U').toUpperCase() : 'JX'), h('div', { style: 'min-width:0;max-width:100%' }, h('div.bubble', body), meta));
    };
    const renderLog = () => {
      const c = activeConversation(false);
      clear(log);
      if (!c || !c.messages.length) {
        log.append(h('div.empty', { style: 'margin:auto;max-width:520px;border:0' },
          h('h3', { style: 'margin-bottom:8px' }, 'How can I help?'),
          h('div.small', 'Ask anything, give a command, or paste text to summarise. Your favourite prompts:'),
          h('div.suggest', { style: 'justify-content:center;margin-top:10px' }, store.get('memory.prompts').map((p) => h('button.btn.sm', { onclick: () => { input.value = p.text + ' '; input.focus(); store.patchById('memory.prompts', p.id, { uses: (p.uses || 0) + 1 }); } }, icon('star'), p.title)))));
        return;
      }
      c.messages.forEach((m, i) => log.append(bubble(m, i)));
      log.scrollTop = log.scrollHeight;
    };

    /* ---------- send */
    async function send(textArg) {
      const text = (textArg ?? input.value).trim(); if (!text || controller) return;
      input.value = ''; autosize();
      controller = new AbortController();
      sendBtn.replaceChildren(icon('stop')); sendBtn.setAttribute('aria-label', 'Stop'); sendBtn.onclick = () => controller?.abort();
      const tts = speakReplies && voice.supported.tts ? voice.speakStream() : null;
      let lastNode;
      const res = await ask(text, { signal: controller.signal, onChunk: (full) => {
        if (!lastNode) { renderLog(); lastNode = log.lastElementChild?.querySelector('.md'); }
        if (lastNode) { lastNode.innerHTML = renderMarkdown(full); log.scrollTop = log.scrollHeight; }
        tts?.push(full);
      } });
      tts?.end();
      controller = null; sendBtn.replaceChildren(icon('send')); sendBtn.setAttribute('aria-label', 'Send'); sendBtn.onclick = () => send();
      renderLog(); renderList(); renderStatus();
      return res;
    }
    async function dictate() {
      if (voice.listening) { voice.stop(); return; }
      try {
        mic.classList.add('live');
        const text = await voice.listen({ onPartial: (p) => { input.value = p; } });
        mic.classList.remove('live');
        if (text) { speakReplies = true; send(text); }
      } catch (e) { mic.classList.remove('live'); toast(e.message, { type: 'error' }); }
    }
    async function attachDoc() {
      if (!gate('ai.documents')) return;
      const [f] = await pickFiles({ accept: '.txt,.md,.csv,.json,.html,.js,.py,.java,.cpp,.sql,.log', multiple: false }); if (!f) return;
      if (f.size > 400_000) { toast('That file is too large for in-browser analysis (max 400 KB).', { type: 'warn' }); return; }
      const text = await f.text();
      send(`Summarize: ${text.slice(0, 60_000)}\n\n(Document: ${f.name})`);
    }

    const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(200, input.scrollHeight) + 'px'; };
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

    const renderStatus = () => {
      const q = quota(); const p = activeProviderId();
      status.textContent = `${providers[p].label}${q.max === Infinity ? '' : ` · ${Math.max(0, q.left)} of ${q.max} requests left today`}`;
      status.title = p === 'local' ? 'Offline engine — open Settings → AI to connect a model' : '';
    };

    /* ---------- personality */
    const persona = h('select.select', { style: 'width:auto', 'aria-label': 'Personality', onchange: (e) => {
      const p = PERSONALITIES[e.target.value];
      if (p.plan !== 'free' && !gate('ai.personalities')) { e.target.value = store.get('settings.ai.personality'); return; }
      store.set('settings.ai.personality', e.target.value);
      if (e.target.value === 'custom') bus.emit('open', { id: 'settings', params: { tab: 'ai' } });
    } }, Object.entries(PERSONALITIES).map(([k, p]) => h('option', { value: k, selected: store.get('settings.ai.personality') === k }, p.label + (p.plan !== 'free' && !allowed('ai.personalities') ? ' (Pro)' : ''))));

    const speakToggle = h('label.switch.xs', h('input', { type: 'checkbox', checked: speakReplies, onchange: (e) => { speakReplies = e.target.checked; store.set('settings.voice.autoSpeak', speakReplies); if (!speakReplies) voice.cancelSpeech(); } }), h('span.track'), 'Speak replies');

    const exportConv = (kind) => {
      const c = activeConversation(false); if (!c?.messages.length) { toast('Nothing to export yet.'); return; }
      const md = c.messages.map((m) => `**${m.role === 'user' ? store.get('profile.name') : 'JARVIS-X'}** (${fmt.dt(m.ts)})\n\n${m.content}`).join('\n\n---\n\n');
      ({ md: exportMarkdown, pdf: exportPDF, doc: exportWord })[kind](c.title, md);
    };
    ctx.setActions(
      h('button.btn.ghost.sm', { onclick: () => exportConv('md'), title: 'Export as Markdown' }, icon('download'), 'MD'),
      h('button.btn.ghost.sm', { onclick: () => exportConv('pdf'), title: 'Export as PDF' }, 'PDF', featureBadge('export.docs')),
      h('button.btn.ghost.sm', { onclick: () => exportConv('doc'), title: 'Export as Word (.docx)' }, 'Word', featureBadge('export.docs')),
    );

    el.append(h('div.split',
      h('aside',
        h('button.btn.primary', { onclick: () => { newConversation(); renderList(); renderLog(); input.focus(); } }, icon('plus'), 'New conversation'),
        h('div.section-title', 'History'), listEl,
        store.get('settings.privacy.privacyMode') ? h('div.pill', icon('eyeoff', { size: 12 }), 'Privacy mode: not saved') : null),
      h('main', { style: 'padding:0;gap:0' },
        h('div.chat', log,
          h('div.composer',
            h('div.row', persona, speakToggle, h('span.grow'), status),
            h('div.row', { style: 'align-items:flex-end' },
              h('button.btn.icon', { 'aria-label': 'Analyze a document', title: 'Analyze a document', onclick: attachDoc }, icon('file')),
              input, mic, sendBtn))))));

    renderList(); renderLog(); renderStatus();
    const offs = [
      bus.on('assistant:ask', ({ text }) => send(text)),
      bus.on('chat:new', () => setTimeout(() => { renderList(); renderLog(); })),
      bus.on('ai:usage', renderStatus), bus.on('ai:provider', renderStatus), bus.on('plan:change', renderStatus),
      bus.on('assistant:tool', ({ name }) => !/^(get_|search_|read_|web_|calculate)/.test(name) && toast(`Done: ${name.replace(/_/g, ' ')}`, { type: 'ok', timeout: 1800 })),
    ];
    this.update = (p) => { if (p.ask) send(p.ask); if (p.prefill) { input.value = p.prefill; input.focus(); } };
    this.update(ctx.params);
    setTimeout(() => input.focus(), 50);
    return () => { offs.forEach((o) => o()); controller?.abort(); };
  },
};
