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
 * ## What is covered — and the published catalog, which deliberately is not
 *
 * "The whole surface" above means the CEILINGS map below, which is an
 * ENUMERATION, never a root glob: the pm-dispatch surface (SKILL.md, its
 * references/, the per-lane job descriptions), the four other
 * `.claude/skills/` playbook SKILL.md files, the dev-agent definition
 * `.claude/agents/os-dev.md`, and the root `AGENTS.md`. Read a file's absence
 * from the map as a fact to check, not an oversight to infer — `.claude/hooks/`,
 * `.claude/settings.json` and `CLAUDE.md` carry no ceiling either.
 *
 * The **published** `skills/` catalog — the one that ships to customer projects
 * — is deliberately OUTSIDE the ceiling. It is the omission worth stating
 * because it is by far the larger surface: eleven published SKILL.md totalling
 * ~10,400 lines, against ~3,700 covered here. Two reasons, both about the cost
 * curve the ratchet prices rather than about size (#9923):
 *
 *   - What the ratchet prices is a full-file token read paid PER SEAT SESSION
 *     and PER ROUTINE FIRE, which is what every covered file above costs. The
 *     published catalog is read by customer projects, not by this repo's seats
 *     — a different cost curve, and not the one this gate was built against.
 *   - The published catalog is already a governed, human-merge-only surface
 *     (Prime Directive #14), so growth there passes a human eye by
 *     construction — a control a ratchet would merely duplicate. Note this
 *     reason does not separate the two roots by itself: the covered files are
 *     governed at merge too. What no reviewer prices THERE is the recurring
 *     per-session read of reason one, which is why they still carry ceilings
 *     and the published catalog does not.
 *
 * Extending coverage to the published root is therefore a POLICY CHANGE, not a
 * maintenance edit: it needs its own card and a maintainer's ruling, not a
 * CEILINGS row added in passing. The self-test pins this boundary, because
 * enforcement cannot — a published-root entry would run perfectly green.
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
  ['.claude/skills/pm-dispatch/SKILL.md', 682],
  // Raised 223 → 244 by the triage reading-cost card (maintainer ruling
  // 2026-08-20, quoted in the raising PR): three mandated conventions land in
  // the runbook's triage sections. Landed count, headroom 0, same convention.
  ['.claude/skills/pm-dispatch/references/dispatch-runbook.md', 244],
  ['.claude/skills/pm-dispatch/references/platform-readings.md', 134],
  ['.claude/skills/pm-dispatch/references/review-checklist.md', 82],
  ['.claude/skills/pm-dispatch/references/landing-operations.md', 82],
  ['.claude/skills/pm-dispatch/references/seat-post-protocol.md', 101],
  // Lane job descriptions (maintainer ruling 2026-08-19: per-lane PM job
  // descriptions move from seat-post prose into versioned skill references).
  // Set at landed line counts (headroom 0, same convention as above).
  ['.claude/skills/pm-dispatch/references/lanes/engine.md', 41],
  ['.claude/skills/pm-dispatch/references/lanes/services.md', 31],
  ['.claude/skills/pm-dispatch/references/lanes/cli.md', 37],
  ['.claude/skills/pm-dispatch/references/lanes/devx.md', 38],
  ['.claude/skills/pm-dispatch/references/lanes/skills.md', 36],
  ['.claude/skills/pm-dispatch/references/lanes/spec.md', 44],
  ['.claude/agents/os-dev.md', 399],
  // #9473: the other four `.claude/skills/` are read in full by the sessions
  // that use them too — the erosion mechanism the ratchet exists to stop
  // isn't specific to the pm-dispatch surface. Set at current counts on
  // `origin/main` (headroom 0, same convention as the entries above).
  ['.claude/skills/checklist-test/SKILL.md', 232],
  ['.claude/skills/checklist-author/SKILL.md', 61],
  ['.claude/skills/dogfood-verification/SKILL.md', 155],
  ['.claude/skills/spec-property-retirement/SKILL.md', 328],
  // #9792: root AGENTS.md is the largest, most-read, most binding instruction
  // file in the repo and had no ceiling — the hole the oversized 39-line
  // read-layer clause (compacted by #9715) entered through. Set at its line
  // count on `origin/main` after #9715 landed (headroom 0, same convention).
  //
  // 958 → 961 (#10126): the ONE raise this map has taken, by the header's own
  // escape hatch. The queue-incident remediation adds a three-line convention to
  // § Build & Test — clocked windows measure behaviour, never loading — and the
  // section it joins had two lines of lossless rewrap headroom against a
  // three-line cost, so it could not be paid for in place. Maintainer ruling
  // 2026-08-20, verbatim and untranslated: 「A — 抬上限到 961 (Recommended)」
  // (issue #10126, comment 5353111732). Headroom is 0 again by construction, and
  // the next author needing a line is back to compressing.
  ['AGENTS.md', 961],
]);

/**
 * The repo-ROOT files of the map above, spelled so `scripts/pm/dispatch-gates.mjs`
 * can derive this gate from a card that touches one.
 *
 * ## The gap this closes
 *
 * That tool reads a gate's population out of the path literals in the gate's own
 * source, and "looks like a path" there means "carries a separator" (plus a short
 * allowlist of dotted top-level dirs). Every key above satisfies that except
 * `AGENTS.md` — a repo-root FILE has no separator to be found by. So the map's
 * eighteen entries yielded seventeen watch hints, an AGENTS.md card derived ZERO
 * gates, and the dev met this ratchet as red CI instead of as a local command.
 * That lands on the largest ceiling in the map at headroom 0, where one added
 * paragraph crosses it. CI still enforces either way (lint.yml carries no path
 * filter) — what was missing was discoverability, and this restores it.
 *
 * ## Why the subtree spelling, and why it covers exactly one file
 *
 * `<file>/**` is the only form that reaches a repo-root file: the extractor
 * requires the separator, and dispatch-gates collapses a hint's globs before
 * comparing, which reduces this back to `AGENTS.md` and matches that path alone.
 * Nothing in the tree lives under `AGENTS.md/`, so it claims no directory —
 * measured at exactly one (gate, file) pair added, one family gaining coverage.
 *
 * The alternative was widening the extractor to accept bare top-level `*.md`
 * literals. Measured over 114 families x 6326 tracked files it is cheap by
 * VOLUME (+17 pairs) and fails on PROVENANCE: 8 of those 17 are fabricated,
 * because gates spell `README.md` and `CHANGELOG.md` as BASENAMES they join with
 * a package directory (a manifest `files` entry, a per-package exclusion, a
 * remote directory listing). A README.md card would come back with six leads of
 * which five name a gate that never reads that file — the false-lead class
 * dispatch-gates' own header errs against, one extension over from the
 * `package.json` basenames it already refuses.
 *
 * ## This is provenance, NOT a lookup key
 *
 * `run` opens files through CEILINGS. This list is read by nothing in this
 * script, and deliberately does not live in that map: a key rewritten into the
 * glob form would send the ratchet looking for a file that does not exist. The
 * self-test pins both halves — every separator-less ceiling is declared here,
 * and nothing declared here is a CEILINGS key.
 */
export const ROOT_FILE_WATCH_HINTS = ['AGENTS.md/**'];

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
    ['all six lane job descriptions are covered', ['engine', 'services', 'cli', 'devx', 'skills', 'spec'].every((n) => CEILINGS.has(`.claude/skills/pm-dispatch/references/lanes/${n}.md`)), true],
    ['the other four skills are covered (#9473)', ['checklist-test', 'checklist-author', 'dogfood-verification', 'spec-property-retirement'].every((n) => CEILINGS.has(`.claude/skills/${n}/SKILL.md`)), true],
    ['root AGENTS.md is covered (#9792)', CEILINGS.has('AGENTS.md'), true],
    // The dispatch-gates declaration (#9964). Enforcement cannot hold any of
    // these: the declaration is read by another tool entirely, so a wrong or
    // missing entry runs perfectly green here and only shows up as a dev
    // dispatched on a root-file card with an empty gate brief.
    ['every separator-less ceiling declares a root-file watch hint', [...CEILINGS.keys()].filter((k) => !k.includes('/')).every((k) => ROOT_FILE_WATCH_HINTS.includes(`${k}/**`)), true],
    ['and the declaration names no file the map does not cover', ROOT_FILE_WATCH_HINTS.every((h) => CEILINGS.has(h.replace(/\/\*+$/, ''))), true],
    ['AGENTS.md is the root file it declares', ROOT_FILE_WATCH_HINTS.includes('AGENTS.md/**'), true],
    // Provenance, never a lookup key: `run` opens every CEILINGS key, so the
    // glob form appearing there would make the ratchet read a path that does
    // not exist — red under #4690's cannot-read rule, for a file that is fine.
    ['the declared form is NOT a CEILINGS key', [...CEILINGS.keys()].some((k) => ROOT_FILE_WATCH_HINTS.includes(k)), false],
    // The boundary the header states, pinned (#9923). Enforcement cannot hold
    // it: a ceiling on a real published SKILL.md runs green like any other row,
    // so without this case the header paragraph could drift from the map
    // silently. Extending coverage to the published catalog is a policy change
    // — it lands with a maintainer ruling that also deletes this case.
    ['the published skills/ catalog is deliberately uncovered', [...CEILINGS.keys()].some((k) => k.startsWith('skills/')), false],
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
