#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-console-intercept-disarm — every package that runs vitest must disarm
// vitest's console interception (`disableConsoleIntercept: true`) in its
// package-root vitest config.
//
// ── The defect this keeps closed (#10374, fix shape landed in #10293) ───────
//
// vitest 4's worker replaces `console` with one that forwards every write to
// the main thread over RPC, and `sendLog` (in vitest's own
// `dist/chunks/console.*.js`) DISCARDS the promise that forwarding returns.
// Worker teardown then runs `await rpcDone()` — which awaits a SNAPSHOT of the
// pending set — followed by `$rejectPendingCalls(...)`. A console RPC created
// after that snapshot is rejected as an UNHANDLED error, and vitest fails the
// run even though every assertion passed. The recognisable signature:
//
//     Test Files  N passed (N)
//          Tests  X passed (X)
//         Errors  1 error
//     EnvironmentTeardownError: [vitest-worker]: Closing rpc while
//       "onUserConsoleLog" was pending
//
// ⚠️ The file that error names is where the rejection ORIGINATED (the file the
// worker happened to be on), not where the bug is. The window is load-width —
// ~1ms idle, wide enough for any leaked timer or fire-and-forget write on a
// saturated runner — which is why it presents as a merge-queue flake that "no
// one can reproduce". Full mechanism, reproduction and measured costs:
// `examples/app-showcase/vitest.config.ts` (the disarm's docblock) and
// `examples/app-showcase/test/vitest-console-teardown-race.test.ts` (the pin
// that proves the mechanism is still live in the installed vitest, and fails
// if showcase's disarm is removed).
//
// Setting `disableConsoleIntercept: true` removes the MECHANISM rather than
// narrowing the trigger: with no console RPC there is no pending call for
// `$rejectPendingCalls` to reject, so no future late `console.log` in any
// package can redden a green run this way.
//
// ── Why a gate and not a sweep (#10374's measured population) ───────────────
//
// The sweep that accompanied this gate disarmed every suite it could find —
// and the population it found was already stale-prone in both directions:
// 38 vitest configs on 2026-08-21 had become 43 by 2026-08-30 (five new
// configs in nine days, every one of them arriving with the intercept armed),
// and 29 MORE packages ran vitest with no config file at all, invisible to
// any count of `vitest.config.ts`. A sweep's terminal state leaves the next
// package unguarded, and the symptom of the omission is a suite that is green
// for months and then fails a merge-queue run no one can reproduce. The
// invariant has to be asserted mechanically or it is not asserted at all.
//
// ── What this checks ────────────────────────────────────────────────────────
//
// For every workspace package (from `pnpm-workspace.yaml`'s globs) whose
// `scripts` invoke vitest:
//
//   1. A package-root vitest config must exist (`vitest.config.{ts,mts,cts,
//      js,mjs,cjs}`). A package with no config runs vitest's defaults, and
//      the default arms the intercept.
//   2. Its comment-masked source must set `disableConsoleIntercept: true` —
//      masked via `scripts/js-comment-mask.mjs`, so a docblock ABOUT the
//      setting (this repo's configs carry long rationale comments) never
//      satisfies the check, and a commented-out setting doesn't either.
//   3. `disableConsoleIntercept: false` at package root is refused loudly —
//      it re-arms the mechanism while reading as a considered choice.
//
// Deliberately OUT of scope: configs below the package root, e.g.
// `examples/app-showcase/test/fixtures/late-console-teardown/
// vitest.unguarded.config.ts` — that fixture sets `false` ON PURPOSE (it is
// the positive control the teardown-race pin measures the defect with), and
// scoping this gate to package-root configs is what lets it exist.
//
// No waiver ledger, deliberately: no suite in the repo today depends on the
// interception (measured: no package-root config sets `onConsoleLog`, and the
// full-population measurement behind #10374 found the intercepted output of
// every suite was being DISCARDED by the non-TTY default reporter's
// `silent: 'passed-only'`). If a real dependency on interception ever
// appears, add a shrink-only ledger here with the package and the reason —
// never widen the scan away from the package.
//
// Exit 0: every vitest-running package is disarmed. Exit 1: findings (each
// names the package, what is missing, and the exact line to add). Exit 2:
// the gate itself could not measure (broken workspace file, empty population)
// — never reported as a pass.
//
//   node scripts/check-console-intercept-disarm.mjs
//   node scripts/check-console-intercept-disarm.mjs --self-test

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { blank, scanSource } from './js-comment-mask.mjs';

/**
 * Comments AND string/template/regex content blanked, offsets kept. This gate
 * looks for a bare code-position `disableConsoleIntercept: true`, so unlike
 * the gates whose signal IS a string literal, a quoted spelling here is never
 * the real setting — it is prose (an error message, a doc snippet) and
 * blanking it keeps prose from satisfying the check. The boundary this
 * accepts: a config spelling the KEY as a quoted property
 * (`'disableConsoleIntercept': true`) reds the gate even though vitest would
 * honour it — the failure is loud, names the file, and the remedy is the
 * unquoted spelling every other config uses.
 */
function maskProse(source) {
  const { comment, literal } = scanSource(source);
  const flags = new Uint8Array(comment.length);
  for (let i = 0; i < flags.length; i++) flags[i] = comment[i] | literal[i];
  return blank(source, flags);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const VITEST_CONFIG_NAMES = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
];

const DISARM_RE = /\bdisableConsoleIntercept\s*:\s*true\b/;
const REARM_RE = /\bdisableConsoleIntercept\s*:\s*false\b/;
/** A script that runs vitest — `vitest run`, `vitest --coverage`, a bare `vitest`. */
const VITEST_SCRIPT_RE = /(?:^|\s|&&|;)vitest(?:\s|$)/;

const REMEDY = `    // Late console writes must not redden a green suite (#10374) — see the
    // mechanism docblock in examples/app-showcase/vitest.config.ts. Enforced
    // by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,`;

/**
 * Expand `pnpm-workspace.yaml`'s package globs. Every glob in that file is
 * either a literal directory or a single-level `<dir>/*`; this expander
 * refuses anything wider so a future workspace-file shape FAILS the gate
 * instead of silently emptying its population.
 */
export function workspacePackageDirs(root) {
  const raw = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [];
  let inPackages = false;
  for (const line of raw.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = line.match(/^\s+-\s+['"]?([^'"#\s]+)['"]?\s*$/);
      if (m) {
        globs.push(m[1]);
        continue;
      }
      if (line.trim() !== '') inPackages = false;
    }
  }
  if (globs.length === 0) {
    throw new Error(`no package globs parsed from ${join(root, 'pnpm-workspace.yaml')}`);
  }
  const dirs = [];
  for (const glob of globs) {
    if (glob.endsWith('/*')) {
      const base = join(root, glob.slice(0, -2));
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(base, entry.name);
        if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
      }
    } else if (!glob.includes('*')) {
      const dir = join(root, glob);
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
    } else {
      throw new Error(
        `pnpm-workspace.yaml glob '${glob}' is wider than '<dir>/*' — teach ` +
          `workspacePackageDirs() the new shape before trusting this gate again`,
      );
    }
  }
  return dirs;
}

/** @returns {{findings: string[], vitestPackages: number}} */
export function scan(root) {
  const findings = [];
  let vitestPackages = 0;
  for (const dir of workspacePackageDirs(root)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch (error) {
      findings.push(`${rel(root, dir)}/package.json: unreadable (${error.message})`);
      continue;
    }
    const scripts = Object.values(manifest.scripts ?? {});
    if (!scripts.some((s) => typeof s === 'string' && VITEST_SCRIPT_RE.test(s))) continue;
    vitestPackages += 1;

    const configName = VITEST_CONFIG_NAMES.find((name) => existsSync(join(dir, name)));
    if (!configName) {
      findings.push(
        `${rel(root, dir)}: runs vitest with NO package-root vitest config — vitest's ` +
          `default ARMS console interception, exposing this suite to the #10374 ` +
          `teardown race. Add a vitest.config.ts whose test block carries:\n${REMEDY}`,
      );
      continue;
    }
    const masked = maskProse(readFileSync(join(dir, configName), 'utf8'));
    if (REARM_RE.test(masked)) {
      findings.push(
        `${rel(root, dir)}/${configName}: sets disableConsoleIntercept: FALSE — this ` +
          `re-arms the #10374 teardown race at the package root. The only sanctioned ` +
          `home for that value is a fixture config BELOW the package root (the ` +
          `teardown-race pin's positive control). Set it to true, or move the config ` +
          `under the fixture directory that needs it.`,
      );
      continue;
    }
    if (!DISARM_RE.test(masked)) {
      findings.push(
        `${rel(root, dir)}/${configName}: does not set disableConsoleIntercept: true ` +
          `(a comment about it does not count) — this suite pays a console RPC per ` +
          `write and any late console.log can fail its fully green run ` +
          `(EnvironmentTeardownError: [vitest-worker]: Closing rpc while ` +
          `"onUserConsoleLog" was pending). Add to the test block:\n${REMEDY}`,
      );
    }
  }
  return { findings, vitestPackages };
}

function rel(root, path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}

function main() {
  let result;
  try {
    result = scan(REPO_ROOT);
  } catch (error) {
    console.error(`check-console-intercept-disarm: MEASUREMENT FAILED — ${error.message}`);
    process.exit(2);
  }
  const { findings, vitestPackages } = result;
  if (vitestPackages === 0) {
    console.error(
      'check-console-intercept-disarm: MEASUREMENT FAILED — the scan found ZERO ' +
        'vitest-running packages, and this repo has dozens. The population went ' +
        'missing, which is not the same fact as "everything is disarmed".',
    );
    process.exit(2);
  }
  if (findings.length > 0) {
    console.error(
      `check-console-intercept-disarm: ${findings.length} package(s) exposed to the ` +
        `vitest late-console teardown race (#10374):\n\n${findings.join('\n\n')}\n`,
    );
    process.exit(1);
  }
  console.log(
    `OK: ${vitestPackages} vitest-running package(s), every one disarms console ` +
      `interception at the package root.`,
  );
}

// ── self-test ───────────────────────────────────────────────────────────────
//
// Builds a throwaway workspace in $TMPDIR per case. The cases pin the verdict
// DIRECTION of every rule above — most importantly that prose never satisfies
// the check (case 5) and that a fixture config below the package root is
// invisible (case 6): those are the two silent-in-the-green-direction bugs a
// textual gate can grow.

function buildWorkspace(caseDir, packages) {
  mkdirSync(join(caseDir, 'packages'), { recursive: true });
  writeFileSync(join(caseDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  for (const [name, files] of Object.entries(packages)) {
    const dir = join(caseDir, 'packages', name);
    mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
  }
}

const TEST_MANIFEST = JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } });
const QUIET_MANIFEST = JSON.stringify({ name: 'x', scripts: { build: 'tsup' } });
const DISARMED = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { disableConsoleIntercept: true } });
`;

function selfTest() {
  const cases = [
    {
      name: 'disarmed package passes',
      packages: { a: { 'package.json': TEST_MANIFEST, 'vitest.config.ts': DISARMED } },
      expectFindings: 0,
    },
    {
      name: 'config without the setting fails',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts': `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 1,
      expectText: 'does not set disableConsoleIntercept',
    },
    {
      name: 'vitest script with no config fails',
      packages: { a: { 'package.json': TEST_MANIFEST } },
      expectFindings: 1,
      expectText: 'NO package-root vitest config',
    },
    {
      name: 'explicit false at package root fails',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts': `export default { test: { disableConsoleIntercept: false } };\n`,
        },
      },
      expectFindings: 1,
      expectText: 'FALSE',
    },
    {
      name: 'a comment about the setting does not satisfy the check',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts':
            `// disableConsoleIntercept: true — explained here, set nowhere\n` +
            `/* disableConsoleIntercept: true */\n` +
            `export default { test: { globals: true } };\n`,
        },
      },
      expectFindings: 1,
      expectText: 'a comment about it does not count',
    },
    {
      name: 'a fixture config below the package root is out of scope',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts': DISARMED,
          'test/fixtures/race/vitest.unguarded.config.ts':
            `export default { test: { disableConsoleIntercept: false } };\n`,
        },
      },
      expectFindings: 0,
    },
    {
      name: 'a package that never runs vitest is ignored',
      packages: { a: { 'package.json': QUIET_MANIFEST } },
      expectFindings: 0,
      expectVitestPackages: 0,
    },
    {
      name: 'string-guarded config: setting inside a template literal does not count',
      packages: {
        a: {
          'package.json': TEST_MANIFEST,
          'vitest.config.ts':
            'const doc = `disableConsoleIntercept: true`;\n' +
            `export default { test: { globals: true } };\n`,
        },
      },
      // String/template content is blanked before matching, so a template
      // literal spelling the setting never satisfies the gate.
      expectFindings: 1,
      expectText: 'does not set disableConsoleIntercept',
    },
  ];

  let failures = 0;
  for (const testCase of cases) {
    const caseDir = mkdtempSync(join(tmpdir(), 'ci-disarm-'));
    try {
      buildWorkspace(caseDir, testCase.packages);
      const { findings, vitestPackages } = scan(caseDir);
      const problems = [];
      if (findings.length !== testCase.expectFindings) {
        problems.push(`expected ${testCase.expectFindings} finding(s), got ${findings.length}`);
      }
      if (testCase.expectText && !findings.some((f) => f.includes(testCase.expectText))) {
        problems.push(`no finding contains '${testCase.expectText}'`);
      }
      if (
        testCase.expectVitestPackages !== undefined &&
        vitestPackages !== testCase.expectVitestPackages
      ) {
        problems.push(`expected ${testCase.expectVitestPackages} vitest package(s), got ${vitestPackages}`);
      }
      if (problems.length > 0) {
        failures += 1;
        console.error(`self-test FAIL: ${testCase.name}\n  ${problems.join('\n  ')}`);
        for (const f of findings) console.error(`  finding: ${f.split('\n')[0]}`);
      }
    } finally {
      rmSync(caseDir, { recursive: true, force: true });
    }
  }

  // Anti-vacuity over the REAL tree: the scan must see the real population.
  const real = scan(REPO_ROOT);
  if (real.vitestPackages < 60) {
    failures += 1;
    console.error(
      `self-test FAIL: real-tree scan sees only ${real.vitestPackages} vitest-running ` +
        `package(s); the population this gate was written against had 72. The ` +
        `workspace expansion has gone blind, which would pass every future arrival.`,
    );
  }

  if (failures > 0) process.exit(1);
  console.log(`self-test OK: ${cases.length} cases + real-tree population floor.`);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
