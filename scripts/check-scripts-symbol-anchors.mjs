#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-scripts-symbol-anchors (#15765) -- the `scripts/**` registration of the
 * shared symbol-anchor resolver.
 *
 *   node scripts/check-scripts-symbol-anchors.mjs
 *   node scripts/check-scripts-symbol-anchors.mjs --list
 *   node scripts/check-scripts-symbol-anchors.mjs --list-unresolvable
 *   node scripts/check-scripts-symbol-anchors.mjs --self-test
 *
 * ⚠️ THE MECHANISM IS NOT HERE. The grammar, the extractor, the comment-prose
 * projection and the resolution rule all live in `scripts/symbol-anchors.mjs`,
 * whose header is authoritative and worth reading before this one. This file is
 * a `defineCorpus` call, a population declaration and an exit contract -- the
 * same deliberately thin shape as `scripts/check-adr-symbol-anchors.mjs`, and
 * ⛔ NOT a second resolver. The 2026-09-01 ruling on #13556 is explicit that a
 * corpus joins by registration: 「与 #13788 已裁方向同构,**共享同一个
 * resolver**,⛔ 不造第二套」.
 *
 * ## The measured failure (#15765)
 *
 * `docs/adr/**` was the first corpus because its rot was censused: 243 of 337
 * live line anchors broken, 72.1%, a one-way LOWER bound. Gate headers under
 * `scripts/**` were outside every corpus, in BOTH directions -- a `path:NNN`
 * there was neither resolved nor refused -- and they are read more often than
 * an ADR, because a gate header is where the next fixer starts.
 *
 * The rot rate there was demonstrated rather than argued. One citation in
 * `scripts/check-react-page-adapter-contract.mjs` was written as
 * `packages/client/src/index.ts` at one line, the #15094 census found that
 * declaration at another, and triage read a third the SAME DAY: a cross-file
 * line citation that moved twice inside one day, unnoticed, because nothing
 * checked it. A second citation three lines below it had drifted off its line
 * too, and was found only because a human read the paragraph.
 *
 * ## The census this gate was registered against
 *
 * `CENSUS_15765` below, measured on `5315098df` over the 216 tracked `.mjs`
 * files under `scripts/`. The instrument matters more than the number, because
 * three different instruments gave three different answers on the same tree:
 *
 *   251  raw `extractAnchors` over the whole file       -- includes CODE, so it
 *                                                          counts a gate's own
 *                                                          fixtures
 *   128  through `scripts/symbol-anchors.mjs#commentProse` -- comment prose only
 *    32  ...and the cited path names a TRACKED FILE     -- what this gate judges
 *
 * The card reported 27 across 14 files and triage 22 with a coarser regex;
 * neither binds, and the third row above reproduces the card's instrument to
 * within one citation (28 across 14 files if a bare `AGENTS.md` is required to
 * be directory-qualified; 32 across 15 without that extra rule, which is the
 * predicate this gate uses because a tracked file is a tracked file).
 *
 * ## What this corpus judges, and what it declines to
 *
 * `judgeUntrackedLineAnchors: false`. A citation that names no tracked file is
 * SEEN, COUNTED and ENUMERATED, and judged by nothing: this gate cannot tell
 * its author how to fix it, and a gate whose only remedy is "stop writing that"
 * is the permanently-red gate this repo retired. They were a real defect class
 * and were carded as a follow-up (#15809), exactly as the 1,056 bare paths
 * under `checkBarePaths` were for `docs/adr/**`.
 *
 * ⭐ THAT FOLLOW-UP IS MOSTLY DONE, AND THE REST IS A LIST, NOT A NUMBER. When
 * the corpus was registered it declined 96 citations; #15809 migrated 81 of
 * them by the same method PR #15806 used on the tracked-target ones -- the file
 * as a file-level anchor, the number kept beside it as data, the placeholder
 * spelling `scripts/symbol-anchors.mjs#ANCHOR_GRAMMAR` defines for an
 * illustration, and prose naming the repo for a third-party or dependency
 * source no in-repo resolver could ever check. ⛔ Not one digit was repaired or
 * repointed; every number that was in an anchor is still on its page, as data.
 *
 * The residual when that landed was 15, and every one of them was a file
 * another lane held OPEN at that moment -- ⛔ not one was an ambiguity. That
 * count is a DATED reading; `--list-unresolvable` is the live one. ⚠️ It is why the
 * flag is still `false`: the fence #15809 was dispatched under is that it flips
 * only when the residual is ZERO and a self-test pins the flip, and a residual
 * of 15 would make this gate permanently red for the length of somebody else's
 * pull request. `--list-unresolvable` prints the residual so the next author
 * inherits a worklist rather than a count; the day it prints nothing, the flag
 * is a one-line change with a case to pin it.
 *
 * `checkBarePaths: false`, for the same reason and on a measurement: judging
 * every bare path code span in this corpus produces 1,617 findings, nearly all
 * of them abbreviated spellings inside prose (`turbo.json` written as itself,
 * `react-pages.mdx` for a page named in full two paragraphs up). That is the
 * same call `docs/adr/**` made at 1,056.
 *
 * ⭐ What it DOES judge is the whole of the grammar otherwise: a `path:NNN`
 * naming a tracked file is REFUSED, a symbol anchor must have a declaration
 * site in the file it names, and a file-level anchor with a `#fragment` must
 * name a file the tree really has.
 *
 * ## What a red means, and how to clear it
 *
 * [line-anchor]        A `path:NNN` naming a tracked file. Cite the symbol
 *                      instead -- `path#symbolName` -- or drop to a file-level
 *                      `path`. Both stay checked; a line number does not.
 *                      ⚠️ If the number is a DATED RECORD rather than a
 *                      pointer -- a census row, a rot-rate example -- the
 *                      repair is to keep every digit and stop writing it in
 *                      ANCHOR FORM: name the file as a file-level anchor and
 *                      put the number beside it as data. Nothing is lost and
 *                      the record stops reading as a live claim.
 * [unresolved-symbol]  The file is there, the symbol is not.
 * [unresolved-path]    No tracked file at that path. In this corpus that is
 *                      usually a PLACEHOLDER written path-shaped; the idiom
 *                      `scripts/symbol-anchors.mjs#ANCHOR_GRAMMAR` already uses
 *                      -- angle-bracket words, deliberately not path-shaped --
 *                      is the fix.
 * [bad-exemption]      An `anchor-exempt` marker naming no valid class.
 *
 * ⛔ MAINTAINER-ONLY: adding an `anchor-exempt` marker. Unchanged here.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';
import { ANCHOR_GRAMMAR, commentProse, defineCorpus, sweepCorpus } from './symbol-anchors.mjs';

/* ── The declared path population (#13519 / check-declared-population-live) ───
 * These literals ARE the population this gate reads, and the self-test holds
 * them against the corpus registration below, so a moved surface reddens here
 * rather than turning this gate silently inert. */
export const SCRIPTS_DIR = 'scripts';
export const ROOT_DIR_WATCH_HINTS = ['scripts/**'];

/* The census this gate was registered against, kept as data so the report can
 * state what the surface was when the corpus joined. ⛔ Historical
 * measurements, not a budget to spend. */
export const CENSUS_15765 = {
  measuredOn: '5315098dfb55d19ea79bd27c28b3864f32f8fad9',
  mjsFilesTotal: 216,
  rawLineCitations: 251,
  commentProseLineCitations: 128,
  trackedTargetLineCitations: 32,
  trackedTargetFiles: 15,
  barePathFindingsIfJudged: 1617,
};

/**
 * ⚠️ DATED ALLOWANCES -- a file another lane's LIVE pull request holds.
 *
 * This is not an exemption and it is not a softening of the grammar: the
 * citation is still a finding, still printed, still counted. What the row buys
 * is that it does not FAIL the build while a PR that has already been reviewed
 * against that file is open, because a comment-only edit landing underneath it
 * is how two lanes hand each other a conflict.
 *
 * ⛔ A row is EXACT IN BOTH DIRECTIONS and the self-test holds it there:
 *
 *   - it must name a file that STILL carries a judged finding, so the day the
 *     citation is migrated the row goes stale and reds until it is DELETED. An
 *     allowance nobody can retire is an exemption wearing a date.
 *   - it must name the PR that lifts it, so the follow-up has an owner.
 *
 * ⛔ This is NOT a route to green for a file you simply do not want to edit.
 * The only admissible reason is the hot-file serial queue.
 */
export const HELD_FILE_ALLOWANCES = Object.freeze([
  // EMPTY, and empty is the healthy state: every row written so far has been
  // retired by repairing the citation it held. The mechanism above is not dead
  // code — `triage()` still takes rows, and the self-test still exercises it in
  // BOTH directions against its OWN fixture row (`scripts/bad.mjs`), including
  // the leg that proves a row is load-bearing rather than decorative. So an
  // empty live array leaves that battery running, not vacuous.
]);

export const CORPUS = defineCorpus({
  id: 'scripts',
  label: 'scripts/** (gate headers and audit scripts, comment prose only)',
  docRoots: [SCRIPTS_DIR],
  docPattern: /\.mjs$/,
  docProjection: commentProse,
  judgeUntrackedLineAnchors: false,
  crossRepos: { objectui: { checkoutEnv: 'OBJECTUI_CHECKOUT' } },
});

/** Split a sweep's findings into the three dispositions this gate reports. */
export function triage(findings, allowances = HELD_FILE_ALLOWANCES) {
  const allowed = new Map(allowances.map((a) => [a.file, a]));
  const hard = [];
  const soft = [];
  const excused = [];
  for (const f of findings) {
    if (f.soft) soft.push(f);
    else if (allowed.has(f.doc)) excused.push({ ...f, allowance: allowed.get(f.doc) });
    else hard.push(f);
  }
  return { hard, soft, excused };
}

export function runCheck(root = process.cwd()) {
  const { findings, counts } = sweepCorpus(CORPUS, root);
  const { hard, soft, excused } = triage(findings);

  if (counts.anchors === 0) {
    console.error('❌ check-scripts-symbol-anchors: the sweep found ZERO anchors in scripts/** — the extractor is broken, not the corpus clean.');
    process.exit(1);
  }

  for (const f of soft) console.log(`ℹ️  [${f.kind}] ${f.doc}:${f.line}  ${f.raw}\n      ${f.detail}`);
  for (const f of excused) {
    console.log(
      `⏳ [${f.kind}] ${f.doc}:${f.line}  ${f.raw}\n      ${f.detail}\n`
        + `      ALLOWED, dated ${f.allowance.dated} — held by ${f.allowance.heldBy}. Delete the row when the citation goes.`,
    );
  }

  if (hard.length > 0) {
    console.error(`❌ check-scripts-symbol-anchors: ${hard.length} finding(s) across ${counts.docs} scripts.\n`);
    for (const f of hard) console.error(`  [${f.kind}] ${f.doc}:${f.line}  ${f.raw}\n      ${f.detail}`);
    console.error(`\nThe anchor grammar:\n  ${ANCHOR_GRAMMAR}`);
    console.error('\n⛔ MAINTAINER-ONLY: an `anchor-exempt` marker is not the remedy — fix the anchor.');
    process.exit(1);
  }

  console.log(
    `✅ check-scripts-symbol-anchors: ${counts.anchors} anchors across ${counts.docs} scripts resolve — `
      + `${counts.symbol} symbol (${counts.declaration} declaration, ${counts.literal} literal), `
      + `${counts.fileLevel} file-level, ${counts.crossRepo} cross-repo, ${counts.exempt} exempt, `
      + `${counts.continuation} continuation. 0 line anchors on tracked targets survive `
      + `(${counts.unresolvableLineCitation} citations name no tracked file and are not judged; `
      + `${excused.length} dated allowance finding(s)).`,
  );
}

function list(root = process.cwd()) {
  const { findings, counts, declined } = sweepCorpus(CORPUS, root);
  console.log(JSON.stringify({ counts, findings, declined, allowances: HELD_FILE_ALLOWANCES }, null, 2));
}

/**
 * The citations this corpus DECLINES to judge, enumerated.
 *
 * ⚠️ A listing, never a verdict: this exits 0 whatever it prints, exactly as
 * `--list` does. `runCheck()` is still the only arm that can fail.
 *
 * The count alone (`unresolvableLineCitation`, printed by the green line) says
 * a residual exists without saying where, so nobody can work it down and
 * nobody can tell a residual that SHRANK from one that moved. This prints
 * `file:line -- citation` per row and a tally by shape, which is what a
 * follow-up card needs to be closed rather than re-measured.
 */
function listUnresolvable(root = process.cwd()) {
  const { counts, declined } = sweepCorpus(CORPUS, root);
  const byShape = {};
  for (const d of declined) byShape[d.shape] = (byShape[d.shape] ?? 0) + 1;
  for (const d of declined) console.log(`${d.doc}:${d.line}  ${d.raw}   [${d.shape}]`);
  console.log(
    `\n${declined.length} citation(s) name no tracked file and are not judged `
      + `(counter: ${counts.unresolvableLineCitation}) — `
      + Object.entries(byShape).sort().map(([k, v]) => `${v} ${k}`).join(', '),
  );
}

/* ─────────────────────────────── self-test ─────────────────────────────── */

function assert(cond, msg) { if (!cond) { console.error(`❌ check-scripts-symbol-anchors --self-test: ${msg}`); process.exit(1); } }

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// A module-level `assert()` that exits on the first failure used to be this
// shape's ONLY success condition, so "every case held" and "the cases never
// ran" printed the same line. What is pinned is the registered NAMES, not a
// number: the floor requires the OPENED set to equal the DECLARED set with
// each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
// ⛔ Four of these cases are registered PER `HELD_FILE_ALLOWANCES` row (the
// exactness loop below runs four `check()`s over each row), so retiring a row
// legitimately lowers this floor by 4 — and that is the ONLY reason it may be
// lowered. 34 → 30 when the `scripts/check-react-page-adapter-contract.mjs`
// row was retired, then 30 → 26 when the `scripts/check-adr-0087-registration.mjs`
// row was retired and the array went EMPTY (#15765). Any other drop is cases that
// STOPPED RUNNING; find what stopped registering instead of moving the number.
// 26 → 29 when the declined citations gained an ENUMERATION beside their count
// (#15809): three cases hold `declined` equal to `unresolvableLineCitation`, to
// the file/line/text a residual list needs, and to the shape classification.
// ⚠️ An empty array does NOT make the allowance battery vacuous: its five
// fixture cases run off `scripts/bad.mjs`, never off the live rows, so they are
// not part of this arithmetic and must never fall out of the count.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-scripts-symbol-anchors self-test': 29,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-scripts-symbol-anchors self-test reached its verdict';

export function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => { openBattery = name; };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  battery('check-scripts-symbol-anchors self-test');
  const check = (cond, message) => { registerCase(); assert(cond, message); };

  // 1. ⭐ A synthetic corpus carrying one of EVERY finding class this
  //    registration can produce, plus the healthy forms and the two shapes
  //    this corpus deliberately declines to judge — so "no findings" is told
  //    apart from "the rule stopped matching", and "declines" is told apart
  //    from "never saw it".
  const tmp = mkdtempSync(join(tmpdir(), 'check-scripts-symbol-anchors-'));
  try {
    const write = (rel, body) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), body); };
    write('src/thing.ts', 'export function realSymbol() {}\nconst names = ["sys_thing"];\n// commentOnlySymbol is only named here\n');
    write('scripts/good.mjs', [
      '// A symbol anchor `src/thing.ts#realSymbol` resolves.',
      '/* A data identifier `src/thing.ts#sys_thing` resolves as a literal. */',
      '/**',
      ' * A file-level anchor `src/thing.ts` resolves, and a continuation',
      ' * `src/thing.ts#realSymbol` then `#sys_thing`.',
      ' */',
      "const fixture = 'src/thing.ts:42';  // ⛔ CODE: a fixture, not a citation",
      'export const x = 1;',
    ].join('\n'));
    write('scripts/bad.mjs', [
      '// A survived line anchor `src/thing.ts:42` must be found.',
      '/* A range `src/thing.ts:10-20` must be found. */',
      '// An en-dash range `src/thing.ts:30–40` must be found.',
      '// A missing symbol `src/thing.ts#noSuchSymbol` must be found.',
      '// A comment-only symbol `src/thing.ts#commentOnlySymbol` must be found.',
      '// A gone file `src/vanished.ts#whatever` must be found.',
      '// A bogus exemption `src/thing.ts:99` <!-- anchor-exempt: NOPE --> must be found.',
    ].join('\n'));
    // A SECOND failing script, so "an allowance covers only the file it names"
    // is provoked against a corpus that still has something left to fail on.
    write('scripts/also-bad.mjs', '// Another survived line anchor `src/thing.ts:77` must be found.');
    write('scripts/declined.mjs', [
      '// An untracked target `src/never-existed.ts:7` is NOT judged here.',
      '// A bare filename `thing.ts:8` is NOT judged here.',
      '// A bare path code span `some/abbreviated/spelling.ts` is NOT judged here.',
    ].join('\n'));
    write('scripts/exempt.mjs', '// An excused anchor `src/gone.ts:7` <!-- anchor-exempt: HISTORICAL --> is silent.');
    // the sweep reads `git ls-files`, so the fixture needs to be a repo
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    execFileSync('git', ['add', '-A'], { cwd: tmp });

    const { findings, counts, declined } = sweepCorpus(CORPUS, tmp);
    const kinds = findings.map((f) => f.kind);
    const count = (k) => kinds.filter((x) => x === k).length;

    check(count('line-anchor') === 4, `4 line anchors (plain, hyphen range, EN DASH range, second file) must be found, got ${count('line-anchor')}`);
    check(count('unresolved-symbol') === 2, `2 unresolved symbols must be found, got ${count('unresolved-symbol')}`);
    check(count('bad-exemption') === 1, `an invalid exemption class must be a finding, got ${count('bad-exemption')}`);
    check(count('unresolved-path') === 1, `a vanished target must be a finding, got ${count('unresolved-path')}`);
    check(counts.exempt === 1, 'a valid exemption must be honoured exactly once');
    check(!findings.some((f) => f.doc.includes('good.mjs')), 'the healthy script must produce no findings');
    check(counts.declaration >= 1 && counts.literal >= 1, 'both resolution classes must be exercised by the fixture');
    // ⭐ The projection, at CORPUS level rather than in the core's unit cases:
    // a citation living in a string literal is a gate's own fixture and must
    // not be a finding against the gate that wrote it.
    check(!findings.some((f) => f.raw.includes('thing.ts:42') && f.doc.includes('good.mjs')),
      'a citation inside a STRING LITERAL is code, not a doc citation — the corpus must sweep comment prose only');
    // ...and the DECLINED shapes are declined, not missed: they were seen and
    // counted, which is the difference between a scope call and a blind spot.
    check(!findings.some((f) => f.doc.includes('declined.mjs')),
      'a citation naming no tracked file must not be a finding under judgeUntrackedLineAnchors: false');
    check(counts.unresolvableLineCitation === 2,
      `both declined citations must be SEEN and counted, got ${counts.unresolvableLineCitation}`);
    // ...and ENUMERATED, not merely counted (#15809). A count says a residual
    // exists without saying where, so nobody can work it down and a residual
    // that MOVED reads identically to one that shrank. `--list-unresolvable`
    // prints this array; these three cases are what keep it equal to the
    // counter rather than a second, drifting instrument.
    check(declined.length === counts.unresolvableLineCitation,
      `the declined ENUMERATION must equal the declined COUNT, got ${declined.length} vs ${counts.unresolvableLineCitation}`);
    check(declined.every((d) => d.doc.includes('declined.mjs') && Number.isInteger(d.line) && d.raw),
      'every declined row must carry the file, the line and the citation text it was declined for');
    check(
      declined.map((d) => d.shape).sort().join(',') === 'bare-filename,directory-qualified',
      `the declined rows must be classified by SHAPE, got ${declined.map((d) => d.shape).sort().join(',')}`,
    );

    // 2. The allowance mechanism, in both directions, against the fixture.
    const fake = [{ file: 'scripts/bad.mjs', dated: '2026-01-01', heldBy: 'PR #1', why: 'fixture' }];
    const t = triage(findings, fake);
    check(t.excused.length > 0, 'an allowance row must move that file\'s findings out of the failing set');
    check(t.excused.every((f) => f.doc === 'scripts/bad.mjs'), 'an allowance must cover ONLY the file it names');
    check(t.hard.every((f) => f.doc !== 'scripts/bad.mjs'), 'an allowed file must not also fail');
    check(t.hard.length > 0, 'an allowance on one file must not excuse the others — this corpus still reds');
    const none = triage(findings, []);
    check(none.hard.length > t.hard.length, 'REMOVING the row must put those findings back — the row is load-bearing, not decorative');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 3. The population guard: the declaration is read by ANOTHER tool
  //    (dispatch-gates / check-declared-population-live), so a wrong entry runs
  //    perfectly green here and shows up only as a dev who was never told this
  //    gate reads their surface.
  check(ROOT_DIR_WATCH_HINTS.every((h) => h.startsWith(SCRIPTS_DIR)), 'every watch hint must be under the declared scripts dir');
  check(existsSync(SCRIPTS_DIR), `the declared population must reach the tree: ${SCRIPTS_DIR}`);
  check(CORPUS.docRoots.includes(SCRIPTS_DIR), 'the corpus must sweep the population this gate declares');
  check(
    ROOT_DIR_WATCH_HINTS.every((h) => CORPUS.docRoots.includes(h.replace(/\/\*+$/, ''))),
    `the declared hints must name the roots the corpus sweeps: ${ROOT_DIR_WATCH_HINTS.join(', ')} vs ${CORPUS.docRoots.join(', ')}`,
  );

  // 4. ⭐ The live corpus is not empty, and the projection really is wired.
  //    This is the ONLY thing separating a clean tree from an extractor that
  //    silently matches nothing.
  const live = sweepCorpus(CORPUS);
  check(live.counts.anchors > 1000, `the live scripts corpus must yield its anchors, got ${live.counts.anchors}`);
  check(live.counts.symbol > 0, 'the live corpus must contain resolved SYMBOL anchors');
  check(CORPUS.docProjection === commentProse, 'the corpus must sweep COMMENT PROSE — a raw .mjs corpus judges every gate\'s own fixtures');

  // 5. ⛔ Every allowance row is EXACT IN BOTH DIRECTIONS against the LIVE
  //    tree. A row whose file no longer carries a judged finding has done its
  //    job and must be DELETED; leaving it is how a dated allowance becomes a
  //    permanent exemption nobody re-reads.
  const liveExcused = triage(live.findings).excused;
  for (const row of HELD_FILE_ALLOWANCES) {
    check(
      liveExcused.some((f) => f.doc === row.file),
      `the allowance for \`${row.file}\` is STALE — that file carries no judged finding any more. `
        + 'Delete the row; it has been lifted.',
    );
    check(/^\d{4}-\d{2}-\d{2}$/.test(row.dated), `the allowance for \`${row.file}\` must carry an ISO date, got \`${row.dated}\``);
    check(/#\d+/.test(row.heldBy), `the allowance for \`${row.file}\` must name the PR that lifts it, got \`${row.heldBy}\``);
    check(row.file.startsWith(`${SCRIPTS_DIR}/`), `an allowance may only name a file in this corpus, got \`${row.file}\``);
  }

  // 6. The gate is wired to run. A gate nothing invokes is this repo's most
  //    carded defect class, and renaming a step silently detaches it.
  const workflow = readFileSync('.github/workflows/lint.yml', 'utf8');
  check(workflow.includes('node scripts/check-scripts-symbol-anchors.mjs'), 'lint.yml must invoke this gate');
  check(workflow.includes('node scripts/check-scripts-symbol-anchors.mjs --self-test'), 'lint.yml must invoke this gate\'s --self-test');

  // 7. The census declaration is intact, and its three instruments stay
  //    ordered — the ordering IS the reading (raw counts code, comment prose
  //    does not, and only some of those name a file this tree has).
  check(CENSUS_15765.rawLineCitations > CENSUS_15765.commentProseLineCitations, 'the raw instrument must count MORE than the comment-prose one');
  check(CENSUS_15765.commentProseLineCitations > CENSUS_15765.trackedTargetLineCitations, 'the comment-prose instrument must count more than the tracked-target one');

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  const floorMessages = [];
  const floorFailure = (message) => { floorMessages.push(message); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  assert(!floorBreached, floorMessages.join('\n     '));

  console.log(
    '✅ check-scripts-symbol-anchors --self-test: every finding class provoked, comment-prose projection '
      + `wired, declined shapes counted not missed, allowance rows exact both ways, population live (${live.counts.anchors} live anchors)`,
  );

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  // The `if` body is BRACED so the trailing `else if` cannot re-bind to the
  // inner refusal; the `else` arms stay unbraced, per the landed
  // `scripts/pm/check-label-desc-cap.mjs` precedent.
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-scripts-symbol-anchors self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else if (process.argv.includes('--list-unresolvable')) listUnresolvable();
  else if (process.argv.includes('--list')) list();
  else runCheck();
}
