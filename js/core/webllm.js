/**
 * Built-in AI — a real language model that runs inside your browser (WebLLM + WebGPU).
 * No API key, no Ollama, no account: the model downloads once (≈1–2 GB, cached by the
 * browser), then works even offline. With Live web on, JARVIS-X searches the internet and
 * hands the results to the model, so it can answer current questions with sources.
 * Needs a browser with WebGPU (Chrome or Edge on a computer; recent Chrome on Android).
 * @module core/webllm
 */
import { store } from './store.js';

const CDN = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';
/** Small instruction models that run on ordinary laptops. Only those in WebLLM's list are offered. */
export const MODELS = [
  ['Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Qwen 2.5 · 1.5B — recommended: quick, multilingual (incl. Hindi)', '≈1.6 GB'],
  ['Llama-3.2-1B-Instruct-q4f16_1-MLC', 'Llama 3.2 · 1B — fastest, for older computers', '≈0.9 GB'],
  ['Llama-3.2-3B-Instruct-q4f16_1-MLC', 'Llama 3.2 · 3B — smarter, needs a better graphics chip', '≈2.3 GB'],
  ['gemma-2-2b-it-q4f16_1-MLC', 'Gemma 2 · 2B — good writing', '≈1.9 GB'],
  ['Phi-3.5-mini-instruct-q4f16_1-MLC', 'Phi 3.5 mini · 3.8B — strong at maths and code', '≈3.7 GB'],
];

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

/** Streamed chat. Returns the full text. */
export async function chat({ system, messages, onText, signal, onProgress }) {
  const e = await load(chosenModel(), onProgress);
  const onAbort = () => { try { e.interruptGenerate(); } catch { /* */ } };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const stream = await e.chat.completions.create({ stream: true, temperature: store.get('settings.ai.temperature') ?? 0.7, max_tokens: 1024,
      messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: String(m.content) }))] });
    let out = '';
    for await (const c of stream) { out += c.choices?.[0]?.delta?.content || ''; onText?.(out); }
    if (signal?.aborted) throw Object.assign(new Error('Stopped'), { name: 'AbortError', partial: out });
    return out;
  } finally { signal?.removeEventListener('abort', onAbort); }
}
