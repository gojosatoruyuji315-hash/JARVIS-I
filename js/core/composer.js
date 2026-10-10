/**
 * AI Composer — writes original songs that the built-in synth engine plays live.
 *
 * The AI (Claude inside the viewer, the server AI, your own key — or the offline engine)
 * chooses a title, tempo, key, chord progression and a melody; this module arranges them
 * into bass, chords/pad, arpeggio, lead and drum parts for a style. No samples, no network:
 * works everywhere, including inside Claude, and can be exported as a WAV file.
 * @module core/composer
 */
export const STYLES = {
  lofi: { label: 'Lo-fi', bpm: [70, 88], drums: 'lofi', lead: 'triangle', pad: 'sine', arp: false, swing: true },
  ambient: { label: 'Ambient', bpm: [60, 76], drums: null, lead: 'sine', pad: 'sawtooth', arp: true, swing: false },
  synthwave: { label: 'Synthwave', bpm: [96, 112], drums: 'four', lead: 'sawtooth', pad: 'sawtooth', arp: true, swing: false },
  dance: { label: 'Dance', bpm: [118, 128], drums: 'four', lead: 'square', pad: 'sawtooth', arp: true, swing: false },
  cinematic: { label: 'Cinematic', bpm: [72, 92], drums: 'epic', lead: 'triangle', pad: 'sawtooth', arp: true, swing: false },
  chiptune: { label: 'Chiptune', bpm: [130, 150], drums: 'chip', lead: 'square', pad: 'square', arp: true, swing: false },
  piano: { label: 'Soft piano', bpm: [66, 84], drums: null, lead: 'triangle', pad: 'triangle', arp: true, swing: false },
  indian: { label: 'Indian classical-inspired', bpm: [76, 96], drums: 'tabla', lead: 'triangle', pad: 'sawtooth', arp: false, swing: false, drone: true },
};
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], pentatonic: [0, 2, 4, 7, 9, 12, 14], bhairav: [0, 1, 4, 5, 7, 8, 11], yaman: [0, 2, 4, 6, 7, 9, 11] };
const _ = null;

/** Scale degree (1-based, can exceed 7 or be negative) → MIDI note. */
function deg(root, scale, d, octave = 0) {
  const s = SCALES[scale] || SCALES.minor; const i = d - 1;
  const o = Math.floor(i / s.length); const k = ((i % s.length) + s.length) % s.length;
  return root + s[k] + 12 * (o + octave);
}
function rng(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
const pick = (r, a) => a[Math.floor(r() * a.length)];

/** Turn a song plan into a playable track for core/audio.js. */
export function arrange(plan) {
  const style = STYLES[plan.style] || STYLES.lofi;
  const r = rng([...(plan.title || 'song')].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const root = Math.max(45, Math.min(64, plan.root ?? 57)); const scale = SCALES[plan.scale] ? plan.scale : 'minor';
  const chords = (plan.chords?.length ? plan.chords : [1, 6, 3, 7]).slice(0, 8).map((c) => Math.max(1, Math.min(7, Math.round(c))));
  while (chords.length < 4) chords.push(chords[chords.length % chords.length]);
  const bars = chords.length; const steps = bars * 16;
  const pat = () => new Array(steps).fill(_);
  const voices = [];

  // Bass: chord roots, rhythm by style
  const bass = pat();
  chords.forEach((c, b) => { const n = deg(root, scale, c, -2); for (const s of style.drums === 'four' || style.drums === 'chip' ? [0, 4, 8, 12] : style.drums ? [0, 6, 10] : [0]) bass[b * 16 + s] = n; });
  voices.push({ wave: style.drums === 'chip' ? 'square' : 'sine', gain: 0.2, dec: style.drums ? 0.45 : 1.8, pat: bass, lp: 700 });

  // Pad: three chord tones, sustained
  for (const [k, off] of [[0, 0], [1, 2], [2, 4]]) {
    const p = pat(); chords.forEach((c, b) => { p[b * 16] = deg(root, scale, c + off, 0); if (style.drums === 'four') p[b * 16 + 8] = deg(root, scale, c + off, 0); });
    voices.push({ wave: style.pad, gain: style.pad === 'sawtooth' ? 0.022 : 0.05, dec: style.drums === 'four' ? 1.2 : 2.6, att: 0.25, pat: p, lp: 1500, detune: (k - 1) * 6 });
  }
  if (style.drone) { const p = pat(); for (let b = 0; b < bars; b++) p[b * 16] = root - 12; voices.push({ wave: 'sawtooth', gain: 0.03, dec: 3.4, att: 0.5, pat: p, lp: 600 }); }

  // Arpeggio
  if (style.arp) {
    const p = pat(); const shape = [0, 2, 4, 7, 4, 2];
    const stepSize = style.bpm[0] > 110 ? 1 : 2;
    chords.forEach((c, b) => { for (let s = 0, k = 0; s < 16; s += stepSize, k++) p[b * 16 + s] = deg(root, scale, c + shape[k % shape.length], 1); });
    voices.push({ wave: style.drums === 'chip' ? 'square' : 'triangle', gain: 0.045, dec: 0.22, pat: p, lp: 2600 });
  }

  // Lead melody: from the plan (scale degrees, 0/null = rest) or generated
  const mel = pat();
  const given = Array.isArray(plan.melody) ? plan.melody : null;
  for (let i = 0; i < steps / 2; i++) {
    let d = given ? given[i % given.length] : (r() < 0.35 ? null : chords[Math.floor(i / 8)] + pick(r, [0, 2, 4, 4, 2, 0, 1, -1, 7]));
    if (d === 0 || d == null || Number.isNaN(+d)) continue;
    mel[i * 2] = deg(root, scale, Math.round(+d), 1);
  }
  voices.push({ wave: style.lead, gain: style.lead === 'square' || style.lead === 'sawtooth' ? 0.04 : 0.09, dec: style.drums === 'four' ? 0.3 : 0.6, pat: mel, lp: style.lead === 'sawtooth' ? 2200 : undefined });

  // Drums
  const kick = pat(), snare = pat(), hat = pat();
  for (let b = 0; b < bars; b++) {
    const o = b * 16;
    if (style.drums === 'four' || style.drums === 'chip') { [0, 4, 8, 12].forEach((s) => (kick[o + s] = 1)); [4, 12].forEach((s) => (snare[o + s] = 1)); for (let s = 2; s < 16; s += 4) hat[o + s] = 1; }
    if (style.drums === 'lofi') { [0, 7, 10].forEach((s) => (kick[o + s] = 1)); [4, 12].forEach((s) => (snare[o + s] = 1)); for (let s = 0; s < 16; s += 2) hat[o + s] = 1; }
    if (style.drums === 'epic') { [0, 3, 8, 11].forEach((s) => (kick[o + s] = 1)); snare[o + 12] = 1; }
    if (style.drums === 'tabla') { [0, 6, 10].forEach((s) => (kick[o + s] = 1)); [3, 8, 13, 15].forEach((s) => (hat[o + s] = 1)); }
  }
  if (style.drums) {
    voices.push({ wave: 'kick', gain: style.drums === 'lofi' ? 0.5 : 0.7, dec: 0.3, pat: kick });
    if (snare.some(Boolean)) voices.push({ wave: 'snare', gain: style.drums === 'lofi' ? 0.08 : 0.12, dec: 0.15, pat: snare });
    voices.push({ wave: 'noise', gain: style.drums === 'lofi' ? 0.018 : 0.03, dec: 0.04, pat: hat });
  }

  const bpm = Math.max(50, Math.min(170, Math.round(plan.bpm || (style.bpm[0] + style.bpm[1]) / 2)));
  return {
    id: `cmp-${Date.now().toString(36)}${Math.floor(r() * 1e4)}`, kind: 'synth', source: 'composed', composed: true,
    title: String(plan.title || 'Untitled').slice(0, 60), artist: `AI Composer · ${style.label}`, album: plan.mood || '',
    bpm, hue: Math.floor(r() * 360), voices, plan: { ...plan, style: plan.style, root, scale, chords },
  };
}

/** Ask the AI for a song plan; falls back to an on-device plan if no AI is reachable. */
export async function compose(description, { style = 'auto', ask } = {}) {
  const styleId = style !== 'auto' ? style : guessStyle(description);
  let plan = null;
  const { activeProviderId } = await import('./ai.js');
  if (ask && activeProviderId() !== 'local') {
    try {
      const text = await ask(`Compose an original instrumental song for this request: "${description}".\nStyle: ${STYLES[styleId].label}.\nReturn ONLY JSON:\n{"title": string (2-5 words, original), "mood": string (2-4 words), "bpm": number between ${STYLES[styleId].bpm[0]} and ${STYLES[styleId].bpm[1]}, "root": MIDI note between 50 and 62, "scale": one of ${Object.keys(SCALES).join('|')}, "chords": array of 4 or 8 scale degrees 1-7 (one chord per bar), "melody": array of exactly ${8 * 4} scale degrees (1-9, or 0 for a rest; eighth notes, 8 per bar) forming a memorable, singable motif that repeats with variation}`);
      plan = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch { plan = null; }
  }
  if (!plan) {
    const r = rng(Date.now());
    const sad = /sad|rain|night|lonely|melanch|dark|calm|sleep/i.test(description);
    plan = { title: titleFrom(description, r), mood: sad ? 'Reflective' : 'Bright', bpm: STYLES[styleId].bpm[0] + Math.floor(r() * (STYLES[styleId].bpm[1] - STYLES[styleId].bpm[0])), root: 50 + Math.floor(r() * 12), scale: styleId === 'indian' ? pick(r, ['yaman', 'bhairav']) : sad ? pick(r, ['minor', 'dorian']) : pick(r, ['major', 'pentatonic']), chords: pick(r, sad ? [[1, 6, 3, 7], [1, 4, 6, 5], [6, 4, 1, 5]] : [[1, 5, 6, 4], [1, 4, 5, 4], [4, 1, 5, 6]]) };
  }
  plan.style = styleId;
  return arrange(plan);
}

function guessStyle(t) {
  t = t.toLowerCase();
  if (/lo-?fi|study|chill|coffee/.test(t)) return 'lofi';
  if (/ambient|sleep|meditat|space|calm/.test(t)) return 'ambient';
  if (/80s|synthwave|retro|neon|drive/.test(t)) return 'synthwave';
  if (/dance|edm|club|party|workout|gym/.test(t)) return 'dance';
  if (/epic|movie|cinema|trailer|battle|hero/.test(t)) return 'cinematic';
  if (/8-?bit|chip|game|arcade|pixel/.test(t)) return 'chiptune';
  if (/piano|soft|gentle/.test(t)) return 'piano';
  if (/raga|indian|sitar|tabla|bollywood|classical indian/.test(t)) return 'indian';
  return 'lofi';
}
function titleFrom(t, r) {
  const words = t.replace(/[^\w\s]/g, '').split(/\s+/).filter((w) => w.length > 3 && !/song|music|make|some|with|that|like|about|track/i.test(w));
  const base = words.slice(0, 2).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return base || pick(r, ['Quiet Orbit', 'Paper Lanterns', 'Night Signal', 'Glass Garden', 'Slow Comet']);
}
