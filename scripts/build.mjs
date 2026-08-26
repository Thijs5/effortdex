#!/usr/bin/env node
// Production build (docs/adr/0002's "no framework" is a separate
// decision from "no build tooling" — see that ADR's own note). Minifies
// the app's JS/CSS into dist/ without bundling/concatenating: each
// source file is transformed in place, one output file per input, same
// relative path — so the ES module graph (import specifiers, directory
// layout) is untouched and dev (`npx serve .`, raw source) and prod
// (`npx serve dist`, this output) both just work off the same index.html/
// sw.js unmodified. Static assets (index.html, sw.js, manifest, icons,
// version.json) are copied through as-is; only JS/CSS gets minified.
import { build } from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'dist');

/** @param {string} dir @returns {Promise<string[]>} */
async function findJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return findJsFiles(full);
      return entry.name.endsWith('.js') ? [full] : [];
    })
  );
  return files.flat();
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const jsEntryPoints = (
    await Promise.all([findJsFiles(path.join(root, 'lib')), findJsFiles(path.join(root, 'components')), findJsFiles(path.join(root, 'pages'))])
  ).flat();
  jsEntryPoints.push(path.join(root, 'app.js'));

  // No `bundle: true` — a transform-only minify per file, so import
  // specifiers (and the directory layout they point at) pass through
  // unchanged rather than getting inlined/rewritten.
  await build({
    entryPoints: jsEntryPoints,
    outdir: outDir,
    outbase: root,
    minify: true,
    format: 'esm',
    target: 'esnext',
    platform: 'browser',
    logLevel: 'info',
  });

  await build({
    entryPoints: [path.join(root, 'styles.css'), path.join(root, 'tokens.css')],
    outdir: outDir,
    outbase: root,
    minify: true,
    logLevel: 'info',
  });

  // sw.js is a classic script (not a module — see its own header
  // comment on why it can't import lib/sprite-cache.js), and small
  // enough that minifying it isn't worth the extra esbuild config for a
  // second loader; the deploy workflow's own CACHE_NAME stamp already
  // runs on this exact copy before this script sees it.
  const passthroughFiles = ['index.html', 'sw.js', 'manifest.webmanifest', 'version.json'];
  await Promise.all(passthroughFiles.map((f) => cp(path.join(root, f), path.join(outDir, f))));
  await cp(path.join(root, 'icons'), path.join(outDir, 'icons'), { recursive: true });

  console.log(`Built to ${path.relative(root, outDir)}/`);
}

main();
