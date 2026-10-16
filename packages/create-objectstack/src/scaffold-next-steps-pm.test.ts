// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Pins commit 8d21f7a76: the printed "Next steps" (and the install-failure remedy) must
// name the SAME package manager the run actually detected — never a
// hardcoded `npm` regardless of what ran. Before this fix, a newcomer whose
// install ran with `pnpm` was told to run `npm run dev` / `npm run validate`
// afterwards — the third of the "three different answers" commit 8d21f7a76 measured.
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
// The install-outcome legs at the foot of the file run without it, against a
// stub `pnpm` that answers `install` itself, so they stay offline too.
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

/**
 * Only the "Next steps:" command list — the lines up to the blank line that
 * ends it. Narrower again than `nextStepsSection`: the "AI Skills" block that
 * follows says "After `<pm> install`:" under `--skip-install`, so an install
 * assertion against the whole section would pass without the list naming it.
 */
function nextStepsList(stdout: string): string {
  return nextStepsSection(stdout).split(/\n\s*\n/)[0] ?? '';
}

/**
 * `node` + `npm` reachable and a stub `pnpm` whose `--version` succeeds and
 * whose `install` exits with `installExit`. Every call's argv is appended to
 * `calls.log` beside it, so a leg can prove the install was (or was not)
 * attempted from the record rather than from the wording of a warning.
 */
function makeInstallStubPnpmBin(installExit: number): string {
  const dir = makeBin();
  const script =
    '#!/bin/sh\n' +
    `echo "$*" >> "${path.join(dir, 'calls.log')}"\n` +
    'case "$1" in\n' +
    '  --version) echo "10.31.0"; exit 0 ;;\n' +
    `  install) exit ${installExit} ;;\n` +
    'esac\n' +
    'exit 64\n';
  fs.writeFileSync(path.join(dir, 'pnpm'), script, { mode: 0o755 });
  return dir;
}

/** The argv of every stub `pnpm` call a leg made, one entry per call. */
function stubPnpmCalls(bin: string): string[] {
  const log = path.join(bin, 'calls.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
}

/** Run the real CLI with --skip-skills (and, by default, --skip-install) under `bin`'s PATH. */
function runScaffold(bin: string, { skipInstall = true }: { skipInstall?: boolean } = {}): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-nextsteps-'));
  try {
    return execFileSync(
      TSX,
      [
        INDEX_TS,
        'my-app',
        '--template',
        'blank',
        ...(skipInstall ? ['--skip-install'] : []),
        '--skip-skills',
      ],
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

// ─── A failed install leaves the same empty node_modules as a skipped one ───
//
// "Next steps" used to print `<pm> install` only under `--skip-install`, so a
// run whose install was ATTEMPTED and FAILED (a network error, a registry
// outage, an engine mismatch, an npm crash) printed the same list as a
// successful one, and the next command it named ran against an empty
// node_modules. The condition is now "the install did not complete". The
// install's outcome is the stub's exit status, never the network, for the
// reason the header gives; the stub's call log proves each leg took the path
// it claims.

/** The index of the first line of `list` matching `re`, or -1. */
function lineIndex(list: string, re: RegExp): number {
  return list.split('\n').findIndex((line) => re.test(line));
}

describe('a failed install still lists the install step in "Next steps" (#23865)', () => {
  it('install attempted and failed: the list names `pnpm install`, before the run commands', () => {
    withBin(() => makeInstallStubPnpmBin(1), (bin) => {
      expectPnpmResolvesToStub(bin);

      const list = nextStepsList(runScaffold(bin, { skipInstall: false }));

      // Attempted, and the stub answered it with exit 1.
      expect(stubPnpmCalls(bin)).toContain('install');
      const install = lineIndex(list, /\bpnpm install\b/);
      expect(install).toBeGreaterThanOrEqual(0);
      expect(lineIndex(list, /\bpnpm run dev\b/)).toBeGreaterThan(install);
    });
  }, 20_000);

  it('CONTROL: install attempted and succeeded, so no install step in the list', () => {
    withBin(() => makeInstallStubPnpmBin(0), (bin) => {
      expectPnpmResolvesToStub(bin);

      const list = nextStepsList(runScaffold(bin, { skipInstall: false }));

      expect(stubPnpmCalls(bin)).toContain('install');
      expect(list).toMatch(/\bpnpm run dev\b/);
      expect(list).not.toMatch(/\bpnpm install\b/);
    });
  }, 20_000);

  it('CONTROL: `--skip-install` still names `pnpm install` before the run commands', () => {
    withBin(() => makeInstallStubPnpmBin(0), (bin) => {
      expectPnpmResolvesToStub(bin);

      const list = nextStepsList(runScaffold(bin));

      // Skipped, not attempted: the only call the stub saw is the probe.
      expect(stubPnpmCalls(bin)).toEqual(['--version']);
      const install = lineIndex(list, /\bpnpm install\b/);
      expect(install).toBeGreaterThanOrEqual(0);
      expect(lineIndex(list, /\bpnpm run dev\b/)).toBeGreaterThan(install);
    });
  }, 20_000);
});
