#!/usr/bin/env node
// Production build (docs/adr/0002's "no framework" is a separate
// decision from "no build tooling" — see that ADR's own note). Bundles
// the entire JS module graph (app.js and everything it imports from
// lib/ and components/) into a single dist/app.js, and minifies the
// CSS. Dev (`npx serve .`, raw source) still runs the real, unbundled
// module graph directly — only prod (`npx serve dist`) gets the
// bundle — so index.html and sw.js's SHELL_PATHS (see docs/adr/0004)
// only need to name the files that actually exist in dist/, not every
// source module.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'dist');

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // `bundle: true`, single entry point: esbuild inlines the whole
  // import graph (lib/, components/) into one dist/app.js, so prod no
  // longer makes a per-module request for every file the app is made
  // of. `sourcemap: true` (a real .map file, referenced via a trailing
  // `//# sourceMappingURL=` comment, not inlined) is deliberate for a
  // fully open-source app with nothing to hide in its minified output —
  // a live bug report is debuggable against original file/line numbers
  // and comments in DevTools without reproducing locally first. Browsers
  // only fetch a .map when DevTools is actually open, so this costs
  // ordinary visitors nothing.
  await build({
    entryPoints: [path.join(root, 'app.ts')],
    outdir: outDir,
    outbase: root,
    bundle: true,
    minify: true,
    sourcemap: true,
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
    sourcemap: true,
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
