#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Writes `docs/audits/2026-07-unknown-key-strictness-ledger.counts.md` — every
 * number the #4001 strictness ledger publishes (#5107).
 *
 * The ledger's prose merged cleanly all through the campaign; its NUMBERS were
 * the whole conflict surface, and they merged in the worst way available — two
 * batches each decrement a header by their own correct delta, git merges the rows
 * without complaint, and the subtotal line, which overlaps nothing, merges clean
 * and wrong. Seven cases in one day. Every correct resolution was the same:
 * recompute from the merged tree.
 *
 * So the numbers are generated, the artifact carries `merge=os-regen` (#4675),
 * and recomputation is enforced by the pre-commit half of that driver rather than
 * remembered. Regeneration is WHOLESALE — this script never patches a number in
 * place, and neither should you.
 *
 * The verdicts stay hand-written in the ledger. This script reads them (a
 * subtotal is arithmetic over a judgement) and never writes to that file.
 *
 * Usage:
 *   tsx build-strictness-ledger-counts.mts     # rewrite the artifact
 *
 * Freshness is proved by `check:strictness-ledger`, which renders the same model
 * and compares bytes — deliberately not a second parser.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { COUNTS_PATH, loadLedger } from './lib/strictness-ledger-doc';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');
const REPO = path.resolve(SPEC, '../..');
const SRC = path.join(SPEC, 'src');

const { countsPath, rendered, problems, model } = loadLedger(REPO, SRC);

fs.writeFileSync(countsPath, rendered);

console.log(`✓ wrote ${COUNTS_PATH}`);
console.log(
  `  ${model.global.sites} site(s) across ${model.global.dirs} triaged director(ies); ` +
    `${model.global.strip} strip site(s) in ${model.global.openFiles} file(s).`,
);

if (problems.length) {
  // Written anyway, on purpose: the post-merge regeneration this whole scheme
  // rests on must not be blockable by a ledger defect, and `check:` fails on the
  // same problems a moment later. What must never happen is a defect becoming an
  // invisible zero, so it is counted as `unclassified` and named here.
  console.error(`\n⚠ ${problems.length} ledger defect(s) — the artifact records them as \`unclassified\`:\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  console.error('  check:strictness-ledger will fail on these.');
}
