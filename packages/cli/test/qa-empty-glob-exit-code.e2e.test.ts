// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#7848) — what the SHELL sees when `os test` matches no suite.
 *
 * ```
 * $ os test 'qa/nothing-matches-*.test.json'
 * No test files found matching: qa/nothing-matches-*.test.json
 * $ echo $?
 * 0
 * ```
 *
 * A green exit from a run that executed nothing — the #7347 `coverage.json`
 * shape, where a check that checked nothing kept reporting success. The exit
 * status is deliberately KEPT at 0: a repository that legitimately ships no
 * suites must not begin failing CI because we changed our minds about a number
 * nobody had written down. What changes is that the posture is now declared
 * (`--help`), the count is machine-readable on every run (`Found 0 test
 * suites.`, previously printed only when the count was positive), and
 * `--fail-on-empty` makes the strict reading available.
 *
 * Both arms are asserted here, and "exits 0" is the one that had to be: an exit
 * status nobody asserts is exactly the behaviour that changes by accident, and
 * the whole reason this issue exists is that a green nobody looked at survived.
 *
 * It has to be a real child process. `process.exit(1)` inside a vitest worker
 * is not an exit status — the number a shell, a `set -e` script or a CI step
 * reads only exists once Node has exited. Spawned through `bin/run-dev.js` +
 * tsx (the pattern `migrate-exit-code.e2e.test.ts` and `emit-json-pipe.test.ts`
 * already use) so the suite does not depend on `packages/cli/dist` having been
 * built. No server is contacted on this path — the command resolves the glob
 * before it sends anything — so the run needs neither a boot nor a config.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** Matches nothing, in a temp dir that contains nothing. */
const EMPTY_PATTERN = 'qa/nothing-matches-*.test.json';

/** oclif + tsx cold start; a healthy run here is ~2-5 s. */
const RUN_TIMEOUT_MS = 120_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; `null`/undefined means the child
          // was signalled — a failure of a different kind, never reported as 0.
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

let dir: string;
let lenient: Run;
let strict: Run;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-qa-empty-glob-'));
  lenient = await runCli(['test', EMPTY_PATTERN], dir);
  strict = await runCli(['test', EMPTY_PATTERN, '--fail-on-empty'], dir);
}, RUN_TIMEOUT_MS * 2);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('[#7848] `os test` with a zero-match glob', () => {
  it('exits 0 without the flag — the declared posture, now asserted', () => {
    expect(lenient.code).toBe(0);
  });

  it('exits non-zero with --fail-on-empty', () => {
    expect(strict.code).not.toBe(0);
    expect(strict.code).toBe(1);
  });

  it('prints the machine-readable count on the empty run, in both arms', () => {
    // The number a CI step needs to tell "all suites passed" from "there were
    // no suites" — absent, before this change, from exactly that run.
    expect(lenient.stdout).toContain('Found 0 test suites.');
    expect(strict.stdout).toContain('Found 0 test suites.');
  });

  it('still names the pattern that matched nothing', () => {
    expect(`${lenient.stdout}${lenient.stderr}`).toContain(`No test files found matching: ${EMPTY_PATTERN}`);
  });

  it('says out loud that the zero exit is a posture, not an oversight', () => {
    expect(lenient.stdout).toContain('--fail-on-empty');
  });

  it('states the posture in --help', async () => {
    const help = await runCli(['test', '--help'], dir);
    expect(help.code).toBe(0);
    expect(`${help.stdout}${help.stderr}`).toContain('--fail-on-empty');
    expect(`${help.stdout}${help.stderr}`).toContain('Found 0 test suites.');
  }, RUN_TIMEOUT_MS);
});
