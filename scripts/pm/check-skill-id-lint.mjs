#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * pm-skill issue-ID lint — operative agent-protocol text must not cite issue
 * numbers.
 *
 *   node scripts/pm/check-skill-id-lint.mjs               # the gate
 *   node scripts/pm/check-skill-id-lint.mjs --self-test   # verify the checker
 *
 * ## Why
 *
 * Maintainer ruling, 2026-08-12 (verbatim, untranslated): 「立一张结构卡,我觉的
 * 处理 issue 时犯的错应该总结成经验,保留 issue id没有意义,如果ai去查原始issue,
 * 得不偿失。」 Incident learnings are distilled into the rules themselves as
 * self-contained lessons (failure mode + discipline + boundary); an issue-ID
 * citation invites the reader to dereference history, which costs more than it
 * returns. Maintainer-ruling provenance keeps DATE + VERBATIM QUOTE — numbers go.
 *
 * ## What it scans
 *
 * Every .md file under .claude/skills/pm-dispatch/ (the PM operating protocol,
 * including its references/), plus .claude/agents/os-dev.md (the dev-side twin)
 * and AGENTS.md (the repo-wide agent instruction file, rewritten to the same
 * principles-only standard). The pattern is /#[0-9]{3,}/ — real issue/PR numbers
 * in this repo are 3+ digits, while placeholders (`#<n>`, `#N`, `epic:#<n>`),
 * Prime-Directive cross-references (`#14`) and small literals (`#12 #34` in the
 * argument-syntax example) stay legal.
 *
 * ## The legacy-waiver mechanism (LEGACY_EXACT), currently unused
 *
 * A file rewritten to this standard in a DIFFERENT PR than the one that adds it
 * to the scan set needs merge-order independence: an EXACT legacy count lets the
 * file pass only at its recorded pre-rewrite value (untouched legacy) or at 0
 * (rewritten) — any other count is red, so nobody can add an ID and a partial
 * cleanup must finish the job. os-dev.md used this for its own rewrite; its
 * entry became dead weight once that landed (worse: it would have re-admitted
 * exactly 81 IDs) and was deleted. AGENTS.md needs no entry — its rewrite and
 * its scan-set addition travel in the same PR. The mechanism stays for the next
 * split rewrite; the self-test exercises it with a synthetic entry.
 *
 * Missing file or empty read is RED, never a pass — a gate that cannot find its
 * input must fail, not skip.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');

export const SCAN_ROOT = '.claude/skills/pm-dispatch';
export const EXTRA_FILES = ['.claude/agents/os-dev.md', 'AGENTS.md'];
export const ID_PATTERN = /#[0-9]{3,}/g;

// Exact-count legacy waiver (see header): pass iff count === legacy || count === 0.
export const LEGACY_EXACT = new Map([]);

function mdFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...mdFilesUnder(p));
    else if (entry.endsWith('.md')) out.push(p);
  }
  return out;
}

export function verdictFor(rel, matchCount) {
  const legacy = LEGACY_EXACT.get(rel);
  if (legacy !== undefined) {
    if (matchCount === 0 || matchCount === legacy) return { ok: true };
    return {
      ok: false,
      msg:
        `${rel}: ${matchCount} issue-ID citation(s); the legacy waiver allows exactly ${legacy} ` +
        '(the untouched pre-rewrite file) or 0 (the principles-only rewrite). Do not add IDs; ' +
        'a partial cleanup must go to zero.',
    };
  }
  if (matchCount > 0) {
    return {
      ok: false,
      msg:
        `${rel}: ${matchCount} issue-ID citation(s) — operative text carries lessons ` +
        'self-contained (failure mode + discipline + boundary); rulings keep date + verbatim ' +
        'quote, numbers go (maintainer ruling 2026-08-12).',
    };
  }
  return { ok: true };
}

function run() {
  const targets = [];
  try {
    targets.push(...mdFilesUnder(join(REPO_ROOT, SCAN_ROOT)));
  } catch {
    console.error(`✗ check-skill-id-lint: cannot read ${SCAN_ROOT} — red, not a skip.`);
    process.exit(1);
  }
  for (const extra of EXTRA_FILES) targets.push(join(REPO_ROOT, extra));

  let failed = 0;
  let scanned = 0;
  for (const abs of targets) {
    const rel = relative(REPO_ROOT, abs).replace(/\\/g, '/');
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      console.error(`✗ check-skill-id-lint: cannot read ${rel} — red, not a skip.`);
      failed++;
      continue;
    }
    if (text.length === 0) {
      console.error(`✗ check-skill-id-lint: ${rel} read as empty — red, not a skip.`);
      failed++;
      continue;
    }
    scanned++;
    const count = (text.match(ID_PATTERN) ?? []).length;
    const v = verdictFor(rel, count);
    if (!v.ok) {
      failed++;
      console.error(`✗ check-skill-id-lint: ${v.msg}`);
      // name the first few offending lines so the fix needs no second scan
      let shown = 0;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && shown < 5; i++) {
        if (ID_PATTERN.test(lines[i])) {
          console.error(`    ${rel}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
          shown++;
        }
        ID_PATTERN.lastIndex = 0;
      }
    }
  }
  if (failed) process.exit(1);
  console.log(`✓ check-skill-id-lint: ${scanned} file(s) clean (pattern ${ID_PATTERN}).`);
}

function selfTest() {
  // The waiver mechanism is tested with a synthetic entry so it stays covered
  // while LEGACY_EXACT is empty (see header).
  LEGACY_EXACT.set('synthetic-legacy.md', 81);
  const cases = [
    ['clean file -> green', verdictFor('x.md', 0).ok, true],
    ['one ID -> red', verdictFor('x.md', 1).ok, false],
    ['un-waived scanned files carry no waiver', LEGACY_EXACT.has('.claude/agents/os-dev.md') || LEGACY_EXACT.has('AGENTS.md'), false],
    ['legacy file at exact count -> green', verdictFor('synthetic-legacy.md', 81).ok, true],
    ['legacy file at zero -> green', verdictFor('synthetic-legacy.md', 0).ok, true],
    ['legacy file grew -> red', verdictFor('synthetic-legacy.md', 82).ok, false],
    ['legacy file partially cleaned -> red', verdictFor('synthetic-legacy.md', 40).ok, false],
    ['red message names the standard', verdictFor('x.md', 2).msg.includes('self-contained'), true],
    ['placeholders stay legal', ('#<n> #N epic:#<n> #12 #34'.match(ID_PATTERN) ?? []).length, 0],
    ['real IDs match', ('see #4650 and #12345'.match(ID_PATTERN) ?? []).length, 2],
  ];
  let failed = 0;
  for (const [name, actual, expected] of cases) {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  LEGACY_EXACT.delete('synthetic-legacy.md');
  if (failed) {
    console.error(`✗ check-skill-id-lint self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-skill-id-lint self-test: ${cases.length} cases pass.`);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
