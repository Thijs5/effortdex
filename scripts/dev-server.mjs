#!/usr/bin/env node
// Dev server (docs/adr/0026 — the TypeScript migration's "enabling
// step"). Replaces `npx serve .` for local development and for
// playwright.config.ts's `webServer`. This is the model a modern
// framework dev server uses: no bundling, native ES modules in the
// browser, one HTTP request per source module, each `.ts`/`.js`
// transformed on demand with esbuild (already a devDependency, already
// the production bundler in scripts/build.mjs). The real relative-import
// graph stays intact in the browser — the property docs/adr/0002 cares
// about — instead of being collapsed into one file the way the prod
// build (only) does it.
//
// index.html still names `app.js`; this server resolves any missing
// `*.js` request to the `*.ts` on disk, so index.html and sw.js's
// SHELL_PATHS need no dev-only variant. sw.js itself is served verbatim
// (it is a classic script, never a module) and is not registered in dev
// anyway (lib/dev-cache.js disables it on localhost).
//
// Config, highest precedence first: CLI flags, then env vars, then the
// built-in default.
//   --port/-p <n>   PORT       5173
//   --host <h>      HOST       0.0.0.0
//   --no-reload     LIVERELOAD=0/false/no    (turns the injected reload
//                  listener + file watcher off; the `dev` npm script and
//                  playwright.config.ts both pass --no-reload)
import { transform } from 'esbuild';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const optValue = (...names) => {
  for (const n of names) {
    const i = argv.indexOf(n);
    if (i !== -1 && argv[i + 1] != null) return argv[i + 1];
  }
  return undefined;
};

const host = optValue('--host') || process.env.HOST || '0.0.0.0';
const port = Number(optValue('--port', '-p') || process.env.PORT || 5173);
const liveReload = hasFlag('--no-reload')
  ? false
  : !['0', 'false', 'no'].includes((process.env.LIVERELOAD || '').toLowerCase());

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const TRANSFORMABLE = new Set(['.ts', '.js', '.mjs']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report', 'blob-report']);
const WATCH_SOURCE = /\.(ts|js|mjs|css|html|json|webmanifest)$/;

// --- transform cache (path -> { mtimeMs, code }) --------------------
// esbuild.transform is fast, but a cold page load is ~40 module
// requests and the e2e suite runs many pages in parallel against this
// one process; caching keeps repeat loads from re-transforming
// unchanged files.
const cache = new Map();
async function transformFile(abs, ext) {
  const { mtimeMs } = await stat(abs);
  const hit = cache.get(abs);
  if (hit && hit.mtimeMs === mtimeMs) return hit.code;
  const src = await readFile(abs, 'utf8');
  const { code } = await transform(src, {
    loader: ext === '.ts' ? 'ts' : 'js',
    format: 'esm',
    target: 'esnext',
    sourcemap: 'inline',
    sourcefile: path.relative(root, abs),
  });
  cache.set(abs, { mtimeMs, code });
  return code;
}

// --- live reload ---------------------------------------------------
/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();
const RELOAD_SNIPPET = `<script>
  new EventSource('/__livereload').onmessage = () => location.reload();
</script>`;

if (liveReload) {
  let timer = null;
  watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const parts = filename.split(path.sep);
    if (parts.some((p) => IGNORED_DIRS.has(p))) return;
    if (!WATCH_SOURCE.test(filename)) return;
    cache.delete(path.join(root, filename));
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const res of clients) res.write('data: reload\n\n');
    }, 150);
  });
}

// --- request handling --------------------------------------------
async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const abs = path.join(root, rel);
  if (!abs.startsWith(root)) return null; // path-traversal guard
  if (await isFile(abs)) return abs;
  // index.html names app.js; on disk it is app.ts after the migration.
  if (abs.endsWith('.js')) {
    const asTs = abs.slice(0, -3) + '.ts';
    if (await isFile(asTs)) return asTs;
  }
  return null;
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = req.url || '/';

    if (url.startsWith('/__livereload')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    const abs = await resolveFile(url);
    if (!abs) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(abs);

    if (ext === '.html') {
      const html = await readFile(abs, 'utf8');
      const body = liveReload
        ? html.replace('</body>', `${RELOAD_SNIPPET}\n</body>`)
        : html;
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(body);
      return;
    }

    // sw.js is a classic script — serve verbatim, never transform.
    if (TRANSFORMABLE.has(ext) && path.basename(abs) !== 'sw.js') {
      const code = await transformFile(abs, ext);
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
      res.end(code);
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    createReadStream(abs).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(err && err.stack ? err.stack : err));
  }
});

server.keepAliveTimeout = 60_000;
server.headersTimeout = 65_000;
server.requestTimeout = 0;

server.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`effortdex dev server → http://${shown}:${port}${liveReload ? '' : ' (live reload off)'}`);
});
