#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-runner-env-posture -- product source may not read a test-RUNNER
 * environment variable.
 *
 *   node scripts/check-runner-env-posture.mjs              # scan the tree
 *   node scripts/check-runner-env-posture.mjs --self-test  # verify the checker
 *
 * ## The defect this exists for, measured
 *
 * `packages/services/service-settings/src/local-crypto-provider.ts` selected
 * its crypto posture like this:
 *
 *   if (env.VITEST || env.NODE_ENV === 'test') return 'test';
 *
 * `'test'` there is not a softer flavour of `'production'`. It is the branch
 * that takes an ephemeral key, never touches disk, and **never refuses to
 * boot** -- and the refusal is the whole point of that class. So one runner
 * variable decided whether a security gate ran.
 *
 * Runner variables are INHERITED. Vitest sets `TEST`, `VITEST`, `VITEST_MODE`,
 * `VITEST_WORKER_ID` and `VITEST_POOL_ID` on its worker, and every process that
 * worker spawns with `{ ...process.env }` receives them. A real `os serve`
 * spawned that way therefore booted with production auth and TEST crypto:
 * `packages/cli/test/serve-node-env-production-default.e2e.test.ts`, a pin
 * whose entire subject is *"unset `NODE_ENV` means production"*, ran that way
 * for its whole life. Nothing said a word -- a gate that does not run prints
 * nothing -- and it was found only incidentally, while closing the sibling
 * `TEST` leak into better-auth's origin check one layer down.
 *
 * Two variables, two subsystems, one week, same shape. That is a CLASS, and a
 * class is what a gate is for.
 *
 * ## What is banned, and what deliberately is not
 *
 * Banned: the identifiers that say *a test runner is present* -- `TEST`
 * exactly, `VITEST` and anything `VITEST_`-prefixed, and `JEST_WORKER_ID`. They
 * describe the RUNNER.
 *
 * Not banned: `NODE_ENV`, including `NODE_ENV === 'test'`. That describes the
 * DEPLOYMENT, it is this repo's one established environment source (Prime
 * Directive #9 lists it as a third-party exception, and `seed-loader.ts` and
 * `discovery.zod.ts` both fold it), and it is what a deployment sets on
 * purpose. The distinction is the entire rule: a deployment may declare itself
 * a test deployment; a runner may not declare it on the deployment's behalf.
 *
 * This is also why the fix for the defect above was to DELETE the `VITEST`
 * read rather than to narrow it. In-process unit tests still get test posture,
 * because vitest sets both variables on the same worker
 * (`prepareVitest()`: `process.env.VITEST = "true"; process.env.NODE_ENV ??=
 * "test";`). In-process the two spellings are indistinguishable; they differ
 * only for an inheriting child, which is the defect.
 *
 * ## Population: every `src` tree, and nothing outside one
 *
 * Product source lives under `src/`. A test that reads `VITEST` is doing its
 * job -- `packages/cli/test/helpers/serve-process.ts` names the whole family in
 * order to STRIP it, and `examples/app-showcase/test/` does the same. Scanning
 * them would force an allowlist, and an allowlist is a hole the next real
 * defect falls through quietly. So the population is the tree where the rule
 * has no exceptions, and files that are tests by name are dropped even there.
 *
 * ## Comments and literals are masked
 *
 * Through `scripts/js-comment-mask.mjs`, for the reason `check-parse-guard.mjs`
 * gives for the same choice: the file this gate was written for now carries a
 * long comment QUOTING the banned line, and a gate that cannot tell prose from
 * code would either flag that documentation or force it to be deleted -- and
 * deleting the explanation is how the next author re-introduces the defect.
 */

// dispatch-gates: wide-population -- SCANNED_ROOTS is packages, apps and examples, walked for non-test source beneath a src SEGMENT -- 1812 of 5241 (35%) under packages, 150 of 241 (62%) under examples, and MEASURED AT ZERO (0 of 35) under apps, which has no src tree today. Recorded REFUSE-UNSPELLABLE in scripts/pm/bare-root-worklist.mjs on all three: the narrowest live subtree spelling covers 4291 files to reach 1812 (42%), and 2466 of the files it over-names are the test files this gate deliberately skips -- the one filter no glob idiom can spell.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments, maskCommentsAndLiterals } from './js-comment-mask.mjs';
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
  'Detection: the spellings an author actually reaches for.': 13,
  'The line number points at the real line, offsets preserved by the mask.': 1,
  'NOT flagged: the deployment signal, which is the whole point.': 2,
  'NOT flagged: prose and payloads. A gate that cannot tell them apart': 4,
  'Longer identifiers must not be split by the word boundaries.': 3,
  'Population.': 7,
  'Wiring. Unwiring the gate must redden HERE rather than go quiet.': 3,
  'The corpus itself, as a case rather than as the run\'s only evidence.': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 8;

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

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(HERE, '..');

/** Trees that can hold product source. */
export const SCANNED_ROOTS = ['packages', 'apps', 'examples'];

/** Directory names never descended into. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', '.next', 'coverage', '.git']);

const SOURCE_EXT = /\.(m?[jt]sx?|cts)$/;

/** A file that is a test by name or by the directory it sits in. */
export function isTestFile(relPath) {
  const p = relPath.split(sep).join('/');
  if (/\.(test|spec|e2e|pin|bench)\.[^/]+$/.test(p)) return true;
  if (/\.(e2e|pin)\.(test|spec)\.[^/]+$/.test(p)) return true;
  return /(^|\/)(__tests__|__mocks__|__fixtures__|fixtures|test|tests)\//.test(p);
}

/** Product source: under a `src/` segment, not a test, not generated. */
export function isProductSource(relPath) {
  const p = relPath.split(sep).join('/');
  if (!SOURCE_EXT.test(p)) return false;
  if (!/(^|\/)src\//.test(p)) return false;
  if (p.endsWith('.d.ts')) return false;
  return !isTestFile(p);
}

/**
 * The runner-variable class. `TEST` is spelled exactly; `VITEST` covers the
 * whole prefixed namespace, so a variable vitest adds tomorrow is already in.
 */
export const RUNNER_ENV_PATTERN = /\b(TEST|VITEST(?:_[A-Z0-9_]+)?|JEST_WORKER_ID)\b/g;

/**
 * A BRACKET access whose key is a quoted runner token — `env['VITEST']`.
 *
 * This needs its own pass, and the self-test is why it exists: the first pass
 * runs over source with string literals blanked, so `env['VITEST']` vanished
 * from it entirely and the gate reported a confident zero about the one
 * spelling an author would reach for FIRST if the dotted one were rejected.
 *
 * The character before `[` is required to be an identifier tail or a closing
 * paren/bracket, which is what separates an INDEX from an array literal:
 * `env['VITEST']` matches, `const keys = ['VITEST']` does not. That matters —
 * naming the family in an array is exactly what the code that STRIPS these
 * variables has to do.
 */
export const RUNNER_ENV_BRACKET_PATTERN =
  /[A-Za-z0-9_$\])]\s*(?:\?\.)?\[\s*(['"`])(TEST|VITEST(?:_[A-Z0-9_]+)?|JEST_WORKER_ID)\1\s*\]/g;

/**
 * Findings in one file's source text.
 *
 * Two passes, because the maskings a text scan needs pull in opposite
 * directions. Pass 1 blanks comments AND literals — prose and payloads that
 * merely NAME a variable are not reads — and catches every unquoted spelling
 * (`env.VITEST`, a destructure, an optional chain). Pass 2 blanks comments
 * only and looks for indexing syntax, because the quoted key of a bracket
 * access IS the read and pass 1 has just erased it.
 *
 * Offsets are preserved by both maskings, so a reported line number still
 * points at the real line.
 *
 * Both are `js-comment-mask.mjs`'s own exports (#15776) rather than a
 * composition re-derived here.
 */
export function findRunnerEnvReads(source) {
  const commentMasked = maskComments(source);
  const bothMasked = maskCommentsAndLiterals(source);

  const seen = new Set();
  const out = [];
  const lineAt = (index) => source.slice(0, index).split('\n').length;
  const push = (index, token) => {
    const line = lineAt(index);
    const key = `${line}:${token}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ line, token });
  };

  RUNNER_ENV_PATTERN.lastIndex = 0;
  let m;
  while ((m = RUNNER_ENV_PATTERN.exec(bothMasked)) !== null) push(m.index, m[1]);

  RUNNER_ENV_BRACKET_PATTERN.lastIndex = 0;
  let b;
  while ((b = RUNNER_ENV_BRACKET_PATTERN.exec(commentMasked)) !== null) push(b.index, b[2]);

  out.sort((x, y) => x.line - y.line);
  return out;
}

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, acc);
    } else if (e.isFile()) {
      const rel = relative(ROOT, full);
      if (isProductSource(rel)) acc.push(rel);
    }
  }
  return acc;
}

export function collectFiles(root = ROOT) {
  const acc = [];
  for (const r of SCANNED_ROOTS) {
    const dir = join(root, r);
    if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir, acc);
  }
  return acc.sort();
}

export function scanTree(root = ROOT) {
  const findings = [];
  for (const rel of collectFiles(root)) {
    const source = readFileSync(join(root, rel), 'utf8');
    for (const hit of findRunnerEnvReads(source)) findings.push({ file: rel, ...hit });
  }
  return findings;
}

function report(findings, fileCount) {
  if (findings.length === 0) {
    console.log(`✓ check-runner-env-posture: ${fileCount} product source file(s), no test-runner variable read.`);
    return 0;
  }
  console.error('✗ check-runner-env-posture: product source reads a test-RUNNER environment variable.\n');
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.token}`);
  console.error(
    '\n  A runner variable is INHERITED by every process the runner spawns, so a product\n' +
      '  decision keyed off one is made for spawned servers too — and the measured result\n' +
      '  was a security gate that silently stopped running (see this script\'s header).\n\n' +
      '  Key the decision off the DEPLOYMENT instead: `NODE_ENV` is this repo\'s one\n' +
      '  environment source, and vitest sets `NODE_ENV=test` on the same worker it sets\n' +
      '  `VITEST` on, so in-process tests keep their posture without the runner voting.\n\n' +
      '  A genuinely new case is an edit to this gate plus a --self-test case, never an\n' +
      '  allowlist entry.',
  );
  return 1;
}

// ---------------------------------------------------------------------------
// Self-test — the shapes, not today's corpus
// ---------------------------------------------------------------------------

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

export function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => {
    registerCase();
    return cases.push([name, actual, expected]);
  };
  const tokens = (src) => findRunnerEnvReads(src).map((h) => h.token);

  // --- Detection: the spellings an author actually reaches for.
  battery('Detection: the spellings an author actually reaches for.');
  t('member access', tokens('if (env.VITEST) return 1;'), ['VITEST']);
  t('process.env member', tokens('const x = process.env.VITEST;'), ['VITEST']);
  t('optional chain', tokens('const x = process?.env?.VITEST;'), ['VITEST']);
  t('bracket access', tokens("const x = env['VITEST_WORKER_ID'];"), ['VITEST_WORKER_ID']);
  t('bracket access, double-quoted', tokens('const x = env["TEST"];'), ['TEST']);
  t('bracket access through an optional chain', tokens("const x = process.env?.['VITEST'];"), ['VITEST']);
  t('an ARRAY literal naming the family is not a read', tokens("const keys = ['VITEST', 'TEST'];"), []);
  t('a bracket read is reported once, not twice', findRunnerEnvReads("env['VITEST'];").length, 1);
  t('destructure', tokens('const { VITEST, HOME } = process.env;'), ['VITEST']);
  t('bare TEST', tokens('if (env.TEST) return 1;'), ['TEST']);
  t('jest worker', tokens('if (env.JEST_WORKER_ID) return 1;'), ['JEST_WORKER_ID']);
  t('the whole VITEST namespace, not a fixed list', tokens('env.VITEST_SOMETHING_NEW;'), ['VITEST_SOMETHING_NEW']);
  t('two reads on one line are both reported', tokens('env.VITEST || env.TEST;'), ['VITEST', 'TEST']);

  // --- The line number points at the real line, offsets preserved by the mask.
  battery('The line number points at the real line, offsets preserved by the mask.');
  t('line number survives masking', findRunnerEnvReads('// x\n/* y */\nif (env.VITEST) {}').map((h) => h.line), [3]);

  // --- NOT flagged: the deployment signal, which is the whole point.
  battery('NOT flagged: the deployment signal, which is the whole point.');
  t('NODE_ENV is not a runner variable', tokens("if (env.NODE_ENV === 'test') return 1;"), []);
  t("the string 'test' is not the token TEST", tokens("if (mode === 'test') return 1;"), []);

  // --- NOT flagged: prose and payloads. A gate that cannot tell them apart
  //     forces the explanation to be deleted, which is how this comes back.
  battery('NOT flagged: prose and payloads. A gate that cannot tell them apart');
  t('a line comment quoting the banned line', tokens('// if (env.VITEST || x) return 1;'), []);
  t('a block comment quoting it', tokens('/**\n * if (env.VITEST) return 1;\n */\nconst a = 1;'), []);
  t('a string payload naming it', tokens("const s = 'VITEST';"), []);
  t('a template payload naming it', tokens('const s = `TEST=${x}`;'), []);

  // --- Longer identifiers must not be split by the word boundaries.
  battery('Longer identifiers must not be split by the word boundaries.');
  t('MANIFEST is not TEST', tokens('const MANIFEST = 1;'), []);
  t('TEST_TIMEOUT is not TEST', tokens('const TEST_TIMEOUT = 1;'), []);
  t('LATEST is not TEST', tokens('const LATEST = 1;'), []);

  // --- Population.
  battery('Population.');
  t('product source counts', isProductSource('packages/services/service-settings/src/local-crypto-provider.ts'), true);
  t('a unit test beside it does not', isProductSource('packages/services/service-settings/src/local-crypto-provider.test.ts'), false);
  t('an e2e in a test dir does not', isProductSource('packages/cli/test/helpers/serve-process.ts'), false);
  t('an example test dir does not', isProductSource('examples/app-showcase/test/vitest-console-teardown-race.test.ts'), false);
  t('a d.ts does not', isProductSource('examples/app-showcase/src/types.d.ts'), false);
  t('a repo script outside src/ does not', isProductSource('scripts/check-runner-env-posture.mjs'), false);
  t('a package script outside src/ does not', isProductSource('packages/spec/scripts/build-schemas.mjs'), false);

  // --- Wiring. Unwiring the gate must redden HERE rather than go quiet.
  battery('Wiring. Unwiring the gate must redden HERE rather than go quiet.');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  t('a package.json alias invokes this script', /check-runner-env-posture\.mjs/.test(pkg.scripts?.['check:runner-env-posture'] ?? ''), true);
  t('...and runs the self-test with it', /--self-test/.test(pkg.scripts?.['check:runner-env-posture'] ?? ''), true);
  const lintYml = readFileSync(join(ROOT, '.github/workflows/lint.yml'), 'utf8');
  t('a lint job runs the alias', lintYml.includes('pnpm check:runner-env-posture'), true);

  // --- The corpus itself, as a case rather than as the run's only evidence.
  battery('The corpus itself, as a case rather than as the run\'s only evidence.');
  t('today\'s tree is clean', scanTree().length, 0);

  // The floor runs BEFORE the verdict below, so a success line can only be
  // printed by a run in which every declared battery registered its cases.
  for (const message of batteryFloorFailures()) cases.push([message, false, true]);

  let failed = 0;
  for (const [name, actual, expected] of cases) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  }
  if (failed) {
    console.error(`✗ check-runner-env-posture self-test: ${failed} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`✓ check-runner-env-posture self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-runner-env-posture self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(selfTestCode);
  } else {
    const files = collectFiles();
    process.exit(report(scanTree(), files.length));
  }
}
