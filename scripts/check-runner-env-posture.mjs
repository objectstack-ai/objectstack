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

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanSource, blank } from './js-comment-mask.mjs';
import { isEntrypoint } from './invoked-as.mjs';

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
 */
export function findRunnerEnvReads(source) {
  const flags = scanSource(source);

  const commentMasked = blank(source, flags.comment);
  const bothMasked = blank(commentMasked, flags.literal);

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

export function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => cases.push([name, actual, expected]);
  const tokens = (src) => findRunnerEnvReads(src).map((h) => h.token);

  // --- Detection: the spellings an author actually reaches for.
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
  t('line number survives masking', findRunnerEnvReads('// x\n/* y */\nif (env.VITEST) {}').map((h) => h.line), [3]);

  // --- NOT flagged: the deployment signal, which is the whole point.
  t('NODE_ENV is not a runner variable', tokens("if (env.NODE_ENV === 'test') return 1;"), []);
  t("the string 'test' is not the token TEST", tokens("if (mode === 'test') return 1;"), []);

  // --- NOT flagged: prose and payloads. A gate that cannot tell them apart
  //     forces the explanation to be deleted, which is how this comes back.
  t('a line comment quoting the banned line', tokens('// if (env.VITEST || x) return 1;'), []);
  t('a block comment quoting it', tokens('/**\n * if (env.VITEST) return 1;\n */\nconst a = 1;'), []);
  t('a string payload naming it', tokens("const s = 'VITEST';"), []);
  t('a template payload naming it', tokens('const s = `TEST=${x}`;'), []);

  // --- Longer identifiers must not be split by the word boundaries.
  t('MANIFEST is not TEST', tokens('const MANIFEST = 1;'), []);
  t('TEST_TIMEOUT is not TEST', tokens('const TEST_TIMEOUT = 1;'), []);
  t('LATEST is not TEST', tokens('const LATEST = 1;'), []);

  // --- Population.
  t('product source counts', isProductSource('packages/services/service-settings/src/local-crypto-provider.ts'), true);
  t('a unit test beside it does not', isProductSource('packages/services/service-settings/src/local-crypto-provider.test.ts'), false);
  t('an e2e in a test dir does not', isProductSource('packages/cli/test/helpers/serve-process.ts'), false);
  t('an example test dir does not', isProductSource('examples/app-showcase/test/vitest-console-teardown-race.test.ts'), false);
  t('a d.ts does not', isProductSource('examples/app-showcase/src/types.d.ts'), false);
  t('a repo script outside src/ does not', isProductSource('scripts/check-runner-env-posture.mjs'), false);
  t('a package script outside src/ does not', isProductSource('packages/spec/scripts/build-schemas.mjs'), false);

  // --- Wiring. Unwiring the gate must redden HERE rather than go quiet.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  t('a package.json alias invokes this script', /check-runner-env-posture\.mjs/.test(pkg.scripts?.['check:runner-env-posture'] ?? ''), true);
  t('...and runs the self-test with it', /--self-test/.test(pkg.scripts?.['check:runner-env-posture'] ?? ''), true);
  const lintYml = readFileSync(join(ROOT, '.github/workflows/lint.yml'), 'utf8');
  t('a lint job runs the alias', lintYml.includes('pnpm check:runner-env-posture'), true);

  // --- The corpus itself, as a case rather than as the run's only evidence.
  t('today\'s tree is clean', scanTree().length, 0);

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
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest());
  } else {
    const files = collectFiles();
    process.exit(report(scanTree(), files.length));
  }
}
