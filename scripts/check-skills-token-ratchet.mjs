#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * published-skills TOKEN ratchet (#10473) — shrink-only ceilings on every
 * SKILL.md in the catalog that ships to customer projects.
 *
 *   node scripts/check-skills-token-ratchet.mjs               # the gate
 *   node scripts/check-skills-token-ratchet.mjs --self-test   # verify the checker
 *
 * ## Why a ceiling here at all
 *
 * Maintainer ruling, 2026-08-21, on PR #10402 (verbatim, untranslated):
 * 「10402 需要整体考虑 skills 的长度,不能为了一个小功能扩写很多。」 That PR had
 * added +111 lines to the published bundle for one small feature. The principle
 * was established; nothing enforced it, and the only control left was a
 * reviewer remembering the ruling — which this board's history says is the
 * expensive way to rediscover a rule.
 *
 * `skills/` is loaded WHOLE into customer agent context windows. Its length is
 * therefore not a repo-hygiene question: it is a per-token cost paid again in
 * every customer session, in every customer project, forever. That is the cost
 * curve this gate prices.
 *
 * ## Relationship to the `.claude/**` line ratchet
 *
 * `scripts/pm/check-skill-line-ratchet.mjs` is the proven precedent and this
 * gate mirrors its discipline deliberately. The two are SEPARATE gates over
 * SEPARATE roots, and that separation is the design, not an accident:
 *
 *   - that one prices `.claude/**` in LINES, a surface read per seat session
 *     and per Routine fire inside THIS repo;
 *   - this one prices `skills/**` in TOKENS, a surface read by customer
 *     projects.
 *
 * Its header states that the published catalog is outside ITS map and that
 * extending coverage there is a policy change needing a maintainer's ruling.
 * That ruling is the one quoted above, and this file is how it landed — as a
 * second gate with its own cost unit, rather than as a row bolted onto a map
 * built for a different unit. Its self-test still correctly pins that no
 * `skills/` key appears in ITS map.
 *
 * ## The counting convention — `ceil(utf8 bytes / 4)`, and its limits
 *
 * Tokens, not lines, because tokens are what a context window is billed in: a
 * re-wrap that halves the line count changes the customer's cost by nothing.
 *
 * The count is `Math.ceil(Buffer.byteLength(text, 'utf8') / 4)`. Three reasons
 * this beats a real tokenizer HERE:
 *
 *   - DETERMINISM. A ratchet's numbers are pinned constants. A tokenizer's
 *     output is a function of its vocabulary version, so a dependency bump
 *     would silently re-price all eleven ceilings — a ratchet that moves when
 *     nobody edited a file is not a ratchet.
 *   - NO DEPENDENCY. The workspace carries no tokenizer today (checked at
 *     landing: no `tiktoken` / `gpt-tokenizer` / `gpt-3-encoder` in any
 *     manifest), and root dependencies are fenced (#9465). Adding one to make a
 *     lint gate's numbers prettier is not a trade this gate needs.
 *   - INDEPENDENTLY REPRODUCIBLE. Anyone can audit a ceiling without running
 *     this script: `ceil($(wc -c < file) / 4)`. A tokenizer's count can only be
 *     checked by re-running the tokenizer.
 *
 * ~4 bytes per token is the standard rule of thumb for BPE over English prose
 * and markdown, which is what this catalog is. Its KNOWN limitation, stated
 * rather than hidden: it UNDER-prices CJK, where 3 UTF-8 bytes buy 0.75 units
 * while a real tokenizer charges roughly 1–2 per character. Measured across the
 * catalog when the ceilings were pinned: 235 CJK codepoints against ~117,000
 * units — 0.2%, an order of magnitude below the ratchet's own resolution. If
 * the catalog ever turns substantially non-Latin, the convention needs
 * revisiting rather than the ceilings.
 *
 * ⚠️ Counts produced here are comparable ONLY against other counts produced
 * here. They are not an estimate of any specific model's tokenizer, and the
 * ceilings below are pinned in this convention — changing the convention
 * re-prices every one of them.
 *
 * ## The ratchet discipline (shrink-only, per file)
 *
 *   - New text is paid for by DELETING text in the SAME FILE. Genuine deletion:
 *     a re-wrap moves no tokens and pays nothing.
 *   - A ceiling may be LOWERED by any PR that shrinks its file. Lowering is
 *     always legitimate and encouraged; the report line below prints every
 *     file's headroom on every run so a shrink is visible the moment it lands.
 *   - Going the other way lands only in a PR whose body quotes a maintainer
 *     ruling authorizing it — the same evidence bar the `.claude/**` ratchet
 *     uses.
 *
 * ## Enumeration, never a hand list
 *
 * The catalog is read off the filesystem (every `skills/<name>/SKILL.md`), and a
 * discovered file with no ceiling is RED. A hand-maintained list would let the
 * twelfth published skill land unpriced, which is precisely the hole the ruling
 * is about — the bundle grows by a whole file, and every existing ceiling stays
 * green. Missing file or empty read is RED, never a pass (#4690: a gate that
 * cannot find its input must fail, not skip).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

/** The compliance token. Byte-identical to every instrumented gate's const (#8435). */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/** How the numbers below were produced. Printed on every run — see the header. */
export const TOKEN_CONVENTION = 'ceil(utf8 bytes / 4)';

/**
 * Where each pinned number was measured. Two bases, deliberately.
 *
 * `main` is the ordinary basis. `pending10402` is PR #10402's branch head: that
 * PR is reviewed and waiting on a maintainer's hand-merge, and it grows the two
 * files named in `from10402`. Pinning those two at main's counts would have
 * this gate turn red the moment an already-approved PR lands — a gate that
 * reds on the merge it was never about teaches authors to ignore it.
 *
 * ⚠️ The resulting headroom on those two files is NOT budget. It is #10402's
 * already-spent text, priced ahead of its merge; when that PR lands the
 * headroom returns to zero on its own and the next author is back to paying by
 * deletion.
 */
export const CEILING_BASIS = {
  main: '465bfce90',
  pending10402: '7228d6c25',
  from10402: ['skills/objectstack-data/SKILL.md', 'skills/objectstack-platform/SKILL.md'],
};

/**
 * Measured counts, in the convention above. SHRINK-ONLY: lower freely, and see
 * the header for what the other direction costs.
 *
 * Basis: `main` = 465bfce90 for every file, EXCEPT the two files PR #10402
 * touches (`objectstack-data`, `objectstack-platform`), measured from that PR's
 * branch head `7228d6c25` — see {@link CEILING_BASIS}.
 */
export const CEILINGS = new Map([
  ['skills/objectstack-ai/SKILL.md', 6824],
  ['skills/objectstack-api/SKILL.md', 6348],
  ['skills/objectstack-automation/SKILL.md', 12543],
  // basis 7228d6c25 (PR #10402 head), not main — see CEILING_BASIS.
  ['skills/objectstack-data/SKILL.md', 13797],
  ['skills/objectstack-formula/SKILL.md', 6055],
  ['skills/objectstack-i18n/SKILL.md', 6349],
  // basis 7228d6c25 (PR #10402 head), not main — see CEILING_BASIS.
  ['skills/objectstack-platform/SKILL.md', 12716],
  ['skills/objectstack-pm-dispatch/SKILL.md', 14239],
  ['skills/objectstack-query/SKILL.md', 5569],
  ['skills/objectstack-ui/SKILL.md', 25154],
  ['skills/objectstack-upgrade/SKILL.md', 8325],
]);

/**
 * The catalog's token count for one file's text.
 *
 * @param {string} text
 * @returns {number}
 */
export function countTokens(text) {
  if (text.length === 0) return 0;
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

/**
 * Every published SKILL.md on disk — read off the filesystem, never a hand list.
 *
 * A directory under `skills/` carrying no SKILL.md is not a published skill and
 * is skipped; `skills/README.md` is not a directory and never appears.
 *
 * @param {string} [root]
 * @returns {string[]} repo-relative paths, sorted
 */
export function discoverSkillFiles(root = REPO_ROOT) {
  const dir = root === REPO_ROOT ? SKILLS_DIR : join(root, 'skills');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `skills/${entry.name}/SKILL.md`)
    .filter((rel) => existsSync(join(root, rel)))
    .sort();
}

/**
 * @param {string} rel
 * @param {number} tokens
 * @param {number | undefined} ceiling
 * @returns {{ok: boolean, msg: string}}
 */
export function verdict(rel, tokens, ceiling) {
  if (tokens === 0) {
    return { ok: false, msg: `${rel} read as empty — refusing to treat a missing/empty input as a pass (#4690).` };
  }
  if (ceiling === undefined) {
    return {
      ok: false,
      msg:
        `${rel} is a published SKILL.md carrying no ceiling, measured now at ${tokens} tokens. `
        + 'Every file in the catalog is priced, because an unpriced file is unpriced growth — the '
        + 'bundle grows by a whole file while every existing ceiling stays green. '
        + `${RATCHET_AUTHORITY_MARKER}: adding a CEILINGS row prices a new skill into the bundle `
        + 'that ships to every customer project, which is the maintainer ruling this ratchet '
        + 'implements — not a step an author takes while landing the skill.',
    };
  }
  if (tokens > ceiling) {
    return {
      ok: false,
      msg:
        `${rel} is ${tokens} tokens; the ratchet ceiling is ${ceiling} (over by ${tokens - ceiling}). `
        + 'The published catalog is loaded whole into every customer agent context window, so its '
        + 'length is a per-token cost paid again in every customer session. New text is paid for by '
        + 'deleting text IN THE SAME FILE — genuine deletion, never a re-wrap, which moves no tokens '
        + 'and pays nothing. Loosening a ceiling to fit new text is not the fix: these ceilings are '
        + 'shrink-only. The other direction lands only in a PR whose body quotes a maintainer ruling '
        + `authorizing it. ${RATCHET_AUTHORITY_MARKER}`,
    };
  }
  return { ok: true, msg: `${rel} is ${tokens} tokens (ceiling ${ceiling}; headroom ${ceiling - tokens}).` };
}

/**
 * The price tag, printed on SUCCESS AND FAILURE alike (#10473 direction 2).
 *
 * The visibility half of the mechanism package: every PR's CI log carries the
 * bundle's current cost and each file's distance from its ceiling, so growth is
 * legible in review even in the runs where nothing crosses a line.
 *
 * @param {Array<{rel: string, tokens: number, ceiling: number | undefined}>} rows
 */
export function reportLines(rows) {
  const out = [`── published skills bundle — price tag (convention: ${TOKEN_CONVENTION})`];
  let totalTokens = 0;
  let totalCeiling = 0;
  for (const { rel, tokens, ceiling } of rows) {
    totalTokens += tokens;
    totalCeiling += ceiling ?? 0;
    const delta = ceiling === undefined ? 'unpriced' : `${tokens - ceiling >= 0 ? '+' : ''}${tokens - ceiling}`;
    const shown = ceiling === undefined ? 'none' : String(ceiling);
    out.push(`   ${rel.padEnd(40)} ${String(tokens).padStart(6)} / ${shown.padStart(6)}   (${delta})`);
  }
  const net = totalTokens - totalCeiling;
  out.push(
    `   ${'bundle total'.padEnd(40)} ${String(totalTokens).padStart(6)} / ${String(totalCeiling).padStart(6)}`
    + `   (${net >= 0 ? '+' : ''}${net})`,
  );
  return out;
}

function run() {
  const covered = [...new Set([...discoverSkillFiles(), ...CEILINGS.keys()])].sort();
  const rows = [];
  let failed = 0;

  for (const rel of covered) {
    let text;
    try {
      text = readFileSync(join(REPO_ROOT, rel), 'utf8');
    } catch {
      console.error(`✗ check-skills-token-ratchet: cannot read ${rel} — red, not a skip (#4690).`);
      failed++;
      continue;
    }
    const tokens = countTokens(text);
    const ceiling = CEILINGS.get(rel);
    rows.push({ rel, tokens, ceiling });
    const v = verdict(rel, tokens, ceiling);
    if (!v.ok) {
      failed++;
      console.error(`✗ check-skills-token-ratchet: ${v.msg}`);
      continue;
    }
    console.log(`✓ check-skills-token-ratchet: ${v.msg}`);
  }

  console.log('');
  for (const line of reportLines(rows)) console.log(line);

  if (failed) {
    console.error(`\n✗ check-skills-token-ratchet: ${failed} of ${covered.length} published SKILL.md over budget.`);
    process.exit(1);
  }
  console.log(`\n✓ check-skills-token-ratchet: ${covered.length} published SKILL.md within their ceilings.`);
}

function selfTest() {
  const rel = 'skills/objectstack-ui/SKILL.md';
  const over = verdict(rel, 26000, 25154).msg;
  const unpriced = verdict('skills/objectstack-new/SKILL.md', 4000, undefined).msg;
  const discovered = discoverSkillFiles();

  const cases = [
    // ── ratchet semantics ────────────────────────────────────────────────
    ['under the ceiling -> green', verdict(rel, 25000, 25154).ok, true],
    ['at the ceiling -> green', verdict(rel, 25154, 25154).ok, true],
    ['over the ceiling -> red', verdict(rel, 25155, 25154).ok, false],
    ['empty read -> red, not a skip (#4690)', verdict(rel, 0, 25154).ok, false],
    ['the red names the file', over.includes(rel), true],
    ['the red names the measured count', over.includes('26000'), true],
    ['the red names the ceiling', over.includes('25154'), true],
    ['the red names the rule: deletion in the same file', over.includes('IN THE SAME FILE'), true],
    ['the red rejects a re-wrap as payment', over.includes('never a re-wrap'), true],
    // Shrink-only, pinned in the DIRECTION it runs: a file measured below its
    // ceiling is green and the green message reports the headroom, which is
    // what makes an opportunistic lowering visible. Nothing here rewrites a
    // ceiling — the map is edited by a person, in a PR, in one direction.
    ['shrink direction — a shrunk file is green and its headroom is reported',
      verdict(rel, 20000, 25154).ok && verdict(rel, 20000, 25154).msg.includes('headroom 5154'), true],
    ['the gate declares its registry shrink-only in author-facing text', over.includes('shrink-only'), true],

    // ── remedy authority (#8435) ─────────────────────────────────────────
    ['the over-ceiling remedy carries the authority token', over.includes(RATCHET_AUTHORITY_MARKER), true],
    ['the unpriced-file remedy carries the authority token', unpriced.includes(RATCHET_AUTHORITY_MARKER), true],
    // The convention's actual content: the author is never handed the steps for
    // loosening the ratchet. Pinned as an ABSENCE, because that is the shape
    // the failure takes — a helpful sentence appended a year from now.
    ['no remedy tells the author to raise a ceiling', /raise (?:the |a |its )?ceiling to|bump the ceiling|update the ceiling to/i.test(`${over} ${unpriced}`), false],
    ['the raise is bound to a quoted maintainer ruling', over.includes('quotes a maintainer ruling'), true],

    // ── the counting convention ──────────────────────────────────────────
    ['four ASCII bytes are one token', countTokens('abcd'), 1],
    ['five ASCII bytes round up to two', countTokens('abcde'), 2],
    ['the unit is UTF-8 BYTES, not JS characters (a 3-byte CJK char is not free)', countTokens('中'), 1],
    ['empty text counts zero, which the verdict turns red', countTokens(''), 0],

    // ── enumeration, never a hand list ───────────────────────────────────
    ['the catalog is discovered from disk', discovered.length > 0, true],
    ['every discovered file is a published SKILL.md path',
      discovered.every((p) => p.startsWith('skills/') && p.endsWith('/SKILL.md')), true],
    // The hole the enumeration exists to close: a twelfth published skill must
    // not land unpriced. A hand list would simply not mention it.
    ['a discovered file with no ceiling is RED', verdict('skills/objectstack-new/SKILL.md', 4000, undefined).ok, false],
    ['the unpriced red names the file and its measured count',
      unpriced.includes('skills/objectstack-new/SKILL.md') && unpriced.includes('4000'), true],
    ['every discovered file carries a ceiling today', discovered.filter((p) => !CEILINGS.has(p)), []],
    ['every ceiling names a file the enumeration finds', [...CEILINGS.keys()].filter((p) => !discovered.includes(p)), []],
    ['every ceiling is a positive integer',
      [...CEILINGS.values()].every((n) => Number.isInteger(n) && n > 0), true],

    // ── the two-basis pin (#10402) ───────────────────────────────────────
    // Enforcement cannot hold this: both shas run perfectly green whatever they
    // say, because the gate never reads them. Without these cases the recorded
    // provenance drifts from the numbers it explains, silently.
    ['the main basis sha is recorded', CEILING_BASIS.main, '465bfce90'],
    ['the pending-#10402 basis sha is recorded', CEILING_BASIS.pending10402, '7228d6c25'],
    ['exactly the two #10402 files are pinned on the second basis',
      CEILING_BASIS.from10402.join(','),
      'skills/objectstack-data/SKILL.md,skills/objectstack-platform/SKILL.md'],
    ['both second-basis files carry a ceiling', CEILING_BASIS.from10402.every((p) => CEILINGS.has(p)), true],

    // ── the report line ──────────────────────────────────────────────────
    ['the report prints a bundle total',
      reportLines([{ rel, tokens: 10, ceiling: 20 }]).some((l) => l.includes('bundle total')), true],
    ['the report prints a per-file net delta against the ceiling',
      reportLines([{ rel, tokens: 30, ceiling: 20 }]).some((l) => l.includes('(+10)')), true],
    ['the report names the counting convention',
      reportLines([]).some((l) => l.includes(TOKEN_CONVENTION)), true],
  ];

  let failed = 0;
  for (const [name, actual, expected] of cases) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  }
  if (failed) {
    console.error(`✗ check-skills-token-ratchet self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-skills-token-ratchet self-test: ${cases.length} cases pass.`);
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else run();
}
