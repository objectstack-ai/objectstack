#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Prints what a docs deployment uploads, by part: the Build Output API tree
 * `vercel build` writes (`.vercel/output`) PLUS the files its functions pull in
 * from the repository.
 *
 *   node apps/docs/scripts/measure-deploy-output.mjs                  # from the repo root
 *   node apps/docs/scripts/measure-deploy-output.mjs --root <repo-root>
 *   node apps/docs/scripts/measure-deploy-output.mjs --json
 *
 * Read-only, offline, no credentials: run it after any `vercel build` (the
 * Docs Deploy workflow's, or a local one).
 *
 * ## Why the output directory alone is the wrong number
 *
 * A function directory under `.vercel/output/functions/` holds little more than
 * its `.vc-config.json`. The code it runs -- the route's chunks under
 * `apps/docs/.next/server` and the traced `node_modules` -- is listed in that
 * file's `filePathMap` and uploaded from the repository by `vercel deploy
 * --prebuilt`. `du .vercel/output` therefore misses the function code entirely.
 * The two halves together reproduce the CLI's own file count (its "Downloading N
 * deployment files" line): every output entry, symbolic links included, plus
 * every distinct `filePathMap` file.
 *
 * ## Why sizes are by content
 *
 * The upload is content-addressed: a file is sent once per distinct SHA-1,
 * however many paths carry it (a symlinked function, a segment file identical
 * to its page's `.rsc`, a layout segment every page shares). Bytes are summed
 * over distinct contents, each counted in the first part that holds it, so the
 * parts add up to the total.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const json = args.includes('--json');
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex === -1 ? process.cwd() : args[rootIndex + 1]);
const output = join(root, '.vercel', 'output');

if (!existsSync(join(output, 'config.json'))) {
  console.error(
    `measure-deploy-output: no Build Output API tree at ${output} (no config.json). ` +
      'Run `vercel build` from the repository root first, or pass --root <repo-root>.',
  );
  process.exit(2);
}

/** The part a path in `.vercel/output` belongs to, in a reader's words. */
function outputPart(rel) {
  const p = rel.split(sep).join('/');
  if (p.startsWith('static/')) {
    return p === 'static/llms-full.txt' ? 'static: llms-full.txt' : 'static: assets and public/';
  }
  if (p.startsWith('functions/og/')) return 'OG images (prerendered)';
  if (p.startsWith('functions/llms.mdx/')) return 'llms.mdx bodies (prerendered)';
  if (/^functions\/en(\/|\.)/.test(p)) {
    if (p.includes('.segments/')) return 'pages: RSC segment files';
    if (p.endsWith('.html')) return 'pages: HTML (prerendered)';
    if (p.endsWith('.rsc')) return 'pages: full RSC (prerendered)';
    return 'pages: prerender configs';
  }
  if (p.endsWith('.vc-config.json')) return 'function configs';
  return 'other output';
}

const parts = new Map();
const seen = new Set();
let entries = 0;
let links = 0;

function add(part, file) {
  const body = readFileSync(file);
  const sha = createHash('sha1').update(body).digest('hex');
  if (seen.has(sha)) return;
  seen.add(sha);
  const row = parts.get(part) ?? { bytes: 0, files: 0 };
  row.bytes += body.length;
  row.files += 1;
  parts.set(part, row);
}

const funcs = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      entries += 1;
      links += 1;
      continue;
    }
    if (stat.isDirectory()) {
      if (name.endsWith('.func')) funcs.push(path);
      walk(path);
      continue;
    }
    entries += 1;
    add(outputPart(relative(output, path)), path);
  }
}
walk(output);

const traced = new Set();
const listed = new Set();
const functions = [];
for (const func of funcs) {
  const config = JSON.parse(readFileSync(join(func, '.vc-config.json'), 'utf8'));
  const map = config.filePathMap ?? {};
  let bytes = 0;
  for (const from of Object.values(map)) {
    // Counted as the CLI counts it: one deployment file per distinct map entry,
    // whatever is on disk at that path.
    listed.add(from);
    const path = join(root, from);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    bytes += statSync(path).size;
    traced.add(from);
  }
  functions.push({ function: relative(join(output, 'functions'), func), files: Object.keys(map).length, bytes });
}
for (const from of [...traced].sort()) {
  add(from.startsWith('apps/docs/.next/') ? 'function code: apps/docs/.next' : 'function code: node_modules', join(root, from));
}

const rows = [...parts.entries()]
  .map(([part, row]) => ({ part, ...row }))
  .sort((a, b) => b.bytes - a.bytes);
const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
const totalFiles = rows.reduce((sum, row) => sum + row.files, 0);
const deploymentFiles = entries + listed.size;

if (json) {
  console.log(
    JSON.stringify(
      { root, deploymentFiles, outputEntries: entries, outputLinks: links, tracedEntries: listed.size, tracedFiles: traced.size, uniqueFiles: totalFiles, uniqueBytes: totalBytes, parts: rows, functions },
      null,
      2,
    ),
  );
} else {
  const mib = (bytes) => (bytes / 2 ** 20).toFixed(1).padStart(8);
  console.log(`Docs deploy output at ${output}`);
  console.log(
    `Deployment files: ${deploymentFiles} (${entries} output entries, ${links} of them symbolic links, + ${listed.size} traced repository entries)`,
  );
  console.log(`Distinct contents: ${totalFiles} files, ${(totalBytes / 2 ** 20).toFixed(1)} MiB`);
  console.log('');
  console.log('     MiB  share   files  part');
  for (const row of rows) {
    const share = ((100 * row.bytes) / totalBytes).toFixed(1).padStart(5);
    console.log(`${mib(row.bytes)} ${share}% ${String(row.files).padStart(7)}  ${row.part}`);
  }
  console.log('');
  console.log('Functions (filePathMap, before de-duplication):');
  for (const f of functions.sort((a, b) => b.bytes - a.bytes)) {
    console.log(`${mib(f.bytes)} MiB ${String(f.files).padStart(6)} files  ${f.function}`);
  }
}
