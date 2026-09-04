#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * measure-self-test-floor -- can each `scripts/**` self-test prove it ran? (#13489)
 *
 *   node scripts/measure-self-test-floor.mjs           # static census (fast)
 *   node scripts/measure-self-test-floor.mjs --probe   # + the dynamic probe (minutes)
 *   node scripts/measure-self-test-floor.mjs --json    # machine-readable
 *
 * ## The two holes, which are ORTHOGONAL
 *
 * A gate can be clean on one and defeated by the other, so they are counted
 * separately and never summed into one "problem gates" total.
 *
 *   1. NO ASSERTION FLOOR. Success decided by `failures.length === 0` alone,
 *      so "every case held" and "the cases never ran" print the same line.
 *   2. NO VERDICT HANDSHAKE. The dispatch discards the self-test's completion
 *      (`return selfTest()`, `selfTest();`, `process.exit(selfTest())`), so a
 *      `return` anywhere above the verdict prints NOTHING and still exits 0.
 *      A gate with a perfect floor is still defeated this way: the floor never
 *      runs either.
 *
 * ⚠️ A verdict line that already prints a case count is EVIDENCE, NOT PROOF. A
 * battery dropping from 40 cases to 3 still prints a non-zero count and passes,
 * and pinning a TOTAL rots the moment a sibling battery grows. Two gates in
 * this tree derive and print a `SELF_TEST_CASE_COUNT` that nothing ever
 * compares; both classify NONE here, correctly.
 *
 * ## Boundary: this is NOT the empty-scan class
 *
 * "A sweep that read zero must refuse" is a different property. `check-adr-links`
 * and `check-doc-anchors` both carry that refusal AND are defeated by hole 2 --
 * measured, in this tree. Neither class covers for the other.
 *
 * ## Why hole 2 is MEASURED and hole 1 is READ
 *
 * The grep the triage ruling supplies (`failures.length === 0`, `return
 * selfTest()`) is an ENTRY POINT, not a criterion: a gate reaches the same
 * effect through `process.exit(selfTest())` (an early bare `return` yields
 * `undefined`, and `process.exit(undefined)` is exit 0), through
 * `selfTest(); main();`, or through a top-level block with no callee at all.
 * So hole 2 is decided by BEHAVIOUR: inject `return;` as the first statement of
 * the function the dispatch calls, run it, and read what it SAYS as well as what
 * it exits. Exit 0 is the defect. Hole 1 has no equally generic mutation --
 * a battery is not a mechanically identifiable unit across 158 differently shaped
 * self-tests -- so it is decided by a published static criterion instead, stated
 * below.
 *
 * ## A non-zero exit is NOT a handshake: DEFEATED / HELD / ACCIDENT
 *
 * A handshake is a gate NOTICING that its self-test left early and SAYING so. An
 * exit code alone cannot tell that apart from an accident: a dispatch spelled
 * `process.exit(runSelfTest() === 0 ? 0 : 1)` turns the early return's `undefined`
 * into `undefined === 0` -> false -> exit 1, having printed ZERO BYTES. Nothing
 * detected anything; the arithmetic of a comparison against a missing return value
 * did it. Scoring that HELD is the same accident-versus-handshake mistake this
 * instrument exists to expose, made by the instrument itself -- and it inflates
 * exactly the completion picture a green `--probe` sweep is quoted for.
 *
 * So the mutated run must also SPEAK, and the verdict is three-valued:
 *
 *   DEFEATED  exit 0            -- the early return went unnoticed.
 *   HELD      exit != 0 AND the mutated run printed a non-blank line.
 *   ACCIDENT  exit != 0 AND it printed nothing -- a non-zero exit with no
 *             refusal behind it. NOT counted among HELD, ever.
 *
 * The `mutatedBytes` / `mutatedHead` fields the row already carried are what this
 * reads; `mutatedSpoke` publishes the reading. Deliberately the verdict does NOT
 * match the refusal WORDING: the repair landed in three spellings and teaching
 * this verdict any of them is the coupling #14968 is filed to remove. Reporting
 * WHICH handshake a file carries is that card's column, not this verdict's job.
 *
 * ## The controls, which run on EVERY invocation
 *
 * This tool's whole subject is "a green that asserted nothing". A survey that
 * silently misses a class of files and reports zero commits exactly that
 * defect. So both instruments are driven against KNOWN-HOLED and KNOWN-SOUND
 * fixtures before any number is printed, and a control failure refuses -- it
 * does not degrade to a smaller number. They are placed here, unconditionally,
 * rather than behind a `--self-test` flag, precisely so they cannot become
 * unrun; that is the `inline` route `check-self-test-wired.mjs` records.
 *
 * The controls have already earned their place once: an earlier revision of
 * `classifyFloor` keyed on the NAME `SELF_TEST_BATTERIES` rather than on a
 * comparison that produces a failure, and called a fixture floored after the
 * roster had been removed. The control caught it; nothing else would have.
 */

import { readFileSync, writeFileSync, rmSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { maskComments } from './js-comment-mask.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** A `--self-test` DISPATCH: argv membership tested, not a literal passed to a child. */
const DISPATCH = /(?:includes|has)\(\s*['"`]--self-test['"`]\s*\)/;

/** Marker injected by the probe. Its presence on disk is the mutation's proof. */
const PROBE_MARKER = 'OS_SELF_TEST_FLOOR_PROBE';

// ---------------------------------------------------------------------------
// Instrument 1 -- the static assertion-floor criterion
// ---------------------------------------------------------------------------

/**
 * A FLOOR must PRODUCE A FAILURE, not merely be named. Keying on a name is the
 * mistake this card is about one level up, and the control below proves it.
 *
 * The criterion is published in two halves so a control can test each on its own:
 *
 *   NAMED    the failure is produced by a spelling that names itself --
 *            `failures.push`, a literal `process.exit(1)`, `throw new Error`,
 *            `exitCode = 1`, `ok(false`.
 *   TERNARY  the EXIT CODE is the verdict: `process.exit(<cond> ? 0 : 1)`, the
 *            same with any non-zero failing arm (`? 0 : N`), and the inverted
 *            `process.exit(<cond> ? 1 : 0)`. A failing arm that is a non-zero
 *            LITERAL produces a failure exactly as `process.exit(1)` does; it is
 *            an ordinary spelling, and reading only the literal form called a
 *            complete, working roster floor NONE (#15339) -- the roster half
 *            matched, the file carried no other recognised spelling, and the
 *            failure half missed.
 *
 * BOUNDARY -- a bare `process.exit(<expr>)` is deliberately NOT a failure
 * producer, however likely the expression is to be non-zero. That is the
 * accident shape this file's header is about: over a self-test that returned
 * early, `process.exit(runSelfTest())` is `process.exit(undefined)` -- exit 0,
 * nothing produced, nothing noticed. Source text cannot tell what an opaque
 * expression yields; a non-zero literal in the failing arm it can.
 */
const PRODUCES_FAILURE_NAMED = /failures\.push|process\.exit\(1\)|throw new Error|exitCode = 1|ok\(false/;
const PRODUCES_FAILURE_TERNARY_EXIT =
  /process\.exit\(\s*[^;]{0,200}?\?\s*(?:0\s*:\s*[1-9]\d*|[1-9]\d*\s*:\s*0)\s*\)/;
const PRODUCES_FAILURE = new RegExp(`${PRODUCES_FAILURE_NAMED.source}|${PRODUCES_FAILURE_TERNARY_EXIT.source}`);
const ROSTER_COMPARISON =
  /(?:declaredBatteries|SELF_TEST_BATTERIES|BATTERY_FLOOR)[^;]{0,400}?(?:\.length|\.size|includes\(|has\(|!==|===|<)/s;
const COUNT_COMPARISON = [
  new RegExp(
    String.raw`\b(?:checked|cases|caseCount|ran|seen|asserted|assertions|count|total|CASES|CHECKED)\w*` +
      String.raw`(?:\.(?:length|size))?\s*(?:<|!==|!=|<=)\s*(?:\d+|[A-Z][A-Z0-9_]{3,})`,
  ),
  new RegExp(
    String.raw`(?:\d+|[A-Z][A-Z0-9_]{3,})\s*(?:>|!==|!=|>=)\s*` +
      String.raw`\b(?:checked|cases|caseCount|ran|seen|asserted|assertions|count|total)\w*(?:\.(?:length|size))?`,
  ),
];

/**
 * ROSTER -- declared battery NAMES compared as a set (the #13487 shape).
 * COUNT  -- a registered count compared against a declared constant.
 * NONE   -- success decided by "no failure was recorded", and nothing else.
 *
 * ⚠️ The criterion reads NAMES (`SELF_TEST_BATTERIES`, `declaredBatteries`, a
 * counter called `checked`/`cases`/...). A floor spelled with names it does not
 * know reads as NONE, so its error runs in ONE direction: it can call a floored
 * self-test unfloored, never the reverse. A NONE is therefore a candidate to
 * read, and the population it reports is an UPPER bound on the hole. On
 * 597020aa5 the tree was also hand-swept for zero-case refusals independently
 * of these names; every hit was a production-scan refusal (the adjacent
 * empty-scan class), not a self-test floor.
 *
 * Deliberately high-recall: COUNT hits are candidates to READ, not verdicts.
 * Both COUNT hits in this tree on 597020aa5 were hand-checked and are false
 * positives (`count < 100` in a production probe; a `total < 0` sign test).
 */
export function classifyFloor(code) {
  if (ROSTER_COMPARISON.test(code) && PRODUCES_FAILURE.test(code)) return 'ROSTER';
  if (COUNT_COMPARISON.some((re) => re.test(code)) && PRODUCES_FAILURE.test(code)) return 'COUNT';
  return 'NONE';
}

// ---------------------------------------------------------------------------
// Instrument 2 -- the dynamic verdict-handshake probe
// ---------------------------------------------------------------------------

/** Every `/self.?test/i`-named function DEFINED in this source. */
export function selfTestDefs(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (/self.?test/i.test(m[1])) names.add(m[1]);
  }
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) {
    if (/self.?test/i.test(m[1])) names.add(m[1]);
  }
  return [...names];
}

/** Insert `return;` as the first statement of `name`. Returns null when absent. */
export function injectEarlyReturn(src, name) {
  const pats = [
    new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*(?::\\s*[A-Za-z_$][\\w$<>\\[\\]|. ]*\\s*)?\\{`),
    new RegExp(`const\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::[^=]*)?=>\\s*\\{`),
  ];
  for (const re of pats) {
    const m = src.match(re);
    if (!m) continue;
    const at = m.index + m[0].length;
    return `${src.slice(0, at)}\n  return; /*${PROBE_MARKER}*/\n${src.slice(at)}`;
  }
  return null;
}

/**
 * Run one gate's `--self-test` with an early `return` at the top of `entry`.
 *
 * The copy is written BESIDE the original so relative imports and repo-root
 * resolution still answer the same, and the marker is re-read FROM DISK before
 * the run: an editor step that matched nothing exits 0 just as happily as one
 * that landed, and an unmutated file would report "held" for no reason at all.
 */
export function probeEarlyReturn(absFile, entry, { timeout = 120000 } = {}) {
  const src = readFileSync(absFile, 'utf8');
  const mutated = injectEarlyReturn(src, entry);
  if (mutated === null) return { verdict: 'NOT MEASURED', why: `no injectable definition of ${entry}` };
  if (src.includes(PROBE_MARKER)) return { verdict: 'NOT MEASURED', why: 'marker already present in source' };

  const probePath = join(dirname(absFile), `.self-test-floor-probe-${basename(absFile)}`);
  const isTs = /\.(mts|ts)$/.test(absFile);
  const cmd = isTs ? join(ROOT, 'node_modules/.bin/tsx') : process.execPath;
  try {
    writeFileSync(probePath, mutated);
    const onDisk = (readFileSync(probePath, 'utf8').match(new RegExp(PROBE_MARKER, 'g')) ?? []).length;
    if (onDisk !== 1) return { verdict: 'NOT MEASURED', why: `mutation not on disk (marker x${onDisk})` };

    const base = spawnSync(cmd, [absFile, '--self-test'], { cwd: ROOT, timeout, encoding: 'utf8' });
    const mut = spawnSync(cmd, [probePath, '--self-test'], { cwd: ROOT, timeout, encoding: 'utf8' });
    const baseOut = (base.stdout ?? '') + (base.stderr ?? '');
    const mutOut = (mut.stdout ?? '') + (mut.stderr ?? '');
    if (mut.signal || base.signal) return { verdict: 'NOT MEASURED', why: `killed by ${mut.signal ?? base.signal}` };
    // A mutation that changed nothing observable did not reach the executed
    // path, whatever its exit code says.
    if (baseOut === mutOut && base.status === mut.status) {
      return { verdict: 'NOT MEASURED', why: 'mutation had no observable effect' };
    }
    // Did the mutated run SAY anything? Read as "printed a non-blank line", the
    // same reading `mutatedHead` already publishes and quotes -- a run whose whole
    // output is a newline has non-zero bytes and still refused nothing.
    const mutatedHead = mutOut.split('\n').find((l) => l.trim()) ?? '';
    const mutatedSpoke = mutatedHead !== '';
    return {
      // Exit code alone cannot tell a refusal from an accident -- see the header.
      verdict: mut.status === 0 ? 'DEFEATED' : mutatedSpoke ? 'HELD' : 'ACCIDENT',
      entry,
      baselineExit: base.status,
      mutatedExit: mut.status,
      mutatedBytes: mutOut.length,
      mutatedHead,
      mutatedSpoke,
    };
  } finally {
    rmSync(probePath, { force: true });
  }
}

// ---------------------------------------------------------------------------
// The controls -- run on EVERY invocation, before any number is printed
// ---------------------------------------------------------------------------

const HOLED_GATE = [
  '#!/usr/bin/env node',
  'function selfTest() {',
  '  const failures = [];',
  "  if (1 !== 1) failures.push('x');",
  "  if (failures.length) { console.error('nope'); process.exit(1); }",
  "  console.log('fixture self-test: 1 case passes');",
  '}',
  "if (process.argv.includes('--self-test')) selfTest();",
  '',
].join('\n');

const SOUND_GATE = [
  '#!/usr/bin/env node',
  "const VERDICT = 'reached';",
  "const SELF_TEST_BATTERIES = Object.freeze({ only: 1 });",
  'const SELF_TEST_BATTERY_FLOOR = 1;',
  'function selfTest() {',
  '  const failures = [];',
  '  const seen = new Map();',
  "  let open = null;",
  '  const battery = (n) => { open = n; };',
  "  const ok = (c, l) => { seen.set(open, (seen.get(open) ?? 0) + 1); if (!c) failures.push(l); };",
  "  battery('only');",
  "  ok(1 === 1, 'x');",
  '  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);',
  "  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) failures.push('registry shrank');",
  "  for (const n of declaredBatteries) if ((seen.get(n) ?? 0) < SELF_TEST_BATTERIES[n]) failures.push('battery ' + n + ' did not run');",
  '  if (failures.length) { console.error(failures.join(String.fromCharCode(10))); process.exit(1); }',
  "  console.log('fixture self-test: floor held');",
  '  return VERDICT;',
  '}',
  "if (process.argv.includes('--self-test')) {",
  '  if (selfTest() !== VERDICT) {',
  "    console.error('fixture: selfTest returned without reaching its verdict');",
  '    process.exit(1);',
  '  }',
  '}',
  '',
].join('\n');

/**
 * The measured ACCIDENT shape, reduced: a dispatch that compares the self-test's
 * return value against a number. An early return makes that comparison false and
 * the process exits 1 having printed NOTHING -- a non-zero exit with no refusal
 * behind it. This is the shape `scripts/audits/14744-before-update-per-row-value-
 * census.mjs` carries and that an exit-code-only verdict scored HELD (#15324).
 */
const ACCIDENT_GATE = [
  '#!/usr/bin/env node',
  'function runSelfTest() {',
  '  const failures = [];',
  "  if (1 !== 1) failures.push('x');",
  "  console.log('fixture self-test: 1 case passes');",
  '  return failures.length;',
  '}',
  "if (process.argv.includes('--self-test')) {",
  '  process.exit(runSelfTest() === 0 ? 0 : 1);',
  '}',
  '',
].join('\n');

/**
 * The ternary exit, reduced: a roster floor whose ONLY failure production is
 * `process.exit(<cond> ? 0 : 1)`. It carries none of the NAMED spellings -- no
 * `failures.push`, no literal `process.exit(1)`, no `throw`, no `exitCode = 1`,
 * no `ok(false` -- and a control asserts that, so reading it ROSTER can only be
 * the ternary being recognised and never some other half of the criterion
 * sneaking in. This is the shape `scripts/check-regen-pending.mjs` carried while
 * its floor was sound, its ablations all fired, and this instrument still said
 * NONE (#15339).
 *
 * The classifier is a pure function of source text, so unlike the three fixtures
 * above this one is never spawned -- it is read, not run.
 */
const TERNARY_EXIT_GATE = [
  '#!/usr/bin/env node',
  'const SELF_TEST_BATTERIES = Object.freeze({ only: 1 });',
  'function runSelfTest() {',
  '  const seen = new Map();',
  '  const battery = (n) => seen.set(n, (seen.get(n) ?? 0) + 1);',
  "  battery('only');",
  '  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);',
  '  let held = declaredBatteries.length >= 1;',
  '  for (const n of declaredBatteries) if ((seen.get(n) ?? 0) < SELF_TEST_BATTERIES[n]) held = false;',
  "  console.log('fixture self-test: floor ' + (held ? 'held' : 'shrank'));",
  '  return held;',
  '}',
  "if (process.argv.includes('--self-test')) {",
  '  process.exit(runSelfTest() ? 0 : 1);',
  '}',
  '',
].join('\n');

/** The one dispatch line of `TERNARY_EXIT_GATE`, the anchor the variants replace. */
const TERNARY_EXIT_DISPATCH = 'runSelfTest() ? 0 : 1';

/**
 * Both instruments, against both directions. Returns the failures; the caller
 * refuses on any. Nothing here reads the repo, so a control failure is always
 * the instrument and never the tree.
 */
export function runControls() {
  const failures = [];
  const say = (cond, label) => { if (!cond) failures.push(label); };

  // Instrument 1, both directions.
  say(classifyFloor(maskComments(HOLED_GATE)) === 'NONE',
    'POSITIVE CONTROL FAILED: a self-test deciding success by failures.length alone was not classified NONE');
  say(classifyFloor(maskComments(SOUND_GATE)) === 'ROSTER',
    'NEGATIVE CONTROL FAILED: a roster-floored self-test was not classified ROSTER');

  // The ternary exit, both directions. The failing arm being a NON-ZERO LITERAL
  // is what produces the failure; the roster half still has to match on its own,
  // and an opaque expression still has to produce nothing.
  const ternaryExit = (dispatchArgs) =>
    maskComments(TERNARY_EXIT_GATE.replace(TERNARY_EXIT_DISPATCH, dispatchArgs));
  say(!PRODUCES_FAILURE_NAMED.test(maskComments(TERNARY_EXIT_GATE)),
    'CONTROL FIXTURE INVALID: the ternary fixture picked up one of the NAMED failure spellings; every verdict below it would then be passing for the wrong reason');
  say(classifyFloor(maskComments(TERNARY_EXIT_GATE)) === 'ROSTER',
    'NEGATIVE CONTROL FAILED: a roster floor whose only failure production is `process.exit(<cond> ? 0 : 1)` was not classified ROSTER');
  say(classifyFloor(ternaryExit('runSelfTest() ? 0 : 2')) === 'ROSTER',
    'NEGATIVE CONTROL FAILED: a ternary exit whose failing arm is a non-zero literal other than 1 was not classified ROSTER');
  say(classifyFloor(ternaryExit('!runSelfTest() ? 1 : 0')) === 'ROSTER',
    'NEGATIVE CONTROL FAILED: the inverted ternary exit (`? 1 : 0`, the failing arm first) was not classified ROSTER');
  say(classifyFloor(ternaryExit('runSelfTest()')) === 'NONE',
    'POSITIVE CONTROL FAILED: a bare `process.exit(<expr>)` was read as producing a failure -- an opaque expression is the accident shape (it is `process.exit(undefined)` after an early return), not a floor');
  say(classifyFloor(maskComments(TERNARY_EXIT_GATE
    .replaceAll('SELF_TEST_BATTERIES', 'FIXTURE_BATTERIES_BY_NAME')
    .replaceAll('declaredBatteries', 'declaredNames'))) === 'NONE',
    'POSITIVE CONTROL FAILED: the ternary exit alone was classified ROSTER -- producing a failure is HALF the criterion; a roster this criterion can NAME is the other half');
  // Reuse rather than invention: the shape now recognised is the one the ACCIDENT
  // fixture above actually dispatches with (and the audit file it is reduced
  // from), so the criterion stays pinned to a spelling measured in this tree.
  say(PRODUCES_FAILURE_TERNARY_EXIT.test(ACCIDENT_GATE.split('\n').find((l) => l.includes('process.exit(')) ?? ''),
    'CONTROL FAILED: the accident fixture no longer dispatches with the ternary exit this criterion was extended to read; the two have drifted apart');

  // Instrument 2, both directions, against real processes on disk.
  const dir = mkdtempSync(join(tmpdir(), 'self-test-floor-control-'));
  try {
    const holed = join(dir, 'holed-gate.mjs');
    const sound = join(dir, 'sound-gate.mjs');
    const accident = join(dir, 'accident-gate.mjs');
    writeFileSync(holed, HOLED_GATE);
    writeFileSync(sound, SOUND_GATE);
    writeFileSync(accident, ACCIDENT_GATE);
    const h = probeEarlyReturn(holed, 'selfTest');
    const s = probeEarlyReturn(sound, 'selfTest');
    const a = probeEarlyReturn(accident, 'runSelfTest');
    say(h.verdict === 'DEFEATED',
      `POSITIVE CONTROL FAILED: the probe read a known-holed gate as ${h.verdict} (${h.why ?? ''})`);
    say(h.mutatedBytes === 0,
      'POSITIVE CONTROL FAILED: the known-holed gate printed something; the measured shape prints NOTHING');
    say(s.verdict === 'HELD',
      `NEGATIVE CONTROL FAILED: the probe read a handshake-protected gate as ${s.verdict} (${s.why ?? ''})`);
    // The discriminator, in both directions. A gate that HOLDS must be one that
    // SPOKE; a non-zero exit that printed nothing is an ACCIDENT and must never
    // be counted among the holds (#15324).
    say(s.mutatedSpoke === true && s.mutatedBytes > 0,
      'NEGATIVE CONTROL FAILED: the handshake-protected gate printed nothing when defeated; HELD is supposed to mean it REFUSED out loud');
    say(a.verdict === 'ACCIDENT',
      `POSITIVE CONTROL FAILED: the probe read a silent non-zero exit as ${a.verdict} (${a.why ?? ''}) -- an exit code is not a handshake`);
    say(a.mutatedExit !== 0 && a.mutatedBytes === 0 && a.mutatedSpoke === false,
      `POSITIVE CONTROL FAILED: the accident fixture no longer produces the measured shape (exit ${a.mutatedExit}, ${a.mutatedBytes} byte(s)); the ACCIDENT verdict above would then be passing for the wrong reason`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failures;
}

// ---------------------------------------------------------------------------
// The census
// ---------------------------------------------------------------------------

/**
 * ⛔ SHRINK-ONLY. The nine files whose entry cannot be resolved mechanically,
 * resolved by READING the dispatch site (the ruling's A2.1: the grep is an
 * entry point, not the criterion). A `null` entry is NOT MEASURED with the
 * stated reason -- never a quiet pass, and never a guess.
 *
 * A row whose file no longer holds more than one `/self.?test/i` definition is
 * dead and should be deleted; the mechanical path then covers it.
 */
export const ENTRY_BY_HAND = Object.freeze({
  'scripts/check-comment-mask-corpus.mjs': 'selfTest',
  'scripts/check-doc-authoring.mjs': 'selfTest',
  'scripts/check-durability-degradation-log-level.mjs': 'selfTest',
  'scripts/check-self-test-wired.mjs': 'selfTest',
  'scripts/check-self-test-workflow-commands.mjs': 'selfTest',
  'scripts/check-turbo-task-graph.mjs': 'runSelfTest',
  // Two self-test-shaped functions: `selfTest()` returns a failure list and
  // `runSelfTest()` is what the dispatch calls. Probing the inner one records a
  // TypeError as a handshake; probing `runSelfTest` reads the real one (#14842).
  'scripts/check-workspace-manifest-cycles.mjs': 'runSelfTest',
  // The dispatch calls FOUR self-test functions and combines their statuses;
  // there is no single entry an early return leaves, so a one-function probe
  // measures a sub-battery and reads a downstream crash as a handshake.
  'scripts/check-platform-checklist.mjs': null,
  // The self-test is an inline top-level block calling several helpers.
  'scripts/check-regen-pending.mjs': null,
  // Injecting into this file produces a SyntaxError (the anchor lands inside a
  // template literal), so no run of it measures anything.
  'scripts/pm/dispatch-gates.mjs': null,
});

/**
 * This file is not itself a member: the `--self-test` literals below live in
 * CONTROL FIXTURE strings, which are data, not a dispatch. It deliberately
 * ships no `--self-test` mode -- its controls run inline on every invocation,
 * so they cannot become unrun.
 */
const CENSUS_SELF = 'scripts/measure-self-test-floor.mjs';

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(mjs|mts|js|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every `scripts/**` file that DISPATCHES on `--self-test`, read from CODE. */
export function population() {
  const scripts = join(ROOT, 'scripts');
  if (!existsSync(scripts)) throw new Error('scripts/ does not resolve -- the census would report zero for the wrong reason');
  const rows = [];
  for (const abs of walk(scripts).sort()) {
    const src = readFileSync(abs, 'utf8');
    const code = maskComments(src);
    if (!DISPATCH.test(code)) continue;
    const file = abs.slice(ROOT.length + 1).split(sep).join('/');
    if (file === CENSUS_SELF) continue;
    rows.push({ file, abs, floor: classifyFloor(code), defs: selfTestDefs(src) });
  }
  if (rows.length === 0) throw new Error('the census found no self-test dispatch at all -- refusing rather than reporting zero');
  return rows;
}

function main() {
  const controlFailures = runControls();
  if (controlFailures.length > 0) {
    console.error('measure-self-test-floor: ITS OWN CONTROLS FAILED -- no census printed.\n');
    for (const f of controlFailures) console.error(`  - ${f}`);
    console.error('\nA survey whose instrument cannot see a known hole reports zero for the same reason');
    console.error('this measurement exists. Fix the instrument; a smaller number is not the fallback.\n');
    process.exit(1);
  }

  const rows = population();
  const wantProbe = process.argv.includes('--probe');
  if (wantProbe) {
    for (const r of rows) {
      const named = Object.hasOwn(ENTRY_BY_HAND, r.file) ? ENTRY_BY_HAND[r.file] : undefined;
      if (named === null) { r.probe = { verdict: 'NOT MEASURED', why: 'entry read by hand as not probeable -- see ENTRY_BY_HAND' }; continue; }
      const entry = named ?? (r.defs.length === 1 ? r.defs[0] : undefined);
      if (entry === undefined) {
        r.probe = { verdict: 'NOT MEASURED', why: r.defs.length === 0
          ? 'self-test is an inline top-level block; no callee to leave early'
          : `ambiguous entry (${r.defs.join(', ')}) and no ENTRY_BY_HAND row -- read the dispatch site` };
        continue;
      }
      r.probe = probeEarlyReturn(r.abs, entry);
    }
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows.map(({ abs, ...rest }) => rest), null, 2));
    return;
  }

  const byFloor = { ROSTER: [], COUNT: [], NONE: [] };
  for (const r of rows) byFloor[r.floor].push(r.file);
  console.log(`measure-self-test-floor: ${rows.length} file(s) under scripts/ dispatch on \`--self-test\`.\n`);
  console.log('Hole 1 -- no assertion floor (success decided by "no failure was recorded"):');
  console.log(`  ${byFloor.NONE.length} of ${rows.length}. Floored: ${byFloor.ROSTER.length} roster, ${byFloor.COUNT.length} count-candidate(s) to read.`);
  if (byFloor.ROSTER.length) console.log(`    roster: ${byFloor.ROSTER.join(', ')}`);
  if (byFloor.COUNT.length) console.log(`    count candidates: ${byFloor.COUNT.join(', ')}`);

  if (!wantProbe) {
    console.log('\nHole 2 -- no verdict handshake: NOT MEASURED (pass --probe; it runs every self-test twice).');
    return;
  }
  const defeated = rows.filter((r) => r.probe.verdict === 'DEFEATED');
  const held = rows.filter((r) => r.probe.verdict === 'HELD');
  const accidents = rows.filter((r) => r.probe.verdict === 'ACCIDENT');
  const unmeasured = rows.filter((r) => r.probe.verdict === 'NOT MEASURED');
  console.log('\nHole 2 -- silently defeated by an early `return` in the self-test (MEASURED):');
  console.log(`  ${defeated.length} DEFEATED, ${held.length} HELD, ${accidents.length} ACCIDENT, ${unmeasured.length} NOT MEASURED.`);
  console.log(`  of the defeated, ${defeated.filter((r) => r.probe.mutatedBytes === 0).length} printed NOTHING at all and still exited 0.`);
  for (const r of held) console.log(`    HELD  ${r.file} -- ${r.probe.mutatedHead.slice(0, 96)}`);
  for (const r of accidents) console.log(`    ACC   ${r.file} -- exited ${r.probe.mutatedExit} printing ${r.probe.mutatedBytes} byte(s); no refusal, so NOT a hold`);
  for (const r of unmeasured) console.log(`    n/m   ${r.file} -- ${r.probe.why}`);
  if (accidents.length) {
    console.log(`\n⚠ ACCIDENT is not a hold. Those ${accidents.length} file(s) exit non-zero because a comparison`);
    console.log('   against a missing return value happened to be false, not because anything noticed.');
  }
  console.log('\n⛔ The two numbers are ORTHOGONAL and are never summed: a gate with a perfect');
  console.log('   floor is still defeated by hole 2, because the floor never runs either.');
}

if (isEntrypoint(import.meta.url)) {
  main();
}
