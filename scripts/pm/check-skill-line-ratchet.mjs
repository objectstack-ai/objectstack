#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * pm-dispatch SKILL.md line ratchet (#7341 item 1, #5925 item 7) — a
 * shrink-only ceiling on the hot file every PM seat loads every round.
 *
 *   node scripts/pm/check-skill-line-ratchet.mjs               # the gate
 *   node scripts/pm/check-skill-line-ratchet.mjs --self-test   # verify the checker
 *
 * ## Why a ceiling
 *
 * `.claude/skills/pm-dispatch/SKILL.md` is read in full by every seat session
 * and every Routine fire. It reached 3,013 lines (~235 KB) before #7341's
 * extraction moved the long incident narratives into
 * `.claude/skills/pm-dispatch/references/` (loaded on demand), landing the
 * main file at 2,997 lines. #5925 item 7's approved intent is that the main
 * file's growth rate goes to ZERO: new rules stay in main, new case law lands
 * in `references/incidents.md` (append-only). Without a gate that intent
 * erodes one well-meaning paragraph at a time — the same way the file got to
 * 3,000 in the first place.
 *
 * ## The ratchet discipline (shrink-only)
 *
 *   - MAX_LINES may be LOWERED by any PR that shrinks the file — lowering is
 *     always legitimate and encouraged.
 *   - RAISING it requires a maintainer ruling quoted in the raising PR's body
 *     (the same evidence bar as Guardrails' `.claude/` tooling exception).
 *     A protocol change that would cross the ceiling pays its way by moving
 *     narrative out (references/) instead of raising the roof.
 *   - The headroom between the current count and the ceiling is the budget
 *     for ordinary rule edits between extractions; it is deliberately small.
 *
 * Missing file or empty read is RED, never a pass (#4690: a gate that cannot
 * find its input must fail, not skip).
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

const SKILL_PATH = new URL('../../.claude/skills/pm-dispatch/SKILL.md', import.meta.url);

// Post-#7754-compression count: 2,568 — the #7631 batch's PR₂ moved the
// remaining narratives/沿革/worked examples into references/incidents.md,
// keeping every imperative + criteria/command + one-line case anchor in the
// main file. Shrink-only: lower freely, raise only with a maintainer ruling
// quoted in the raising PR (see header).
export const MAX_LINES = 2568;

export function verdict(lineCount, maxLines) {
  if (lineCount === 0) return { ok: false, msg: 'SKILL.md read as empty — refusing to treat a missing/empty input as a pass (#4690).' };
  if (lineCount > maxLines) {
    return {
      ok: false,
      msg:
        `SKILL.md is ${lineCount} lines; the ratchet ceiling is ${maxLines}. ` +
        'Move narrative to .claude/skills/pm-dispatch/references/ (incidents.md is append-only case law) ' +
        'instead of growing the hot file — raising the ceiling requires a maintainer ruling quoted in the PR.',
    };
  }
  return { ok: true, msg: `SKILL.md is ${lineCount} lines (ceiling ${maxLines}; headroom ${maxLines - lineCount}).` };
}

function run() {
  let text;
  try {
    text = readFileSync(SKILL_PATH, 'utf8');
  } catch {
    console.error('✗ check-skill-line-ratchet: cannot read .claude/skills/pm-dispatch/SKILL.md — red, not a skip (#4690).');
    process.exit(1);
  }
  const lines = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const v = verdict(lines, MAX_LINES);
  if (!v.ok) {
    console.error(`✗ check-skill-line-ratchet: ${v.msg}`);
    process.exit(1);
  }
  if (MAX_LINES - lines > 120) {
    console.log(`ℹ️  headroom is ${MAX_LINES - lines} lines — consider lowering MAX_LINES (shrink-only ratchets tighten opportunistically).`);
  }
  console.log(`✓ check-skill-line-ratchet: ${v.msg}`);
}

function selfTest() {
  const cases = [
    ['under the ceiling -> green', verdict(2900, 3050).ok, true],
    ['at the ceiling -> green', verdict(3050, 3050).ok, true],
    ['over the ceiling -> red', verdict(3051, 3050).ok, false],
    ['red message names the remedy', verdict(9999, 3050).msg.includes('references/'), true],
    ['empty read -> red, not a skip', verdict(0, 3050).ok, false],
  ];
  let failed = 0;
  for (const [name, actual, expected] of cases) {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  if (failed) {
    console.error(`✗ check-skill-line-ratchet self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-skill-line-ratchet self-test: ${cases.length} cases pass.`);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
