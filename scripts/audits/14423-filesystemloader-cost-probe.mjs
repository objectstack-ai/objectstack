#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14423 step 1 (census) — real FilesystemLoader/NodeMetadataManager timing:
// loadMany() (one glob + N reads) vs listNames() + N x loadDiagnosed() (one
// EXTRA glob, then N x [up to K fs.access stats + one read] via findFile()).
// MEASUREMENT ONLY — ships nothing, no source changed.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeMetadataManager } from '../../packages/metadata/dist/node.js';

const N = 50;
const root = await mkdtemp(join(tmpdir(), 'os-14423-fsloader-cost-'));
await mkdir(join(root, 'action'), { recursive: true });
for (let i = 0; i < N; i++) {
  await writeFile(join(root, 'action', `action_${i}.json`), JSON.stringify({ type: 'script', target: `action_${i}` }), 'utf8');
}

const meta = new NodeMetadataManager({ rootDir: root });

// Warm the OS file-stat cache identically for both measurements: run each
// scenario twice, keep the SECOND timing, so page-cache effects don't favor
// whichever scenario runs first.
async function timeLoadMany() {
  const t0 = performance.now();
  const items = await meta.loadMany('action');
  return { ms: performance.now() - t0, count: items.length };
}
async function timeListNamesPlusLoad() {
  const t0 = performance.now();
  const names = await meta.listNames('action');
  for (const n of names) await meta.loadDiagnosed('action', n);
  return { ms: performance.now() - t0, count: names.length };
}

await timeLoadMany(); await timeListNamesPlusLoad(); // warm-up, discarded
const a = await timeLoadMany();
const b = await timeListNamesPlusLoad();

console.log(JSON.stringify({
  itemCount: N,
  loadMany: a,
  listNamesPlusLoad: b,
  ratio: (b.ms / a.ms).toFixed(2),
}, null, 2));

await rm(root, { recursive: true, force: true });
