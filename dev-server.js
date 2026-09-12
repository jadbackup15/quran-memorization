#!/usr/bin/env node
// Local dev server for Quran Review.
// Serves static files (like python3 -m http.server) AND accepts POST /log
// from the browser so log entries get written to files you can read.
//
// Usage:  node dev-server.js          (default port 8080)
//         node dev-server.js 3000     (custom port)
//
// Log files written to ./logs/:
//   app.log   — every entry (info + warn + error)
//   warn.log  — warnings only
//   error.log — errors only
// Each file rotates at 10 MB (renamed to .old, fresh file starts).

'use strict';
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PORT    = parseInt(process.argv[2]) || 8080;
const ROOT    = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_MAX = 10 * 1024 * 1024; // 10 MB per file

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ── Log file helpers ──────────────────────────────────────────────────────────
function rotateIfNeeded(p) {
  try { if (fs.statSync(p).size >= LOG_MAX) fs.renameSync(p, p + '.old'); } catch {}
}
function appendLog(filename, line) {
  const p = path.join(LOG_DIR, filename);
  rotateIfNeeded(p);
  fs.appendFileSync(p, line + '\n', 'utf8');
}
function writeLogEntry(entry) {
  const { level = 'verbose', category = '', msg = '', data } = entry;
  const lvl = level.toUpperCase().padEnd(7);
  const suffix = data !== undefined && data !== '' ? ' ' + (typeof data === 'string' ? data : JSON.stringify(data)) : '';
  const line = `[${new Date().toISOString()}] [${lvl}] [${category}] ${msg}${suffix}`;
  appendLog('app.log', line);
  if (level === 'warn')  appendLog('warn.log',  line);
  if (level === 'error') appendLog('error.log', line);
  // Echo to terminal so dev can see logs live without opening files
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(line);
}

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.md': 'text/plain',
};

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // POST /log — receive a log entry from the browser
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try { writeLogEntry(JSON.parse(body)); } catch {}
      res.writeHead(204); res.end();
    });
    return;
  }

  // GET /logs/<file> — serve a log file directly (optional convenience)
  if (req.method === 'GET' && req.url.startsWith('/logs/')) {
    const name = path.basename(new URL(req.url, 'http://localhost').pathname);
    const p = path.join(LOG_DIR, name);
    if (!p.startsWith(LOG_DIR)) { res.writeHead(403); res.end(); return; }
    try {
      const content = fs.readFileSync(p, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(content);
    } catch { res.writeHead(404); res.end('Not found'); }
    return;
  }

  // Serve static files
  let pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/' || pathname === '') pathname = '/review.html';
  const filePath = path.join(ROOT, pathname);

  // Safety: don't escape the project root
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Dev server → http://localhost:${PORT}/`);
  console.log(`Log files  → ${LOG_DIR}/`);
  writeLogEntry({ level: 'verbose', category: 'server', msg: `dev-server started on port ${PORT}` });
});
