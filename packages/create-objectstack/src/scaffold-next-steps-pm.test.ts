// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Pins #10322: the printed "Next steps" (and the install-failure remedy) must
// name the SAME package manager the run actually detected — never a
// hardcoded `npm` regardless of what ran. Before this fix, a newcomer whose
// install ran with `pnpm` (confirmed empirically: this scaffolder prefers
// pnpm and only falls back to npm when pnpm is unreachable — see
// `detectPackageManager()`) was told to run `npm run dev` / `npm run
// validate` afterwards — the third of the "three different answers" #10322
// measured. `packages/cli/src/commands/init.ts`'s own "Next steps" already
// threads its detected `chosenPm` through; this file is the same contract for
// `create-objectstack`.
//
// `index.ts` calls `program.parse()` at import time, so it cannot be
// unit-tested directly — this exercises the real CLI end to end via `tsx`,
// the same no-build subprocess pattern `scaffold-description.test.ts` uses.
// `--skip-install` keeps every run here fast and offline: `detectPackageManager()`
// is a read-only `<pm> --version` probe (see index.ts), so its result — and
// therefore what "Next steps" prints — does not depend on an install actually
// following it. The *real* install path (both the pnpm and npm-fallback
// cases) was additionally verified by hand against the built CLI; see this
// issue's PR body for the transcripts.
//
// Both branches of the detector are exercised by controlling PATH:
//   - pnpm reachable    -> "pnpm run dev" / "pnpm run validate"
//   - pnpm unreachable  -> "npm run dev" / "npm run validate" (the fallback
//     this scaffolder has always had for machines without pnpm)
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

function which(cmd: string): string {
  return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim();
}

/** A PATH entry with `node` + `npm` reachable and `pnpm` deliberately absent. */
function makePnpmlessBin(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-nopnpm-bin-'));
  fs.symlinkSync(which('node'), path.join(dir, 'node'));
  fs.symlinkSync(which('npm'), path.join(dir, 'npm'));
  return dir;
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

/** Run the real CLI with --skip-install --skip-skills and return its stdout. */
function runScaffold(env: NodeJS.ProcessEnv): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-nextsteps-'));
  try {
    return execFileSync(
      TSX,
      [INDEX_TS, 'my-app', '--template', 'blank', '--skip-install', '--skip-skills'],
      { cwd: tmp, env, encoding: 'utf8' },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('scaffolder "Next steps" names the package manager it actually detected (#10322)', () => {
  it('with pnpm on PATH: prints pnpm consistently, never bare npm', () => {
    // Sanity: this container really does have pnpm reachable, or the
    // "consistently pnpm" assertion below would be vacuous.
    expect(() => which('pnpm')).not.toThrow();

    const nextSteps = nextStepsSection(runScaffold(process.env));
    expect(nextSteps).toMatch(/\bpnpm run dev\b/);
    expect(nextSteps).toMatch(/\bpnpm run validate\b/);
    expect(nextSteps).not.toMatch(/\bnpm run\b/);
    expect(nextSteps).not.toMatch(/\bnpm install\b/);
  }, 20_000);

  it('with pnpm unreachable: falls back to npm — consistently, not a stale pnpm mention', () => {
    const bin = makePnpmlessBin();
    try {
      // Sanity: the fake PATH really does hide pnpm (and really does still
      // expose node/npm — otherwise tsx itself could not launch).
      expect(() =>
        execFileSync('sh', ['-c', 'command -v pnpm'], {
          env: { ...process.env, PATH: bin },
        }),
      ).toThrow();

      const nextSteps = nextStepsSection(
        runScaffold({ ...process.env, PATH: `${bin}:/usr/bin:/bin` }),
      );
      expect(nextSteps).toMatch(/\bnpm run dev\b/);
      expect(nextSteps).toMatch(/\bnpm run validate\b/);
      expect(nextSteps).not.toMatch(/pnpm/);
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  }, 20_000);

  it('both branches still name the unskippable validate step (#10322 pt. 3)', () => {
    expect(runScaffold(process.env)).toMatch(/run validate/);
  }, 20_000);

  it('the install-failure remedy also names the detected package manager, not a hardcoded npm', () => {
    const source = fs.readFileSync(INDEX_TS, 'utf8');
    expect(source).toMatch(/Dependency installation failed\. Run .*\$\{pm\} install.* manually\./);
    expect(source).not.toMatch(/Run `npm install` manually/);
  });
});
