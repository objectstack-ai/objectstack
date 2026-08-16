#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * pm instruction-surface line ratchet (#7341 item 1, #5925 item 7; per-file
 * extension #8700) — shrink-only ceilings on every file the PM protocol and
 * the dev-agent definition are made of.
 *
 *   node scripts/pm/check-skill-line-ratchet.mjs               # the gate
 *   node scripts/pm/check-skill-line-ratchet.mjs --self-test   # verify the checker
 *
 * ## Why ceilings
 *
 * `.claude/skills/pm-dispatch/SKILL.md` is read in full by every seat session
 * and every Routine fire. It reached 3,013 lines (~235 KB) before #7341's
 * extraction, and 2,568 before the #7885 principles-only rewrite (maintainer
 * ruling 2026-08-12: 「现有的项目经理 skills 应该大幅简化,只需要说原则,不需要
 * 写细节」) landed it at its current ceiling. The ratchet held it at 0% growth
 * — while the UN-ratcheted references/ and os-dev.md grew +31% in one shift
 * (maintainer ruling 2026-08-14: 「8685 字太多了 并且综合审查一下相关的skills是
 * 不是应该压缩字数。」). So the ceiling now covers the whole surface, per file:
 * the main file carries principles; references/ carries on-demand detail
 * (provenance is one line; stories live on cards, not in operational text);
 * incident case law lives in git history (issue-ID dereference is deprecated —
 * see check-skill-id-lint.mjs). Without a gate that intent erodes one
 * well-meaning paragraph at a time.
 *
 * ## The ratchet discipline (shrink-only, per file)
 *
 *   - A ceiling may be LOWERED by any PR that shrinks its file — lowering is
 *     always legitimate and encouraged.
 *   - RAISING one requires a maintainer ruling quoted in the raising PR's body
 *     (the same evidence bar as Guardrails' `.claude/` tooling exception).
 *     A protocol change that would cross a ceiling pays its way by moving
 *     narrative out (SKILL.md → references/) or compressing in place, instead
 *     of raising the roof.
 *   - The headroom between a file's count and its ceiling is the budget for
 *     ordinary rule edits between compressions; it is deliberately small.
 *
 * Missing file or empty read is RED, never a pass (#4690: a gate that cannot
 * find its input must fail, not skip).
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

const REPO_ROOT = new URL('../../', import.meta.url);

// Post-compression counts (#8700 one-time pass; SKILL.md keeps its #7885
// value). Shrink-only: lower freely, raise only with a maintainer ruling
// quoted in the raising PR (see header).
export const CEILINGS = new Map([
  ['.claude/skills/pm-dispatch/SKILL.md', 686],
  ['.claude/skills/pm-dispatch/references/dispatch-runbook.md', 223],
  ['.claude/skills/pm-dispatch/references/platform-readings.md', 134],
  ['.claude/skills/pm-dispatch/references/review-checklist.md', 82],
  ['.claude/skills/pm-dispatch/references/landing-operations.md', 82],
  ['.claude/skills/pm-dispatch/references/seat-post-protocol.md', 101],
  ['.claude/agents/os-dev.md', 399],
]);

export function verdict(rel, lineCount, maxLines) {
  if (lineCount === 0) return { ok: false, msg: `${rel} read as empty — refusing to treat a missing/empty input as a pass (#4690).` };
  if (lineCount > maxLines) {
    return {
      ok: false,
      msg:
        `${rel} is ${lineCount} lines; the ratchet ceiling is ${maxLines}. ` +
        'Keep the surface compressed: principles in SKILL.md, on-demand detail in ' +
        '.claude/skills/pm-dispatch/references/ — provenance is one line, stories live on cards, ' +
        'not in operational text. Raising a ceiling requires a maintainer ruling quoted in the PR.',
    };
  }
  return { ok: true, msg: `${rel} is ${lineCount} lines (ceiling ${maxLines}; headroom ${maxLines - lineCount}).` };
}

function countLines(text) {
  return text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function run() {
  let failed = 0;
  for (const [rel, maxLines] of CEILINGS) {
    let text;
    try {
      text = readFileSync(new URL(rel, REPO_ROOT), 'utf8');
    } catch {
      console.error(`✗ check-skill-line-ratchet: cannot read ${rel} — red, not a skip (#4690).`);
      failed++;
      continue;
    }
    const v = verdict(rel, countLines(text), maxLines);
    if (!v.ok) {
      failed++;
      console.error(`✗ check-skill-line-ratchet: ${v.msg}`);
      continue;
    }
    if (maxLines - countLines(text) > 120) {
      console.log(`ℹ️  ${rel}: headroom is ${maxLines - countLines(text)} lines — consider lowering its ceiling (shrink-only ratchets tighten opportunistically).`);
    }
    console.log(`✓ check-skill-line-ratchet: ${v.msg}`);
  }
  if (failed) process.exit(1);
}

function selfTest() {
  const rel = '.claude/skills/pm-dispatch/SKILL.md';
  const cases = [
    ['under the ceiling -> green', verdict(rel, 2900, 3050).ok, true],
    ['at the ceiling -> green', verdict(rel, 3050, 3050).ok, true],
    ['over the ceiling -> red', verdict(rel, 3051, 3050).ok, false],
    ['red message names the file', verdict(rel, 9999, 3050).msg.includes(rel), true],
    ['red message names the remedy', verdict(rel, 9999, 3050).msg.includes('references/'), true],
    ['red message names the authoring rule', verdict(rel, 9999, 3050).msg.includes('stories live on cards'), true],
    ['empty read -> red, not a skip', verdict(rel, 0, 3050).ok, false],
    ['every covered file has a positive ceiling', [...CEILINGS.values()].every((n) => Number.isInteger(n) && n > 0), true],
    ['SKILL.md is covered', CEILINGS.has('.claude/skills/pm-dispatch/SKILL.md'), true],
    ['the dev-agent definition is covered', CEILINGS.has('.claude/agents/os-dev.md'), true],
    ['all five compressed references are covered', ['dispatch-runbook', 'platform-readings', 'review-checklist', 'landing-operations', 'seat-post-protocol'].every((n) => CEILINGS.has(`.claude/skills/pm-dispatch/references/${n}.md`)), true],
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
