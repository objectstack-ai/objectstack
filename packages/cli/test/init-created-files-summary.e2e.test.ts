// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack init`'s closing "Created files" summary — over the REAL
 * command, not a copy of its printing logic (#10557).
 *
 * ## The defect
 *
 * The summary used to be printed from an array accumulated WHILE the
 * template files were written — and that happens BEFORE `<pm> install`
 * runs, so it could never name `pnpm-lock.yaml` / `package-lock.json` /
 * `node_modules/`, or anything else the package manager writes. Measured
 * against a real `objectstack init demo-app -t app --package-manager pnpm`
 * on this tree before the fix:
 *
 *   printed summary entries : 7    (template files only)
 *   written on disk         : 9    (+ pnpm-lock.yaml, node_modules/ — 575 MB)
 *
 * ## The fork this closes, and why THIS side of it
 *
 * Two repairs were on the table: (A) move the print after the install
 * attempt, or (B) keep the print where it was and predict the paths the
 * install will write. (B) can name a path that never lands (a failed
 * install, or a package manager that writes something different). (A)'s
 * open question was what prints when the install FAILS.
 *
 * `create-objectstack`'s sibling scaffolder (`packages/create-objectstack/
 * src/index.ts`, the #10323 fix) had already measured and answered exactly
 * this for the other scaffold path: print UNCONDITIONALLY once the install
 * attempt — succeeded or failed — has run its course, from a WALK of the
 * finished directory (`created-summary.ts`'s `summarizeTree`), never from a
 * list assembled during the copy. `init` now reuses that exact module
 * (imported as `create-objectstack/created-summary`, a published subpath —
 * see that package's `exports`) instead of carrying a second copy of the
 * same renderer, which is how the two scaffold paths drifted once already
 * (#10499).
 *
 * ## Why a fake `pnpm` on PATH rather than a real install
 *
 * A real `pnpm install` against a scaffold outside the workspace hits the
 * npm registry for every `@objectstack/*` package — slow, and in CI a
 * source of flakiness unrelated to this property. The fake below does
 * exactly what this test needs from "install" and nothing more: it writes
 * `pnpm-lock.yaml` and populates `node_modules/`, including a REAL symlink
 * to this repo's already-built `@objectstack/spec`, so the self-test step
 * that runs after a successful install (`validateScaffold`, which bundles
 * the scaffold's `objectstack.config.ts` and needs `defineStack` to
 * resolve) passes too — closer to a real install than a bare touch, and it
 * costs nothing extra: `created-summary.ts` never follows a symlink while
 * walking (see its header), so this stays fast regardless of how large the
 * real `spec` package is on disk.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const REPO_ROOT = resolve(HERE, '../../..');
const TSX = resolve(REPO_ROOT, 'node_modules/.bin/tsx');
const SPEC_PKG = resolve(REPO_ROOT, 'packages/spec');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, env: Record<string, string>): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1', ...env }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // The real exit status, not truthiness of `err` — a non-zero code
          // without a signal still lands here as an `error` from `execFile`.
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/**
 * A fake `pnpm` on PATH. `opts.fail` simulates the OTHER path this fix has
 * to answer for: install fails, and the summary must still name whatever
 * DID land rather than disappearing (see the file header's fork).
 */
function writeFakePnpm(binDir: string, opts: { fail: boolean }) {
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, 'pnpm');

  if (opts.fail) {
    writeFileSync(bin, '#!/bin/sh\necho "fake pnpm: simulated install failure" >&2\nexit 1\n');
  } else {
    // 15 dummy top-level node_modules entries — over created-summary's
    // COLLAPSE_AT of 10 — so this also exercises the collapsed-directory
    // line a real install's hundreds of packages would produce, plus a
    // real symlink to the already-built @objectstack/spec so the
    // post-install self-test has a `defineStack` to resolve.
    const script = [
      '#!/bin/sh',
      'set -e',
      'mkdir -p node_modules/@objectstack/spec',
      `cp ${JSON.stringify(join(SPEC_PKG, 'package.json'))} node_modules/@objectstack/spec/package.json`,
      `ln -s ${JSON.stringify(join(SPEC_PKG, 'dist'))} node_modules/@objectstack/spec/dist`,
      ': > pnpm-lock.yaml',
      'i=1',
      'while [ "$i" -le 15 ]; do',
      '  mkdir -p "node_modules/.fake-pkg-$i"',
      '  : > "node_modules/.fake-pkg-$i/index.js"',
      '  i=$((i + 1))',
      'done',
      '',
    ].join('\n');
    writeFileSync(bin, script);
  }
  chmodSync(bin, 0o755);
}

let parentDir: string;
let binDir: string;
let successProjectDir: string;
let successRun: Run;
let failProjectDir: string;
let failRun: Run;

beforeAll(async () => {
  parentDir = mkdtempSync(join(tmpdir(), 'os-init-summary-e2e-'));
  binDir = join(parentDir, 'fakebin');
  const env = { PATH: `${binDir}:${process.env.PATH ?? ''}` };

  writeFakePnpm(binDir, { fail: false });
  successProjectDir = join(parentDir, 'demo-success');
  successRun = await runCli(['init', 'demo-success', '-t', 'app', '--package-manager', 'pnpm'], parentDir, env);

  writeFakePnpm(binDir, { fail: true });
  failProjectDir = join(parentDir, 'demo-fail');
  failRun = await runCli(['init', 'demo-fail', '-t', 'app', '--package-manager', 'pnpm'], parentDir, env);
}, 60_000);

afterAll(() => {
  try { rmSync(parentDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('objectstack init — "Created files" summary names what `pnpm install` wrote (#10557)', () => {
  it('a successful install: exits 0, and the summary names pnpm-lock.yaml and node_modules/', () => {
    expect(successRun.code).toBe(0);
    expect(successRun.stdout).toContain('pnpm-lock.yaml');
    // Collapsed-directory line: "node_modules/   <count> files, <size>".
    expect(successRun.stdout).toMatch(/node_modules\/\s+\d+ files?,/);
  });

  it('prints the summary AFTER attempting the install, not before', () => {
    const installIdx = successRun.stdout.indexOf('Installing dependencies with pnpm');
    const summaryIdx = successRun.stdout.indexOf('Created files:');
    expect(installIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeLessThan(summaryIdx);
  });

  it('really wrote what it claims — every top-level path on disk is named in the summary', () => {
    const onDisk = readdirSync(successProjectDir);
    expect(onDisk).toEqual(expect.arrayContaining(['pnpm-lock.yaml', 'node_modules']));
    for (const name of onDisk) {
      const named = successRun.stdout.includes(name) || successRun.stdout.includes(`${name}/`);
      expect(named, `"${name}" is on disk but not named anywhere in the printed summary`).toBe(true);
    }
  });

  it('a FAILED install still prints a summary — reality, not a promise', () => {
    // The other failure mode the fork's Option A had to answer for: a
    // summary that never appears on a failed run would be a new gap.
    expect(failRun.stdout).toContain('Created files:');
    expect(failRun.stdout).toContain('package.json');
    expect(failRun.stdout).toContain('objectstack.config.ts');

    // Nothing the fake pnpm would have written landed on disk this time, so
    // the summary must not claim it did either.
    const onDisk = readdirSync(failProjectDir);
    expect(onDisk).not.toContain('pnpm-lock.yaml');
    expect(onDisk).not.toContain('node_modules');
    expect(failRun.stdout).not.toContain('pnpm-lock.yaml');
    expect(failRun.stdout).not.toMatch(/node_modules\//);
  });
});
