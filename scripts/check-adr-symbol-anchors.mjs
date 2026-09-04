#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-adr-symbol-anchors (#13556) -- the `docs/adr/**` registration of the
 * shared symbol-anchor resolver.
 *
 *   node scripts/check-adr-symbol-anchors.mjs
 *   node scripts/check-adr-symbol-anchors.mjs --list
 *   node scripts/check-adr-symbol-anchors.mjs --self-test
 *
 * ⚠️ THE MECHANISM IS NOT HERE. The grammar, the extractor and the resolution
 * rule all live in `scripts/symbol-anchors.mjs`, whose header is authoritative
 * and worth reading before this one. This file is a `defineCorpus` call, a
 * population declaration and an exit contract -- deliberately thin, because a
 * second corpus joining this gate must be able to be exactly the same thing.
 *
 * ## Why this gate exists (the measured failure)
 *
 * ADRs cited positions in source files by LINE NUMBER. The #13556 census
 * enumerated all of them -- 343 distinct anchors across 35 of the 134 ADRs,
 * plus 52 continuation anchors, a 395-anchor surface -- and resolved each
 * against `main`. Excluding 4 HISTORICAL and 2 EXTERNAL anchors, **243 of 337
 * were broken: 72.1%**, with the four hottest target files 100% broken across
 * 50 anchors.
 *
 * ⭐ **72.1% IS A ONE-WAY LOWER BOUND, and that declaration is part of the
 * record** (maintainer ruling 2026-09-01, point 5: 「72.1% 是单向误差下界的申报
 * 原样入册」). The census's mechanical RESOLVES test accepted a symbol appearing
 * anywhere inside the cited range, including inside a COMMENT, so it passed
 * anchors a stricter reading fails. True rot was higher than 72.1%, never
 * lower. This migration confirmed the direction: `object.zod.ts` was credited
 * with `stateMachines` by the census, but on today's tree the only occurrence
 * is a comment saying that map no longer exists. The resolver in
 * `symbol-anchors.mjs` strips comments before matching precisely so this gate
 * does not inherit that permissiveness.
 *
 * ## The ruling (maintainer 2026-09-01, 总监批 #27)
 *
 * Option A: 「ADR 行号锚整体迁为符号锚 + resolver 门禁(缺符号变红)—— 与 #13788
 * 已裁方向同构,共享同一个 resolver,⛔ 不造第二套」, with 「C 不作过渡」 -- one
 * migration, no gradual phase. That is why a surviving line anchor is a hard
 * finding here rather than a warning: a deprecation window is precisely the
 * "两道工" the ruling refused, and it would let the 243 proven-rotted numbers
 * outlive the migration that deleted them.
 *
 * ## What a red means, and how to clear it
 *
 * [line-anchor]        A `path:NNN` is back. Cite the symbol instead --
 *                      `path#symbolName` -- or, if the sentence names no
 *                      symbol that exists, drop to a file-level `path`. Both
 *                      stay checked; a line number does not.
 * [unresolved-symbol]  The file is there, the symbol is not. Either the symbol
 *                      was renamed (update the anchor) or the mechanism moved
 *                      out of that file (re-anchor it where it lives). ⚠️ If
 *                      the SENTENCE has become untrue -- not just the pointer
 *                      -- that is a separate defect and takes its own card;
 *                      ADR-0113's inverted predicate is the worked example
 *                      (#14193). Do not repair prose to clear this gate.
 * [unresolved-path]    No tracked file at that path. The file moved or went.
 * [bad-exemption]      An `anchor-exempt` marker naming no valid class. A typo
 *                      must not be a way to switch the gate off.
 *
 * ⛔ MAINTAINER-ONLY: adding an `anchor-exempt` marker. It is the one remedy
 * that makes this gate quieter instead of satisfying it -- the same shape as
 * editing a shrink-only ledger -- and it exists for exactly two classes
 * (HISTORICAL, EXTERNAL) that no in-repo resolver could ever check. An author
 * whose anchor will not resolve fixes the ANCHOR, never the exemption list.
 *
 * ## Cross-repo anchors are REPORTED, never red (ruling point 3)
 *
 * 11 census anchors point into the sibling `objectui` repo. A gate living here
 * cannot resolve them against a moving sibling without pinning a sha, so the
 * ruled fallback applies: they are downgraded to file-level anchors that NAME
 * the cross-repo target (`objectui:packages/...`), and the resolver verifies
 * them only when a checkout is actually available ($OBJECTUI_CHECKOUT). With no
 * checkout they are listed as skipped and the gate stays green -- a check that
 * reddens on the healthy case is the permanently-red gate this repo retired.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';
import { ANCHOR_GRAMMAR, defineCorpus, sweepCorpus } from './symbol-anchors.mjs';

/* ── The declared path population (#13519 / check-declared-population-live) ───
 * These literals ARE the population this gate reads, and the self-test holds
 * them against the corpus registration below, so a moved surface reddens here
 * rather than turning this gate silently inert. */
export const ADR_DIR = 'docs/adr';
export const ROOT_DIR_WATCH_HINTS = ['docs/adr/**'];

/* The census this gate was built from, kept as data so the report can state
 * what the surface was when the migration ran. ⛔ SHRINK-ONLY in spirit: these
 * are historical measurements, not a budget to spend. */
export const CENSUS_13556 = {
  measuredOn: '83be46012778c07b8de6b6d3a026217f26712302',
  adrFilesTotal: 134,
  adrFilesWithAnchors: 35,
  distinctLineAnchors: 343,
  continuationAnchors: 52,
  totalSurface: 395,
  brokenOfLive: [243, 337],
  rotRate: '72.1%',
  rotRateIsLowerBound: true,
};

export const CORPUS = defineCorpus({
  id: 'adr',
  label: 'docs/adr/** (architecture decision records)',
  docRoots: [ADR_DIR],
  docPattern: /\.md$/,
  crossRepos: { objectui: { checkoutEnv: 'OBJECTUI_CHECKOUT' } },
});

export function runCheck(root = process.cwd()) {
  const { findings, counts } = sweepCorpus(CORPUS, root);
  const hard = findings.filter((f) => !f.soft);
  const soft = findings.filter((f) => f.soft);

  if (counts.anchors === 0) {
    console.error('❌ check-adr-symbol-anchors: the sweep found ZERO anchors in docs/adr/** — the extractor is broken, not the corpus clean.');
    process.exit(1);
  }

  for (const f of soft) console.log(`ℹ️  [${f.kind}] ${f.doc}:${f.line}  ${f.raw}\n      ${f.detail}`);

  if (hard.length > 0) {
    console.error(`❌ check-adr-symbol-anchors: ${hard.length} finding(s) across ${counts.docs} records.\n`);
    for (const f of hard) console.error(`  [${f.kind}] ${f.doc}:${f.line}  ${f.raw}\n      ${f.detail}`);
    console.error(`\nThe anchor grammar:\n  ${ANCHOR_GRAMMAR}`);
    console.error('\n⛔ MAINTAINER-ONLY: an `anchor-exempt` marker is not the remedy — fix the anchor.');
    process.exit(1);
  }

  console.log(
    `✅ check-adr-symbol-anchors: ${counts.anchors} anchors across ${counts.docs} records resolve — ` +
      `${counts.symbol} symbol (${counts.declaration} declaration, ${counts.literal} literal), ` +
      `${counts.fileLevel} file-level, ${counts.crossRepo} cross-repo, ${counts.exempt} exempt, ` +
      `${counts.continuation} continuation. 0 line anchors survive.`,
  );
}

function list(root = process.cwd()) {
  const { findings, counts } = sweepCorpus(CORPUS, root);
  console.log(JSON.stringify({ counts, findings }, null, 2));
}

/* ─────────────────────────────── self-test ─────────────────────────────── */

function assert(cond, msg) { if (!cond) { console.error(`❌ check-adr-symbol-anchors --self-test: ${msg}`); process.exit(1); } }

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// A module-level `assert()` that exits on the first failure used to be this
// self-test's ONLY success condition, so "every case held" and "the cases
// never ran" printed the same line. Closed the way PR #13487 validated on
// check-doc-authoring: what is pinned is the registered NAMES, not a
// number. The floor requires the OPENED set to equal the DECLARED set with
// each battery at or above its own count.
//
// This file declares ONE battery, opened at the top of the self-test body. It
// carries fewer than the two named section banners the sectioning criterion
// needs, and ⛔ a comment is NOT promoted to a section head — that is a
// judgement per comment this transplant does not make. The hoisted single
// battery is the shape PR #14896, PR #15003 and PR #15217 landed for exactly
// this case.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-adr-symbol-anchors self-test': 17,
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
const SELF_TEST_VERDICT = 'check-adr-symbol-anchors self-test reached its verdict';

export function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  battery('check-adr-symbol-anchors self-test');
  // A thin in-body wrapper over the module-level `assert`: it attributes the
  // case to the open battery and then defers to the existing assertion, whose
  // semantics (print and exit 1 on the first failure) are unchanged.
  const check = (cond, message) => {
    registerCase();
    assert(cond, message);
  };
  // 1. ⭐ The instrument this gate cannot hold about itself on a clean tree: a
  //    synthetic corpus carrying one of EVERY finding class, plus the healthy
  //    forms, so "no findings" is told apart from "the rule stopped matching".
  const tmp = mkdtempSync(join(tmpdir(), 'check-adr-symbol-anchors-'));
  try {
    const write = (rel, body) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), body); };
    write('src/thing.ts', 'export function realSymbol() {}\nconst names = ["sys_thing"];\n// commentOnlySymbol is only named here\n');
    write('docs/adr/0001-good.md', [
      'A symbol anchor `src/thing.ts#realSymbol` resolves.',
      'A data identifier `src/thing.ts#sys_thing` resolves as a literal.',
      'A file-level anchor `src/thing.ts` resolves.',
      'A continuation `src/thing.ts#realSymbol` then `#sys_thing`.',
    ].join('\n'));
    write('docs/adr/0002-bad.md', [
      'A survived line anchor `src/thing.ts:42` must be found.',
      'A range `src/thing.ts:10-20` must be found.',
      'An en-dash range `src/thing.ts:30–40` must be found.',
      'A missing symbol `src/thing.ts#noSuchSymbol` must be found.',
      'A comment-only symbol `src/thing.ts#commentOnlySymbol` must be found.',
      'A gone file `src/vanished.ts#whatever` must be found.',
      'A bogus exemption `src/thing.ts:99` <!-- anchor-exempt: NOPE --> must be found.',
    ].join('\n'));
    write('docs/adr/0003-exempt.md', 'An excused anchor `src/gone.ts:7` <!-- anchor-exempt: HISTORICAL --> is silent.');
    // the sweep reads `git ls-files`, so the fixture needs to be a repo
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    execFileSync('git', ['add', '-A'], { cwd: tmp });

    const { findings, counts } = sweepCorpus(CORPUS, tmp);
    const kinds = findings.map((f) => f.kind);
    const count = (k) => kinds.filter((x) => x === k).length;

    check(count('line-anchor') === 3, `3 line anchors (plain, hyphen range, EN DASH range) must be found, got ${count('line-anchor')}`);
    // `noSuchSymbol` (absent) and `commentOnlySymbol` (named only in a
    // comment — the census's permissiveness, refused here). The vanished FILE
    // is a different class and is asserted separately below.
    check(count('unresolved-symbol') === 2, `2 unresolved symbols must be found, got ${count('unresolved-symbol')}`);
    check(count('bad-exemption') === 1, `an invalid exemption class must be a finding, got ${count('bad-exemption')}`);
    check(count('unresolved-path') === 1, `a vanished target must be a finding, got ${count('unresolved-path')}`);
    check(counts.exempt === 1, 'a valid exemption must be honoured exactly once');
    // ...and the healthy record must contribute NOTHING. A rule that fires on
    // good anchors is as broken as one that misses bad ones.
    check(!findings.some((f) => f.doc.includes('0001-good')), 'the healthy record must produce no findings');
    check(counts.declaration >= 1 && counts.literal >= 1, 'both resolution classes must be exercised by the fixture');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 2. The population guard: the declaration is read by ANOTHER tool
  //    (dispatch-gates / check-declared-population-live), so a wrong entry runs
  //    perfectly green here and shows up only as a dev who was never told this
  //    gate reads their surface.
  check(ROOT_DIR_WATCH_HINTS.every((h) => h.startsWith(ADR_DIR)), 'every watch hint must be under the declared ADR dir');
  check(existsSync(ADR_DIR), `the declared population must reach the tree: ${ADR_DIR}`);
  check(CORPUS.docRoots.includes(ADR_DIR), 'the corpus must sweep the population this gate declares');
  check(
    ROOT_DIR_WATCH_HINTS.every((h) => CORPUS.docRoots.includes(h.replace(/\/\*+$/, ''))),
    `the declared hints must name the roots the corpus sweeps: ${ROOT_DIR_WATCH_HINTS.join(', ')} vs ${CORPUS.docRoots.join(', ')}`,
  );

  // 3. ⭐ The live corpus is not empty. This is the ONLY thing separating a
  //    clean tree from an extractor that silently matches nothing — the exact
  //    failure mode that let 243 rotted anchors sit unnoticed.
  const live = sweepCorpus(CORPUS);
  check(live.counts.anchors > 300, `the live ADR corpus must yield its anchors, got ${live.counts.anchors}`);
  check(live.counts.symbol > 0, 'the live corpus must contain resolved SYMBOL anchors');

  // 4. The gate is wired to run. A gate nothing invokes is this repo's most
  //    carded defect class, and renaming a step silently detaches it.
  const workflow = readFileSync('.github/workflows/lint.yml', 'utf8');
  check(workflow.includes('node scripts/check-adr-symbol-anchors.mjs'), 'lint.yml must invoke this gate');
  check(workflow.includes('node scripts/check-adr-symbol-anchors.mjs --self-test'), 'lint.yml must invoke this gate\'s --self-test');

  // 5. The census declaration is intact, INCLUDING the one-way error direction
  //    the ruling ordered recorded (point 5).
  check(CENSUS_13556.rotRateIsLowerBound === true, 'the 72.1% figure is a LOWER bound and must be declared as one');
  check(CENSUS_13556.totalSurface === CENSUS_13556.distinctLineAnchors + CENSUS_13556.continuationAnchors, 'the declared surface must be the sum of its parts');

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  // The floor's refusal joins the SAME sink the cases use — the module-level
  // `assert`, which prints and exits 1 — so a breached floor cannot be printed
  // over by the verdict below.
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

  console.log(`✅ check-adr-symbol-anchors --self-test: every finding class provoked, healthy anchors silent, population live, wiring pinned (${live.counts.anchors} live anchors)`);

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  // The `if` body is BRACED so the trailing `else if` cannot re-bind to the
  // inner refusal; the `else` arms stay unbraced, per the landed
  // `scripts/pm/check-label-desc-cap.mjs` precedent.
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-adr-symbol-anchors self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else if (process.argv.includes('--list')) list();
  else runCheck();
}
