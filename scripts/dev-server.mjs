// @ts-check

import { spawn } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const DIST_DIR = path.join(PUBLIC_DIR, 'dist');
const MINIFY_SCRIPT = path.join(REPO_ROOT, 'scripts', 'minify-public.cjs');

const DEFAULT_HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.PORT || '3000');

/**
 * @param {string} message
 */
function log(message) {
  process.stdout.write(`[dev] ${message}\n`);
}

/**
 * @param {string} message
 */
function warn(message) {
  process.stderr.write(`[dev] ${message}\n`);
}

/**
 * @param {number} code
 * @param {string} message
 */
function sendText(code, message, req, res) {
  const isHead = (req.method || '').toUpperCase() === 'HEAD';
  res.statusCode = code;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (isHead) return res.end();
  res.end(message);
}

/**
 * @param {string} ext
 */
function contentTypeFromExt(ext) {
  switch (ext.toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/**
 * @param {string} pathname
 */
function safeResolveDistPath(pathname) {
  const decoded = decodeURIComponent(pathname || '/');
  const normalized = decoded.replaceAll('\\', '/');
  const safePath = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  const abs = path.resolve(DIST_DIR, safePath);
  if (!abs.startsWith(DIST_DIR + path.sep) && abs !== DIST_DIR) {
    return null;
  }
  return abs;
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MINIFY_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`pages:build failed with exit code ${code}`));
    });
  });
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleRequest(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendText(405, 'Method Not Allowed', req, res);
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname || '/';

  let filePath = safeResolveDistPath(pathname);
  if (!filePath) return sendText(400, 'Bad Request', req, res);

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    if (pathname.endsWith('/')) {
      filePath = path.join(DIST_DIR, pathname.slice(1), 'index.html');
    } else {
      // If someone requests "/airports/penghu", serve "/airports/penghu/index.html"
      const withIndex = safeResolveDistPath(`${pathname.replace(/\/+$/, '')}/index.html`);
      if (withIndex) filePath = withIndex;
    }
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
    if (!stat.isFile()) return sendText(404, 'Not Found', req, res);
  } catch {
    return sendText(404, 'Not Found', req, res);
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypeFromExt(path.extname(filePath)));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(stat.size));

  if (method === 'HEAD') return res.end();

  const stream = createReadStream(filePath);
  stream.on('error', (err) => {
    warn(`stream error: ${err?.message || String(err)}`);
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  stream.pipe(res);
}

/**
 * @param {number} port
 * @param {string} host
 */
function startServer(port, host) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      warn(`request error: ${err?.message || String(err)}`);
      sendText(500, 'Internal Server Error', req, res);
    });
  });

  server.listen(port, host, () => {
    /** @type {any} */ (server.address());
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;
    log(`Serving ${path.relative(REPO_ROOT, DIST_DIR)} at http://${host}:${actualPort}/`);
    log('Edit files in public/ to trigger rebuild.');
  });

  return server;
}

function startWatch() {
  let timer = null;
  let isBuilding = false;
  let isQueued = false;

  const rebuild = async () => {
    if (isBuilding) {
      isQueued = true;
      return;
    }
    isBuilding = true;
    isQueued = false;
    try {
      log('Rebuilding...');
      await runBuild();
      log('Rebuild done.');
    } catch (err) {
      warn(`Rebuild failed: ${err?.message || String(err)}`);
    } finally {
      isBuilding = false;
      if (isQueued) void rebuild();
    }
  };

  const watcher = fs.watch(PUBLIC_DIR, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;
    const normalized = String(filename).replaceAll('\\', '/');
    if (normalized.startsWith('dist/')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 200);
  });

  log(`Watching ${path.relative(REPO_ROOT, PUBLIC_DIR)} (excluding public/dist)…`);
  return watcher;
}

async function main() {
  log('Building...');
  await runBuild();
  log('Build done.');

  const server = startServer(DEFAULT_PORT, DEFAULT_HOST);
  const watcher = startWatch();

  const shutdown = () => {
    watcher.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 1000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  warn(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
