/**
 * Voice Studio plugin — text to speech. Preview with your device's voices,
 * or render studio-quality MP3 narration through the JARVIS-X server (OpenAI TTS).
 */
import { voice } from '../core/voice.js';

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];

export default {
  id: 'voice-studio', name: 'Voice Studio', version: '1.0.0', author: 'JARVIS-X',
  icon: 'volume', category: 'Creative', needs: [],
  description: 'Turn scripts, notes and lessons into speech. Preview with your device voices, or render natural MP3 narration on the JARVIS-X server.',
  panel(el, api) {
    const { h, icon } = api;
    const text = h('textarea.textarea', { placeholder: 'Paste a script, note or lesson…', style: 'min-height:160px', value: api.get('draft', '') });
    text.addEventListener('input', () => api.set('draft', text.value));
    const devVoice = h('select.select', { style: 'width:auto', 'aria-label': 'Device voice' }, h('option', { value: '' }, 'Default device voice'), voice.voices().map((v) => h('option', { value: v.voiceURI }, `${v.name} (${v.lang})`)));
    const rate = h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.05, value: 1, style: 'max-width:140px', 'aria-label': 'Speed' });
    const srvVoice = h('select.select', { style: 'width:auto', 'aria-label': 'Studio voice' }, OPENAI_VOICES.map((v) => h('option', v)));
    const out = h('div.stack'); const status = h('div.small.dim');
    const canRender = api.platform.isServer && api.platform.server?.features?.media;
    const preview = () => {
      if (!text.value.trim()) return; speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.value); u.rate = +rate.value;
      const v = voice.voices().find((x) => x.voiceURI === devVoice.value); if (v) u.voice = v;
      speechSynthesis.speak(u);
    };
    const render = async () => {
      if (!text.value.trim()) return; status.textContent = 'Rendering MP3…';
      try {
        const { api: server } = await import('../core/api.js');
        const res = await server('/api/media/speech', { method: 'POST', body: { text: text.value, voice: srvVoice.value }, raw: true });
        const blob = await res.blob(); const url = URL.createObjectURL(blob);
        out.prepend(h('div.glass.widget.stack', h('audio', { src: url, controls: true, style: 'width:100%' }), h('div.row', h('span.grow.xs.dim', text.value.slice(0, 80)),
          h('button.btn.sm', { onclick: () => api.download('narration.mp3', blob) }, icon('download'), 'MP3'),
          h('button.btn.ghost.sm', { onclick: () => api.saveToFiles(blob, `narration-${Date.now().toString(36)}.mp3`, '/Generated/Audio') }, icon('folder'), 'Save to Files'))));
        status.textContent = '';
      } catch (e) { status.textContent = e.message; }
    };
    el.append(h('div.stack', text,
      h('div.glass.widget.stack', h('b', 'Device voices (instant, free)'), h('div.row', devVoice, h('span.small.dim', 'Speed'), rate, h('button.btn', { onclick: preview }, icon('play'), 'Speak'), h('button.btn.ghost', { onclick: () => speechSynthesis.cancel() }, icon('stop'), 'Stop'))),
      h('div.glass.widget.stack', h('b', 'Studio narration (MP3)'),
        canRender ? h('div.row', srvVoice, h('button.btn.primary', { onclick: render }, icon('sparkles'), 'Render MP3')) : h('div.small.dim', 'Rendering MP3 files needs the JARVIS-X server with OPENAI_API_KEY. Device voices can speak but browsers cannot record them to a file.')),
      status, out));
  },
};
