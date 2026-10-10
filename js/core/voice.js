/**
 * Voice I/O on top of the Web Speech API.
 *  - Speech recognition (push-to-talk, toggle, wake-word placeholder)
 *  - Text-to-speech with profiles, rate/pitch, sentence-level streaming and interruption
 * Gracefully reports unsupported browsers (Firefox has no SpeechRecognition).
 * @module core/voice
 */
import { store } from './store.js';
import { bus } from './bus.js';
import { stripMarkdown } from './markdown.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;

export const VOICE_PROFILES = {
  default: { label: 'Standard', rate: 1, pitch: 1, plan: 'free' },
  calm:    { label: 'Calm', rate: 0.9, pitch: 0.9, plan: 'free' },
  brisk:   { label: 'Brisk', rate: 1.2, pitch: 1.05, plan: 'pro' },
  deep:    { label: 'Deep', rate: 0.95, pitch: 0.7, plan: 'pro' },
  bright:  { label: 'Bright', rate: 1.05, pitch: 1.3, plan: 'pro' },
  custom:  { label: 'Custom (rate & pitch)', rate: null, pitch: null, plan: 'master' },
};

let rec = null; let listening = false; let wakeRec = null;
let queue = []; let speaking = false; let streamBuf = '';

function params() {
  const v = store.get('settings.voice');
  const p = VOICE_PROFILES[v.profile] || VOICE_PROFILES.default;
  return { rate: (p.rate ?? 1) * v.rate, pitch: Math.min(2, (p.pitch ?? 1) * v.pitch), voiceURI: v.voiceURI, lang: v.lang };
}
function state(s) { bus.emit('voice:state', { state: s }); bus.emit('hud:state', { state: s === 'idle' ? 'idle' : s }); }

export const voice = {
  supported: { stt: !!SR, tts: !!synth },
  get listening() { return listening; },
  get speaking() { return speaking; },

  voices() { try { return synth?.getVoices() ?? []; } catch { return []; } },

  /**
   * Start recognition. Resolves with the final transcript ('' if nothing heard).
   * onPartial(text) receives interim results.
   */
  listen({ onPartial, continuous = false } = {}) {
    if (!SR) return Promise.reject(new Error('Speech recognition is not supported in this browser. Try Chrome or Edge.'));
    this.cancelSpeech(); // voice interruption: user talking stops TTS
    this.stop();
    return new Promise((resolve, reject) => {
      rec = new SR();
      rec.lang = store.get('settings.voice.lang') || 'en-US';
      rec.interimResults = true; rec.continuous = continuous; rec.maxAlternatives = 1;
      let finalText = '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        onPartial?.((finalText + interim).trim());
      };
      rec.onerror = (e) => { listening = false; state('idle'); if (e.error === 'no-speech' || e.error === 'aborted') resolve(''); else reject(new Error(e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in your browser settings.' : `Speech error: ${e.error}`)); };
      rec.onend = () => { listening = false; state('idle'); resolve(finalText.trim()); store.set('usage.totals.voice', store.get('usage.totals.voice') + 1); };
      try { rec.start(); listening = true; state('listening'); } catch (e) { reject(e); }
    });
  },
  /** Stop listening (final result still delivered). */
  stop() { try { rec?.stop(); } catch { /* */ } },

  /** Speak text now. interrupt=true cancels anything queued. */
  speak(text, { interrupt = true } = {}) {
    if (!synth || !text) return;
    if (interrupt) this.cancelSpeech();
    const clean = stripMarkdown(text).replace(/<[^>]+>/g, '');
    for (const s of clean.match(/[^.!?\n]+[.!?]*|\n/g) || []) if (s.trim()) queue.push(s.trim());
    pump();
  },
  /** Streaming speech: feed partial text as it arrives; speaks complete sentences. */
  speakStream() {
    this.cancelSpeech(); streamBuf = '';
    return {
      push: (fullText) => {
        const fresh = fullText.slice(streamBuf.length); streamBuf = fullText;
        pending += fresh;
        const parts = pending.split(/(?<=[.!?])\s+|\n+/);
        pending = parts.pop();
        for (const p of parts) { const t = stripMarkdown(p).trim(); if (t) queue.push(t); }
        pump();
      },
      end: () => { const t = stripMarkdown(pending).trim(); pending = ''; if (t) queue.push(t); pump(); },
    };
  },
  cancelSpeech() { queue = []; pending = ''; try { synth?.cancel(); } catch { /* */ } speaking = false; },

  /** Wake-word listener (experimental placeholder using continuous recognition). */
  startWakeWord(onWake) {
    if (!SR) return false;
    this.stopWakeWord();
    const phrase = (store.get('settings.voice.wakePhrase') || 'jarvis').toLowerCase();
    wakeRec = new SR(); wakeRec.continuous = true; wakeRec.interimResults = false; wakeRec.lang = store.get('settings.voice.lang') || 'en-US';
    wakeRec.onresult = (e) => {
      const t = e.results[e.results.length - 1][0].transcript.toLowerCase();
      const idx = t.indexOf(phrase);
      if (idx >= 0) onWake(t.slice(idx + phrase.length).trim());
    };
    wakeRec.onend = () => { if (wakeRec) try { wakeRec.start(); } catch { /* */ } };
    try { wakeRec.start(); return true; } catch { return false; }
  },
  stopWakeWord() { const r = wakeRec; wakeRec = null; try { r?.stop(); } catch { /* */ } },
};
let pending = '';

function pump() {
  if (!synth || speaking || !queue.length) return;
  const text = queue.shift();
  const u = new SpeechSynthesisUtterance(text);
  const p = params(); u.rate = p.rate; u.pitch = p.pitch; u.lang = p.lang;
  const v = voice.voices().find((x) => x.voiceURI === p.voiceURI); if (v) u.voice = v;
  u.onstart = () => { speaking = true; state('speaking'); };
  u.onend = u.onerror = () => { speaking = false; if (queue.length) pump(); else state('idle'); };
  speaking = true;
  try { synth.speak(u); } catch { speaking = false; }
}

// Some browsers load voices asynchronously
try { synth?.addEventListener?.('voiceschanged', () => bus.emit('voice:voices')); } catch { /* */ }
