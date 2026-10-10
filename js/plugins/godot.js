/**
 * Godot Engine plugin — start Godot 4 projects from templates, generate and
 * upgrade GDScript with AI, browse snippets, and install the JARVIS-X editor
 * dock add-on inside Godot itself.
 */
import { zip } from '../core/zip.js';
import { TEMPLATES, ADDON, readme, ICON, inputSetup, projectGodot } from './godot-templates.js';

const slug = (s) => (s || 'my-game').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'my-game';

/** Build a ready-to-open Godot 4 project as a zip Blob. */
export function buildProject(name, templateId = 'platformer', { addon = true } = {}) {
  const tpl = TEMPLATES[templateId] || TEMPLATES.platformer;
  const dir = slug(name) + '/';
  const files = {
    'project.godot': projectGodot(name, { addon }),
    'icon.svg': ICON,
    'scripts/input_setup.gd': inputSetup(tpl.jump),
    ...tpl.files(name),
    'README.md': readme(name, tpl, addon),
    '.gitignore': '.godot/\n*.import\nexport/\n',
    ...(addon ? ADDON : {}),
  };
  return { blob: zip(Object.entries(files).map(([n, data]) => ({ name: dir + n, data }))), files: Object.keys(files), filename: `${slug(name)}.zip` };
}

/* ------------------------------------------------ Godot 3 → 4 upgrader */
const RENAMES = [
  ['KinematicBody2D', 'CharacterBody2D'], ['KinematicBody', 'CharacterBody3D'], ['Spatial', 'Node3D'], ['RigidBody(?!2D|3D)', 'RigidBody3D'],
  ['StaticBody(?!2D|3D)', 'StaticBody3D'], ['Area(?!2D|3D)', 'Area3D'], ['MeshInstance(?!2D|3D)', 'MeshInstance3D'], ['CollisionShape(?!2D|3D)', 'CollisionShape3D'],
  ['Position2D', 'Marker2D'], ['Position3D', 'Marker3D'], ['YSort', 'Node2D'], ['Navigation2D', 'Node2D'], ['TextureButton', 'TextureButton'],
  ['PoolStringArray', 'PackedStringArray'], ['PoolIntArray', 'PackedInt32Array'], ['PoolRealArray', 'PackedFloat32Array'], ['PoolVector2Array', 'PackedVector2Array'], ['PoolVector3Array', 'PackedVector3Array'], ['PoolByteArray', 'PackedByteArray'], ['PoolColorArray', 'PackedColorArray'],
  ['Reference', 'RefCounted'], ['File\\.new\\(\\)', 'FileAccess  # FileAccess.open(path, FileAccess.READ)'], ['Directory\\.new\\(\\)', 'DirAccess  # DirAccess.open(path)'],
  ['rand_range\\(', 'randf_range('], ['stepify\\(', 'snapped('], ['deg2rad\\(', 'deg_to_rad('], ['rad2deg\\(', 'rad_to_deg('], ['linear2db\\(', 'linear_to_db('], ['db2linear\\(', 'db_to_linear('],
  ['\\.empty\\(\\)', '.is_empty()'], ['\\.instance\\(\\)', '.instantiate()'], ['get_tree\\(\\)\\.change_scene\\(', 'get_tree().change_scene_to_file('],
  ['OS\\.get_ticks_msec\\(', 'Time.get_ticks_msec('], ['\\.translation\\b', '.position'], ['\\.rect_position', '.position'], ['\\.rect_size', '.size'], ['\\.rect_min_size', '.custom_minimum_size'],
  ['BUTTON_LEFT', 'MOUSE_BUTTON_LEFT'], ['BUTTON_RIGHT', 'MOUSE_BUTTON_RIGHT'], ['KEY_CONTROL', 'KEY_CTRL'], ['\\bTool\\b', '@tool'], ['^tool$', '@tool'],
];

/** Mechanical Godot 3 → 4 upgrade. Returns { code, changes[] } — changes explain each fix. */
export function upgradeGd3(src) {
  const changes = []; let code = src.replace(/\r\n/g, '\n');
  const rep = (re, to, why) => { const before = code; code = code.replace(re, to); if (before !== code) changes.push(why); };
  rep(/^tool\s*$/m, '@tool', '`tool` → `@tool` annotation');
  rep(/^(\s*)export\s*\(([^)]*)\)\s*var\s+/gm, (m, ind, hint) => `${ind}@export var `, '`export(Type) var` → `@export var` (add a type hint: `@export var speed: float`)');
  rep(/^(\s*)export\s+var\s+/gm, '$1@export var ', '`export var` → `@export var`');
  rep(/^(\s*)onready\s+var\s+/gm, '$1@onready var ', '`onready var` → `@onready var`');
  rep(/\byield\s*\(\s*([^,]+?)\s*,\s*"(\w+)"\s*\)/g, 'await $1.$2', '`yield(obj, "signal")` → `await obj.signal`');
  rep(/\byield\s*\(\s*get_tree\(\)\.create_timer\(([^)]*)\)\s*,\s*"timeout"\s*\)/g, 'await get_tree().create_timer($1).timeout', 'timer yield → `await …timeout`');
  rep(/(\w+)\.connect\(\s*"(\w+)"\s*,\s*self\s*,\s*"(\w+)"\s*\)/g, '$1.$2.connect($3)', '`connect("sig", self, "method")` → `sig.connect(method)`');
  rep(/\bconnect\(\s*"(\w+)"\s*,\s*self\s*,\s*"(\w+)"\s*\)/g, '$1.connect($2)', '`connect("sig", self, "method")` → `sig.connect(method)`');
  rep(/\bemit_signal\(\s*"(\w+)"\s*\)/g, '$1.emit()', '`emit_signal("sig")` → `sig.emit()`');
  rep(/\bemit_signal\(\s*"(\w+)"\s*,\s*/g, '$1.emit(', '`emit_signal("sig", args)` → `sig.emit(args)`');
  rep(/^(\s*)(?:var\s+)?velocity\s*=\s*move_and_slide\(\s*([\w.]+)\s*(?:,[^)]*)?\)/gm, (m, ind, v) => `${ind}${v === 'velocity' ? '' : `velocity = ${v}\n${ind}`}move_and_slide()`, '`velocity = move_and_slide(v, up)` → set `velocity` then `move_and_slide()`; set `up_direction` on the body');
  rep(/^(\s*)move_and_slide\(\s*([\w.]+)\s*(?:,[^)]*)?\)/gm, (m, ind, v) => `${ind}${v === 'velocity' ? '' : `velocity = ${v}\n${ind}`}move_and_slide()`, '`move_and_slide(v)` → `move_and_slide()` using the built-in `velocity`');
  rep(/^(\s*)var\s+velocity\s*(?::\s*Vector[23])?\s*=\s*Vector[23](?:\.ZERO|\([^)]*\))\s*$/gm, '$1# velocity is built into CharacterBody in Godot 4', 'removed custom `var velocity` (CharacterBody has one)');
  rep(/\bis_on_floor\(\s*\)/g, 'is_on_floor()', '');
  rep(/\bsetget\s+(\w+)\s*(?:,\s*(\w+))?/g, (m, s, g) => `# TODO Godot 4: use property syntax  var x: set = ${s}${g ? `, get = ${g}` : ''}`, '`setget` → property `set =` / `get =` syntax (flagged with TODO)');
  for (const [from, to] of RENAMES) rep(new RegExp(from, 'gm'), to, `\`${from.replace(/\\/g, '').replace(/\(\?![^)]*\)/g, '')}\` → \`${to.split('  #')[0]}\``);
  rep(/\bfunc\s+_ready\(\s*\)\s*:/g, 'func _ready() -> void:', 'added `-> void` return types');
  rep(/\bfunc\s+_process\(\s*delta\s*\)\s*:/g, 'func _process(delta: float) -> void:', 'typed `_process(delta: float)`');
  rep(/\bfunc\s+_physics_process\(\s*delta\s*\)\s*:/g, 'func _physics_process(delta: float) -> void:', 'typed `_physics_process(delta: float)`');
  return { code, changes: [...new Set(changes.filter(Boolean))] };
}

/** Look for Godot 3-only patterns without changing anything. */
export function checkGd(src) {
  const hits = [];
  const rules = [[/^\s*(export|onready)\s/m, 'Godot 3 `export`/`onready` keywords (use @export / @onready)'], [/\byield\s*\(/, '`yield` (use `await`)'], [/move_and_slide\(\s*\w/, '`move_and_slide(…)` with arguments'], [/KinematicBody/, 'KinematicBody (now CharacterBody2D/3D)'], [/connect\(\s*"/, 'string-based `connect`'], [/\bsetget\b/, '`setget`'], [/\.instance\(\)/, '`.instance()` (now `.instantiate()`)'], [/\bSpatial\b/, '`Spatial` (now Node3D)'], [/Pool\w+Array/, 'Pool*Array (now Packed*Array)']];
  for (const [re, msg] of rules) if (re.test(src)) hits.push(msg);
  if (/^ {2,}\S/m.test(src) && /^\t/m.test(src)) hits.push('mixed tabs and spaces (Godot uses tabs by default)');
  return hits;
}

/* ------------------------------------------------------- snippets */
const SNIPPETS = [
  { title: 'Signal: declare, emit, connect', tags: 'signal event', code: `signal health_changed(new_value: int)\n\nvar health := 100:\n\tset(value):\n\t\thealth = clampi(value, 0, 100)\n\t\thealth_changed.emit(health)\n\nfunc _ready() -> void:\n\thealth_changed.connect(_on_health_changed)\n\nfunc _on_health_changed(v: int) -> void:\n\tprint("HP: ", v)` },
  { title: 'Timer with await', tags: 'timer delay await', code: `func flash() -> void:\n\tmodulate = Color.RED\n\tawait get_tree().create_timer(0.15).timeout\n\tmodulate = Color.WHITE` },
  { title: 'Tween (move + fade)', tags: 'tween animation', code: `func pop_in() -> void:\n\tscale = Vector2.ZERO\n\tvar tween := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)\n\ttween.tween_property(self, "scale", Vector2.ONE, 0.35)\n\ttween.parallel().tween_property(self, "modulate:a", 1.0, 0.35)` },
  { title: 'Spawn a scene', tags: 'instantiate spawn preload', code: `const BULLET := preload("res://scenes/bullet.tscn")\n\nfunc shoot() -> void:\n\tvar b := BULLET.instantiate()\n\tb.global_position = $Muzzle.global_position\n\tb.rotation = rotation\n\tget_tree().current_scene.add_child(b)` },
  { title: 'Save & load (JSON in user://)', tags: 'save load file json', code: `const SAVE_PATH := "user://save.json"\n\nfunc save_game(data: Dictionary) -> void:\n\tvar f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)\n\tf.store_string(JSON.stringify(data))\n\nfunc load_game() -> Dictionary:\n\tif not FileAccess.file_exists(SAVE_PATH):\n\t\treturn {}\n\tvar parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))\n\treturn parsed if parsed is Dictionary else {}` },
  { title: 'Autoload singleton (Game state)', tags: 'autoload singleton global', code: `# Project → Project Settings → Globals → Autoload: add this as "Game"\nextends Node\n\nsignal score_changed(score: int)\nvar score := 0\n\nfunc add_score(n: int) -> void:\n\tscore += n\n\tscore_changed.emit(score)` },
  { title: 'Change scene', tags: 'scene switch', code: `func go_to_level(path: String) -> void:\n\tget_tree().change_scene_to_file(path)` },
  { title: 'Raycast from camera (3D click)', tags: 'raycast 3d mouse', code: `func _unhandled_input(event: InputEvent) -> void:\n\tif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:\n\t\tvar cam := get_viewport().get_camera_3d()\n\t\tvar from := cam.project_ray_origin(event.position)\n\t\tvar to := from + cam.project_ray_normal(event.position) * 1000.0\n\t\tvar hit := get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(from, to))\n\t\tif hit:\n\t\t\tprint("Clicked ", hit.collider.name, " at ", hit.position)` },
  { title: 'Simple state machine', tags: 'state machine enum ai', code: `enum State { IDLE, CHASE, ATTACK }\nvar state := State.IDLE\n\nfunc _physics_process(delta: float) -> void:\n\tmatch state:\n\t\tState.IDLE:\n\t\t\tif _sees_player(): state = State.CHASE\n\t\tState.CHASE:\n\t\t\t_move_toward_player(delta)\n\t\t\tif _in_range(): state = State.ATTACK\n\t\tState.ATTACK:\n\t\t\t_attack()\n\t\t\tstate = State.CHASE` },
  { title: 'Screen shake (Camera2D)', tags: 'camera shake juice', code: `extends Camera2D\n\nvar shake := 0.0\n\nfunc add_shake(amount: float) -> void:\n\tshake = minf(shake + amount, 20.0)\n\nfunc _process(delta: float) -> void:\n\tshake = move_toward(shake, 0.0, 30.0 * delta)\n\toffset = Vector2(randf_range(-shake, shake), randf_range(-shake, shake))` },
  { title: 'Play a sound', tags: 'audio sound sfx', code: `@onready var sfx: AudioStreamPlayer = $Jump\n\nfunc jump() -> void:\n\tsfx.pitch_scale = randf_range(0.9, 1.1)\n\tsfx.play()` },
  { title: 'Pause menu', tags: 'pause menu ui', code: `# Set this node's Process Mode to "Always"\nfunc _unhandled_input(event: InputEvent) -> void:\n\tif event.is_action_pressed("ui_cancel"):\n\t\tget_tree().paused = not get_tree().paused\n\t\tvisible = get_tree().paused` },
];

const DOCS = [
  ['Getting started', 'https://docs.godotengine.org/en/stable/getting_started/introduction/index.html'],
  ['GDScript reference', 'https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html'],
  ['Upgrading from Godot 3', 'https://docs.godotengine.org/en/stable/tutorials/migrating/upgrading_to_godot_4.html'],
  ['Class reference', 'https://docs.godotengine.org/en/stable/classes/index.html'],
  ['Exporting projects', 'https://docs.godotengine.org/en/stable/tutorials/export/index.html'],
  ['Asset Library', 'https://godotengine.org/asset-library/asset'],
  ['Download Godot', 'https://godotengine.org/download'],
];

const GD_SYSTEM = 'You are an expert Godot 4.3 developer. Write GDScript 2.0 only (typed variables, @export, @onready, await, signal.emit(), signal.connect(callable), CharacterBody2D/3D with built-in velocity and move_and_slide() without arguments). Indent with tabs. Reply with ONE ```gdscript code block, then at most three short bullet notes on how to use it (which node type to attach it to, required child nodes, input actions).';
const extractCode = (t) => (t.match(/```(?:gdscript|gd)?\s*\n([\s\S]*?)```/) || [, t])[1].trimEnd();

/* ------------------------------------------------------------ UI */
function panel(el, api) {
  const { h, icon } = api;
  const body = h('div.stack');
  const tabs = [['new', 'New project', 'rocket'], ['script', 'Script helper', 'sparkles'], ['upgrade', 'Godot 3 → 4', 'refresh'], ['snippets', 'Snippets', 'code'], ['addon', 'Editor add-on', 'plug'], ['docs', 'Docs', 'book']];
  let cur = api.get('tab', 'new');
  const bar = h('div.tabs', { role: 'tablist', style: 'margin-bottom:12px' });
  const pre = (code) => { const p = h('pre.code', h('code')); import('../core/highlight.js').then(({ highlight }) => { p.firstChild.innerHTML = highlight(code, 'gdscript'); }); return p; };
  const codeCard = (code, name = 'script.gd') => h('div.stack', pre(code), h('div.row', h('button.btn.sm', { onclick: () => api.copyText(code) }, icon('copy'), 'Copy'), h('button.btn.ghost.sm', { onclick: () => api.download(name, code, 'text/plain') }, icon('download'), `Download ${name}`)));

  const views = {
    new() {
      const name = h('input.input', { value: api.get('lastName', 'My Game'), 'aria-label': 'Project name' });
      let tpl = api.get('lastTpl', 'platformer');
      const addon = h('input', { type: 'checkbox', checked: api.get('addon', true) });
      const cards = h('div.plugin-grid');
      const paint = () => cards.replaceChildren(...Object.entries(TEMPLATES).map(([id, t]) => h('button.choice-card', { class: id === tpl ? 'active' : '', 'aria-pressed': String(id === tpl), onclick: () => { tpl = id; paint(); } }, h('b', t.label), h('div.small.dim', t.description))));
      paint();
      const files = h('div.xs.muted');
      const make = async () => {
        api.set('lastName', name.value); api.set('lastTpl', tpl); api.set('addon', addon.checked);
        const p = buildProject(name.value, tpl, { addon: addon.checked });
        files.textContent = `${p.files.length} files: ${p.files.join(', ')}`;
        api.download(p.filename, p.blob, 'application/zip');
        await api.saveToFiles(p.blob, p.filename, '/Godot').catch(() => {});
      };
      return h('div.stack', h('p.small.dim', 'Creates a complete Godot 4.3+ project you can open straight away: unzip it, open Godot → Import → pick project.godot, press F5.'),
        h('label.stack', h('span.small', 'Project name'), name), h('div.section-title', 'Template'), cards,
        h('label.row.small', addon, 'Include the JARVIS-X Assistant editor dock (AI help inside Godot)'),
        h('div.row', h('button.btn.primary', { onclick: make }, icon('download'), 'Create project (.zip)')), files);
    },
    script() {
      const prompt = h('textarea.textarea', { placeholder: 'Describe the script — e.g. "enemy that patrols between two points and chases the player when close"', style: 'min-height:90px' });
      const kind = h('select.select', { style: 'width:auto' }, ['Any', 'CharacterBody2D', 'CharacterBody3D', 'Area2D', 'Node2D', 'Control (UI)', 'Autoload singleton', 'EditorPlugin (@tool)'].map((x) => h('option', x)));
      const out = h('div.stack'); let ctrl;
      const go = async () => {
        if (!prompt.value.trim()) return; ctrl?.abort(); ctrl = new AbortController();
        const live = h('pre.code', 'Writing GDScript…'); out.replaceChildren(live);
        try {
          const text = await api.ask(`${kind.value !== 'Any' ? `Node type: ${kind.value}.\n` : ''}Task: ${prompt.value}`, { system: GD_SYSTEM, signal: ctrl.signal, tier: 'default', onText: (t) => { live.textContent = t; } });
          const code = extractCode(text); const notes = text.replace(/```[\s\S]*?```/, '').trim();
          api.set('history', [{ prompt: prompt.value, code, ts: Date.now() }, ...api.get('history', [])].slice(0, 30));
          out.replaceChildren(codeCard(code, 'generated.gd'), notes ? h('div.small.dim', { style: 'white-space:pre-wrap' }, notes) : null, checkGd(code).length ? h('div.small', { style: 'color:var(--warn)' }, `Heads-up: ${checkGd(code).join('; ')}`) : null);
        } catch (e) { out.replaceChildren(h('div.small', e.message)); }
      };
      const hist = api.get('history', []);
      return h('div.stack', h('div.row', kind, h('button.btn.primary', { onclick: go }, icon('sparkles'), 'Generate')), prompt, out,
        hist.length ? h('details', h('summary.small', `Recent scripts (${hist.length})`), h('div.list', hist.map((x) => h('button.item', { style: 'text-align:left;color:var(--fg)', onclick: () => out.replaceChildren(codeCard(x.code, 'generated.gd')) }, icon('code', { size: 14 }), h('span.small.grow', x.prompt))))) : null);
    },
    upgrade() {
      const src = h('textarea.textarea', { placeholder: 'Paste Godot 3 GDScript here…', style: 'min-height:200px;font-family:var(--mono)', spellcheck: false });
      const out = h('div.stack');
      const mech = () => { const { code, changes } = upgradeGd3(src.value); out.replaceChildren(h('div.section-title', `${changes.length} automatic fixes`), h('ul.small', changes.map((c) => h('li', c))), codeCard(code, 'upgraded.gd'), checkGd(code).length ? h('div.small', { style: 'color:var(--warn)' }, `Still needs a look: ${checkGd(code).join('; ')} — try "Upgrade with AI".`) : h('div.small', { style: 'color:var(--ok)' }, 'No Godot 3 patterns left.')); };
      const ai = async () => { const live = h('pre.code', 'Upgrading…'); out.replaceChildren(live); try { const t = await api.ask(`Convert this Godot 3 GDScript to idiomatic Godot 4.3 GDScript. Keep behaviour identical. After the code, list the changes as bullets.\n\n\`\`\`gdscript\n${src.value}\n\`\`\``, { system: GD_SYSTEM, onText: (x) => { live.textContent = x; } }); out.replaceChildren(codeCard(extractCode(t), 'upgraded.gd'), h('div.small.dim', { style: 'white-space:pre-wrap' }, t.replace(/```[\s\S]*?```/, '').trim())); } catch (e) { out.replaceChildren(h('div.small', e.message)); } };
      return h('div.stack', h('p.small.dim', 'The quick upgrade runs instantly on your device and handles the common renames (export/onready, yield, connect, move_and_slide, node and type names). The AI upgrade handles the rest.'), src,
        h('div.row', h('button.btn.primary', { onclick: mech }, icon('refresh'), 'Quick upgrade'), h('button.btn', { onclick: ai }, icon('sparkles'), 'Upgrade with AI'), h('button.btn.ghost', { onclick: () => { const c = checkGd(src.value); api.toast(c.length ? c.join(' · ') : 'Looks like Godot 4 already', { timeout: 5000 }); } }, 'Check only')), out);
    },
    snippets() {
      const q = h('input.input', { placeholder: 'Filter snippets (signal, tween, save…)' }); const list = h('div.stack');
      const paint = () => { const s = q.value.toLowerCase(); list.replaceChildren(...SNIPPETS.filter((x) => !s || (x.title + x.tags).toLowerCase().includes(s)).map((x) => h('details.glass.widget', h('summary', h('b.small', x.title)), codeCard(x.code, `${slug(x.title)}.gd`)))); };
      q.addEventListener('input', paint); paint();
      return h('div.stack', q, list);
    },
    addon() {
      const dl = () => { const blob = zip(Object.entries(ADDON).map(([name, data]) => ({ name, data }))); api.download('jarvis_x_godot_addon.zip', blob, 'application/zip'); };
      return h('div.stack', h('p', 'Put AI help inside the Godot editor. The JARVIS-X Assistant dock answers questions and writes GDScript, and its ', h('b', 'Insert code'), ' button pastes the result at your cursor.'),
        h('ol.small', h('li', 'Download the add-on and unzip it into your project so you have ', h('code', 'res://addons/jarvis_x/'), '.'), h('li', 'Godot → Project → Project Settings → Plugins → enable ', h('b', 'JARVIS-X Assistant'), '.'), h('li', 'In the dock (right side), choose ', h('b', 'JARVIS-X server'), ' and paste your server URL and a Developer API key (Account → Developer API keys), or choose ', h('b', 'Anthropic'), ' and paste your own key.'), h('li', 'Settings are stored in the Godot editor settings on your computer, not in the project.')),
        h('div.row', h('button.btn.primary', { onclick: dl }, icon('download'), 'Download add-on (.zip)'), h('button.btn.ghost', { onclick: () => api.open('account') }, icon('key'), 'Get an API key')),
        h('details', h('summary.small', 'View the dock script'), codeCard(ADDON['addons/jarvis_x/dock.gd'], 'dock.gd')));
    },
    docs() {
      const q = h('input.input.grow', { placeholder: 'Search the Godot docs (e.g. CharacterBody2D, tween)' });
      const go = () => q.value.trim() && window.open(`https://docs.godotengine.org/en/stable/search.html?q=${encodeURIComponent(q.value)}`, '_blank', 'noopener');
      q.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      return h('div.stack', h('div.row', q, h('button.btn.primary', { onclick: go }, icon('search'), 'Search')), h('div.list', DOCS.map(([t, u]) => h('a.item', { href: u, target: '_blank', rel: 'noopener', style: 'color:var(--fg)' }, icon('external', { size: 14 }), t))));
    },
  };
  const show = (id) => { cur = id; api.set('tab', id); bar.replaceChildren(...tabs.map(([k, label, ic]) => h('button.tab', { role: 'tab', 'aria-selected': String(k === id), class: k === id ? 'active' : '', onclick: () => show(k) }, icon(ic, { size: 14 }), label))); body.replaceChildren(views[id]()); };
  show(views[cur] ? cur : 'new');
  el.append(h('div.stack', bar, body));
}

export default {
  id: 'godot', name: 'Godot Engine', version: '1.0.0', author: 'JARVIS-X',
  icon: 'gamepad', category: 'Developer', needs: [],
  description: 'Make games with Godot 4: create ready-to-run projects from templates (2D platformer, top-down, 3D first-person, menus), generate GDScript with AI, upgrade Godot 3 code, snippets, and an AI assistant dock for the Godot editor.',
  panel,
  activate(api) { api.bus.emit('dev:lang', { id: 'gdscript', label: 'GDScript (Godot)', ext: 'gd', run: null, sample: SNIPPETS[0].code }); },
  commands: [
    { match: /^(new|create|make) (a )?godot (project|game)( called (.+))?$/i, run(t, api) { const n = t.match(/called (.+)$/i)?.[1] || 'My Game'; const p = buildProject(n, 'platformer', { addon: true }); api.download(p.filename, p.blob, 'application/zip'); return `Created **${n}** (2D platformer, ${p.files.length} files). Unzip it and open \`project.godot\` in Godot 4.3+. More templates are in the Godot plugin.`; } },
  ],
  tools: [
    { name: 'godot_new_project', description: 'Create a complete, runnable Godot 4 project zip from a template and give it to the user to download. Templates: platformer (2D), topdown (2D collector), fps3d (3D first-person), menu (title screen + game scene).', schema: { type: 'object', properties: { name: { type: 'string' }, template: { type: 'string', enum: Object.keys(TEMPLATES) }, include_addon: { type: 'boolean', description: 'Include the JARVIS-X editor assistant dock (default true)' } }, required: ['name'] },
      async run({ name, template = 'platformer', include_addon = true }, api) { const p = buildProject(name, template, { addon: include_addon }); api.download(p.filename, p.blob, 'application/zip'); await api.saveToFiles(p.blob, p.filename, '/Godot').catch(() => {}); return { created: p.filename, template, files: p.files, howToOpen: 'Unzip, then Godot 4.3+ → Import → project.godot → F5' }; } },
    { name: 'godot_upgrade_script', description: 'Mechanically upgrade Godot 3 GDScript to Godot 4 syntax. Returns the new code and a list of changes; review remaining TODOs yourself.', schema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      run({ code }) { const r = upgradeGd3(code); return { ...r, remainingIssues: checkGd(r.code) }; } },
  ],
};
