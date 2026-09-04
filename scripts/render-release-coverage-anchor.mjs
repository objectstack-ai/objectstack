#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// render-release-coverage-anchor — composes the anchor-issue body for
// `.github/workflows/release-coverage-patrol.yml` (#10803).
//
//   node scripts/render-release-coverage-anchor.mjs             # reads the env
//   node scripts/render-release-coverage-anchor.mjs --self-test
//
// ## Why this is a script and not eight lines of inline `github-script`
//
// It is the entire product of the patrol run: the one artifact a reader sees.
// Inline JS inside a YAML `script:` block is reachable by no test, so every
// property below — that a broken instrument can never render as a clean corpus,
// that the heartbeat is always present, that the gate's authored prose is
// wrapped rather than re-worded — would be pinned by nothing at all. This repo's
// answer to "a mechanism nobody runs" is the whole reason #10803 exists; a
// renderer nobody can test is the same defect one layer down.
//
// ## The composition split
//
// The gate `check-release-section-coverage.mjs` OWNS its finding prose — it is
// authored, it cites its own measurements, and its `--self-test` pins it. This
// renderer WRAPS that text verbatim inside a fenced block and never re-words it.
// Saying "my callee could not run" is the caller's job and is composed here;
// saying what is wrong with the release pages is the callee's, and is not.
//
// ## The one asymmetry that matters
//
// A sweep that could not run must never render as a clean corpus (#4690). The
// instrument verdict is therefore read FIRST and short-circuits every other
// branch, and the did-not-run body says in its own words that it contains no
// reading at all — not a clean one and not a dirty one.
import { readFileSync } from 'node:fs';
import { isEntrypoint } from './invoked-as.mjs';

const MARKER = 'os-release-coverage-sweep';

const PREAMBLE = [
  `${MARKER} — machine-findable marker for this generated view.`,
  '',
  '**Generated view — not a second tracker.** This body is rewritten IN PLACE by the scheduled '
  + 'patrol workflow (`.github/workflows/release-coverage-patrol.yml`) on every run, and the edit '
  + 'history is the archive. **Report-only**: every finding is patrol input, never a gate verdict. '
  + 'This sweep never writes release prose — it cannot, and the gate\'s own header explains why (a '
  + 'curated section is a judgement about what is user-facing, read out of the per-package '
  + 'changelogs).',
].join('\n');

const HEARTBEAT_NOTE =
  'The `Swept` line above is this patrol\'s heartbeat: a timestamp that stops advancing means the '
  + 'standing caller died, which is the failure this anchor exists to make visible. Read it before '
  + 'you read the findings.';

/**
 * The advisory run's exit code is the INSTRUMENT verdict; the `--strict` run's
 * is the findings predicate, and is only meaningful once the instrument is
 * known healthy. Encoding that ordering in one place keeps the workflow's two
 * runs from being read as interchangeable.
 *
 * @param {{ advisoryCode: number, strictCode: number }} codes
 * @returns {'did-not-run' | 'findings' | 'clean'}
 */
export function verdict({ advisoryCode, strictCode }) {
  if (advisoryCode !== 0) return 'did-not-run';
  return strictCode === 0 ? 'clean' : 'findings';
}

/**
 * @param {object} input
 * @param {number} input.advisoryCode
 * @param {number} input.strictCode
 * @param {string} input.report   stdout of the advisory run (the authored prose)
 * @param {string} input.errText  stderr of the advisory run
 * @param {string} input.provenance
 * @param {string} input.sweptAt  ISO timestamp
 * @returns {string}
 */
export function renderBody({ advisoryCode, strictCode, report, errText, provenance, sweptAt }) {
  const state = verdict({ advisoryCode, strictCode });
  const stamp = `_Swept ${sweptAt} · ${provenance}_`;

  if (state === 'did-not-run') {
    const classified = (errText || report || '(no output captured)').trim();
    return [
      PREAMBLE,
      '',
      `# ⛔ THE SWEEP DID NOT RUN (exit ${advisoryCode})`,
      '',
      stamp,
      '',
      'Nothing below is a finding. **No release page was judged**, so this body says nothing about '
      + 'whether a published minor is missing its section — it is not a clean corpus and it is not '
      + 'a dirty one, it is no reading at all. A sweep that could not run must never read as a '
      + 'clean corpus.',
      '',
      'The standing patrol is DOWN until this is fixed; the previous run\'s findings are in this '
      + 'issue\'s edit history. The gate\'s own classified output:',
      '',
      '```',
      classified,
      '```',
      '',
      HEARTBEAT_NOTE,
    ].join('\n');
  }

  if (state === 'clean') {
    return [
      PREAMBLE,
      '',
      '# ✅ Every published minor has its section',
      '',
      stamp,
      '',
      'No findings. Every in-scope GA minor has a heading on its major\'s release page, and every '
      + 'index entry names the newest release of its major.',
      '',
      '```',
      report.trim(),
      '```',
      '',
      HEARTBEAT_NOTE,
    ].join('\n');
  }

  return [
    PREAMBLE,
    '',
    '# ⚠️ A published minor is missing its release-page section',
    '',
    stamp,
    '',
    'The gate\'s findings, verbatim — its prose is authored and cites its own measurements, so this '
    + 'view wraps it rather than re-wording it:',
    '',
    '```',
    report.trim(),
    '```',
    '',
    '**Remedy.** Fold the missing minor into its major\'s release page under the running section '
    + 'both current pages use, and name the newest release in `content/docs/releases/index.mdx`. '
    + 'This is a curated write, not a generated one: `docs/releases-maintenance.md` section 3 is '
    + 'the process, and the section itself is a judgement about what is user-facing, read out of '
    + 'the per-package changelogs.',
    '',
    'This is advisory on every pull request by design and stays that way: the two historical gaps '
    + 'ran 5h44m (17.1.0) and 25 days (16.1.0), and hard-failing them would have red 2748 PRs for a '
    + 'debt none of them created. This anchor is the durable, correctly-addressed half — the PR '
    + 'annotation is anchored to `.github` on a green check and is read by whoever opened the next '
    + 'PR, who neither created the debt nor owns the remedy.',
    '',
    HEARTBEAT_NOTE,
  ].join('\n');
}

// ── Self-test ────────────────────────────────────────────────────────────────

let failures = 0;
let assertions = 0;
function expect(what, ok) {
  assertions += 1;
  if (ok) { console.log(`  ok  ${what}`); return; }
  failures += 1;
  console.error(`  FAIL  ${what}`);
}

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed
// the way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. The floor requires the OPENED set to
// equal the DECLARED set with each battery at or above its own count.
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
  'render-release-coverage-anchor self-test': 10,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

let selfTestReachedVerdict = false;

function selfTest() {
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
  battery('render-release-coverage-anchor self-test');
  // A thin in-body wrapper over the module-level `expect`: it attributes the case
  // to the open battery and then defers to the existing assertion, whose
  // semantics (the `assertions` tally, the ok/FAIL line, the `failures` tally)
  // are unchanged.
  const check = (what, ok) => {
    registerCase();
    expect(what, ok);
  };
  const base = {
    report: 'check-release-section-coverage: 2 finding(s)',
    errText: '',
    provenance: 'run [1](http://x/1)',
    sweptAt: '2026-08-24T00:00:00.000Z',
  };

  check(
    'verdict — a non-zero ADVISORY code is did-not-run whatever --strict said, because a broken '
    + 'instrument makes the predicate meaningless',
    verdict({ advisoryCode: 1, strictCode: 0 }) === 'did-not-run'
    && verdict({ advisoryCode: 1, strictCode: 1 }) === 'did-not-run',
  );
  check(
    'verdict — instrument healthy + strict 0 is clean; instrument healthy + strict non-zero is '
    + 'findings',
    verdict({ advisoryCode: 0, strictCode: 0 }) === 'clean'
    && verdict({ advisoryCode: 0, strictCode: 1 }) === 'findings',
  );

  const down = renderBody({ ...base, advisoryCode: 1, strictCode: 0, errText: 'BROKEN INSTRUMENT' });
  check(
    'did-not-run — never renders as a clean corpus (#4690): it carries the DID NOT RUN heading and '
    + 'none of the clean body\'s claim',
    down.includes('THE SWEEP DID NOT RUN') && !down.includes('Every published minor has its section'),
  );
  check(
    'did-not-run — wraps the gate\'s classified stderr rather than re-wording it',
    down.includes('BROKEN INSTRUMENT'),
  );

  const clean = renderBody({ ...base, advisoryCode: 0, strictCode: 0, report: 'OK — 5 published minor(s)' });
  check(
    'clean — states the no-findings verdict and carries the gate\'s own OK line',
    clean.includes('Every published minor has its section') && clean.includes('OK — 5 published minor(s)'),
  );

  const found = renderBody({ ...base, advisoryCode: 0, strictCode: 1 });
  check(
    'findings — names the remedy as a curated write and points at the maintenance process',
    found.includes('docs/releases-maintenance.md') && found.includes('curated write'),
  );
  check(
    'findings — wraps the gate\'s authored prose verbatim',
    found.includes('check-release-section-coverage: 2 finding(s)'),
  );

  for (const [name, body] of [['did-not-run', down], ['clean', clean], ['findings', found]]) {
    check(
      `${name} — carries the machine-findable marker and the heartbeat, so no branch can lose `
      + 'either',
      body.startsWith(MARKER) && body.includes('Swept 2026-08-24T00:00:00.000Z') && body.includes(HEARTBEAT_NOTE),
    );
  }

  // Counted, never a literal: a hard-coded total silently stops matching the
  // moment a case is added, and a self-test that misreports its own size is the
  // first thing a reader stops trusting.
  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  // The floor's refusal joins the SAME sink the cases use — a `FAIL` line and the
  // `failures` tally the verdict reads — so a breached floor cannot be printed
  // over by the success line.
  const floorFailure = (message) => {
    failures += 1;
    console.error(`  FAIL  ${message}`);
  };
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

  console.log(failures === 0
    ? `\nOK  render-release-coverage-anchor --self-test: ${assertions} assertions pass`
    : `\nFAILED  ${failures} failure(s) (cases and floor) of ${assertions} assertion(s)`);
  selfTestReachedVerdict = true;
  return failures === 0 ? 0 : 1;
}

function main(argv) {
  if (argv.includes('--self-test')) {
      const selfTestCode = selfTest();
      if (!selfTestReachedVerdict) {
          console.error(
              '\n✗ render-release-coverage-anchor self-test: selfTest() returned without reaching its verdict,\n'
                  + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                  + 'that never finished as a self-test that passed.\n',
          );
          process.exit(1);
      }
      return selfTestCode;
  }

  const tmp = process.env.RUNNER_TEMP || '.';
  const read = (name) => {
    try { return readFileSync(`${tmp}/${name}`, 'utf8'); } catch { return ''; }
  };
  process.stdout.write(renderBody({
    advisoryCode: Number(process.env.ADVISORY_CODE ?? '1'),
    strictCode: Number(process.env.STRICT_CODE ?? '0'),
    report: read('report.txt'),
    errText: read('report.err'),
    provenance: process.env.PROVENANCE || '(no provenance)',
    sweptAt: new Date().toISOString(),
  }));
  process.stdout.write('\n');
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
