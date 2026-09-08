'use strict';
// Local development server for http://localhost:8080
// - Serves static files from the project root
// - Accepts POST /log from the page's devLog() calls
// - Writes to logs/errors.log, logs/warnings.log, logs/verbose.log
// - Rotates each file when it exceeds LOG_MAX_BYTES (keeps one .old backup)
// - Trims entries older than LOG_MAX_AGE_DAYS on startup

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT          = 8080;
const LOG_DIR       = path.join(__dirname, 'logs');
const LOG_MAX_BYTES = 512 * 1024; // 512 KB per file before rotation
const LOG_MAX_AGE_DAYS = 7;       // trim log entries older than this on startup

const LOG_FILES = {
  error:   path.join(LOG_DIR, 'errors.log'),
  warn:    path.join(LOG_DIR, 'warnings.log'),
  verbose: path.join(LOG_DIR, 'verbose.log'),
};

// ── Log file helpers ──────────────────────────────────────────────────────────
fs.mkdirSync(LOG_DIR, { recursive: true });

function rotatIfNeeded(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size >= LOG_MAX_BYTES) {
      fs.renameSync(file, file + '.old');
    }
  } catch (_) { /* file doesn't exist yet — fine */ }
}

function appendLog(level, line) {
  const file = LOG_FILES[level] || LOG_FILES.verbose;
  rotatIfNeeded(file);
  fs.appendFileSync(file, line + '\n', 'utf8');
}

function trimOldEntries(file) {
  if (!fs.existsSync(file)) return;
  const cutoff = Date.now() - LOG_MAX_AGE_DAYS * 86400 * 1000;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const kept = lines.filter(l => {
    const m = l.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/);
    if (!m) return true; // keep malformed lines
    return new Date(m[1]).getTime() >= cutoff;
  });
  fs.writeFileSync(file, kept.join('\n'), 'utf8');
}

// Trim old entries from all log files on startup
for (const f of Object.values(LOG_FILES)) trimOldEntries(f);
console.log(`[dev-server] Logs → ${LOG_DIR}`);

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt':  'text/plain',
};

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // POST /log — browser devLog() calls land here
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { level = 'verbose', category = '', msg = '', data } = JSON.parse(body);
        const ts   = new Date().toISOString();
        const cat  = category ? `[${category}] ` : '';
        const tail = data != null ? ' ' + JSON.stringify(data) : '';
        const line = `[${ts}] ${cat}${msg}${tail}`;
        const fileLevel = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'verbose';
        appendLog(fileLevel, line);
        // Mirror to terminal for live visibility
        const col = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[90m';
        console.log(`${col}[${level.toUpperCase()}]\x1b[0m ${cat}${msg}${tail}`);
      } catch (_) {}
      res.writeHead(204); res.end();
    });
    return;
  }

  // Serve static files
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/review.html';
  const filePath = path.join(__dirname, urlPath);

  // Safety: stay inside project root
  if (!filePath.startsWith(__dirname + path.sep) && filePath !== __dirname) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[dev-server] http://localhost:${PORT}/review.html`);
  console.log(`[dev-server] Logs: errors.log  warnings.log  verbose.log  (${LOG_MAX_AGE_DAYS}d retention, ${LOG_MAX_BYTES/1024}KB rotation)`);
});
