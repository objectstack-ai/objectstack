// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Pins #10322: the printed "Next steps" (and the install-failure remedy) must
// name the SAME package manager the run actually detected — never a
// hardcoded `npm` regardless of what ran. Before this fix, a newcomer whose
// install ran with `pnpm` was told to run `npm run dev` / `npm run validate`
// afterwards — the third of the "three different answers" #10322 measured.
// `packages/cli/src/commands/init.ts`'s own "Next steps" already threads its
// detected `chosenPm` through; this file is the same contract for
// `create-objectstack`.
//
// `index.ts` calls `program.parse()` at import time, so it cannot be
// unit-tested directly — this exercises the real CLI end to end via `tsx`,
// the same no-build subprocess pattern `scaffold-description.test.ts` uses.
// `--skip-install` keeps every run here fast and offline: `detectPackageManager()`
// is a read-only `<pm> --version` probe, so its result — and therefore what
// "Next steps" prints — does not depend on an install actually following it.
//
// ─── WHY EVERY LEG STUBS pnpm, INCLUDING THE ONE WHERE pnpm WORKS ───────────
//
// This file used to run its pnpm leg against the ambient environment, and that
// made a merge-queue job go red on a diff that could not reach this package.
// The reason is worth keeping written down, because "just re-run it" would
// have buried it:
//
//   - the scaffold child runs in an `mkdtemp` under `os.tmpdir()`, OUTSIDE the
//     repo, so its `pnpm --version` does not see the repo's pinned
//     `packageManager` and Corepack has to resolve — and can have to FETCH —
//     its own default instead. Measured, one machine, one binary, two cwds:
//     10.31.0 inside this repo, 10.33.0 outside it.
//   - the test's own sanity check ran in the TEST process, whose cwd is inside
//     the repo. It therefore could not cover the child at all: it passed while
//     the thing it was guarding failed.
//
// So a network hiccup on a runner decided this file's verdict. The fix is not
// a retry, a longer timeout or a skip — each of those keeps the test measuring
// the runner and just makes it complain less. Instead the probe's OUTCOME is
// the fixture: every leg runs under a PATH holding a stub `pnpm` whose exit
// status this file chooses. Nothing here can be decided by the network.
//
// The sanity guard is not relaxed by that — it is re-aimed and made stricter.
// It now runs under the PATH the CHILD is given (the cwd/PATH mismatch above
// was the bug) and pins resolution to the exact stub, so a leg whose fixture
// silently failed to take effect fails loudly instead of going vacuous.
//
// The "no bare npm when pnpm ran" assertion is deliberately a WORD-BOUNDARY
// match, not a substring one: the literal text "pnpm run" itself contains the
// substring "npm run" (p-N-P-M-space-r-u-n has "npm run" starting at its
// second character), so a naive `.not.toContain('npm run')` would fail
// against correct pnpm output.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const INDEX_TS = path.join(PKG_ROOT, 'src', 'index.ts');

/** The stderr a stubbed failing probe emits — echoed back in the warning. */
const PROBE_FAILURE_STDERR = 'corepack: Network request to https://registry.npmjs.org/pnpm failed';

function which(cmd: string): string {
  return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim();
}

/** A PATH entry with `node` + `npm` reachable — the floor every leg needs, since
 *  `tsx` itself could not launch without them. */
function makeBin(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-pm-bin-'));
  fs.symlinkSync(which('node'), path.join(dir, 'node'));
  fs.symlinkSync(which('npm'), path.join(dir, 'npm'));
  return dir;
}

/** `node` + `npm` reachable and `pnpm` deliberately absent. */
function makePnpmlessBin(): string {
  return makeBin();
}

/**
 * `node` + `npm` reachable and a stub `pnpm` whose `--version` exits with
 * `exitCode`. This is what makes the verdict hermetic: the real Corepack
 * resolution — the part that needs a network and a cwd inside the repo — never
 * runs, so the branch under test is chosen by this file and not by the runner.
 */
function makeStubPnpmBin(exitCode: number): string {
  const dir = makeBin();
  const script =
    exitCode === 0
      ? '#!/bin/sh\necho "10.31.0"\nexit 0\n'
      : `#!/bin/sh\necho "${PROBE_FAILURE_STDERR}" >&2\nexit ${exitCode}\n`;
  fs.writeFileSync(path.join(dir, 'pnpm'), script, { mode: 0o755 });
  return dir;
}

/** The PATH a scaffold child is given for a leg. */
function childPath(bin: string): string {
  return `${bin}:/usr/bin:/bin`;
}

/**
 * The vacuity guard, re-aimed at the PATH the CHILD receives rather than the
 * test process's own. Asserting mere reachability is what let the old guard
 * pass over a child that resolved something else entirely, so this pins the
 * resolution to the exact stub on disk.
 */
function expectPnpmResolvesToStub(bin: string): void {
  const resolved = execFileSync('sh', ['-c', 'command -v pnpm'], {
    env: { ...process.env, PATH: childPath(bin) },
    encoding: 'utf8',
  }).trim();
  expect(resolved).toBe(path.join(bin, 'pnpm'));
}

/** The mirror guard: the fake PATH really does hide pnpm, and really does still
 *  expose node/npm — otherwise `tsx` itself could not launch. */
function expectPnpmUnreachable(bin: string): void {
  expect(() =>
    execFileSync('sh', ['-c', 'command -v pnpm'], {
      env: { ...process.env, PATH: childPath(bin) },
    }),
  ).toThrow();
  expect(() =>
    execFileSync('sh', ['-c', 'command -v node && command -v npm'], {
      env: { ...process.env, PATH: childPath(bin) },
    }),
  ).not.toThrow();
}

/**
 * The "Next steps:" block of a run's stdout — deliberately narrower than the
 * whole transcript. The "Created files" listing above it names
 * `pnpm-workspace.yaml` regardless of which package manager ran the install
 * (it is a static template file, not install output), so a bare
 * `stdout.not.toMatch(/pnpm/)` would false-positive on that filename in the
 * npm-fallback case. What actually matters is what the run tells the reader
 * to type next.
 */
function nextStepsSection(stdout: string): string {
  return stdout.split('Next steps:')[1] ?? '';
}

/** Run the real CLI with --skip-install --skip-skills under `bin`'s PATH. */
function runScaffold(bin: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-nextsteps-'));
  try {
    return execFileSync(
      TSX,
      [INDEX_TS, 'my-app', '--template', 'blank', '--skip-install', '--skip-skills'],
      { cwd: tmp, env: { ...process.env, PATH: childPath(bin) }, encoding: 'utf8' },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Run `body` against a freshly built bin dir, cleaning it up afterwards. */
function withBin(make: () => string, body: (bin: string) => void): void {
  const bin = make();
  try {
    body(bin);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
}

describe('scaffolder "Next steps" names the package manager it actually detected (#10322)', () => {
  it('with pnpm on PATH: prints pnpm consistently, never bare npm', () => {
    withBin(() => makeStubPnpmBin(0), (bin) => {
      expectPnpmResolvesToStub(bin);

      const nextSteps = nextStepsSection(runScaffold(bin));
      expect(nextSteps).toMatch(/\bpnpm run dev\b/);
      expect(nextSteps).toMatch(/\bpnpm run validate\b/);
      expect(nextSteps).not.toMatch(/\bnpm run\b/);
      expect(nextSteps).not.toMatch(/\bnpm install\b/);
    });
  }, 20_000);

  it('with pnpm unreachable: falls back to npm — consistently, not a stale pnpm mention', () => {
    withBin(makePnpmlessBin, (bin) => {
      expectPnpmUnreachable(bin);

      const nextSteps = nextStepsSection(runScaffold(bin));
      expect(nextSteps).toMatch(/\bnpm run dev\b/);
      expect(nextSteps).toMatch(/\bnpm run validate\b/);
      expect(nextSteps).not.toMatch(/pnpm/);
    });
  }, 20_000);

  it('both branches still name the unskippable validate step (#10322 pt. 3)', () => {
    // Both, actually both — this used to run one ambient leg twice under a
    // name that claimed two.
    withBin(() => makeStubPnpmBin(0), (bin) => {
      expect(runScaffold(bin)).toMatch(/\bpnpm run validate\b/);
    });
    withBin(makePnpmlessBin, (bin) => {
      expect(runScaffold(bin)).toMatch(/\bnpm run validate\b/);
    });
  }, 40_000);

  it('the install-failure remedy also names the detected package manager, not a hardcoded npm', () => {
    const source = fs.readFileSync(INDEX_TS, 'utf8');
    expect(source).toMatch(/Dependency installation failed\. Run .*\$\{pm\} install.* manually\./);
    expect(source).not.toMatch(/Run `npm install` manually/);
  });
});

// ─── The verdict has to be honest, not just deterministic ───────────────────
//
// A hermetic test over a detector that still collapses "I failed" into "npm"
// would pass every time while asserting something false. These are the pins
// that make the transcript distinguish the two, end to end through the real
// CLI — the unit-level pins live in detect-package-manager.test.ts.
describe('a failed pnpm probe is reported as a fallback, not as a choice', () => {
  it('pnpm present but its probe fails: still npm, and the run SAYS the probe failed', () => {
    withBin(() => makeStubPnpmBin(1), (bin) => {
      // Same guard as the succeeding leg: pnpm really is reachable here. That
      // is what separates this case from the one below.
      expectPnpmResolvesToStub(bin);

      const stdout = runScaffold(bin);

      // The decision is unchanged — this change was never entitled to move
      // which package manager a user is told to run.
      const nextSteps = nextStepsSection(stdout);
      expect(nextSteps).toMatch(/\bnpm run dev\b/);
      expect(nextSteps).toMatch(/\bnpm run validate\b/);

      // ...but the transcript now admits why, and names the actual failure
      // instead of swallowing it.
      expect(stdout).toContain('using npm as a fallback');
      expect(stdout).toContain(PROBE_FAILURE_STDERR);
    });
  }, 20_000);

  it('pnpm simply absent: npm with NO fallback warning — the two cases stay distinguishable', () => {
    withBin(makePnpmlessBin, (bin) => {
      expectPnpmUnreachable(bin);

      const stdout = runScaffold(bin);
      expect(nextStepsSection(stdout)).toMatch(/\bnpm run dev\b/);

      // The collapse guard, end to end: if a future edit reports both npm
      // cases the same way, one of these two tests goes red.
      expect(stdout).not.toContain('using npm as a fallback');
    });
  }, 20_000);

  it('a succeeding probe never claims a fallback', () => {
    withBin(() => makeStubPnpmBin(0), (bin) => {
      expect(runScaffold(bin)).not.toContain('using npm as a fallback');
    });
  }, 20_000);
});
