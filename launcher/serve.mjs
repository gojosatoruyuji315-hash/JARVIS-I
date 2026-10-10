#!/usr/bin/env node
/**
 * JARVIS-X local launcher — a tiny static web server (no dependencies, Node 14+).
 * Serves this folder on http://localhost:8765 (or the next free port) and opens your browser.
 * Running JARVIS-X as a normal web page gives it full, direct internet access.
 *
 *   node launcher/serve.mjs [--port 8765] [--no-open]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 8765;
const open = !args.includes('--no-open');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const BLOCK = /^\/(server|data|node_modules|\.git|\.env)(\/|$)/;

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(`http://x${req.url.startsWith('/') ? '' : '/'}${req.url}`).pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  p = path.posix.normalize(p);
  if (BLOCK.test(p)) { res.writeHead(404); return res.end('Not found'); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
});

function start(tries = 0) {
  server.once('error', (e) => { if (e.code === 'EADDRINUSE' && tries < 20) { port++; start(tries + 1); } else { console.error(e.message); process.exit(1); } });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`\n  JARVIS-X is running at ${url}\n  Keep this window open while you use it. Press Ctrl+C to stop.\n`);
    if (open) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
}
start();
