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
// 380 code-tier errors across 18 packages, 241 of them in driver-sql tests
// passing authored-shape literals into the freshly narrowed QueryAST. A green
// test suite no tsc has ever read is not evidence of a contract; this gate
// makes the coverage hole itself the failure, so it can only shrink.
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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

// Anchored to the script, not to cwd: the verdict must not depend on where the
// guard was invoked from.
const ROOT = resolve(import.meta.dirname, '..');
const SELF = 'scripts/check-type-check-coverage.mjs';
const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const TRACKING_ISSUE = 'https://github.com/objectstack-ai/objectstack/issues/4311';

// Package name -> { errors, note? }. `errors` is the raw `tsc --noEmit` count
// measured per package on main @ e5a4d26 (2026-07-31, the #4311 audit re-run
// one commit later; aggregates matched exactly: 48 clean / 29 failing).
// Raw counts include all three of #4311's tiers -- code-tier (real defects),
// config-tier (the check itself misconfigured: TS2591/TS2584 missing
// `types:["node"]`, TS2835/TS2307 module resolution) and noise (TS7006
// implicit-any params, TS6133 unused) -- so each note says what the pile is
// made of. Nobody should mistake a config-tier pile for real breakage, or --
// worse -- the reverse: `core` at 91 raw has 3 real errors, while
// `driver-sql`'s 241 are ALL real.
const DEBT = {
  '@objectstack/cloud-connection': {
    errors: 13,
    note: 'code-tier 11 (TS2493 tuple indexing) + 2 config-tier.',
  },
  '@objectstack/core': {
    errors: 91,
    note: 'code-tier 3; the rest is config-tier (TS2835/TS2347 module resolution) and noise (TS7006).',
  },
  '@objectstack/dogfood': {
    errors: 12,
    note: 'code-tier 8 (TS2322/TS2554) + 3 config-tier + 1 noise.',
  },
  '@objectstack/driver-memory': {
    errors: 23,
    note: 'all code-tier: TS2345/TS2741/TS2339, the QueryAST authored-vs-parsed playbook.',
  },
  '@objectstack/driver-sql': {
    errors: 241,
    note: 'ALL code-tier (TS2345 x123, TS2353 x118): tests pass authored-shape literals into the parsed QueryAST type across 8+ test files; #4196/#4286 narrowed QueryAST and no tsc ever read these tests. 63% of the whole audit; single playbook, fix as one batch.',
  },
  '@objectstack/driver-sqlite-wasm': {
    errors: 27,
    note: 'all code-tier (TS2345/TS2353), same QueryAST playbook as driver-sql.',
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
    errors: 21,
    note: 'code-tier 2; the rest is config-tier (TS2835) and noise (TS7006).',
  },
  '@objectstack/observability': {
    errors: 11,
    note: 'all code-tier (TS2554 wrong arity x10, TS2552).',
  },
  '@objectstack/plugin-approvals': {
    errors: 1,
    note: 'config-tier only (TS2550 lib); no code-tier finding in #4311.',
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
  '@objectstack/service-cache': {
    errors: 3,
    note: 'config-tier only (TS2835); no code-tier finding in #4311.',
  },
  '@objectstack/service-cluster': {
    errors: 1,
    note: 'code-tier 1 (TS2322).',
  },
  '@objectstack/service-i18n': {
    errors: 14,
    note: 'config-tier (TS2835) and noise (TS7006) only; no code-tier finding in #4311.',
  },
  '@objectstack/service-job': {
    errors: 6,
    note: 'config-tier (TS2835) and noise only; no code-tier finding in #4311.',
  },
  '@objectstack/service-knowledge': {
    errors: 8,
    note: 'code-tier 3 (TS2339/TS2352/TS2493); the rest config-tier and noise.',
  },
  '@objectstack/service-messaging': {
    errors: 1,
    note: 'noise only (TS6133); no code-tier finding in #4311.',
  },
  '@objectstack/service-queue': {
    errors: 9,
    note: 'config-tier (TS2835) and noise (TS7006) only; no code-tier finding in #4311.',
  },
  '@objectstack/service-realtime': {
    errors: 9,
    note: 'config-tier (TS2835) and noise (TS7006) only; no code-tier finding in #4311.',
  },
  '@objectstack/service-settings': {
    errors: 44,
    note: 'config-tier (TS2307/TS2835 module resolution) and noise (TS7006) only; no code-tier finding in #4311.',
  },
  '@objectstack/service-storage': {
    errors: 42,
    note: 'code-tier 5 (TS2339/TS2347); the rest is config-tier (TS2835) and noise (TS7006).',
  },
  '@objectstack/spec-monorepo': {
    errors: 50,
    note: 'the workspace root itself: code-tier 2 (TS2304); the rest is config-tier (TS2307/TS2591/TS2584 -- the root tsconfig has no `types:["node"]`) and noise.',
  },
  '@objectstack/types': {
    errors: 107,
    note: 'config-tier only (TS2591/TS2584: missing `types:["node"]`/lib in the check config); no code-tier finding in #4311.',
  },
  'create-objectstack': {
    errors: 5,
    note: 'config-tier only (TS2307 module resolution of template files); no code-tier finding in #4311.',
  },
};

// Package name -> why running tsc over it is not applicable at all. An EXEMPT
// entry is a statement about the package's nature, not about its debt; if the
// nature changes, the RECONCILED direction forces this entry out.
const EXEMPT = {
  '@objectstack/console':
    'Published objectui build artifact -- package.json/README/CHANGELOG plus a dist/ pulled in by `pnpm objectui:refresh`. No TypeScript sources, no tsconfig; the sources are type-checked in the objectui repo.',
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

/** Every workspace member as { name, dir, scripts, hasTsconfig }. */
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
    };
  });
}

/**
 * Pure verdict over an observed workspace state; the real run and the
 * self-test both go through here, so the semantics the fixtures prove are the
 * semantics the gate applies.
 *
 * @param {Array<{name: string, dir: string, scripts: Record<string,string>, hasTsconfig: boolean}>} packages
 * @param {{name: string, scripts: Record<string,string>}} root
 * @param {{ debt: Record<string, {errors: number, note?: string}>,
 *           exempt: Record<string, string>,
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
  const okState = { debt: {}, exempt: {}, turboHasTask: true, ciInvokesTask: true, ciInvokesRoot: true };
  const cases = [
    {
      label: 'covered package passes',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: okState,
      expect: [],
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
console.log(
  `check-type-check-coverage: OK — ${covered}/${packages.length} workspace packages type-checked ` +
    `(plus the root), ${Object.keys(DEBT).length} in the DEBT ledger (${debtTotal} frozen raw errors, ` +
    `${TRACKING_ISSUE}), ${Object.keys(EXEMPT).length} exempt.`,
);
