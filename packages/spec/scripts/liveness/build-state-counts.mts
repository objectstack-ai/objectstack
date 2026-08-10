#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Writes `packages/spec/liveness/state-counts.md` — every number the liveness
 * ledger's "Current state" table used to publish by hand (#7377).
 *
 * The table's Notes prose merged cleanly for a year; its NUMBERS drifted from the
 * gate on 9 of 30 rows and nothing could see it, because the count columns were
 * hand-maintained and hand-maintained counts merge in the one way that hides. Two
 * PRs each move a different row by their own correct delta, the rows do not
 * overlap, git composes them without complaint, and the table publishes a state
 * nobody measured. #5107 met the identical shape in the strictness ledger and
 * counted seven cases in a single day; its resolution — the numbers become a
 * generated artifact carrying `merge=os-regen`, the prose stays hand-written — is
 * the one adopted here.
 *
 * ## Where the numbers come from, and why this script does not compute them
 *
 * From `check-liveness.mts --json`, run as a child process. That is the counting
 * method the README has declared since #4488 ("the gate's own report"), and it is
 * deliberately not re-implemented here: a second walker would be a second
 * definition of "what is classified", and when two definitions disagree the one
 * that wins is whichever the artifact happens to be rendered from. The gate is
 * what CI enforces, so the gate is what gets published.
 *
 * Its exit code is ignored ON PURPOSE. The gate exits 1 while this very artifact
 * is stale — which is the state a regeneration is run FROM — so honouring it would
 * make the fix unreachable from the failure. The JSON is emitted before the
 * verdict, so a non-zero exit still carries a complete report. What is never
 * ignored is a crash: no parseable JSON means no write, because an artifact
 * written from a half-measurement is worse than a stale one.
 *
 * ## The skeleton rows
 *
 * #7257 gave the old python snippet one behaviour a plain regenerate does not
 * have: it read the README back and printed a SKELETON row for any governed type
 * that had none, so the omission was visible at regeneration time and not only at
 * CI time. `api` and `capability` were governed, ledgered and counted for days
 * with no row, because the only reader who could have noticed was a human
 * comparing two lists by eye. That behaviour moves here, unchanged in substance:
 * the skeleton stops at the type name and prints a marker where the Notes cell
 * goes, never a guess at what belongs there.
 *
 * Regeneration is WHOLESALE — this script never patches a number in place, and
 * neither should you.
 *
 * Usage:
 *   tsx build-state-counts.mts     # rewrite the artifact
 *
 * Freshness is proved by `check:liveness`, which renders the same model and
 * compares bytes — deliberately not a second parser.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STATE_COUNTS_FILE,
  STATE_COUNTS_PATH,
  foldStateCounts,
  parseStateTable,
  renderStateCounts,
} from './readme-table.mts';

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = resolve(here, '../..'); // packages/spec
const ledgerRoot = join(specRoot, 'liveness');
const gate = join(here, 'check-liveness.mts');

// `tsx/cli` rather than the `.bin/tsx` shim: the shim is a shell script, so it is
// not spawnable by `process.execPath` and its resolution depends on which
// node_modules/.bin happens to be on PATH. The module export is the same CLI and
// resolves through the package graph.
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

const run = spawnSync(process.execPath, [tsxCli, gate, '--json'], {
  cwd: specRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

// A crash is fatal; a red verdict is not. See the header — the gate is red
// precisely when this artifact needs rewriting.
let report: { types?: Record<string, { byStatus?: Record<string, number> }>; readmeMissingRows?: string[] };
try {
  report = JSON.parse(run.stdout || '');
} catch {
  console.error(`✗ ${gate} --json produced no parseable report — refusing to write ${STATE_COUNTS_FILE}.`);
  console.error('  Nothing is written from a half-measurement; a stale artifact is the safer state.\n');
  if (run.error) console.error(`  ${run.error.message}`);
  if (run.stderr) console.error(run.stderr);
  process.exit(1);
}

const types = report.types ?? {};
// The gate reports one entry per GOVERNED type, in GOVERNED order, so the report's
// own key order IS the artifact's row order. Reading it back from the report keeps
// this script from carrying a second copy of the governed list.
const rows = foldStateCounts(Object.keys(types), Object.fromEntries(
  Object.entries(types).map(([t, v]) => [t, v.byStatus ?? {}]),
));

const rendered = renderStateCounts(rows);
writeFileSync(join(ledgerRoot, STATE_COUNTS_FILE), rendered);

const total = rows.reduce((a, r) => a + r.live + r.experimental + r.dead + r.planned, 0);
console.log(`✓ wrote ${STATE_COUNTS_PATH}`);
console.log(`  ${rows.length} governed type(s), ${total} classified propert(ies).`);

// ── the #7257 skeleton, preserved ──
// Prefer the gate's own reconciliation when the report carries it; fall back to a
// direct read only if an older report shape is being parsed, so the two can never
// answer differently on a report that has the field.
const readmeFile = join(ledgerRoot, 'README.md');
const missing = report.readmeMissingRows
  ?? (existsSync(readmeFile)
    ? (() => {
        const have = new Set(parseStateTable(readFileSync(readmeFile, 'utf8')).rows.map((r) => r.type));
        return rows.map((r) => r.type).filter((t) => !have.has(t));
      })()
    : []);

if (missing.length) {
  console.log(
    `\n⚠ ${missing.length} governed type(s) counted above have NO row in README.md's ` +
      '"Current state" table.\n' +
      '  Paste the skeleton(s) below into the table and write the Notes cell BY\n' +
      '  MEASUREMENT — the seeding PR, what it measured, which keys are dead and why.\n' +
      '  Never infer one from the counts or from the type\'s name.\n',
  );
  for (const t of missing) {
    console.log(
      `| ${t} | **NO ROW YET (#7257) — write this Notes cell from the seeding PR measurement, never from a guess** |`,
    );
  }
  console.log('\n  check:liveness will fail until every governed type has a row.');
}
