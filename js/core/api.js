/**
 * Client for the JARVIS-X server API. Same-origin, cookie session,
 * CSRF header on every request, JSON in/out, typed errors.
 * @module core/api
 */
export class ApiError extends Error {
  constructor(status, message, data = {}) { super(message); this.status = status; this.data = data; }
}

export async function api(path, { method = 'GET', body, signal, raw = false } = {}) {
  let res;
  try {
    res = await fetch(path.replace(/^\//, ''), {
      method, signal, credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-JX': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Can\'t reach the JARVIS-X server. Check your connection.');
  }
  if (raw) { if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error || res.statusText); return res; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data);
  return data;
}
api.get = (p, o) => api(p, o);
api.post = (p, body, o) => api(p, { ...o, method: 'POST', body: body ?? {} });
api.put = (p, body, o) => api(p, { ...o, method: 'PUT', body });
api.patch = (p, body, o) => api(p, { ...o, method: 'PATCH', body });
api.del = (p, o) => api(p, { ...o, method: 'DELETE' });

/** Parse a text/event-stream response of `data: {...}` lines. */
export async function* readSSE(res) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) { const t = l.trim(); if (t.startsWith('data:')) { try { yield JSON.parse(t.slice(5)); } catch { /* skip */ } } }
  }
}
