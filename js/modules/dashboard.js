/**
 * Home dashboard: holographic core + command bar + widget panels.
 * Widgets are small self-contained functions: (el) => cleanup?
 * Visibility is user-configurable (settings.widgets.hidden).
 * @module modules/dashboard
 */
import { h, clear, fmt, todayKey, uid, toast, modal, toggle } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { bus } from '../core/bus.js';
import { store } from '../core/store.js';
import { createHUD } from '../core/hud.js';
import { renderMarkdown } from '../core/markdown.js';
import { evaluate } from '../core/mathx.js';
import { timerService } from '../core/scheduler.js';
import { engine } from '../core/audio.js';
import { t } from '../core/i18n.js';
import { license } from '../core/license.js';
import { allowed } from '../core/gate.js';
import { platform } from '../core/platform.js';
import { api } from '../core/api.js';
let home_rebuild = null;

/* ------------------------------------------------------------ widget shell */
function widget(id, title, ic, ...body) {
  return h('section.widget.glass', { dataset: { widget: id }, 'aria-label': title }, h('div.w-head', icon(ic), h('h3.w-title', title)), ...body);
}

/* ------------------------------------------------------------------ CLOCK */
function wClock() {
  const big = h('div.w-big'); const date = h('div.w-sub'); const zones = h('div.stack', { style: 'gap:4px;margin-top:10px' });
  const cities = [['UTC', 'UTC'], ['New York', 'America/New_York'], ['London', 'Europe/London'], ['Tokyo', 'Asia/Tokyo']];
  const upd = () => {
    const d = new Date();
    big.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    date.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    clear(zones).append(...cities.map(([n, tz]) => h('div.stat-row', h('span.dim', n), h('b', d.toLocaleTimeString([], { timeZone: tz, hour: '2-digit', minute: '2-digit' })))));
  };
  upd(); const off = bus.on('tick', upd);
  const el = widget('clock', 'Chronometer', 'clock', big, date, zones); el.cleanup = off; return el;
}

/* ---------------------------------------------------------------- WEATHER */
const WMO = { 0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'cloud'], 3: ['Overcast', 'cloud'], 45: ['Fog', 'cloud'], 48: ['Rime fog', 'cloud'], 51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy drizzle', 'rain'], 61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'], 71: ['Light snow', 'cloud'], 73: ['Snow', 'cloud'], 75: ['Heavy snow', 'cloud'], 80: ['Showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Violent showers', 'rain'], 95: ['Thunderstorm', 'rain'], 96: ['Thunderstorm, hail', 'rain'], 99: ['Thunderstorm, hail', 'rain'] };
let weatherCache = null;
async function fetchWeather(loc) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`;
  const { getJSON } = await import('../core/net.js'); return getJSON(url);
}
const unavailable = (msg) => h('div.w-note', { style: 'padding:6px 0' }, msg);
function wWeather() {
  const body = h('div.stack');
  const el = widget('weather', 'Weather', 'cloud', body);
  const render = (data, loc) => {
    const c = data.current; const [desc, ic] = WMO[c.weather_code] || ['—', 'cloud'];
    const imperial = store.get('settings.units') === 'imperial';
    const T = (v) => `${Math.round(imperial ? v * 9 / 5 + 32 : v)}°`;
    clear(body).append(
      h('div.row', h('div', { style: 'color:var(--accent)' }, icon(ic, { size: 40 })), h('div', h('div.w-big', T(c.temperature_2m)), h('div.w-sub', `${desc} · feels ${T(c.apparent_temperature)}`))),
      h('div.stat-row', h('span.dim', 'Humidity'), h('b', `${c.relative_humidity_2m}%`)),
      h('div.stat-row', h('span.dim', 'Wind'), h('b', imperial ? `${Math.round(c.wind_speed_10m / 1.609)} mph` : `${Math.round(c.wind_speed_10m)} km/h`)),
      h('div.grid3', { style: 'grid-template-columns:repeat(3,1fr);gap:6px' }, data.daily.time.slice(1, 4).map((d, i) => h('div', { style: 'text-align:center' }, h('div.xs.muted', fmt.date(d + 'T12:00', { weekday: 'short' })), h('div', { style: 'color:var(--accent)' }, icon((WMO[data.daily.weather_code[i + 1]] || [])[1] || 'cloud', { size: 18 })), h('div.xs.mono', `${T(data.daily.temperature_2m_max[i + 1])} / ${T(data.daily.temperature_2m_min[i + 1])}`)))),
      h('div.row', h('span.w-note.grow', `${loc.name} · Open-Meteo · ${fmt.time(weatherCache?.ts || Date.now())}`), h('button.btn.ghost.sm', { onclick: setLocation }, icon('pin'), 'Change')),
    );
  };
  const load = async () => {
    if (!platform.hasNetwork) return clear(body).append(unavailable('Live weather needs internet — open the full version with the “Full internet” button at the top.'));
    const loc = store.get('settings.location');
    if (!loc) return clear(body).append(h('div.w-sub', 'Set your location to see live weather.'), h('button.btn.sm', { style: 'margin-top:8px', onclick: setLocation }, icon('pin'), 'Set location'));
    if (weatherCache && weatherCache.key === `${loc.lat},${loc.lon}` && Date.now() - weatherCache.ts < 18e5) return render(weatherCache.data, loc);
    clear(body).append(h('div.w-note', 'Fetching forecast…'));
    try { const data = await fetchWeather(loc); weatherCache = { key: `${loc.lat},${loc.lon}`, ts: Date.now(), data }; render(data, loc); }
    catch { clear(body).append(unavailable('Weather is unreachable right now.'), h('button.btn.ghost.sm', { onclick: load }, icon('refresh'), 'Retry')); }
  };
  async function setLocation() {
    const inp = h('input.input', { placeholder: 'City name, e.g. Bengaluru' });
    const status = h('div.small.dim');
    const m = modal({ title: 'Set your location', titleIcon: 'pin', body: h('div.stack', h('button.btn', { onclick: () => {
      status.textContent = 'Requesting location…';
      navigator.geolocation?.getCurrentPosition((p) => { store.set('settings.location', { lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), name: 'Current location' }); m.close(); load(); },
        () => { status.textContent = 'Location access was blocked. Search for your city instead.'; }, { timeout: 8000 });
    } }, icon('pin'), 'Use my device location'), h('div.small.muted', 'or search'), inp, status), actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Search', kind: 'primary', onClick: async () => {
        status.textContent = 'Searching…';
        try {
          const { getJSON } = await import('../core/net.js'); const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(inp.value)}&count=1`);
          const g = j.results?.[0]; if (!g) { status.textContent = 'No match found.'; return; }
          store.set('settings.location', { lat: g.latitude, lon: g.longitude, name: `${g.name}, ${g.country_code}` }); m.close(); load();
        } catch { status.textContent = 'Location search is unreachable right now.'; }
      } },
    ] });
  }
  load();
  const iv = setInterval(() => { weatherCache = null; load(); }, 30 * 60e3);
  el.cleanup = () => clearInterval(iv);
  return el;
}

/* ----------------------------------------------------------------- SYSTEM */
function wSystem() {
  const rows = h('div.stack', { style: 'gap:10px' });
  const el = widget('system', 'System Diagnostics', 'cpu', rows);
  let battery = null; let lag = 0; let lastT = performance.now();
  navigator.getBattery?.().then((b) => { battery = b; }).catch(() => {});
  // CPU estimate: event-loop lag relative to a 250ms interval
  const probe = setInterval(() => { const n = performance.now(); lag = lag * 0.7 + Math.max(0, n - lastT - 250) * 0.3; lastT = n; }, 250);
  const meter = (label, pct, value, note, inverse = false) => h('div', h('div.stat-row', h('span.dim', label), h('b', value)), h('div.meter', { class: (inverse ? 100 - pct : pct) > 85 ? 'bad' : (inverse ? 100 - pct : pct) > 65 ? 'warn' : '' }, h('i', { style: `width:${Math.max(2, Math.min(100, pct))}%` })), note ? h('div.w-note', note) : null);
  const upd = () => {
    const cpu = Math.min(100, Math.round((lag / 60) * 100 + 4));
    const mem = performance.memory;
    const conn = navigator.connection;
    clear(rows).append(
      meter('CPU load (est.)', cpu, `${cpu}%`, `${navigator.hardwareConcurrency || '?'} logical cores`),
      mem ? meter('JS memory', (mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100, fmt.bytes(mem.usedJSHeapSize), `of ${fmt.bytes(mem.jsHeapSizeLimit)} heap`) : meter('Device memory', 50, navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'n/a', 'Detailed memory stats need a Chromium browser'),
      battery ? meter('Battery', battery.level * 100, `${Math.round(battery.level * 100)}%`, battery.charging ? 'Charging' : 'On battery', true) : meter('Battery', 0, 'n/a', 'Battery API not available in this browser'),
      h('div.stat-row', h('span.dim', 'Network'), h('b', navigator.onLine ? `${conn?.effectiveType?.toUpperCase() || 'Online'}${conn?.downlink ? ` · ${conn.downlink} Mb/s` : ''}${conn?.rtt ? ` · ${conn.rtt} ms` : ''}` : 'Offline')),
    );
  };
  upd(); const iv = setInterval(upd, 2000);
  el.cleanup = () => { clearInterval(iv); clearInterval(probe); };
  return el;
}

/* --------------------------------------------------------------- LOCATION */
function wLocation() {
  const loc = store.get('settings.location');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return widget('location', 'Location', 'pin',
    h('div.w-sub', loc ? loc.name : 'Not set'),
    h('div.stat-row', h('span.dim', 'Time zone'), h('b', tz)),
    loc ? h('div.stat-row', h('span.dim', 'Coordinates'), h('b', `${loc.lat}, ${loc.lon}`)) : null,
    h('div.row', { style: 'margin-top:8px' }, h('a.btn.sm', { href: loc ? `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=12/${loc.lat}/${loc.lon}` : 'https://www.openstreetmap.org', target: '_blank', rel: 'noopener' }, icon('map'), 'Open map')));
}

/* --------------------------------------------------------------- CALENDAR */
function wCalendar() {
  const d = new Date(); const y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1).getDay(); const days = new Date(y, m + 1, 0).getDate();
  const evDays = new Set(store.get('events').map((e) => e.date));
  const grid = h('div.cal-grid.cal-mini', ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => h('div.dow', x)));
  for (let i = 0; i < first; i++) grid.append(h('div'));
  for (let i = 1; i <= days; i++) {
    const key = todayKey(new Date(y, m, i));
    grid.append(h('button.cal-day', { class: `${i === d.getDate() ? 'today' : ''} ${evDays.has(key) ? 'has' : ''}`, 'aria-label': key, onclick: () => bus.emit('open', { id: 'productivity', params: { tab: 'calendar', date: key } }) }, String(i)));
  }
  const upcoming = store.get('events').filter((e) => e.date >= todayKey()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 3);
  return widget('calendar', d.toLocaleDateString([], { month: 'long', year: 'numeric' }), 'calendar', grid,
    h('div.list', { style: 'margin-top:10px' }, upcoming.length ? upcoming.map((e) => h('div.item', h('span.mono.xs.dim', `${e.date.slice(5)} ${e.time}`), h('span.grow.small', e.title))) : h('div.w-note', 'No upcoming events')));
}

/* ------------------------------------------------------------------ TASKS */
function wTasks() {
  const list = h('div.list');
  const inp = h('input.input', { placeholder: 'Add a task and press Enter', 'aria-label': 'New task' });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) { store.unshift('tasks', { id: uid('t'), title: inp.value.trim(), done: false, priority: 'med', due: todayKey(), list: 'Personal', created: Date.now() }); inp.value = ''; } });
  const render = () => {
    const open = store.get('tasks').filter((x) => !x.done);
    clear(list).append(open.length ? open.slice(0, 6).map((x) => h('label.item', h('input', { type: 'checkbox', onchange: () => store.patchById('tasks', x.id, { done: true, doneAt: Date.now() }) }), h('span.grow.small', x.title), x.priority === 'hi' ? h('span.pill.hi', 'high') : null)) : h('div.w-note', 'All clear.'));
  };
  render(); const off = store.on('tasks', render);
  const el = widget('tasks', 'Tasks', 'tasks', inp, h('div', { style: 'height:8px' }), list, h('button.btn.ghost.sm', { style: 'margin-top:6px', onclick: () => bus.emit('open', { id: 'productivity', params: { tab: 'tasks' } }) }, 'Open task manager'));
  el.cleanup = off; return el;
}

/* ------------------------------------------------------------------ NOTES */
function wNotes() {
  const ta = h('textarea.textarea', { placeholder: 'Scratchpad — saved automatically', style: 'min-height:90px', 'aria-label': 'Scratchpad' });
  ta.value = store.get('profile.scratch') || '';
  ta.addEventListener('input', () => store.set('profile.scratch', ta.value));
  const recent = store.get('notes').slice().sort((a, b) => b.updated - a.updated).slice(0, 3);
  return widget('notes', 'Notes', 'note', ta,
    h('div.list', { style: 'margin-top:8px' }, recent.map((n) => h('button.item', { style: 'cursor:pointer;color:var(--fg);text-align:left', onclick: () => bus.emit('open', { id: 'productivity', params: { tab: 'notes', id: n.id } }) }, icon('note', { size: 14 }), h('span.grow.small', n.title), h('span.xs.muted', fmt.rel(n.updated))))));
}

/* ----------------------------------------------------- STOPWATCH + TIMERS */
function wTimers() {
  let sw = { start: 0, acc: 0, running: false, laps: [] };
  const swDisp = h('div.w-big', '00:00.0');
  const laps = h('div.stack', { style: 'gap:2px;max-height:80px;overflow:auto' });
  const swBtn = h('button.btn.sm', icon('play'), 'Start');
  const swTime = () => sw.acc + (sw.running ? Date.now() - sw.start : 0);
  const fmtSw = (ms) => `${fmt.dur(ms)}.${Math.floor((ms % 1000) / 100)}`;
  swBtn.onclick = () => { if (sw.running) { sw.acc = swTime(); sw.running = false; } else { sw.start = Date.now(); sw.running = true; } swBtn.replaceChildren(icon(sw.running ? 'pause' : 'play'), sw.running ? 'Pause' : 'Start'); };
  const lap = h('button.btn.sm', { onclick: () => { if (!sw.running) return; sw.laps.unshift(swTime()); clear(laps).append(sw.laps.map((l, i) => h('div.stat-row.xs', h('span.dim', `Lap ${sw.laps.length - i}`), h('b', fmtSw(l))))); } }, 'Lap');
  const reset = h('button.btn.ghost.sm', { onclick: () => { sw = { start: 0, acc: 0, running: false, laps: [] }; clear(laps); swBtn.replaceChildren(icon('play'), 'Start'); } }, 'Reset');
  const tlist = h('div.list');
  const renderTimers = () => {
    const ts = timerService.list();
    clear(tlist).append(ts.length ? ts.map((x) => h('div.item', h('span.grow.small', x.label), h('b.mono', fmt.dur(timerService.remaining(x))),
      h('button.btn.ghost.icon.sm', { 'aria-label': x.paused ? 'Resume' : 'Pause', onclick: () => (x.paused ? timerService.resume(x.id) : timerService.pause(x.id)) }, icon(x.paused ? 'play' : 'pause')),
      h('button.btn.ghost.icon.sm', { 'aria-label': 'Cancel', onclick: () => timerService.cancel(x.id) }, icon('x')))) : h('div.w-note', 'No timers running'));
  };
  const custom = h('input.input', { type: 'number', min: 1, placeholder: 'min', style: 'width:70px', 'aria-label': 'Minutes' });
  const offs = [bus.on('tick', () => { swDisp.textContent = fmtSw(swTime()); renderTimers(); }), bus.on('timers:change', renderTimers)];
  const raf = setInterval(() => { if (sw.running) swDisp.textContent = fmtSw(swTime()); }, 100);
  renderTimers();
  const el = widget('timers', 'Stopwatch & Timers', 'timer', swDisp, h('div.row', swBtn, lap, reset), laps,
    h('div.section-title', { style: 'margin-top:10px' }, 'Timers'),
    h('div.row', [1, 5, 10, 25].map((m) => h('button.btn.sm', { onclick: () => timerService.start(m * 6e4, `${m} min timer`) }, `${m}m`)), custom, h('button.btn.sm.icon', { 'aria-label': 'Start custom timer', onclick: () => { const v = +custom.value; if (v > 0) { timerService.start(v * 6e4, `${v} min timer`); custom.value = ''; } } }, icon('plus'))),
    h('div', { style: 'height:6px' }), tlist);
  el.cleanup = () => { offs.forEach((o) => o()); clearInterval(raf); };
  return el;
}

/* ------------------------------------------------------------------ MUSIC */
function wMusic() {
  const title = h('div.small', { style: 'font-weight:600' }); const artist = h('div.xs.muted');
  const play = h('button.btn.icon.round', { 'aria-label': 'Play or pause', onclick: () => engine.toggle() });
  const cv = h('canvas', { width: 300, height: 50, style: 'width:100%;height:50px;display:block;margin-top:8px' });
  const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: store.get('music.volume'), 'aria-label': 'Volume', oninput: (e) => engine.setVolume(+e.target.value) });
  const upd = (s = engine.state()) => { title.textContent = s.track?.title || '—'; artist.textContent = s.track?.artist || ''; play.replaceChildren(icon(s.playing ? 'pause' : 'play')); };
  upd();
  let raf; const c2 = cv.getContext('2d'); let data;
  const draw = () => {
    raf = requestAnimationFrame(draw);
    if (!engine.state().playing) { c2.clearRect(0, 0, cv.width, cv.height); return; }
    const an = engine.analyser; data ||= new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(data);
    c2.clearRect(0, 0, cv.width, cv.height);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    c2.fillStyle = accent; const n = 48; const w = cv.width / n;
    for (let i = 0; i < n; i++) { const v = data[i] / 255; c2.fillRect(i * w + 1, cv.height - v * cv.height, w - 2, v * cv.height); }
  };
  draw();
  const off = bus.on('music:state', upd);
  const el = widget('music', 'Music', 'music', h('div.row', play, h('div.grow', title, artist), h('button.btn.ghost.icon', { 'aria-label': 'Previous', onclick: () => engine.prev() }, icon('prev')), h('button.btn.ghost.icon', { 'aria-label': 'Next', onclick: () => engine.next() }, icon('next'))), cv,
    h('div.row', { style: 'margin-top:6px' }, icon('volume', { size: 14 }), h('div.grow', vol), h('button.btn.ghost.sm', { onclick: () => bus.emit('open', { id: 'music' }) }, 'Player')));
  el.cleanup = () => { off(); cancelAnimationFrame(raf); };
  return el;
}

/* ------------------------------------------------------------- CALCULATOR */
function wCalc() {
  const disp = h('input.input.mono', { 'aria-label': 'Expression', style: 'font-size:18px;text-align:right' });
  const res = h('div.w-note', { style: 'text-align:right;min-height:16px' });
  const calc = () => { try { const v = evaluate(disp.value); res.textContent = Number.isFinite(v) ? `= ${+v.toPrecision(12)}` : ''; return v; } catch { res.textContent = ''; } };
  disp.addEventListener('input', calc);
  disp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = calc(); if (v != null && Number.isFinite(v)) { disp.value = String(+v.toPrecision(12)); res.textContent = ''; } } });
  const keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '(', '+', 'C', ')', '^', '='];
  const pad = h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:6px' }, keys.map((k) => h('button.btn.sm', { class: k === '=' ? 'primary' : '', onclick: () => {
    if (k === 'C') disp.value = ''; else if (k === '=') disp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); else disp.value += k; calc();
  } }, k)));
  return widget('calculator', 'Calculator', 'calc', disp, res, pad, h('div.w-note', 'Supports sqrt(), sin(), log(), pi, ^, %'));
}

/* ------------------------------------------------------------------- NEWS */
function wNews() {
  const list = h('div.list'); const topic = store.get('settings.newsTopic') || '';
  const el = widget('news', topic ? `News · ${topic}` : 'Top stories', 'news', list);
  const load = async () => {
    if (!platform.isServer) return clear(list).append(unavailable(platform.isHost ? 'Live news needs the JARVIS-X server (the Claude viewer has no internet access).' : 'Live news is provided by the JARVIS-X server. Run `npm start` to enable it.'));
    try {
      const { items } = await api.get(`/api/data/news?q=${encodeURIComponent(topic)}`);
      clear(list).append(items.slice(0, 6).map((n) => h('a.item', { href: n.link, target: '_blank', rel: 'noopener', style: 'text-decoration:none;color:var(--fg)' }, h('span.grow.small', n.title.replace(/ - [^-]+$/, '')), h('span.xs.muted', n.source || ''))),
        h('div.row', h('span.w-note.grow', 'Google News'), h('button.btn.ghost.sm', { onclick: async () => { const { promptDialog } = await import('../core/dom.js'); const t = await promptDialog('News topic', { value: topic, placeholder: 'e.g. AI, cricket, startups — empty for top stories' }); if (t !== null) { store.set('settings.newsTopic', t); home_rebuild?.(); } } }, 'Topic')));
    } catch (e) { clear(list).append(unavailable(`News unavailable: ${e.message}`)); }
  };
  load(); const iv = setInterval(load, 15 * 60e3); el.cleanup = () => clearInterval(iv);
  return el;
}

/* ----------------------------------------------------------------- STOCKS */
function wStocks() {
  const list = h('div.list');
  const el = widget('stocks', 'Markets', 'trend', list);
  const spark = (hist, up) => { if (!hist?.length) return h('span'); const min = Math.min(...hist), max = Math.max(...hist); const pts = hist.map((v, i) => `${(i / Math.max(1, hist.length - 1)) * 80},${22 - ((v - min) / (max - min || 1)) * 20}`).join(' '); return h('span', { html: `<svg width="80" height="24" viewBox="0 0 80 24" aria-hidden="true"><polyline fill="none" stroke="${up ? 'var(--ok)' : 'var(--danger)'}" stroke-width="1.5" points="${pts}"/></svg>` }); };
  const load = async () => {
    if (!platform.isServer) return clear(list).append(unavailable('Live quotes are provided by the JARVIS-X server.'));
    try {
      const { quotes, source } = await api.get(`/api/data/quotes?symbols=${encodeURIComponent(store.get('settings.watchlist').join(','))}`);
      clear(list).append(quotes.map((q) => q.error ? h('div.item', h('b.mono.small', q.symbol), h('span.grow.xs.muted', q.error)) : h('div.item', { title: q.name },
        h('b.mono.small', { style: 'width:72px;overflow:hidden;text-overflow:ellipsis' }, q.symbol.replace(/\.(NS|BO)$/, '')), spark(q.spark, q.change >= 0), h('span.grow'),
        h('span.mono.small', q.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })), h('span.mono.xs', { style: `color:var(${q.change >= 0 ? '--ok' : '--danger'});width:58px;text-align:right` }, `${q.change >= 0 ? '+' : ''}${q.changePct?.toFixed(2)}%`))),
        h('div.row', h('span.w-note.grow', source), h('button.btn.ghost.sm', { onclick: async () => { const { promptDialog } = await import('../core/dom.js'); const t = await promptDialog('Watchlist (comma-separated symbols)', { value: store.get('settings.watchlist').join(', '), placeholder: 'RELIANCE.NS, TCS.NS, ^NSEI, AAPL' }); if (t) { store.set('settings.watchlist', t.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 12)); load(); } } }, 'Edit')));
    } catch (e) { clear(list).append(unavailable(`Quotes unavailable: ${e.message}`)); }
  };
  load(); const iv = setInterval(() => document.visibilityState === 'visible' && load(), 60e3); el.cleanup = () => clearInterval(iv);
  return el;
}

/* --------------------------------------------------------------- LAUNCHER */
function wLauncher() {
  const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px' });
  const defaults = [{ label: 'GitHub', url: 'https://github.com' }, { label: 'Gmail', url: 'https://mail.google.com' }, { label: 'YouTube', url: 'https://youtube.com' }, { label: 'Wikipedia', url: 'https://wikipedia.org' }];
  const render = () => {
    const links = store.get('profile.launcher') || defaults;
    const mods = [['assistant', 'chat'], ['productivity', 'tasks'], ['study', 'book'], ['dev', 'code'], ['files', 'folder'], ['automation', 'bolt']];
    clear(grid).append(
      ...mods.map(([id, ic]) => h('button.btn.sm', { style: 'flex-direction:column;padding:10px 4px;white-space:normal', onclick: () => bus.emit('open', { id }) }, icon(ic), h('span.xs', t(id).split(' ')[0]))),
      ...links.map((l) => h('a.btn.sm', { href: l.url, target: '_blank', rel: 'noopener', style: 'flex-direction:column;padding:10px 4px;text-decoration:none' }, icon('external'), h('span.xs', l.label))),
      h('button.btn.ghost.sm', { style: 'flex-direction:column;padding:10px 4px', 'aria-label': 'Add link', onclick: async () => {
        const { promptDialog } = await import('../core/dom.js');
        const url = await promptDialog('Add a quick link', { placeholder: 'https://example.com', label: 'URL' }); if (!url) return;
        const label = new URL(/^https?:/.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, '').split('.')[0];
        store.set('profile.launcher', [...links, { label: label[0].toUpperCase() + label.slice(1), url: /^https?:/.test(url) ? url : 'https://' + url }]);
      } }, icon('plus'), h('span.xs', 'Add')));
  };
  render(); const off = store.on('profile.launcher', render);
  const el = widget('launcher', 'Quick Launcher', 'rocket', grid); el.cleanup = off; return el;
}

/* ---------------------------------------------------------------- INSIGHT */
function wInsight() {
  const body = h('div.stack');
  const render = () => {
    const s = store.state; const tk = todayKey();
    const done = s.tasks.filter((x) => x.done).length, total = s.tasks.length;
    const goal = s.goals[0];
    clear(body).append(
      h('div.stat-row', h('span.dim', 'Tasks complete'), h('b', `${done}/${total}`)), h('div.meter', h('i', { style: `width:${total ? (done / total) * 100 : 0}%` })),
      h('div.stat-row', h('span.dim', 'Focus today'), h('b', `${s.study.minutesByDay[tk] || 0} min`)),
      h('div.stat-row', h('span.dim', 'AI requests today'), h('b', String(s.usage.byDay[tk] || 0))),
      goal ? h('div', h('div.stat-row', h('span.dim', goal.title), h('b', `${goal.progress}/${goal.target}`)), h('div.meter', h('i', { style: `width:${(goal.progress / goal.target) * 100}%` }))) : null,
      h('div.row', h('span.grow'), h('button.btn.ghost.sm', { onclick: () => bus.emit('open', { id: 'analytics' }) }, 'Analytics')),
    );
  };
  render(); const off = bus.on('store:change', ({ path }) => { if (/^(tasks|study|usage|goals|license)/.test(path)) render(); });
  const el = widget('insight', 'Daily Insight', 'chart', body); el.cleanup = off; return el;
}

export const WIDGETS = {
  clock: { title: 'Clock', col: 'left', make: wClock },
  weather: { title: 'Weather', col: 'left', make: wWeather, needs: 'network' },
  system: { title: 'System (CPU, memory, battery, network)', col: 'left', make: wSystem },
  calendar: { title: 'Calendar', col: 'left', make: wCalendar },
  location: { title: 'Location', col: 'left', make: wLocation },
  tasks: { title: 'Tasks', col: 'right', make: wTasks },
  notes: { title: 'Notes', col: 'right', make: wNotes },
  timers: { title: 'Stopwatch & timers', col: 'right', make: wTimers },
  music: { title: 'Music', col: 'right', make: wMusic },
  insight: { title: 'Daily insight', col: 'bottom', make: wInsight },
  calculator: { title: 'Calculator', col: 'bottom', make: wCalc },
  launcher: { title: 'Quick launcher', col: 'bottom', make: wLauncher },
  news: { title: 'News', col: 'bottom', make: wNews, needs: 'server' },
  stocks: { title: 'Markets (live quotes)', col: 'bottom', make: wStocks, needs: 'server' },
};

/* --------------------------------------------------------------- HOME VIEW */
export function renderHome(stage, { onVoice }) {
  const root = h('div.home');
  stage.append(root);
  let cleanups = [];
  let hud;
  const partial = h('div.small.dim', { style: 'min-height:20px;text-align:center', 'aria-live': 'polite' });
  const reply = h('div.reply-card.glass.widget', { hidden: true });

  const build = () => {
    cleanups.forEach((c) => { try { c(); } catch { /* */ } }); cleanups = [];
    hud?.destroy?.();
    clear(root);
    const custom = store.get('settings.widgets');
    const unmet = (w) => (w.needs === 'server' && !platform.isServer) || (w.needs === 'network' && !platform.hasNetwork);
    const hidden = new Set(custom?.hidden ?? Object.entries(WIDGETS).filter(([, w]) => unmet(w)).map(([id]) => id));
    const cols = { left: h('div.home-col.left'), right: h('div.home-col.right'), bottom: h('div.home-bottom') };
    for (const [id, w] of Object.entries(WIDGETS)) {
      if (hidden.has(id)) continue;
      try { const el = w.make(); if (el.cleanup) cleanups.push(el.cleanup); cols[w.col].append(el); } catch (e) { console.error('widget', id, e); }
    }
    const hudVariant = store.get('settings.hud');
    hud = createHUD({ variant: ['reactor'].includes(hudVariant) && !allowed('hud.premium') ? 'classic' : hudVariant === 'prime' && !allowed('themes.exclusive') ? 'classic' : hudVariant, onClick: onVoice });
    const input = h('input', { placeholder: t('ask'), 'aria-label': 'Command', enterkeyhint: 'send' });
    const send = () => { const v = input.value.trim(); if (!v) return; input.value = ''; bus.emit('home:ask', { text: v }); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    const mic = h('button.btn.icon.round.mic', { 'aria-label': 'Voice input (hold Space)', title: 'Voice (hold Space)', onclick: onVoice }, icon('mic'));
    cleanups.push(bus.on('voice:state', ({ state }) => mic.classList.toggle('live', state === 'listening')));
    const chips = ['plan my day', 'what can you do?', 'remind me in 10 minutes to stretch', 'solve 2x + 5 = 17', 'explain recursion'];
    const core = h('div.home-core', hud, partial,
      h('div.cmdbar', icon('sparkles', { size: 16 }), input, mic, h('button.btn.primary.icon.round', { 'aria-label': 'Send', onclick: send }, icon('send'))),
      h('div.suggest', { style: 'justify-content:center' }, chips.map((c) => h('button.btn.ghost.sm', { onclick: () => bus.emit('home:ask', { text: c }) }, c))),
      reply);
    root.append(cols.left, core, cols.right, cols.bottom);
  };
  build(); home_rebuild = build;
  bus.on('dashboard:customize', () => customize(build));
  store.on('settings.widgets', build);
  store.on('settings.hud', build);

  return {
    refresh: build,
    showPartial(text) { partial.textContent = text ? `“${text}”` : ''; },
    showReply(q, md) {
      reply.hidden = false; partial.textContent = '';
      clear(reply).append(h('div.q', '› ' + q), h('div.md', { html: renderMarkdown(md) || '<span class="typing"></span>' }),
        h('div.row', { style: 'margin-top:6px' }, h('button.btn.ghost.sm', { onclick: () => bus.emit('open', { id: 'assistant' }) }, icon('chat'), 'Open conversation'), h('button.btn.ghost.sm', { onclick: () => { reply.hidden = true; } }, 'Dismiss')));
    },
  };
}

function customize(rebuild) {
  const hidden = new Set(store.get('settings.widgets')?.hidden ?? Object.entries(WIDGETS).filter(([, w]) => (w.needs === 'server' && !platform.isServer) || (w.needs === 'network' && !platform.hasNetwork)).map(([id]) => id));
  const body = h('div.stack', Object.entries(WIDGETS).map(([id, w]) => toggle(w.title, !hidden.has(id), (on) => { on ? hidden.delete(id) : hidden.add(id); store.set('settings.widgets', { hidden: [...hidden] }); })));
  modal({ title: 'Dashboard widgets', titleIcon: 'grid', body, actions: [{ label: 'Done', kind: 'primary' }] });
}
