/**
 * Code runner: POST /api/run { lang, code, stdin } → { stdout, stderr, exitCode, ms, timedOut }
 *
 * CODE_RUNNER=docker  — each run in a throwaway container: no network, 256 MB RAM, 0.5 CPU, read-only FS (recommended)
 * CODE_RUNNER=local   — runs toolchains directly on the host. DEVELOPMENT ONLY: user code gets your machine's permissions.
 * CODE_RUNNER=off     — disabled (default)
 * SQL always runs in an isolated in-memory SQLite database inside the server process.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../lib/config.js';
import { HttpError, json, jsonBody, rateLimit } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';

const OUT_CAP = 64 * 1024;
const LANGS = {
  python:     { file: 'main.py',   image: 'python:3.12-alpine', cmd: 'python3 main.py' },
  javascript: { file: 'main.js',   image: 'node:22-alpine',     cmd: 'node main.js' },
  java:       { file: 'Main.java', image: 'eclipse-temurin:21-jdk', cmd: 'java Main.java' },
  cpp:        { file: 'main.cpp',  image: 'gcc:14',             cmd: 'g++ -O2 -std=c++17 -o /tmp/a.out main.cpp && /tmp/a.out' },
  c:          { file: 'main.c',    image: 'gcc:14',             cmd: 'gcc -O2 -o /tmp/a.out main.c && /tmp/a.out' },
};

function exec(cmd, args, { cwd, stdin, timeoutMs }) {
  return new Promise((resolve) => {
    const t0 = Date.now(); const p = spawn(cmd, args, { cwd, env: { PATH: process.env.PATH, HOME: cwd, LANG: 'C.UTF-8' } });
    let stdout = '', stderr = '', timedOut = false;
    const cap = (s, c) => (s.length < OUT_CAP ? s + c.toString() : s);
    p.stdout.on('data', (c) => { stdout = cap(stdout, c); });
    p.stderr.on('data', (c) => { stderr = cap(stderr, c); });
    const kill = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(kill); resolve({ stdout: stdout.slice(0, OUT_CAP), stderr: stderr.slice(0, OUT_CAP), exitCode: code, ms: Date.now() - t0, timedOut }); });
    p.on('error', (e) => { clearTimeout(kill); resolve({ stdout: '', stderr: `Failed to start: ${e.message}`, exitCode: -1, ms: Date.now() - t0, timedOut }); });
    if (stdin) p.stdin.write(stdin); p.stdin.end();
  });
}

function runSql(code) {
  if (/\b(attach|detach|vacuum\s+into|load_extension)\b/i.test(code)) throw new HttpError(400, 'ATTACH, VACUUM INTO and extensions are not allowed.');
  const t0 = Date.now(); const db = new DatabaseSync(':memory:');
  const results = [];
  try {
    for (const stmt of code.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
      const st = db.prepare(stmt);
      if (/^\s*(select|with|pragma|values)\b/i.test(stmt)) results.push({ sql: stmt, rows: st.all().slice(0, 500) });
      else { const r = st.run(); results.push({ sql: stmt, changes: Number(r.changes) }); }
      if (Date.now() - t0 > 3000) throw new Error('Time limit exceeded');
    }
    return { results, ms: Date.now() - t0 };
  } catch (e) { return { results, error: e.message, ms: Date.now() - t0 }; }
  finally { db.close(); }
}

export function runRoutes(r) {
  r.get('/api/run/status', async (req, res) => json(res, { mode: config.runner.mode, languages: config.runner.mode === 'off' ? ['sql'] : [...Object.keys(LANGS), 'sql'] }));

  r.post('/api/run', async (req, res) => {
    const { user } = requireUser(req);
    rateLimit(`run:${user.id}`, 15, 60e3);
    const { lang, code, stdin } = await jsonBody(req, 256 * 1024);
    if (typeof code !== 'string' || !code.trim()) throw new HttpError(400, 'code is required');
    if (lang === 'sql') return json(res, runSql(code));
    const L = LANGS[lang]; if (!L) throw new HttpError(400, `Unsupported language: ${lang}`);
    if (config.runner.mode === 'off') throw new HttpError(503, 'Server code execution is disabled. Set CODE_RUNNER=docker to enable it.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jxrun-'));
    try {
      fs.writeFileSync(path.join(dir, L.file), code);
      const timeoutMs = config.runner.timeoutMs;
      const out = config.runner.mode === 'docker'
        ? await exec('docker', ['run', '--rm', '-i', '--network', 'none', '--memory', '256m', '--cpus', '0.5', '--pids-limit', '64', '--read-only', '--tmpfs', '/tmp:exec,size=64m', '-v', `${dir}:/code:ro`, '-w', '/code', L.image, 'sh', '-c', L.cmd], { cwd: dir, stdin, timeoutMs: timeoutMs + 5000 })
        : await exec('sh', ['-c', L.cmd.replace(/\/tmp\/a\.out/g, './a.out')], { cwd: dir, stdin, timeoutMs });
      return json(res, out);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
