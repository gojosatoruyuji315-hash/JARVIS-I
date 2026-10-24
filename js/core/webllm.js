/**
 * Built-in AI — a real language model that runs inside your browser (WebLLM + WebGPU).
 * No API key, no install, no account: the model downloads once (≈1–6 GB, cached by the
 * browser), then works even offline. With Live web on, JARVIS-X searches the internet and
 * hands the results to the model, so it can answer current questions with sources.
 * Needs a browser with WebGPU (Chrome or Edge on a computer; recent Chrome on Android).
 * @module core/webllm
 */
import { store } from './store.js';

const CDN = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';
/**
 * Downloadable models: [id, name, what it's good at, download size, group].
 * Only those in this WebLLM version's list are offered. Bigger = smarter but needs a stronger graphics chip.
 */
export const MODELS = [
  ['Qwen3.5-2B-q4f16_1-MLC', 'Qwen 3.5 · 2B', 'Recommended — newest, smart for its size, many languages incl. Hindi', '≈2.2 GB', 'everyday'],
  ['gemma-4-E2B-it-q4f16_1-MLC', 'Gemma 4 · E2B', 'Google\'s newest small model — natural writing', '≈3.4 GB', 'everyday'],
  ['Qwen3-1.7B-q4f16_1-MLC', 'Qwen 3 · 1.7B', 'Quick all-rounder that can think step by step', '≈2.0 GB', 'everyday'],
  ['Llama-3.2-3B-Instruct-q4f16_1-MLC', 'Llama 3.2 · 3B', 'Meta\'s friendly chat model', '≈2.3 GB', 'everyday'],
  ['Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC', 'Ministral 3 · 3B', 'Mistral\'s newest small model', '≈2.9 GB', 'everyday'],
  ['Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Qwen 2.5 · 1.5B', 'Light and reliable, multilingual', '≈1.6 GB', 'everyday'],
  ['gemma-2-2b-it-q4f16_1-MLC', 'Gemma 2 · 2B', 'Good writing', '≈1.9 GB', 'everyday'],
  ['SmolLM2-1.7B-Instruct-q4f16_1-MLC', 'SmolLM2 · 1.7B', 'Small and quick, English', '≈1.8 GB', 'everyday'],
  ['Qwen3.5-0.8B-q4f16_1-MLC', 'Qwen 3.5 · 0.8B', 'Tiny — for older laptops and phones', '≈1.6 GB', 'light'],
  ['gemma3-1b-it-q4f16_1-MLC', 'Gemma 3 · 1B', 'Smallest download, starts fastest', '≈0.7 GB', 'light'],
  ['Llama-3.2-1B-Instruct-q4f16_1-MLC', 'Llama 3.2 · 1B', 'Fast on almost any computer', '≈0.9 GB', 'light'],
  ['Qwen3.5-4B-q4f16_1-MLC', 'Qwen 3.5 · 4B', 'Noticeably smarter — good laptops', '≈3.9 GB', 'smart'],
  ['Qwen3-4B-q4f16_1-MLC', 'Qwen 3 · 4B', 'Strong reasoning for its size', '≈3.4 GB', 'smart'],
  ['Phi-4-mini-instruct-q4f16_1-MLC', 'Phi-4 mini · 3.8B', 'Microsoft — strong at maths and logic', '≈3.4 GB', 'smart'],
  ['Phi-3.5-mini-instruct-q4f16_1-MLC', 'Phi 3.5 mini · 3.8B', 'Microsoft — maths and code', '≈3.7 GB', 'smart'],
  ['Qwen3.5-9B-q4f16_1-MLC', 'Qwen 3.5 · 9B', 'Smartest here — needs a gaming-class graphics card', '≈6.4 GB', 'big'],
  ['Qwen3-8B-q4f16_1-MLC', 'Qwen 3 · 8B', 'Very capable, thinks step by step', '≈5.7 GB', 'big'],
  ['Llama-3.1-8B-Instruct-q4f16_1-MLC', 'Llama 3.1 · 8B', 'Meta\'s strong general model', '≈5.0 GB', 'big'],
  ['gemma-2-9b-it-q4f16_1-MLC', 'Gemma 2 · 9B', 'Excellent writing', '≈6.4 GB', 'big'],
  ['Qwen2.5-7B-Instruct-q4f16_1-MLC', 'Qwen 2.5 · 7B', 'Smart all-rounder, many languages', '≈5.1 GB', 'big'],
  ['Mistral-7B-Instruct-v0.3-q4f16_1-MLC', 'Mistral · 7B', 'Quick and capable', '≈4.6 GB', 'big'],
  ['Hermes-3-Llama-3.1-8B-q4f16_1-MLC', 'Hermes 3 · 8B', 'Creative, follows instructions closely', '≈4.9 GB', 'big'],
  ['Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', 'Qwen 2.5 Coder · 7B', 'Writes and explains code', '≈5.1 GB', 'special'],
  ['Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', 'Qwen 2.5 Coder · 1.5B', 'Small coding helper', '≈1.6 GB', 'special'],
  ['DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC', 'DeepSeek R1 · 7B', 'Reasons step by step before answering', '≈5.1 GB', 'special'],
  ['Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC', 'Qwen 2.5 Math · 1.5B', 'Maths homework and problem solving', '≈1.6 GB', 'special'],
];
export const GROUPS = [['everyday', 'Everyday'], ['light', 'Light — older computers & phones'], ['smart', 'Smarter — good laptops'], ['big', 'Biggest — strong graphics card'], ['special', 'Specialists — code, maths, reasoning']];

let lib = null, engine = null, loadedId = null, loading = null;
export const supported = () => !!navigator.gpu;
export const loadedModel = () => loadedId;
export const chosenModel = () => store.get('settings.ai.browserModel') || '';
async function getLib() { return (lib ||= await import(/* @vite-ignore */ CDN)); }

/** Models offered here, filtered against what this WebLLM version knows. */
export async function availableModels() {
  try { const l = await getLib(); const ids = new Set(l.prebuiltAppConfig.model_list.map((m) => m.model_id)); return MODELS.filter(([id]) => ids.has(id)); }
  catch { return MODELS; }
}
export async function isCached(id) { try { return await (await getLib()).hasModelInCache(id); } catch { return false; } }

/** Download (first time) and start a model. onProgress({ progress: 0..1, text }). */
export async function load(id = chosenModel(), onProgress) {
  if (!supported()) throw new Error('This browser has no WebGPU, so the built-in AI can\'t run here. Use Chrome or Edge on a computer.');
  if (!id) throw new Error('Choose a built-in AI model in Settings → AI first.');
  if (engine && loadedId === id) return engine;
  if (loading?.id === id) return loading.promise;
  const promise = (async () => {
    const l = await getLib();
    if (engine && loadedId !== id) { try { await engine.unload(); } catch { /* */ } engine = null; loadedId = null; }
    engine = await l.CreateMLCEngine(id, { initProgressCallback: (r) => onProgress?.({ progress: r.progress ?? 0, text: r.text || '' }) },
      { context_window_size: 8192 }); // room for live web results
    loadedId = id; store.set('settings.ai.browserReady', true);
    return engine;
  })();
  loading = { id, promise };
  try { return await promise; } finally { loading = null; }
}
export async function remove(id) {
  const l = await getLib();
  if (loadedId === id && engine) { try { await engine.unload(); } catch { /* */ } engine = null; loadedId = null; }
  await l.deleteModelAllInfoInCache(id);
}

/** Hide the step-by-step reasoning some models (Qwen 3, DeepSeek R1) write inside <think>…</think>. */
const stripThink = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');

/** Streamed chat. Returns the full text. */
export async function chat({ system, messages, onText, signal, onProgress }) {
  const e = await load(chosenModel(), onProgress);
  const onAbort = () => { try { e.interruptGenerate(); } catch { /* */ } };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const stream = await e.chat.completions.create({ stream: true, temperature: store.get('settings.ai.temperature') ?? 0.7, max_tokens: 1024,
      messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: String(m.content) }))] });
    let out = '';
    for await (const c of stream) {
      out += c.choices?.[0]?.delta?.content || '';
      const visible = stripThink(out);
      onText?.(visible || (/<think>/.test(out) ? '_Thinking…_' : ''));
    }
    out = stripThink(out);
    if (signal?.aborted) throw Object.assign(new Error('Stopped'), { name: 'AbortError', partial: out });
    return out;
  } finally { signal?.removeEventListener('abort', onAbort); }
}
