#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-type-check-coverage -- every workspace package's TypeScript is read by
// tsc somewhere, or its absence is a recorded, tracked decision (#4311).
//
// 66 of 77 workspace packages build with tsup, which transpiles with esbuild
// and never type-checks. `vitest run` does not type-check either. And the CI
// typecheck job covered exactly four targets (spec, examples,
// downstream-contract, docs code blocks) -- so for most packages NOTHING read
// src/ or the tests with a type checker at all. #4311 measured the hole:
// 380 code-tier errors across 18 packages, 241 of them in driver-sql. A green
// test suite no tsc has ever read is not evidence of a contract; this gate
// makes the coverage hole itself the failure, so it can only shrink.
//
// What the first burn-down found is worth knowing before reading a number
// below as "N test literals to fix". The three drivers (driver-sql 241,
// driver-sqlite-wasm 27, driver-memory 23) were filed as one playbook --
// author-tier literals in a parsed-tier parameter -- and 165 of their 292
// were something else entirely: 118 for a `bypassTenantAudit` driver option
// that SqlDriver read (through an `as any`), the engine set, and two services
// passed, while `DriverOptionsSchema` had never declared it; 41 for a bare-id
// `findOne(object, id)` branch on no contract, which the other two drivers
// answered differently; 4 for a `tenancy` key `initObjects` consumed but did
// not declare; 19 for an analytics `timezone` default. The tests were right
// and the types were wrong. A tsc count is a place to look, never a verdict.
//
// The reverse also holds: a LOW count can be call sites opting out. Those same
// three packages carried 111 `as any` casts on driver-call arguments. Removing
// them left 66 fresh errors -- every one a real missing `object` the cast had
// hidden, including an `orderBy: [['id','asc']]` tuple the driver reads as
// `item.field` and therefore silently dropped, inside a helper whose whole job
// was reading rows in order. 43 of the casts were needed by nothing at all;
// exactly 2 were load-bearing (tests feeding a filter the AST gate refuses, on
// purpose). Onboarding a package is supposed to make its `typecheck` mean
// something, so the casts belong in the diff too.
//
//   node scripts/check-type-check-coverage.mjs
//   node scripts/check-type-check-coverage.mjs --self-test
//
// Invariants, per workspace package (the root workspace package included --
// #4311's audit counted its top-level TypeScript like any other package's):
//
//   COVERED     the package declares a `typecheck` script, OR carries a DEBT
//               entry (measured tsc error count + tracking issue) or an EXEMPT
//               entry (why type-checking cannot apply) below. A new package
//               must arrive covered -- the ledger is closed to new debt.
//   REAL        a declared `typecheck` script actually invokes tsc. A script
//               that echoes, lints, or runs tests is not type coverage.
//   TESTS_COVERED
//               a package whose tsconfig `exclude`s its own `*.test.ts` /
//               `*.spec.ts` carries a measured TEST_DEBT entry. `tsc --noEmit`
//               reads the package tsconfig, so an exclusion there hides the
//               tests from the very check the `typecheck` script advertises --
//               COVERED and REAL both pass while nothing reads the files
//               #4311 is actually about. This invariant is why the ledger is
//               two ledgers: DEBT is "src does not check", TEST_DEBT is "src
//               checks, tests are hidden", and they are independent.
//   RUNNABLE    turbo.json declares the `typecheck` task, the root `typecheck`
//               script aggregates it (`turbo run typecheck`, the build/test
//               convention), and lint.yml invokes it -- a script CI never
//               executes is not coverage either (#4203: gates that only run
//               where nobody runs them, rot).
//   RECONCILED  in both directions: a DEBT/EXEMPT entry for a package that now
//               declares `typecheck`, or that no longer exists, is an error.
//               A ledger that can only accrete rots into a list nobody trusts.
//
// The root is the one asymmetry: its `typecheck` script is the workspace
// aggregator, so its OWN top-level TypeScript is covered by a `typecheck:root`
// script (tsc, invoked from lint.yml) or by a ledger entry like anyone else.
//
// DEBT is frozen debt, not a permission slip. Every entry below was measured
// by running the package's own `tsc --noEmit` on main (see the issue for the
// code-tier / config-tier / noise split -- raw counts here include all three).
// To onboard a package: fix (or config-fix) its errors, add
// `"typecheck": "tsc --noEmit"` to its package.json, and delete its entry
// here in the same PR. Deleting the entry without the script fails COVERED;
// keeping the entry alongside the script fails RECONCILED.
//
// TEST_DEBT is the same discipline for the second hole. The first pass of this
// gate (#4324) counted a package covered the moment it declared `typecheck` --
// and 27 of the 48 it waved through exclude `**/*.test.ts` from the tsconfig
// that very script runs against, hiding 568 test files and 1451 errors behind
// a green check. `spec` alone hid 902 across 272 test files. To onboard: drop
// the exclusion from tsconfig.json and delete the entry here in the same PR.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

// Anchored to the script, not to cwd: the verdict must not depend on where the
// guard was invoked from.
const ROOT = resolve(import.meta.dirname, '..');
const SELF = 'scripts/check-type-check-coverage.mjs';
const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const TRACKING_ISSUE = 'https://github.com/objectstack-ai/objectstack/issues/4311';
// An `exclude` pattern that names tests (`**/*.test.ts`, `**/*.spec.tsx`, ...)
// and the files such a pattern hides. Kept deliberately broad: the question is
// "does this config steer tsc away from the test layer", not "which exact glob".
const TEST_GLOB = /\*\.(test|spec)\.tsx?$/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;

// Package name -> { errors, note? }. `errors` is the raw `tsc --noEmit` count
// measured per package on main @ b07d829 (2026-07-31), re-measured after the
// NodeNext repair below.
// Raw counts include all three of #4311's tiers -- code-tier (real defects),
// config-tier (the check itself misconfigured: TS2591/TS2584 missing
// `types:["node"]`, TS2835/TS2307 module resolution) and noise (TS7006
// implicit-any params, TS6133 unused) -- so each note says what the pile is
// made of. Nobody should mistake a config-tier pile for real breakage, or --
// worse -- the reverse: `core` at 91 raw has 3 real errors, while
// `driver-sql`'s 241 were ALL real (and, as the header notes, mostly real
// about the types rather than about the tests).
//
// The tiers are not independent, which is why these numbers get re-measured
// rather than decremented. Under `moduleResolution: NodeNext` a relative
// import without its `.js` extension does not resolve, so every symbol it
// names degrades to `any` -- and each callback over one of those symbols then
// reports TS7006 "implicitly any". Repairing 44 such imports in this PR closed
// 110 errors across eight packages, most of them "noise" that was never noise
// at all, and simultaneously EXPOSED 12 real defects in `service-settings`
// that the unresolved imports had been masking. A config-tier count is an
// upper bound on nothing: fix the config first, then read the residue.
const DEBT = {
  '@objectstack/cloud-connection': {
    errors: 13,
    note: 'code-tier 11 (TS2493 tuple indexing) + 2 config-tier.',
  },
  '@objectstack/core': {
    errors: 91,
    note: 'code-tier 3; the rest is config-tier (TS2835/TS2347 module resolution) and noise (TS7006).',
  },
  '@objectstack/hono': {
    errors: 3,
    note: 'all code-tier (TS2769/TS18046).',
  },
  '@objectstack/knowledge-ragflow': {
    errors: 4,
    note: 'code-tier 3 (TS2353) + 1 config-tier (TS2550 lib).',
  },
  '@objectstack/metadata': {
    errors: 87,
    note: 'code-tier 31 (TS2345/TS2353); the rest is config-tier (TS2835) and noise (TS7006).',
  },
  '@objectstack/metadata-protocol': {
    errors: 28,
    note: 'code-tier 9 (was read as 2 at 21 raw); the rest is config-tier (TS2835) and noise (TS7006).',
  },
  '@objectstack/observability': {
    errors: 11,
    note: 'all code-tier (TS2554 wrong arity x10, TS2552).',
  },
  '@objectstack/rest': {
    errors: 2,
    note: 'code-tier 2 (TS2345).',
  },
  '@objectstack/runtime': {
    errors: 18,
    note: 'noise only (TS6133 unused); no code-tier finding in #4311.',
  },
  '@objectstack/service-analytics': {
    errors: 3,
    note: 'code-tier 2 (TS7053) + 1 noise.',
  },
  '@objectstack/service-automation': {
    errors: 2,
    note: 'code-tier 2 (TS2741: engine.test.ts misses resumeAuthority, the #4198 discovery that opened #4311).',
  },
  '@objectstack/service-cluster': {
    errors: 1,
    note: 'code-tier 1 (TS2322).',
  },
  '@objectstack/service-knowledge': {
    errors: 8,
    note: 'code-tier 3 (TS2339/TS2352/TS2493); the rest config-tier and noise.',
  },
  '@objectstack/service-settings': {
    errors: 13,
    note: 'code-tier 12 (TS2345 x7: manifest action handlers called without `namespace`/`actionId`; TS2322) + 1 noise. Was ledgered at 44 with "no code-tier finding" -- wrong in both directions: 31 of those 44 were unresolved imports (see the NodeNext note at the top of this ledger), and the resolution they were blocking is what made the 12 real ones visible.',
  },
  '@objectstack/service-storage': {
    errors: 42,
    note: 'code-tier 5 (TS2339/TS2347); the rest is config-tier (TS2835) and noise (TS7006).',
  },
  '@objectstack/spec-monorepo': {
    errors: 50,
    note: 'the workspace root itself: code-tier 2 (TS2304); the rest is config-tier (TS2307/TS2591/TS2584 -- the root tsconfig has no `types:["node"]`) and noise.',
  },
};

// Package name -> why running tsc over it is not applicable at all. An EXEMPT
// entry is a statement about the package's nature, not about its debt; if the
// nature changes, the RECONCILED direction forces this entry out.
const EXEMPT = {
  '@objectstack/console':
    'Published objectui build artifact -- package.json/README/CHANGELOG plus a dist/ pulled in by `pnpm objectui:refresh`. No TypeScript sources, no tsconfig; the sources are type-checked in the objectui repo.',
};

// Package name -> { tests, errors, note? } for packages whose tsconfig excludes
// their own test files. `tests` is the number of hidden `*.test.ts`/`*.spec.ts`
// files, `errors` what `tsc --noEmit` reports once the exclusion is lifted --
// both measured by re-running each package's own config with the test globs
// dropped. These packages are NOT uncovered: their src type-checks and most
// declare `typecheck`. What they hide is the test layer, which is where #4311
// found the defects (a passing vitest run proves the code executes, not that
// the call shapes match). Sorted by what each is hiding, worst first.
const TEST_DEBT = {
  '@objectstack/spec': {
    tests: 272,
    errors: 902,
    note: 'TS6133 x208, TS2739 x193, TS2741 x146, TS2322 x96 -- overwhelmingly incomplete object literals in test fixtures against the schemas spec itself defines.',
  },
  '@objectstack/plugin-approvals': {
    tests: 13,
    errors: 467,
    note: 'TS2339 x255, TS2345 x188. Larger than driver-sql; src is clean, so the whole pile is test-only and invisible to every gate today.',
  },
  '@objectstack/runtime': { tests: 66, errors: 220, note: 'TS18048 x81 (possibly-undefined), TS2345 x26, TS6133 x25. Also in DEBT: its src does not check either.' },
  '@objectstack/objectql': { tests: 87, errors: 219, note: 'TS2339 x88, TS2554 x28 (wrong arity), TS7006 x25.' },
  '@objectstack/plugin-auth': { tests: 26, errors: 124, note: 'TS2493 x40 (tuple index out of range), TS18048 x24, TS2740 x18.' },
  '@objectstack/rest': { tests: 35, errors: 105, note: 'TS2835 x43 (NodeNext extensions), TS7006 x42. Also in DEBT.' },
  '@objectstack/mcp': { tests: 8, errors: 52, note: 'TS18046 x51 -- `error` is of type unknown, one catch-block idiom repeated.' },
  '@objectstack/driver-mongodb': { tests: 7, errors: 44, note: 'TS2345 x22, TS2591 x15 (`process` -- the test files need types:["node"] once included).' },
  '@objectstack/lint': { tests: 39, errors: 26, note: 'TS7006 x20, TS2835 x6.' },
  '@objectstack/plugin-security': { tests: 32, errors: 20, note: 'TS2739 x8, TS2740 x5 -- incomplete literals.' },
  '@objectstack/client': { tests: 15, errors: 19, note: 'TS6059 x5 (rootDir), TS2740 x5, TS6133 x3.' },
  '@objectstack/formula': { tests: 13, errors: 12, note: 'TS2345 x3, TS2352 x3, TS2591 x3.' },
  '@objectstack/trigger-record-change': { tests: 4, errors: 8, note: 'TS2353 x8 -- one unknown-property shape repeated.' },
  '@objectstack/verify': { tests: 2, errors: 6, note: 'TS7006 x4, TS2835 x2.' },
  '@objectstack/connector-mcp': { tests: 3, errors: 5, note: 'TS2339 x5.' },
  '@objectstack/connector-openapi': { tests: 3, errors: 5, note: 'TS2339 x5.' },
  '@objectstack/platform-objects': { tests: 8, errors: 3, note: 'TS2339 x2, TS7006 x1.' },
  '@objectstack/plugin-sharing': { tests: 11, errors: 3, note: 'TS6133 x2, TS18048 x1.' },
  '@objectstack/http-conformance': { tests: 2, errors: 1, note: 'TS2740 x1.' },
  '@objectstack/service-sms': { tests: 3, errors: 1, note: 'TS2493 x1.' },
  '@objectstack/connector-rest': { tests: 3, errors: 1, note: 'TS6133 x1.' },
};

/**
 * The `packages:` globs from pnpm-workspace.yaml. Blank lines and comments are
 * skipped rather than treated as the end of the list: stopping early would
 * drop members from the scan and report a clean run over a partial workspace.
 */
function workspaceGlobs() {
  const lines = readFileSync(join(ROOT, WORKSPACE_FILE), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^packages\s*:\s*$/.test(l));
  if (start === -1) throw new Error(`${WORKSPACE_FILE}: no top-level \`packages:\` block`);
  const globs = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const m = line.match(/^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/);
    if (m) {
      globs.push(m[1]);
      continue;
    }
    if (/^\S/.test(line)) break; // the next top-level key ends the block
  }
  if (globs.length === 0) throw new Error(`${WORKSPACE_FILE}: \`packages:\` block is empty`);
  return globs;
}

/**
 * Does this package's tsconfig `exclude` its own test files, and how many are
 * there to hide? Read with a tolerant parse -- these configs carry `//`
 * comments, and a parse failure must not silently read as "excludes nothing"
 * (that would turn TESTS_COVERED into a gate that passes on unparseable input).
 *
 * @returns {{excludesTests: boolean, testFiles: number}}
 */
function testCoverage(dir) {
  const tsconfigPath = join(ROOT, dir, 'tsconfig.json');
  let excludesTests = false;
  let parsedInclude = null;
  if (existsSync(tsconfigPath)) {
    const raw = readFileSync(tsconfigPath, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new Error(`${dir}/tsconfig.json is not parseable, so its test coverage cannot be judged`, { cause });
    }
    excludesTests = (parsed.exclude ?? []).some((pattern) => TEST_GLOB.test(pattern));
    parsedInclude = parsed.include ?? null;
  }

  // Count only under the `include` roots: `exclude` subtracts from what
  // `include` selected, so a test file outside those roots is already out of
  // the program and is not what this exclusion hides. Several packages keep a
  // sibling `test/` tree that their `include` never mentions -- counting it
  // here would attribute files to an exclusion that has no bearing on them.
  // Roots come from the glob prefix (`src/**/*` -> `src`); no `include` at all
  // means tsc walks the whole package directory.
  const roots = Array.isArray(parsedInclude) && parsedInclude.length > 0
    ? [...new Set(parsedInclude.map((g) => g.split('*')[0].replace(/\/$/, '')).filter((p) => !p.includes('..')))]
    : [''];

  let testFiles = 0;
  const seen = new Set();
  const walk = (abs, depth) => {
    let entries = [];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // no such root, or unreadable -- nothing to hide either way
    }
    for (const entry of entries) {
      const child = join(abs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
        if (depth > 0 && existsSync(join(child, 'package.json'))) continue; // another package's problem
        walk(child, depth + 1);
      } else if (TEST_FILE.test(entry.name) && !seen.has(child)) {
        seen.add(child); // overlapping include roots must not double-count
        testFiles++;
      }
    }
  };
  for (const root of roots) walk(join(ROOT, dir, root), 0);
  return { excludesTests, testFiles };
}

/** Every workspace member as { name, dir, scripts, hasTsconfig, excludesTests, testFiles }. */
function workspacePackages() {
  const dirs = [];
  for (const glob of workspaceGlobs()) {
    // Every pattern in this repo is `<dir>` or `<dir>/*`. Anything richer
    // would silently resolve to nothing, so reject it rather than under-report.
    const star = glob.endsWith('/*');
    const base = star ? glob.slice(0, -2) : glob;
    if (base.includes('*')) {
      throw new Error(`${WORKSPACE_FILE}: pattern "${glob}" is richer than <dir> or <dir>/*; extend ${SELF}`);
    }
    const abs = join(ROOT, base);
    if (!existsSync(abs)) continue;
    const candidates = star ? readdirSync(abs).map((e) => posix.join(base, e)) : [base];
    for (const c of candidates) {
      if (existsSync(join(ROOT, c, 'package.json'))) dirs.push(c);
    }
  }
  return dirs.sort().map((dir) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
    return {
      name: manifest.name ?? dir,
      dir,
      scripts: manifest.scripts ?? {},
      hasTsconfig: existsSync(join(ROOT, dir, 'tsconfig.json')),
      ...testCoverage(dir),
    };
  });
}

/**
 * Pure verdict over an observed workspace state; the real run and the
 * self-test both go through here, so the semantics the fixtures prove are the
 * semantics the gate applies.
 *
 * @param {Array<{name: string, dir: string, scripts: Record<string,string>, hasTsconfig: boolean,
 *                excludesTests?: boolean, testFiles?: number}>} packages
 * @param {{name: string, scripts: Record<string,string>}} root
 * @param {{ debt: Record<string, {errors: number, note?: string}>,
 *           exempt: Record<string, string>,
 *           testDebt: Record<string, {tests: number, errors: number, note?: string}>,
 *           turboHasTask: boolean, ciInvokesTask: boolean, ciInvokesRoot: boolean }} state
 * @returns {string[]} problems, empty when the ratchet holds
 */
function evaluate(packages, root, state) {
  const problems = [];
  const byName = new Map(packages.map((p) => [p.name, p]));
  byName.set(root.name, root);

  for (const pkg of packages) {
    const script = pkg.scripts.typecheck;
    const inDebt = Object.hasOwn(state.debt, pkg.name);
    const inExempt = Object.hasOwn(state.exempt, pkg.name);

    // TESTS_COVERED, and its RECONCILED counterpart. Independent of whether the
    // package is covered or in DEBT: this is about what the tsconfig hides, not
    // about whether a script exists to run against it.
    const inTestDebt = Object.hasOwn(state.testDebt, pkg.name);
    if (pkg.excludesTests && pkg.testFiles > 0) {
      if (!inTestDebt) {
        problems.push(
          `${pkg.name} (${pkg.dir}): tsconfig.json excludes its own test files, hiding ${pkg.testFiles} of them ` +
            `from \`tsc --noEmit\` -- the check reports green over source it never read (${TRACKING_ISSUE}). ` +
            `Drop the \`*.test.ts\`/\`*.spec.ts\` entry from \`exclude\`, or measure what surfaces and add a ` +
            `TEST_DEBT entry in ${SELF}.`,
        );
      } else {
        const entry = state.testDebt[pkg.name];
        if (!entry || typeof entry.errors !== 'number' || entry.errors <= 0) {
          problems.push(
            `${pkg.name}: TEST_DEBT entry has no measured error count -- lift the exclusion, run ` +
              `\`tsc --noEmit\`, record the number, or drop the exclusion for good.`,
          );
        }
      }
    } else if (inTestDebt) {
      problems.push(
        `${pkg.name}: has a TEST_DEBT entry but ${pkg.testFiles === 0 ? 'has no test files' : 'no longer excludes its tests'} -- ` +
          `it graduated; delete its entry from TEST_DEBT in ${SELF}.`,
      );
    }

    if (script !== undefined) {
      // REAL: the script must put tsc in front of the package's sources.
      if (!/\btsc\b/.test(script)) {
        problems.push(
          `${pkg.name} (${pkg.dir}): \`typecheck\` script does not invoke tsc ("${script}") -- ` +
            `a typecheck that never type-checks satisfies the letter of COVERED and nothing else.`,
        );
      }
      // RECONCILED: covered packages must not also sit in the ledger.
      if (inDebt) {
        problems.push(
          `${pkg.name}: declares \`typecheck\` but still has a DEBT entry -- it graduated; ` +
            `delete its entry from DEBT in ${SELF}.`,
        );
      }
      if (inExempt) {
        problems.push(
          `${pkg.name}: declares \`typecheck\` but still has an EXEMPT entry -- ` +
            `delete its entry from EXEMPT in ${SELF}.`,
        );
      }
      continue;
    }

    // COVERED: no script, so the ledger must own the gap -- with substance.
    if (inDebt) {
      const entry = state.debt[pkg.name];
      if (!entry || typeof entry.errors !== 'number' || entry.errors <= 0) {
        problems.push(
          `${pkg.name}: DEBT entry has no measured error count -- run its \`tsc --noEmit\`, ` +
            `record the number, or onboard it outright.`,
        );
      }
    } else if (inExempt) {
      if (!String(state.exempt[pkg.name] ?? '').trim()) {
        problems.push(`${pkg.name}: EXEMPT entry has no reason -- say why tsc cannot apply, or onboard it.`);
      }
    } else {
      problems.push(
        `${pkg.name} (${pkg.dir}): no \`typecheck\` script and no ledger entry. ` +
          `Add \`"typecheck": "tsc --noEmit"\` to its package.json (tsup/vitest never type-check, ` +
          `so without it nothing reads this package's types at all -- see ${TRACKING_ISSUE}). ` +
          `Only if the errors are too large to fix now: measure them and add a DEBT entry in ${SELF}.`,
      );
    }
  }

  // The root's own top-level TypeScript, covered via `typecheck:root` (its
  // `typecheck` slot is the workspace aggregator, asserted under RUNNABLE).
  const rootScript = root.scripts['typecheck:root'];
  const rootInDebt = Object.hasOwn(state.debt, root.name);
  const rootInExempt = Object.hasOwn(state.exempt, root.name);
  if (rootScript !== undefined) {
    if (!/\btsc\b/.test(rootScript)) {
      problems.push(`${root.name}: \`typecheck:root\` does not invoke tsc ("${rootScript}").`);
    }
    if (rootInDebt) {
      problems.push(
        `${root.name}: declares \`typecheck:root\` but still has a DEBT entry -- it graduated; ` +
          `delete its entry from DEBT in ${SELF}.`,
      );
    }
    if (rootInExempt) {
      problems.push(`${root.name}: declares \`typecheck:root\` but still has an EXEMPT entry -- delete it from ${SELF}.`);
    }
    if (!state.ciInvokesRoot) {
      problems.push(
        `.github/workflows/lint.yml never invokes \`typecheck:root\` -- the root's own ` +
          `TypeScript is declared covered but CI never reads it. Add the step.`,
      );
    }
  } else if (rootInDebt) {
    const entry = state.debt[root.name];
    if (!entry || typeof entry.errors !== 'number' || entry.errors <= 0) {
      problems.push(`${root.name}: DEBT entry has no measured error count.`);
    }
  } else if (rootInExempt) {
    if (!String(state.exempt[root.name] ?? '').trim()) {
      problems.push(`${root.name}: EXEMPT entry has no reason.`);
    }
  } else {
    problems.push(
      `${root.name} (workspace root): no \`typecheck:root\` script and no ledger entry -- ` +
        `the root's own top-level TypeScript (tsup.config.ts and friends) is in the audit too (${TRACKING_ISSUE}).`,
    );
  }

  // RECONCILED, other direction: ledger entries must point at live packages.
  for (const name of Object.keys(state.debt)) {
    if (!byName.has(name)) {
      problems.push(`DEBT entry for "${name}" names no workspace package -- remove it from ${SELF}.`);
    }
  }
  for (const name of Object.keys(state.exempt)) {
    if (!byName.has(name)) {
      problems.push(`EXEMPT entry for "${name}" names no workspace package -- remove it from ${SELF}.`);
    }
  }
  for (const name of Object.keys(state.testDebt)) {
    if (!byName.has(name)) {
      problems.push(`TEST_DEBT entry for "${name}" names no workspace package -- remove it from ${SELF}.`);
    }
  }

  // RUNNABLE: coverage that nothing executes is not coverage.
  if (!state.turboHasTask) {
    problems.push(
      `turbo.json does not declare a \`typecheck\` task -- \`turbo run typecheck\` runs nothing, ` +
        `so every per-package script above is dead. Restore the task (dependsOn ^build).`,
    );
  }
  if (!/\bturbo run typecheck\b/.test(root.scripts.typecheck ?? '')) {
    problems.push(
      `the root \`typecheck\` script must aggregate the workspace (\`turbo run typecheck\`, ` +
        `the build/test convention) so one command runs every declared check locally.`,
    );
  }
  if (!state.ciInvokesTask) {
    problems.push(
      `.github/workflows/lint.yml does not invoke \`turbo run typecheck\` -- the per-package ` +
        `scripts exist but CI never runs them (#4203 is the history of exactly this). Restore the step.`,
    );
  }

  return problems;
}

/** The observed non-fixture state. */
function observed() {
  const turbo = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
  const lintYml = readFileSync(join(ROOT, '.github/workflows/lint.yml'), 'utf8');
  const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return {
    root: { name: rootManifest.name, scripts: rootManifest.scripts ?? {} },
    state: {
      debt: DEBT,
      exempt: EXEMPT,
      testDebt: TEST_DEBT,
      turboHasTask: Object.hasOwn(turbo.tasks ?? {}, 'typecheck'),
      ciInvokesTask: /turbo run typecheck/.test(lintYml),
      ciInvokesRoot: /typecheck:root/.test(lintYml),
    },
  };
}

/**
 * The ledger semantics are the one part of this gate that can be wrong while
 * every package is right -- an evaluate() that under-reports waves the next
 * uncovered package through, silently. So each failure class is asserted
 * against a fixture before the real run is allowed to say OK.
 */
function selfTest() {
  const pkg = (name, extra = {}) => ({ name, dir: `packages/${name}`, scripts: {}, hasTsconfig: true, ...extra });
  const okRoot = {
    name: 'root',
    scripts: { typecheck: 'turbo run typecheck', 'typecheck:root': 'tsc --noEmit' },
  };
  const okState = { debt: {}, exempt: {}, testDebt: {}, turboHasTask: true, ciInvokesTask: true, ciInvokesRoot: true };
  const cases = [
    {
      label: 'covered package passes',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: okState,
      expect: [],
    },
    {
      label: 'a covered package that excludes its tests fails TESTS_COVERED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, excludesTests: true, testFiles: 12 })],
      root: okRoot,
      state: okState,
      expect: [/excludes its own test files, hiding 12 of them/],
    },
    {
      label: 'a test-debt entry covers the exclusion, but an empty measurement fails',
      packages: [
        pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, excludesTests: true, testFiles: 3 }),
        pkg('b', { scripts: { typecheck: 'tsc --noEmit' }, excludesTests: true, testFiles: 4 }),
      ],
      root: okRoot,
      state: { ...okState, testDebt: { a: { tests: 3, errors: 9 }, b: { tests: 4, errors: 0 } } },
      expect: [/b: TEST_DEBT entry has no measured error count/],
    },
    {
      label: 'excluding tests when there are none to hide is not debt',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, excludesTests: true, testFiles: 0 })],
      root: okRoot,
      state: okState,
      expect: [],
    },
    {
      label: 'dropping the exclusion without deleting TEST_DEBT fails RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, excludesTests: false, testFiles: 5 })],
      root: okRoot,
      state: { ...okState, testDebt: { a: { tests: 5, errors: 7 } } },
      expect: [/a: has a TEST_DEBT entry but no longer excludes its tests/],
    },
    {
      label: 'TEST_DEBT for a vanished package fails RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: { ...okState, testDebt: { gone: { tests: 1, errors: 1 } } },
      expect: [/TEST_DEBT entry for "gone" names no workspace package/],
    },
    {
      label: 'test exclusion is judged independently of src coverage',
      packages: [pkg('a', { excludesTests: true, testFiles: 6 })],
      root: okRoot,
      state: { ...okState, debt: { a: { errors: 4 } } },
      expect: [/a \(packages\/a\): tsconfig.json excludes its own test files/],
    },
    {
      label: 'uncovered, unledgered package fails COVERED',
      packages: [pkg('a')],
      root: okRoot,
      state: okState,
      expect: [/no `typecheck` script and no ledger entry/],
    },
    {
      label: 'debt-ledgered package passes, but an empty measurement fails',
      packages: [pkg('a'), pkg('b')],
      root: okRoot,
      state: { ...okState, debt: { a: { errors: 12 }, b: {} } },
      expect: [/b: DEBT entry has no measured error count/],
    },
    {
      label: 'exempt package passes only with a reason',
      packages: [pkg('a'), pkg('b')],
      root: okRoot,
      state: { ...okState, exempt: { a: 'no sources', b: '  ' } },
      expect: [/b: EXEMPT entry has no reason/],
    },
    {
      label: 'a typecheck script that never runs tsc fails REAL',
      packages: [pkg('a', { scripts: { typecheck: 'echo ok' } })],
      root: okRoot,
      state: okState,
      expect: [/does not invoke tsc/],
    },
    {
      label: 'graduating without deleting the ledger entry fails RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: { ...okState, debt: { a: { errors: 3 } } },
      expect: [/declares `typecheck` but still has a DEBT entry/],
    },
    {
      label: 'ledger entries for vanished packages fail RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: { ...okState, debt: { gone: { errors: 1 } }, exempt: { also_gone: 'x' } },
      expect: [/DEBT entry for "gone"/, /EXEMPT entry for "also_gone"/],
    },
    {
      label: 'a missing turbo task or CI step fails RUNNABLE',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: { ...okState, turboHasTask: false, ciInvokesTask: false },
      expect: [/turbo\.json does not declare/, /lint\.yml does not invoke/],
    },
    {
      label: 'an unledgered root without typecheck:root fails COVERED',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: okState,
      expect: [/root.*no `typecheck:root` script and no ledger entry/],
    },
    {
      label: 'a debt-ledgered root passes; graduating it stale-fails like anyone else',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: { ...okState, debt: { root: { errors: 50 } } },
      expect: [],
    },
    {
      label: 'a root aggregator that does not run turbo fails RUNNABLE',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'tsc --noEmit', 'typecheck:root': 'tsc --noEmit' } },
      state: okState,
      expect: [/root `typecheck` script must aggregate/],
    },
    {
      label: 'a covered root that CI never runs fails RUNNABLE',
      packages: [],
      root: okRoot,
      state: { ...okState, ciInvokesRoot: false },
      expect: [/never invokes `typecheck:root`/],
    },
  ];

  const failures = [];
  for (const c of cases) {
    const got = evaluate(c.packages, c.root, c.state);
    if (got.length !== c.expect.length || !c.expect.every((rx, i) => rx.test(got[i]))) {
      failures.push(`${c.label}: expected ${c.expect.length} problem(s) matching ${c.expect}, got ${JSON.stringify(got)}`);
    }
  }
  if (failures.length) {
    console.error(`✗ check:type-check-coverage --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error('  • ' + f);
    process.exit(1);
  }
  console.log(`✓ check:type-check-coverage --self-test — ${cases.length} semantic case(s) hold.`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const packages = workspacePackages();
const { root, state } = observed();
const problems = evaluate(packages, root, state);

if (problems.length) {
  console.error(`check-type-check-coverage: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}

const covered = packages.filter((p) => p.scripts.typecheck !== undefined).length;
const debtTotal = Object.values(DEBT).reduce((sum, e) => sum + (e.errors ?? 0), 0);
const testDebtErrors = Object.values(TEST_DEBT).reduce((sum, e) => sum + (e.errors ?? 0), 0);
const testDebtFiles = Object.values(TEST_DEBT).reduce((sum, e) => sum + (e.tests ?? 0), 0);
// Both numbers, always. Reporting only the src figure is how the first pass of
// this gate read as 48/77 green while 568 test files went unchecked.
console.log(
  `check-type-check-coverage: OK — ${covered}/${packages.length} workspace packages type-checked ` +
    `(plus the root), ${Object.keys(DEBT).length} in the DEBT ledger (${debtTotal} frozen raw errors, ` +
    `${TRACKING_ISSUE}), ${Object.keys(EXEMPT).length} exempt.\n` +
    `  test layer: ${Object.keys(TEST_DEBT).length} package(s) still exclude their own tests ` +
    `(${testDebtFiles} files, ${testDebtErrors} frozen raw errors in TEST_DEBT).`,
);
