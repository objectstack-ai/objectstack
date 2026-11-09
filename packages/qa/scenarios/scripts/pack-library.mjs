#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The package build's last step: copy the OPEN card library into
// `dist/library/`, keeping the repository's layout, so the published CLI runs
// the cards with no checkout (`src/runner/library.ts` reads it back):
//
//   docs/qa/scenarios/*.json                  → dist/library/docs/qa/scenarios/
//   docs/qa/platform-checklist/areas/*.json   → dist/library/docs/qa/platform-checklist/areas/
//
// ⛔ Only these two directories of THIS repository, one level deep, regular
// `.json` files only. The private overlay (held-out and customer-derived
// cards, objectstack-ai/cloud#3603) lives outside this repository and has no
// path in here; `test/build/packed-tarball.test.ts` packs the package and
// fails on any card in the tarball that is not byte for byte a card of
// `docs/qa/scenarios/`.
//
// turbo re-runs the build when either directory changes: the package's
// `turbo.json` adds them to the build's inputs.

import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PKG, '../../..');
const OUT = join(PKG, 'dist/library');
const DIRS = ['docs/qa/scenarios', 'docs/qa/platform-checklist/areas'];

rmSync(OUT, { recursive: true, force: true });
const counts = [];
for (const dir of DIRS) {
  const from = join(REPO, dir);
  const to = join(OUT, dir);
  mkdirSync(to, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(from).sort()) {
    if (!name.endsWith('.json') || !lstatSync(join(from, name)).isFile()) continue;
    copyFileSync(join(from, name), join(to, name));
    copied++;
  }
  if (copied === 0) {
    console.error(`pack-library: no .json file under ${dir}: the published CLI would have nothing to run`);
    process.exit(1);
  }
  counts.push(`${copied} from ${dir}`);
}
console.log(`pack-library: ${counts.join(', ')} → ${OUT}`);
