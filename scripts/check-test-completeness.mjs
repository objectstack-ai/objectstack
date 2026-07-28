#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-test-completeness -- every test vitest COUNTED must actually have RUN.
//
// A vitest worker can die at the process level -- native module segfault, OOM,
// an abort inside a binding. There is no JS error to catch, so the cases that
// worker owned never run, and the summary reports what survived:
//
//     Test Files  1 passed (40)
//           Tests  21 passed (401)
//
// That line leads with "passed". It is 380 tests short. #3812 hit exactly this
// (17 cases silently skipped, reported as "22 passed (23)") and it was caught
// by a human reading the log closely, which is not a control.
//
// The run does exit non-zero, so the gate goes red -- the failure mode is not a
// false green, it is a red that READS like a pass. Someone triaging sees
// "passed" and a plausible file count and concludes one file flaked. This turns
// that into a specific, quantified error naming the package and the shortfall.
// It also catches the genuinely dangerous variant, where a crash lands somewhere
// that does not propagate a non-zero exit at all.
//
//   node scripts/check-test-completeness.mjs <turbo-test-log>
//
// Reads a saved `turbo run test` log rather than wrapping vitest, so it needs no
// change to the 60+ per-package vitest configs. In CI the test step tees its
// output here. NOTE the tee: `cmd | tee f` reports TEE's exit status, so the
// workflow sets `set -o pipefail` -- without it a failing test suite would look
// green because tee succeeded.

import { readFileSync } from 'node:fs';

const logPath = process.argv[2];
if (!logPath) {
  console.error('check-test-completeness: usage: check-test-completeness.mjs <turbo-test-log>');
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(logPath, 'utf8');
} catch (err) {
  console.error(`check-test-completeness: cannot read ${logPath} -- ${err.message}`);
  process.exit(1);
}

// Strip ANSI first. vitest colours its summary, and the escape bytes sit
// between the number and its label, so every naive column-based parse of a raw
// log silently reads the wrong field.
const text = raw.replace(/\x1B\[[0-9;]*m/g, '');

// `@objectstack/cli:test:  Tests  381 passed | 3 skipped (384)`
//  ^ turbo prefix (absent when vitest runs directly)   ^ tallies   ^ declared
const SUMMARY = /^(?:(\S+?):test:)?\s*(Test Files|Tests)\s+(.+?)\s+\((\d+)\)\s*$/;

const rows = [];
for (const line of text.split('\n')) {
  const m = line.match(SUMMARY);
  if (!m) continue;
  const [, pkg, kind, tallies, declared] = m;

  // `381 passed | 3 skipped` -> 384. Every bucket counts as "accounted for";
  // a skipped test is a decision, an absent one is a hole.
  const counted = [...tallies.matchAll(/(\d+)\s+[a-z]+/g)].reduce((sum, t) => sum + Number(t[1]), 0);

  rows.push({
    pkg: pkg ?? '(vitest)',
    kind,
    counted,
    declared: Number(declared),
    line: line.trim(),
  });
}

if (rows.length === 0) {
  // Legitimate: `turbo run test --affected` runs nothing when a PR touches no
  // package. Say so out loud rather than reporting a vacuous pass.
  console.log(
    'check-test-completeness: no vitest summaries in the log -- nothing to verify ' +
      '(expected when --affected selects no packages).',
  );
  process.exit(0);
}

const holes = rows.filter((r) => r.counted !== r.declared);

if (holes.length === 0) {
  const tests = rows.filter((r) => r.kind === 'Tests');
  const total = tests.reduce((sum, r) => sum + r.declared, 0);
  console.log(
    `check-test-completeness: OK (${tests.length} package(s), ` +
      `${total} test(s) declared and all ${total} accounted for).`,
  );
  process.exit(0);
}

const plural = holes.length === 1 ? 'summary reports' : 'summaries report';
console.error(`check-test-completeness: ${holes.length} ${plural} fewer results than it counted\n`);
for (const h of holes) {
  const missing = h.declared - h.counted;
  console.error(`  • ${h.pkg} -- ${h.kind}: ${h.counted} of ${h.declared} accounted for, ${missing} missing`);
  console.error(`    ${h.line}`);
}
console.error(`
vitest counted these and then did not report an outcome for all of them. The
usual cause is a worker dying at the process level -- a native module segfault,
OOM, or an abort inside a binding -- which produces no JS error, so the cases
that worker owned never ran and the summary still leads with "passed".

This is not a flake; re-running does not make those tests have run. Reproduce on
the runtime CI uses (see .nvmrc) and look for "Worker exited unexpectedly" or a
non-zero signal exit above the summary.

Precedent: #3812, where a test imported a native better-sqlite3 whose engines
required a newer Node than CI ran. It reported "22 passed (23)" while 17 cases
silently did not run.`);
process.exit(1);
