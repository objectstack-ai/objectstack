#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-tenant-audit-census -- holds `content/docs/permissions/tenant-audit-census.mdx`,
 * its ledger index and the ledger's per-package shards to the code they claim to
 * enumerate, and PRINTS the census totals no committed file states.
 *
 *   node scripts/check-tenant-audit-census.mjs
 *   node scripts/check-tenant-audit-census.mjs --self-test
 *
 * The repair arm is the GENERATOR, not this gate:
 *
 *   node scripts/tenant-audit-census.mjs --write
 *
 * That page carries the population the `auditMissingTenant` control acts on. Its
 * predecessor was a comment on an issue that later 404'd, taking the list with
 * it while three open cards still named it as their input -- so the page exists
 * to be re-derivable, and this gate exists so "re-derivable" is a property the
 * build checks rather than a promise the page makes.
 *
 * ## ⭐ Why this is a DRIFT gate and not an anchor gate
 *
 * The sibling `isSystem` census page carries `file:line` anchors and a gate that
 * resolves them. That shape earns something real -- prose rows that point at
 * code -- and it pays for it twice:
 *
 *   - the anchors rot on pure DISPLACEMENT. An inserted import above a site
 *     moves every anchor below it, so the page reds on an edit that changed
 *     nothing it measures.
 *   - its repair arm then has to tell displacement apart from a population
 *     change, and gets it wrong: a file whose ledger-excused citations also
 *     shifted is reported as "the POPULATION changed" when nothing about the
 *     population moved. That refusal asserts something FALSE on a
 *     security-relevant surface, in the one direction an author is instructed to
 *     trust.
 *
 * This page is a CENSUS rather than a behaviour reference, so it does not need
 * anchors to be useful, and the whole failure class is avoidable by not having
 * them. The generated region aggregates by (file, verb, object, tenancy, context
 * posture) and carries no line numbers, which is invariant under displacement;
 * the only thing that can move it is the population. `--json` on the generator
 * still carries every site's `file:line` for anyone navigating to one.
 *
 * ⇒ There is exactly ONE repair path (`--write`), it is mechanical, and it has
 *   no case where it must guess. That is the property the anchor scheme cannot
 *   have, and it is why this gate is not a port of its sibling.
 *
 * ## The checks
 *
 *   A  DRIFT       every generated artefact equals what the generator produces
 *                  from the tree right now, byte-for-byte: the page's generated
 *                  region, the ledger index
 *                  `docs/audits/2026-08-tenant-audit-write-call-sites.counts.md`,
 *                  and every per-package shard under `SHARD_DIR` -- a package
 *                  with sites and no shard, and a shard naming a package the
 *                  census finds nothing in, are drift too. This is the
 *                  load-bearing one: it holds them to the CODE, in the census ->
 *                  page direction, so a site that arrives with no row fails
 *                  rather than going unnoticed. Each shard carries its package's
 *                  TOTALS, and every census total is a sum of those, so a moved
 *                  total is a drifted shard. ⛔ The CORPUS-SCALE rows and their
 *                  dated marker are masked out of the comparison -- they must be
 *                  PRESENT and DATED, never equal. See the split at
 *                  `UNENFORCED_SCALE_ROWS`.
 *   B  PROSE       the page's hand-written prose states NO live census total.
 *                  It used to state two dozen, each held equal to the census --
 *                  and every PR adding a write call site then rewrote them, so
 *                  any two such PRs conflicted on the page. Those figures are
 *                  now the gate's printed output, and a sentence restating one
 *                  in any shape it used to take (`LIVE_TOTAL_PROSE_SHAPES`) is
 *                  a finding: a hand-written number is exactly the thing that
 *                  goes stale first, and a hand-written TOTAL is the thing two
 *                  branches both rewrite. Its corpus-scale counterpart is
 *                  `UNENFORCED_PROSE_COUNTS`: required to be said, not to be right.
 *   C  CENSUS       the census this gate just ran placed every write call site it
 *                  found, and every `UNTYPED_RECEIVERS` row still matches a call.
 *                  Those are facts about the TREE rather than about the artefacts
 *                  and they arrive on the census object itself, as `unledgered`
 *                  and `staleLedgerRows`. CI runs THIS gate and never the
 *                  generator, so until check C existed the generator's own exit 1
 *                  on an unplaceable receiver reached nobody: the census could
 *                  find one, say so to no one, and `Lint & Repo Gates` stayed
 *                  green. See `censusRefusals`.
 *
 * ## ⭐ What is enforced, and what is deliberately not
 *
 * The two artefacts carry two kinds of number and they behave nothing alike.
 * POPULATION -- every write call site, its row, and its tenancy/context verdict,
 * i.e. everything in `census.totals` -- is enforced byte-for-byte and nothing
 * about it was relaxed. CORPUS SCALE -- how many sources were walked, how many
 * engine-shaped types recognised, how many objects declared, how many same-named
 * calls subtracted -- is present, dated, and NOT compared.
 *
 * Adopted by maintainer ruling on 2026-08-31 (option A), following the precedent
 * the sibling `scripts/check-system-context-census.mjs#UNENFORCED_TEXT_COUNTS`
 * set (lines 77-84 there as measured). The full ruling, the falsified
 * alternative (line 30 there, the ⭐ line quoted below), and the measurement that draws the line
 * where it is drawn are all at `UNENFORCED_SCALE_ROWS` below.
 *
 * Check B is not redundant with A. The generated artefacts cannot lie, because
 * they are rewritten; the prose around the region is where a human writes a
 * claim, and #13178's whole lesson is that a quoted number outlives the
 * measurement it quoted -- so the prose quotes none, and B holds it to that.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * A page that cannot be read, a missing marker pair, a census with zero sites, a
 * prose pattern that matches nothing, and any refusal the generator itself
 * raises (an unplaceable receiver, a stale ledger row, an unparseable source)
 * are all exit 1 naming what could not be read. The first two of those reach the
 * exit code through `censusRefusals` (check C); the third throws out of
 * `runCensus()` before any check runs.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// This self-test used to decide success by "no failure was recorded" and
// nothing else, so "every case held" and "the cases never ran" printed the same
// line. Closed the way PR #13487 validated on check-doc-authoring: what is
// pinned is the registered NAMES, not a number. Every section opens with
// `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3 keeps
// a total "right" the moment a sibling grows. A set difference says WHICH
// battery stopped; a count says only that something did.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
//
// The machinery lives HERE, at module scope, rather than inside the self-test:
// this self-test's assertion sink is not a block-bodied helper in its body (it
// is a concise arrow, or a module-scope function), so there is no in-body
// helper to thread a per-run ledger through. Module scope is safe because the
// self-test runs once per process, and it is what lets the existing sink route
// through `registerCase()` with no case rewritten and no assertion changed.
const SELF_TEST_BATTERIES = Object.freeze({
  'A DRIFT': 7,
  'B PROSE': 4,
  '⭐ THE SPLIT': 9,
  'census refusals': 7,
  'refusals': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 5;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// ⚠️ None of these helpers is named with a self-test spelling, deliberately and
// on the record: `check:pm-dispatch-gates` anchors on a top-level declaration
// whose NAME spells self-test, and every such name owes a row in that gate's
// COMPOUND_ANCHOR_LEDGER. These are the battery ROSTER's machinery -- they hold
// no fixtures to mask and read no path literal -- so the accurate name is the
// one that says `battery`, not the one that would owe a ledger row for a role
// this code does not have.

/** Cases registered per battery: `battery()` opens one, `registerCase()` files into it. */
const batteryCases = new Map();
let openBattery = null;

/** Open a battery. Every assertion after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by the self-test's own assertion sink, once per assertion. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/**
 * The floor: every declared battery RAN, and ran its cases (#13489).
 *
 * Evaluated after every battery has had its chance and BEFORE the verdict, so
 * the success line can only be printed by a run in which the set of batteries
 * that registered assertions EQUALS the set declared.
 */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

import {
  BEGIN_MARKER,
  COUNTS,
  END_MARKER,
  PAGE,
  SHARD_DIR,
  corpusScaleRows,
  notRoundTrippableSites,
  readShardFiles,
  renderCountsFile,
  renderGeneratedRegion,
  renderShards,
  runCensus,
  selfTest as censusSelfTest,
  totalsRows,
  undefendedCountRows,
} from './tenant-audit-census.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The paths this gate operates on, written where `scripts/pm/dispatch-gates.mjs`
 * can see them. Provenance ONLY: nothing in this gate reads this list, and every
 * check below behaves exactly as it did without it.
 *
 * ## The gap this closes, measured rather than argued
 *
 * That tool builds a card's gate list by scanning each gate's own source for the
 * path literals it operates on, and it refuses to FOLLOW a module that is itself
 * a gate file. This gate spelled **zero** literals of its own and inherited all
 * 22 from `tenant-audit-census.mjs` — until that module became a gate file in its
 * own right, the moment CI began invoking its `--self-test` directly.
 *
 * ⇒ The inheritance was cut, and the loss is silent in exactly the way this repo
 *   treats as worse than a red: a lead that stops appearing is indistinguishable
 *   from a lead that was never earned. A PR touching `packages/services/**` — the
 *   population this census exists to count — would simply stop being told that
 *   this gate reads its diff. `dispatch-gates --self-test` catches it, by name:
 *   "promoting N module(s) to gate files subtracts no inherited hint from any
 *   other family — LOST: scripts/check-tenant-audit-census.mjs <- …".
 *
 * The two subtrees are the census corpus, and they cover every `UNTYPED_RECEIVERS`
 * path the generator spells — `hintCovers('packages/services', …)` is true for all
 * of them — so restoring the roots restores the whole inherited population rather
 * than a sample of it. The two artefacts are here because a HAND-EDIT to either is
 * precisely what this gate exists to reject, and that edit must derive it.
 *
 * ⚠️ Kept in sync by nothing but review, which is why it is provenance and never
 * a lookup key: `PAGE` and `COUNTS` are imported for every real use below, and the
 * corpus roots live in `SURFACE_ROOTS`. This list may only ever be a WIDER-or-equal
 * restatement of those; a narrower one silently shrinks the gate's discoverability
 * again, which is the defect above wearing a different hat.
 */
const ROOT_DIR_WATCH_HINTS = [
  'packages/services/**',
  'packages/plugins/**',
  'content/docs/permissions/tenant-audit-census.mdx',
  'docs/audits/2026-08-tenant-audit-write-call-sites.counts.md',
  'docs/audits/2026-08-tenant-audit-write-call-sites.counts/**',
];

/**
 * The shapes in which the page's prose used to state a LIVE census total.
 *
 * ## ⭐ Why the prose states none any more
 *
 * Each of these was once a `PROSE_COUNTS` row: the sentence was required to
 * appear and its number to equal the census. That held the prose honest and made
 * the page the hottest conflict surface in the census -- every PR adding a write
 * call site rewrote two dozen hand-written numbers, so any two such PRs conflicted
 * on the page even when the generated artefacts merged. The figures are now the
 * gate's printed output (`printTotals`), and every number left in the prose is
 * dated history that is never regenerated.
 *
 * ⇒ Each shape below must match NOTHING. A live total written back into the prose
 *   is a finding whatever its value: a right number there is the next conflict,
 *   and a wrong one is #13178's lesson -- a quoted number outliving its
 *   measurement. ⚠️ Two former rows are deliberately absent: the over-claim
 *   history ("published **N sites ...**", "when N said so and N were simply
 *   unread") now carries the figures of the day it was caught, dated, so those
 *   shapes match history and are not live.
 *
 * ⚠️ Matched against the prose with WHITESPACE COLLAPSED, so every pattern is
 * written with single spaces and none of them can break on a re-wrap.
 */
export const LIVE_TOTAL_PROSE_SHAPES = [
  { name: 'sites reached through an erased receiver', pattern: /there are \d+ of them/ },
  {
    name: 'sites reached through an erased receiver (deviation section)',
    pattern: /the \d+ sites reached through an erased \(`any`\) receiver/,
  },
  { name: 'sites naming their object through a const', pattern: /and the \d+ that name their object through a `const`/ },
  { name: 'sites whose options argument is unreadable', pattern: /\*\*\d+ of the \d+ sites are spelled that way\*\*/ },
  { name: 'decidably-not-elevated is now N', pattern: /decidably-not-elevated sites is now \*\*\d+\*\*/ },
  { name: 'deviation row: write call sites', pattern: /\| 175 write call sites \|[^|]*\| \*\*\d+\*\* \|/ },
  {
    name: 'deviation row: provable and tenancy-enabled',
    pattern: /\| 24 carrying no tenant context \|[^|]*\| \*\*\d+\*\* provable and tenancy-enabled/,
  },
  { name: 'deviation row: statically decidable', pattern: /\| \*\*\d+ of \d+\*\* decidable, \*\*\d+\*\* undecidable \|/ },
  { name: 'deviation row: decidably elevated', pattern: /\*\*not reproduced\*\*: \d+ decidably elevated/ },
  { name: 'the elevated share restated in prose', pattern: /This census reads \d+ of \d+ \(\d+%\) as decidably elevated/ },
  { name: 'the figure downstream cards should cite', pattern: /Cite `\d+ \/ \d+`/ },
  {
    name: 'the further sites that are neither in nor out',
    pattern: /\*\*\d+ further sites\*\* have an options argument this cannot read/,
  },
];

// ---------------------------------------------------------------------------
// ⭐ The enforced / unenforced split
// ---------------------------------------------------------------------------

/**
 * ⛔ The corpus-scale numbers this gate deliberately does NOT hold to the tree,
 * listed here so that stays a DECISION instead of an omission.
 *
 * Maintainer ruling, 2026-08-31, verbatim and untranslated:
 *
 *   > **裁定**:采**选项 A** —— 租户审计普查工件的门禁采纳兄弟门禁
 *   > (`check-system-context-census.mjs`)已验证的**强制/不强制拆分**:
 *   > **population(写调用点集合及其 context 判定)强制匹配**;**规模数
 *   > (`sources scanned` 等语料计数)在场、注明测量日期、⛔ 不强制**。
 *
 * ## The precedent the ruling rests on
 *
 * The sibling `isSystem` census gate already carries this split, and its docblock
 * (`scripts/check-system-context-census.mjs#UNENFORCED_TEXT_COUNTS`, the paragraph
 * beside it) gives the reason:
 *
 *   > *"The split is not a tolerance. Nothing about the CONTRACT stopped being
 *   > checked ... What stopped being checked is a set of numbers about a
 *   > population the page does not certify -- and whose churn, measured, was
 *   > blocking the page from ever landing."*
 *
 * ## ⛔ What was NOT adopted, and why it is closed
 *
 * Asserting against a RECORDED BASELINE SHA instead of the live tree was proposed
 * and is falsified. `scripts/check-system-context-census.mjs` refutes it in one
 * line (line 30 there as measured):
 *
 *   > *"a gate that only checks what the page already says can never find what
 *   > the page failed to say."*
 *
 * A gate pinned to a commit nobody reviews can no longer answer "a write call
 * site arrived and nothing documents it" -- the #13178 shape. It does not remove
 * staleness, it removes the alarm, and it does so wearing a green tick.
 *
 * ## ⭐ Why the split is drawn HERE, measured rather than argued
 *
 * Measured over the 60 most recent non-merge commits reachable from `967402a12`,
 * by running this census at every one of the 16 that touch the corpus (the other
 * 44 cannot move either artefact) and diffing the RENDERED artefacts line by line:
 *
 *   artefacts drifted at all            3 of 59 transitions
 *   -- SCALE-ONLY (two lines, both      2   `sources scanned` 521->533->534,
 *      the sources-scanned figure)          every population figure byte-identical
 *   -- REAL population drift            1   25 lines, none of them corpus scale
 *                                           (writeCallSites 214->215 and the
 *                                           verdict counts that moved with it)
 *
 * ⭐ The control is the whole argument, and it points both ways: on the two
 * scale-moving commits the population held EXACTLY still, and on the one
 * population-moving commit every corpus-scale number held EXACTLY still. The two
 * classes did not move together once. So this split removes two of the three
 * measured reds, and the two it removes are precisely the ones with no safety
 * content -- while the one that matters still fails.
 *
 * ⚠️ It is necessary and NOT sufficient, and the honest number is smaller than
 * the card that ordered it estimated: that card put `sources scanned` churn at
 * 25% of commits. Re-measured, 26.7% of commits TOUCH the corpus but only 3.4%
 * MOVE the count -- the classifier behind the 25% counted the touch, not the
 * move. Residual population drift is ~1.7% of commits, which still lands inside
 * a human-merge window; that is the "new measured data" the ruling's option-C
 * paragraph asks to be brought back to the box, not something this gate fixes.
 *
 * ## What is still enforced, in full
 *
 * Every write call site and its row; every tenancy and context verdict; every
 * figure inside `census.totals`; the whole aggregated site table; an empty census;
 * a missing region; and every enforced prose figure. ⛔ Nothing security-relevant
 * moved to this list. The line is the one the census data already draws:
 * `census.totals.*` is the population the page certifies, and the four scalars
 * beside it describe the corpus it walked.
 *
 * ⭐ The labels are derived from the GENERATOR's own `corpusScaleRows`, never
 * copied: a fifth corpus number added there is covered here the moment it is
 * emitted, and a renamed row cannot leave a stale pattern behind that matches
 * nothing while reading as coverage.
 */
export const UNENFORCED_SCALE_ROWS = corpusScaleRows({
  scannedSources: 0,
  engineTypes: 0,
  declaredObjects: 0,
  nonEngineCalls: 0,
}).map(([label]) => ({
  id: label,
  label,
  pattern: new RegExp(`^\\| ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| (\\d+) \\|$`, 'm'),
  canonical: `| ${label} | «unenforced» |`,
}));

/**
 * The unenforced block must SAY WHEN IT WAS TRUE, and this gate holds it to that.
 *
 * ⚠️ A number nothing enforces rots silently -- which is the disease this whole
 * artefact exists to treat, one level down. Four bare numbers that read as current
 * and are checked by nothing would be a worse artefact than four that say when
 * they were measured.
 *
 * ⛔ The date and the ref are deliberately NOT compared to anything. Requiring
 * them to be recent would re-introduce exactly the churn this split removes.
 */
export const UNENFORCED_MEASURED_AT = {
  pattern: /^Measured on (\d{4}-\d{2}-\d{2}) at `([0-9a-f]{7,40})`\.$/m,
  why: 'the dated marker on the corpus-scale block',
};

/**
 * Prose figures that are corpus scale rather than population.
 *
 * Same contract as the sibling's `UNENFORCED_TEXT_COUNTS`: each row is still
 * REQUIRED TO MATCH, exactly once, so a reworded page cannot retire the rule by
 * deleting a sentence. ⛔ What is dropped is only the COMPARISON. The date these
 * carry is the one marker on the page's corpus-scale block.
 */
export const UNENFORCED_PROSE_COUNTS = [
  {
    name: 'declared objects in the registry',
    pattern: /Across (\d+) declared objects/,
  },
];

/**
 * Blank the unenforced VALUES on both sides of the byte comparison.
 *
 * ⭐ This is where the split had to differ from its sibling, and the difference is
 * structural rather than stylistic. The sibling enforces a HAND-WRITTEN page
 * through a list of regexes, so it splits by simply not comparing some of them.
 * This gate's enforced half is a BYTE-FOR-BYTE comparison of GENERATED text --
 * there is no per-number comparison to drop. Adding an unenforced list beside the
 * byte compare would have changed nothing: the byte compare still reds on the
 * scale line. So the value is masked out of both texts and everything else stays
 * byte-exact.
 *
 * The mask is anchored to the whole line and rewrites it WHOLE, so it cannot
 * blank a digit that is part of a label, and a row whose shape changed simply
 * fails to mask -- surfacing as drift rather than as a silent exemption.
 */
export function maskUnenforced(text) {
  let out = text;
  for (const row of UNENFORCED_SCALE_ROWS) {
    out = out.replace(new RegExp(row.pattern.source, 'gm'), row.canonical);
  }
  return out.replace(
    new RegExp(UNENFORCED_MEASURED_AT.pattern.source, 'gm'),
    'Measured on «unenforced» at `«unenforced»`.',
  );
}

/** Split the page into its hand-written prose and its generated region. */
export function splitPage(pageText) {
  const begin = pageText.indexOf(BEGIN_MARKER);
  const end = pageText.indexOf(END_MARKER);
  if (begin === -1 || end === -1) {
    return {
      error:
        `${PAGE} has no generated region -- expected the marker pair `
        + '`BEGIN GENERATED: tenant-audit-census` / `END GENERATED: tenant-audit-census`. '
        + 'Run `node scripts/tenant-audit-census.mjs --write` after restoring them.',
    };
  }
  return {
    prose: pageText.slice(0, begin) + pageText.slice(end + END_MARKER.length),
    region: pageText.slice(begin, end + END_MARKER.length),
  };
}

/** The first line at which two texts differ, for a refusal that names the drift. */
function firstDifference(committed, expected) {
  const a = committed.split('\n');
  const b = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return { line: i + 1, committed: a[i] ?? '(page ends here)', expected: b[i] ?? '(census ends here)' };
    }
  }
  return null;
}

/**
 * ⭐ Check C -- the refusals the CENSUS raises, given an exit.
 *
 * `runCensus()` reports three failures about the RUN rather than about the
 * artefacts: a write call site whose receiver is erased and that none of the
 * three placement rules reaches (`census.unledgered`), an `UNTYPED_RECEIVERS`
 * row that no longer matches any call in the corpus (`census.staleLedgerRows`),
 * and a receiver whose declared type the census stored whitespace-collapsed and
 * cannot read back ({@link notRoundTrippableSites}).
 *
 * ⭐ The third one is why this function is load-bearing rather than tidy. That
 * class used to end the whole process inside `runCensus` -- `parseSourceFile`
 * refuses by `process.exit`, so this gate died with it and CI went red. It is now
 * localised to the one site, which is the repair; but a localisation that let CI
 * go GREEN would have traded a loud takedown for a quiet subtraction, and the
 * subtraction is the thing the census exists not to do in silence. ⇒ the site is
 * declared in both artefacts AND refused here. ⛔ Neither half alone is the
 * repair.
 *
 * The generator's own `main()` prints both and exits 1 -- but `lint.yml` invokes
 * THIS gate and never the generator, so until this function existed those two
 * fields were read by nothing on the way to a CI verdict. The census could find
 * an unplaceable receiver, print nothing anyone runs, and the job stayed green:
 * a defect arriving as COMPLIANCE, which is the one direction the census says it
 * cannot survive being wrong in (`tenant-audit-census.mjs`, the rule the page
 * publishes verbatim: *"An unreadable receiver that none of the three place is an
 * ERROR, never a default."*).
 *
 * ⛔ The repair is NOT to add `node scripts/tenant-audit-census.mjs` beside this
 * gate in the workflow: that walks the same corpus and builds the same AST a
 * second time for one verdict this gate already holds in its hand. What was
 * missing is the READ, and the read costs nothing.
 *
 * ⚠️ Deliberately NOT folded into `checkPage`. That function certifies the two
 * ARTEFACTS against a census and takes its page as text so the self-test can feed
 * it adversarial fixtures; this one certifies the CENSUS, and its fixtures are
 * synthetic censuses. Keeping them apart is what lets the self-test instrument
 * check C in both directions no matter what today's tree happens to hold -- a
 * tree with an unplaceable receiver would otherwise turn `--self-test` red on its
 * "the committed artefacts are clean" case and take every other case's verdict
 * with it.
 *
 * @returns {string[]} problems, empty when the census placed every site it found.
 */
export function censusRefusals(census) {
  const problems = [];
  for (const u of census.unledgered ?? []) {
    problems.push(
      `[untyped-receiver] ${u.file}:${u.line} \`${u.receiver}\`.${u.verb}() -- receiver type `
      + `unreadable [${u.how}] and the object name is not a literal declared object. Nothing `
      + 'places this site, so the census cannot say whether it is an engine write at all and the '
      + 'page certifies a population with a hole in it. Rule on what the receiver is, then add an '
      + '`UNTYPED_RECEIVERS` row in `scripts/tenant-audit-census.mjs` saying so.',
    );
  }
  for (const u of notRoundTrippableSites(census)) {
    problems.push(
      `[type-text-not-round-trippable] ${u.file}:${u.line} \`${u.receiver}\`.${u.verb}() -- this tool `
      + `cannot re-parse the declared type it derived for this receiver, so the door rule could not be `
      + `read off it and the census cannot say whether this site is an engine write at all: `
      + `\`${u.type}\`. The SOURCE parsed -- what did not is the census's own re-serialisation of a `
      + 'fragment of it, so this is a fault in the tool and not a fact about the corpus. ⛔ Nothing is '
      + 'wrong with the code at this site and nothing here asks you to restyle it: file this against '
      + 'the census, with the located parse verdict the generator prints under the site.',
    );
  }
  for (const r of census.staleLedgerRows ?? []) {
    problems.push(
      `[stale-ledger-row] UNTYPED_RECEIVERS names ${r.file} (receiver \`${r.receiver}\`) but no `
      + 'such write call exists -- delete the row. A row that matches nothing still EXCUSES the '
      + 'next site that grows into its (file, receiver) pair, so a stale row is an exemption '
      + 'nobody can see.',
    );
  }
  return problems;
}

/**
 * Run both artefact checks against a census, a page text, the ledger index text
 * and the shard texts (repo-relative path -> text, as `readShardFiles` reads them).
 *
 * Takes every artefact as TEXT rather than reading it, so the self-test can feed
 * adversarial pages and shard sets through the same code path the production run
 * uses.
 *
 * @returns {string[]} problems, empty when clean.
 */
export function checkPage(census, pageText, countsText, shardTexts = new Map()) {
  const problems = [];

  if (census.sites.length === 0) {
    problems.push(
      '[empty-census] the census found ZERO write call sites -- refusing to certify a page '
      + 'against nothing (a walk that found nothing and a tree with nothing to find are different).',
    );
    return problems;
  }

  const split = splitPage(pageText);
  if (split.error) {
    problems.push(`[no-region] ${split.error}`);
    return problems;
  }
  const prose = split.prose.replace(/\s+/g, ' ');

  // ── A DRIFT ────────────────────────────────────────────────────────────────
  // ⭐ Byte-for-byte on the POPULATION; value-blind on the CORPUS-SCALE rows and
  // the dated marker. Those are masked on BOTH sides rather than dropped from a
  // comparison list, because the comparison here is the whole text -- see
  // `maskUnenforced`. Everything outside those lines is still exact.
  for (const [label, committed, expected] of [
    [PAGE, split.region, renderGeneratedRegion(census)],
    [COUNTS, countsText, renderCountsFile(census)],
  ]) {
    // ⛔ "Not enforced" must not decay into "not there". The rows and their date
    // are required to be PRESENT in the committed artefact; only their VALUES go
    // unchecked. A row reworded off the artefact is a finding, never a pass.
    for (const row of UNENFORCED_SCALE_ROWS) {
      if (!row.pattern.test(committed ?? '')) {
        problems.push(
          `[unenforced-row-missing] ${label} no longer carries the \`${row.id}\` corpus-scale row. `
          + 'It is deliberately not held to the tree, but it is still required to be there and '
          + 'to be dated -- regenerate, or remove it from the generator\'s `corpusScaleRows` if '
          + 'it is really gone, rather than leaving a number nobody can find.',
        );
      }
    }
    if (!UNENFORCED_MEASURED_AT.pattern.test(committed ?? '')) {
      problems.push(
        `[unenforced-undated] ${label} states ${UNENFORCED_SCALE_ROWS.length} corpus-scale number(s) `
        + `this gate does not enforce and no longer says when they were measured `
        + `(${UNENFORCED_MEASURED_AT.why}). An unenforced number without a date reads as current `
        + 'and is checked by nothing -- restore the marker or delete the numbers.',
      );
    }

    const maskedCommitted = maskUnenforced(committed ?? '');
    const maskedExpected = maskUnenforced(expected);
    if (maskedCommitted === maskedExpected) continue;
    const diff = firstDifference(maskedCommitted, maskedExpected);
    problems.push(
      `[census-drift] the committed census in ${label} is not what the tree produces. `
      + (diff
        ? `First difference at line ${diff.line}:\n`
          + `    committed : ${diff.committed}\n`
          + `    census    : ${diff.expected}\n`
        : '')
      + '    Fix: node scripts/tenant-audit-census.mjs --write',
    );
  }

  // ── A DRIFT, per package ───────────────────────────────────────────────────
  // ⭐ The population's rows AND its totals, one shard per package. Byte-for-byte,
  // with nothing masked: a shard carries no unenforced number. The two shapes a
  // single file could not have are refused here as drift of the same kind -- a
  // package whose sites no shard holds, and a shard holding a package the census
  // finds nothing in (it would certify sites that are gone).
  const expectedShards = renderShards(census);
  for (const [rel, expected] of expectedShards) {
    const committed = shardTexts.get(rel);
    if (committed === undefined) {
      problems.push(
        `[census-drift] the census has write call sites in the package ${rel} is the shard for, `
        + 'and that shard is not committed -- those sites and their totals are certified nowhere.\n'
        + '    Fix: node scripts/tenant-audit-census.mjs --write',
      );
      continue;
    }
    if (committed === expected) continue;
    const diff = firstDifference(committed, expected);
    problems.push(
      `[census-drift] the committed census in ${rel} is not what the tree produces. `
      + (diff
        ? `First difference at line ${diff.line}:\n`
          + `    committed : ${diff.committed}\n`
          + `    census    : ${diff.expected}\n`
        : '')
      + '    Fix: node scripts/tenant-audit-census.mjs --write',
    );
  }
  for (const rel of shardTexts.keys()) {
    if (expectedShards.has(rel)) continue;
    problems.push(
      `[census-drift] ${rel} is committed under ${SHARD_DIR}/ but the census finds no write call `
      + 'site and no undefended subtraction in that package -- it certifies sites that are not there.\n'
      + '    Fix: node scripts/tenant-audit-census.mjs --write (it removes the shard)',
    );
  }

  // ── B PROSE: no live total ─────────────────────────────────────────────────
  for (const row of LIVE_TOTAL_PROSE_SHAPES) {
    const matches = [...prose.matchAll(new RegExp(row.pattern, 'g'))];
    if (matches.length === 0) continue;
    problems.push(
      `[prose-total] the page's hand-written prose states a live census total again -- `
      + `"${row.name}" (${matches.map((m) => JSON.stringify(m[0])).join(', ')}). The prose carries `
      + 'no live total: every PR adding a write call site would rewrite it, so two such PRs '
      + 'conflict on the page, and a quoted number outliving its measurement is the exact failure '
      + 'this artefact replaced. Point the sentence at the figure `node '
      + 'scripts/check-tenant-audit-census.mjs` prints instead.',
    );
  }

  // ── B2 THE UNENFORCED PROSE FIGURES: present, never compared ───────────────
  // ⛔ Their VALUES are not checked -- they are corpus scale, dated by the
  // marker on the generated block. What IS checked is that the sentence still
  // exists, so "not enforced" cannot be reached by deleting the claim.
  for (const row of UNENFORCED_PROSE_COUNTS) {
    const matches = [...prose.matchAll(new RegExp(row.pattern, 'g'))];
    if (matches.length === 0) {
      problems.push(
        `[unenforced-prose-missing] the page no longer states "${row.name}" in the shape this gate `
        + `looks for (${row.pattern}). It is deliberately not held to the census, but it is still `
        + 'required to be on the page -- restore the wording, or drop the row from '
        + 'UNENFORCED_PROSE_COUNTS if the claim is really gone.',
      );
    } else if (matches.length > 1) {
      problems.push(
        `[unenforced-prose-ambiguous] "${row.name}" matches ${matches.length} places in the page; `
        + 'narrow the pattern so the row still names one claim.',
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Self-test -- the only instrument on this gate's matching rules
// ---------------------------------------------------------------------------

/**
 * A clean tree cannot tell a working rule from a weakened one: green means the
 * problem set is empty, and weakening a rule can only shrink that set. So both
 * rules are driven here against pages a clean tree does not contain -- and the
 * REAL census, so a rule that stops reading the tree fails here too.
 */

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    return cases.push({ name, ok: Boolean(ok), detail });
  };
  battery('A DRIFT');

  const census = runCensus();
  const page = readFileSync(join(ROOT, PAGE), 'utf8');
  const counts = readFileSync(join(ROOT, COUNTS), 'utf8');
  const shards = readShardFiles(ROOT);
  const check = (p = page, c = counts, sh = shards) => checkPage(census, p, c, sh);
  /** The shard set with one shard's text replaced (or, for `null`, the shard removed). */
  const withShard = (rel, text) => {
    const next = new Map(shards);
    if (text === null) next.delete(rel);
    else next.set(rel, text);
    return next;
  };
  const [firstShardPath, firstShard] = [...shards].find(([, text]) => text.includes('| `packages/')) ?? [];

  t('the committed artefacts are clean', check().length === 0, check().join(' | '));

  // ── A DRIFT ────────────────────────────────────────────────────────────────
  // ⭐ A row deleted from a SHARD -- "a site exists in code and no row names it",
  // which is the direction that matters and the one a clean tree cannot show.
  const shardLines = (firstShard ?? '').split('\n');
  const firstRow = shardLines.findIndex((l) => l.startsWith('| `packages/'));
  t('a site that exists in code but has no row in its shard is a finding',
    firstRow !== -1
    && check(page, counts, withShard(firstShardPath, [...shardLines.slice(0, firstRow), ...shardLines.slice(firstRow + 1)].join('\n')))
      .some((p) => p.startsWith('[census-drift]')));

  // A line changed in the generated region -- the shape a hand-edit takes.
  t('an edited line inside the page region is a finding',
    check(page.replace('## The measurement', '## The measurement, edited')).some((p) => p.startsWith('[census-drift]')));

  // A package's total changed -- the shape a hand-edit of a shard takes.
  const shardTotal = /^\| Write call sites \| (\d+) \|$/m;
  t('an edited total inside a shard is a finding',
    shardTotal.test(firstShard ?? '')
    && check(page, counts, withShard(firstShardPath, firstShard.replace(shardTotal, (line, n) => `| Write call sites | ${Number(n) - 1} |`)))
      .some((p) => p.startsWith('[census-drift]')));

  // ⭐ The two shapes only a SHARDED ledger can take, each in the direction a
  // clean tree cannot show: a package's sites certified nowhere, and a shard that
  // certifies a package the census finds nothing in.
  t('a package with sites and no committed shard is a finding',
    check(page, counts, withShard(firstShardPath, null))
      .some((p) => p.startsWith('[census-drift]') && p.includes(firstShardPath)));
  const orphanPath = `${SHARD_DIR}/plugins/plugin-no-such-package.md`;
  t('a shard for a package the census finds nothing in is a finding',
    check(page, counts, withShard(orphanPath, firstShard ?? ''))
      .some((p) => p.startsWith('[census-drift]') && p.includes(orphanPath)));

  // The markers themselves -- a page that lost its region must refuse, never pass.
  t('a page with no generated region refuses',
    check(page.replace(BEGIN_MARKER, '')).some((p) => p.startsWith('[no-region]')));

  // ── B PROSE ────────────────────────────────────────────────────────────────
  // ⭐ The prose carries no live total, so the direction a clean tree cannot show
  // is one written BACK into it, in a shape it used to take. Inserted rather than
  // edited: there is no live figure on a clean page to edit.
  battery('B PROSE');
  const t0 = census.totals;
  const prosePlus = (sentence) => page.replace('## ⛔ What this instrument cannot decide',
    `${sentence}\n\n## ⛔ What this instrument cannot decide`);
  t('a live total written back into the prose is a finding',
    check(prosePlus(`**${t0.tenantContextUnreadable} of the ${t0.writeCallSites} sites are spelled that way**.`))
      .some((p) => p.startsWith('[prose-total]')));
  t('a live total restated in the DEVIATION table is a finding',
    check(prosePlus(`| 175 write call sites | quoted in the merged changeset | **${t0.writeCallSites}** |`))
      .some((p) => p.startsWith('[prose-total]')));
  t('the "cite this figure" line restated with live numbers is a finding',
    check(prosePlus(`Cite \`${t0.tenancyEnabledProvablyNoContext} / ${t0.writeCallSites}\`, and say what it is.`))
      .some((p) => p.startsWith('[prose-total]')));
  // ⛔ ...and the control, without which the three above are equally passed by a
  // rule that refuses any number at all: the dated history figures on the page
  // are numbers too, and they are not findings.
  t('⭐ CONTROL: a dated history figure in the prose is NOT a finding',
    check(prosePlus('On 2026-08-31 that published **84 sites "carrying no tenant context at all"**.')).length === 0,
    check(prosePlus('On 2026-08-31 that published **84 sites "carrying no tenant context at all"**.')).join(' | '));

  // ── ⭐ THE SPLIT ───────────────────────────────────────────────────────────
  // The one direction a clean tree cannot show, in BOTH directions at once: the
  // unenforced value may move without a finding, and everything around it may
  // not. A gate that got this wrong in either direction would look identical on
  // a clean tree.
  battery('⭐ THE SPLIT');
  const scaleRow = UNENFORCED_SCALE_ROWS[0];
  const drift = (text, delta) => text.replace(
    scaleRow.pattern,
    (line, n) => `| ${scaleRow.label} | ${Number(n) + delta} |`,
  );
  t('⭐ a corpus-scale count that no longer matches the tree is NOT a finding (page)',
    check(drift(page, 41), counts).length === 0,
    check(drift(page, 41), counts).join(' | '));
  t('⭐ a corpus-scale count that no longer matches the tree is NOT a finding (ledger)',
    check(page, drift(counts, -17)).length === 0,
    check(page, drift(counts, -17)).join(' | '));

  // ⛔ ...and the control, without which the case above only proves the gate is
  // blind: a line of the same block one away from the masked value still fails,
  // and so does a POPULATION figure, which now lives in the package's shard.
  t('⭐ CONTROL: a population count in a shard IS still a finding, beside a moved scale count',
    shardTotal.test(firstShard ?? '')
    && check(drift(page, 41), counts, withShard(firstShardPath,
      firstShard.replace(shardTotal, (line, n) => `| Write call sites | ${Number(n) + 41} |`)))
      .some((p) => p.startsWith('[census-drift]') && p.includes(firstShardPath)));

  // ⛔ "not enforced" must not decay into "not there".
  t('an unenforced row deleted from the artefact is a finding, not a pass',
    check(page.replace(scaleRow.pattern, ''), counts)
      .some((p) => p.startsWith('[unenforced-row-missing]')));
  t('an unenforced row deleted from the LEDGER is a finding, not a pass',
    check(page, counts.replace(scaleRow.pattern, ''))
      .some((p) => p.startsWith('[unenforced-row-missing]')));

  // ⛔ ...nor into "undated". An unenforced number with no date reads as current.
  t('unenforced numbers with no measurement date are a finding, not a quiet pass',
    check(page.replace(UNENFORCED_MEASURED_AT.pattern, 'Measured at some point.'), counts)
      .some((p) => p.startsWith('[unenforced-undated]')));

  // ⭐ The date and the ref are deliberately NOT compared -- an old marker is the
  // point of the marker, not a finding.
  t('⭐ a measurement date from months ago is NOT a finding',
    check(page.replace(UNENFORCED_MEASURED_AT.pattern, 'Measured on 2001-01-01 at `0000000ab`.'), counts)
      .length === 0);

  // The unenforced PROSE figure: value free, sentence required. ⛔ The fixture is
  // built from the PAGE's OWN stated number -- read with the exact same pattern
  // the classifier uses (`UNENFORCED_PROSE_COUNTS[0]`) -- never from the live
  // `census.declaredObjects`. That figure is declared unenforced precisely so it
  // may drift from the tree without being a finding; a fixture pinned to the
  // LIVE count made `.replace()` a silent no-op the moment page and tree
  // disagreed, so this case failed for the PAGE rather than for the classifier
  // it exists to pin (#17437).
  const declaredObjectsRow = UNENFORCED_PROSE_COUNTS[0];
  const declaredObjectsMatch = declaredObjectsRow.pattern.exec(page);
  if (!declaredObjectsMatch) {
    throw new Error(
      `self-test fixture: the page no longer states "${declaredObjectsRow.name}" in the shape `
      + `${declaredObjectsRow.pattern} looks for -- fix the page, or this pair of cases can no `
      + 'longer build its fixture.',
    );
  }
  const declaredObjectsSentence = declaredObjectsMatch[0];
  t('⭐ a stale unenforced prose number is NOT a finding',
    check(page.replace(declaredObjectsSentence, 'Across 4 declared objects'))
      .length === 0,
    check(page.replace(declaredObjectsSentence, 'Across 4 declared objects')).join(' | '));
  t('an unenforced prose claim reworded off the page IS a finding',
    check(page.replace(declaredObjectsSentence, 'Across the declared objects'))
      .some((p) => p.startsWith('[unenforced-prose-missing]')));

  // ── census refusals (check C) ──────────────────────────────────────────────
  // ⭐ The direction the ARTEFACTS cannot show at all: these two fields are facts
  // about the TREE, and a gate that never reads them prints a success line while
  // the census it just ran says it could not place a site. Driven with SYNTHETIC
  // censuses, so the rule stays instrumented whatever today's tree holds -- and
  // in BOTH directions, because a `censusRefusals` that always returned `[]`
  // would look identical to this self-test on a census that happens to be clean.
  battery('census refusals');
  const unplaceableSite = {
    file: 'packages/services/service-fixture/src/seed.ts',
    line: 42,
    receiver: 'ql',
    verb: 'update',
    how: 'ql:any',
    detail: 'any',
    ledgered: false,
  };
  const orphanedRow = {
    file: 'packages/plugins/plugin-fixture/src/departed.ts',
    receiver: 'engine',
    engine: true,
    what: 'a ledger row whose write call left the tree',
  };
  const refuse = (unledgered, staleLedgerRows) =>
    censusRefusals({ ...census, unledgered, staleLedgerRows, undefendedSubtractions: [] });

  t('a census that could not place a receiver is a finding',
    refuse([unplaceableSite], []).some((p) => p.startsWith('[untyped-receiver]')));
  t('the unplaceable-receiver refusal names the site it could not place',
    refuse([unplaceableSite], []).some((p) => p.includes(`${unplaceableSite.file}:${unplaceableSite.line}`)));
  t('a ledger row matching nothing in the tree is a finding',
    refuse([], [orphanedRow]).some((p) => p.startsWith('[stale-ledger-row]')));
  t('the stale-row refusal names the row it could not match',
    refuse([], [orphanedRow]).some((p) => p.includes(orphanedRow.file) && p.includes(orphanedRow.receiver)));

  // ⭐ The third class (#19077): a receiver whose stored type text the census
  // cannot read back. Localising it is the repair; letting CI go green on it
  // would be the same floor drop in a different costume, so it is refused HERE
  // as well as declared in both artefacts.
  const notRoundTrippable = {
    file: 'packages/services/service-fixture/src/seed.ts',
    line: 71,
    receiver: 'engine',
    verb: 'insert',
    reason: 'type-text-not-round-trippable',
    type: '{ insert(object: string, data: unknown): Promise<void> find(object: string): Promise<void> }',
    names: [],
    doorShaped: false,
  };
  const refuseUndefended = (undefendedSubtractions) =>
    censusRefusals({ ...census, unledgered: [], staleLedgerRows: [], undefendedSubtractions });

  t('⭐ a receiver whose stored type text does not round-trip is a finding, not a silent subtraction',
    refuseUndefended([notRoundTrippable]).some((p) => p.startsWith('[type-text-not-round-trippable]')));
  t('the round-trip refusal names the site AND the text that could not be read back',
    refuseUndefended([notRoundTrippable]).some(
      (p) => p.includes(`${notRoundTrippable.file}:${notRoundTrippable.line}`) && p.includes(notRoundTrippable.type)));
  t('⛔ CONTROL: a subtraction on a DIFFERENT undefended arm is declared but NOT refused',
    refuseUndefended([{ ...notRoundTrippable, reason: 'type-not-in-corpus' }]).length === 0,
    refuseUndefended([{ ...notRoundTrippable, reason: 'type-not-in-corpus' }]).join(' | '));

  // ⛔ ...and the control, without which all four cases above are equally passed
  // by a function that simply reports everything it is handed: a census that
  // placed every site and matched every row is clean.
  t('⭐ CONTROL: a census with neither an unplaceable site nor a stale row is NOT a finding',
    refuse([], []).length === 0,
    refuse([], []).join(' | '));

  // ── refusals ───────────────────────────────────────────────────────────────
  battery('refusals');
  t('an empty census refuses rather than certifying the artefacts',
    checkPage({ ...census, sites: [] }, page, counts, shards).some((p) => p.startsWith('[empty-census]')));

  // The floor runs BEFORE the verdict below, so a success line can only be
  // printed by a run in which every declared battery registered its cases.
  for (const message of batteryFloorFailures()) cases.push({ name: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length > 0) {
    console.error(`✗ check-tenant-audit-census self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }

  // ⭐ The GENERATOR's classifier cases run here, and this is the only place
  // they run. They cannot be a flag on that module: CI invoking it directly
  // makes it a gate file, and `dispatch-gates` then refuses to follow it, which
  // silently cuts the 22 path literals this gate inherits from it. Running them
  // from here keeps the instrument AND the inheritance. ⛔ Never let this
  // swallow the exit code -- a green gate self-test over a red census self-test
  // is exactly the shape both of them exist to refuse.
  const censusExit = censusSelfTest();
  if (censusExit !== 0) {
    console.error('✗ check-tenant-audit-census self-test: the census self-test it drives FAILED (above).');
    return censusExit;
  }
  console.log(
    `✓ check-tenant-audit-census self-test: ${cases.length} cases pass `
    + '(drift on a dropped shard row, on an edited page region, on an edited shard '
    + 'total, on a package with no shard, on a shard for a package with no sites and on a '
    + 'lost region; a live total written back into the prose in three shapes while a dated '
    + 'history figure passes, and an empty census -- plus the split in BOTH directions: a '
    + 'corpus-scale count and a stale measurement date pass, while a shard\'s population '
    + 'figure, a deleted unenforced row, an undated block and a reworded unenforced claim all fail).',
  );
  selfTestReachedVerdict = true;
  return 0;
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-tenant-audit-census self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return selfTestCode;
  }

  let page;
  let counts;
  try {
    page = readFileSync(join(ROOT, PAGE), 'utf8');
  } catch (error) {
    console.error(`::error::[unreadable-page] cannot read ${PAGE} -- ${error.message}`);
    return 1;
  }
  try {
    counts = readFileSync(join(ROOT, COUNTS), 'utf8');
  } catch (error) {
    console.error(`::error::[unreadable-ledger] cannot read ${COUNTS} -- ${error.message}`);
    return 1;
  }

  const census = runCensus();
  const shards = readShardFiles(ROOT);
  // ⭐ Check C first: `checkPage` certifies the artefacts AGAINST this census, so
  // a census that could not place one of its own sites is the prior question.
  const problems = [...censusRefusals(census), ...checkPage(census, page, counts, shards)];
  printTotals(census);
  for (const p of problems) console.error(`::error::${p}`);

  if (problems.length > 0) {
    console.error(`✗ check-tenant-audit-census: ${problems.length} problem(s).`);
    return 1;
  }
  const t = census.totals;
  console.log(
    `✓ check-tenant-audit-census: OK -- ${t.writeCallSites} write call sites certified `
    + `across ${renderShards(census).size} package shard(s) `
    + `(${t.staticallyDecidableObjectName} decidable; ${t.tenancyEnabledProvablyNoContext} tenancy-enabled `
    + `sites PROVABLY carry no tenant context, ${t.tenancyEnabledContextUnreadable} more unreadable), `
    + `no live total in the prose (${LIVE_TOTAL_PROSE_SHAPES.length} retired shapes), `
    + 'every write call site placed and every `UNTYPED_RECEIVERS` row matched.',
  );
  return 0;
}

/**
 * ⭐ The census totals, printed -- because no committed file states them.
 *
 * The page and the ledger index carry no population figure and each shard
 * carries only its own package's, so a total across packages is something only
 * a RUN can say. Printed on every run, red or green, from the census this run
 * took: the same rows each shard carries (`totalsRows`), summed by construction,
 * plus the one line the page tells downstream cards to cite.
 */
function printTotals(census) {
  const t = census.totals;
  const rows = [...totalsRows(t), ...undefendedCountRows(census)];
  const width = Math.max(...rows.map(([label]) => label.length));
  console.log('tenant-audit census totals (printed here, committed nowhere):');
  for (const [label, value] of rows) console.log(`  ${label.padEnd(width)}  ${value}`);
  console.log(
    `  cite: ${t.tenancyEnabledProvablyNoContext} / ${t.writeCallSites} -- the sites whose options argument `
    + 'was READ and holds no tenant context, against a decidably tenancy-enabled object, out of every '
    + `write call site; ${t.tenancyEnabledContextUnreadable} further tenancy-enabled sites have an options `
    + 'argument the census cannot read, and are neither in nor out.',
  );
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
