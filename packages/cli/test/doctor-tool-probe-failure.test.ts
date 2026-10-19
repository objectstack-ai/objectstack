// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24464 — `os doctor`'s environment probes answered "Not found" for every
 * failure. A `pnpm` that is installed and fails when it runs — Corepack unable
 * to fetch the version it resolves, offline, behind a proxy or rate-limited —
 * was reported `✗ pnpm  Not found` with `Install pnpm: npm install -g
 * pnpm@10.28.1`, a fix that does not fix it.
 *
 * Every row below is driven through the real probe (`pnpmCheck` and friends
 * run `execSync('pnpm -v')` through the shell, exactly as `os doctor` does),
 * with a `PATH` this file controls: either a directory with no such tool, or
 * one holding a stub script. The `PATH` holds nothing else, so no real `pnpm`,
 * Corepack or registry can be reached from here — a fixture that spawns a real
 * `pnpm` under Corepack resolves `pnpm@latest` from the public registry.
 *
 * The classifier's measurements (why exit 127 is not the discriminator, and
 * how `cmd.exe` resolves a name on Windows) live in `doctor.ts` above
 * `probeTool`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  COREPACK_FETCH_FIX,
  classifyToolProbeFailure,
  firstMeaningfulLine,
  gitCheck,
  isCorepackFetchFailure,
  isOnShellPath,
  pnpmCheck,
  toolFailedFix,
  typescriptCheck,
} from '../src/commands/doctor';

/** Corepack's 429 answer as an uncaught Node error prints it, measured on Corepack 0.34.0. */
const COREPACK_ERROR_LINE =
  'Error: Server answered with HTTP 429 when performing the request to https://registry.npmjs.org/pnpm/latest; ' +
  'for troubleshooting help, see https://github.com/nodejs/corepack#troubleshooting';
const COREPACK_STDERR = [
  '/usr/lib/node_modules/corepack/dist/lib/corepack.cjs:22058',
  '    throw new Error(',
  '          ^',
  '',
  COREPACK_ERROR_LINE,
  '    at fetch (/usr/lib/node_modules/corepack/dist/lib/corepack.cjs:22058:11)',
  '    at async Object.runMain (/usr/lib/node_modules/corepack/dist/lib/corepack.cjs:23660:7)',
  '',
  'Node.js v22.22.0',
].join('\n');

let root = '';
let empty = '';

/** A directory holding one executable `#!/bin/sh` script named `name`. */
function stubDir(label: string, name: string, body: string[], mode = 0o755): string {
  const dir = join(root, label);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, ['#!/bin/sh', ...body, ''].join('\n'));
  chmodSync(file, mode);
  return dir;
}

/** A stub that writes `text` to stderr and exits `code`. */
function failing(text: string, code: number): string[] {
  return ["cat >&2 <<'STUB_EOF'", text, 'STUB_EOF', `exit ${code}`];
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-doctor-tool-probe-'));
  empty = join(root, 'empty');
  mkdirSync(empty, { recursive: true });
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#24464 — the pnpm probe: "no pnpm on PATH" vs "pnpm ran and failed"', () => {
  it('no pnpm on PATH: today\'s row, message and install fix', () => {
    expect(pnpmCheck({ env: { PATH: empty } })).toEqual({
      name: 'pnpm',
      status: 'error',
      message: 'Not found',
      fix: 'Install pnpm: npm install -g pnpm@10.28.1',
    });
  });

  it('a Corepack pnpm whose registry answers 429: Corepack\'s own error line, and the network / packageManager fix', () => {
    const dir = stubDir('corepack-429', 'pnpm', failing(COREPACK_STDERR, 1));
    const row = pnpmCheck({ env: { PATH: dir } });
    expect(row).toEqual({ name: 'pnpm', status: 'error', message: COREPACK_ERROR_LINE, fix: COREPACK_FETCH_FIX });
    expect(row.fix).not.toBe('Install pnpm: npm install -g pnpm@10.28.1');
  });

  it('any other failure: the child\'s own line, and the neutral "run it and read its error" fix', () => {
    const line = 'ERR_PNPM_UNEXPECTED_STORE  Unexpected store location';
    const dir = stubDir('other-failure', 'pnpm', failing(line, 1));
    expect(pnpmCheck({ env: { PATH: dir } })).toEqual({
      name: 'pnpm',
      status: 'error',
      message: line,
      fix: toolFailedFix('pnpm', 'pnpm -v', 'exited with code 1'),
    });
  });

  it('a pnpm on PATH that exits 127 (its node is missing) ran and failed — 127 is not "Not found"', () => {
    const line = "/usr/bin/env: 'node': No such file or directory";
    const dir = stubDir('exit-127', 'pnpm', failing(line, 127));
    expect(pnpmCheck({ env: { PATH: dir } })).toEqual({
      name: 'pnpm',
      status: 'error',
      message: line,
      fix: toolFailedFix('pnpm', 'pnpm -v', 'exited with code 127'),
    });
  });

  it('a pnpm on PATH that is not executable is found, and the shell\'s refusal is the message', () => {
    const dir = stubDir('not-executable', 'pnpm', ['echo 1.0.0'], 0o644);
    const row = pnpmCheck({ env: { PATH: dir } });
    expect(row.status).toBe('error');
    expect(row.message).toMatch(/Permission denied/);
    expect(row.fix).toMatch(/^pnpm is on PATH, but `pnpm -v` exited with code \d+:/);
  });

  it('a failure with no output names the command and how it ended', () => {
    const dir = stubDir('silent', 'pnpm', ['exit 3']);
    expect(pnpmCheck({ env: { PATH: dir } })).toMatchObject({
      status: 'error',
      message: '`pnpm -v` exited with code 3 with no output',
    });
  });

  it('control: a pnpm that answers is reached and reported as before', () => {
    const dir = stubDir('answers', 'pnpm', ['echo 0.0.0-doctor-probe-stub']);
    expect(pnpmCheck({ env: { PATH: dir } })).toEqual({ name: 'pnpm', status: 'ok', message: 'Version 0.0.0-doctor-probe-stub' });
  });
});

describe('#24464 — the same classifier on the tsc and git probes (message and fix only; still warnings)', () => {
  it('no tsc on PATH: today\'s row', () => {
    expect(typescriptCheck({ env: { PATH: empty } })).toEqual({
      name: 'TypeScript',
      status: 'warning',
      message: 'Not found in PATH',
      fix: 'Installed locally via pnpm',
    });
  });

  it('a tsc on PATH that fails (the npm `tsc` impostor writes to stdout): its line, a warning, the neutral fix', () => {
    const line = 'This is not the tsc command you are looking for';
    const dir = stubDir('tsc-impostor', 'tsc', [`echo "${line}"`, 'exit 1']);
    expect(typescriptCheck({ env: { PATH: dir } })).toEqual({
      name: 'TypeScript',
      status: 'warning',
      message: line,
      fix: toolFailedFix('tsc', 'tsc -v', 'exited with code 1'),
    });
  });

  it('no git on PATH: today\'s row', () => {
    expect(gitCheck({ env: { PATH: empty } })).toEqual({
      name: 'Git',
      status: 'warning',
      message: 'Not found',
      fix: 'Install Git for version control',
    });
  });

  it('a git on PATH that fails (the macOS stub without its developer tools): its line, a warning, the neutral fix', () => {
    const line = 'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun';
    const dir = stubDir('git-xcrun', 'git', failing(line, 1));
    expect(gitCheck({ env: { PATH: dir } })).toEqual({
      name: 'Git',
      status: 'warning',
      message: line,
      fix: toolFailedFix('git', 'git --version', 'exited with code 1'),
    });
  });
});

describe('#24464 — the PATH lookup mirrors cmd.exe on win32 (not measured on a Windows host)', () => {
  const PATHEXT = '.COM;.EXE;.BAT;.CMD';

  it('finds `pnpm.cmd` on `Path`, which a plain env object spells case-sensitively', () => {
    const dir = stubDir('win-cmd', 'pnpm.cmd', ['exit 0']);
    expect(isOnShellPath('pnpm', { platform: 'win32', cwd: empty, env: { Path: `${empty};${dir}`, PATHEXT } })).toBe(true);
  });

  it('never counts an extensionless `pnpm`, which cmd.exe does not run (POSIX does)', () => {
    const dir = stubDir('win-bare', 'pnpm', ['exit 0']);
    expect(isOnShellPath('pnpm', { platform: 'win32', cwd: empty, env: { Path: dir, PATHEXT } })).toBe(false);
    expect(isOnShellPath('pnpm', { platform: 'linux', cwd: empty, env: { PATH: dir } })).toBe(true);
  });

  it('searches the current directory first', () => {
    const dir = stubDir('win-cwd', 'pnpm.cmd', ['exit 0']);
    expect(isOnShellPath('pnpm', { platform: 'win32', cwd: dir, env: { Path: '', PATHEXT } })).toBe(true);
  });

  it('cmd.exe\'s exit-1 "is not recognized" is "not found" when no candidate exists, and a failure when one does', () => {
    const notRecognized = {
      status: 1,
      stdout: '',
      stderr: "'pnpm' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n",
    };
    expect(
      classifyToolProbeFailure('pnpm -v', 'pnpm', notRecognized, { platform: 'win32', cwd: empty, env: { Path: empty, PATHEXT } }),
    ).toEqual({ outcome: 'not-found' });

    const dir = stubDir('win-corepack', 'pnpm.cmd', ['exit 0']);
    const corepack = { status: 1, stdout: '', stderr: COREPACK_STDERR.replace(/\n/g, '\r\n') };
    expect(
      classifyToolProbeFailure('pnpm -v', 'pnpm', corepack, { platform: 'win32', cwd: empty, env: { Path: dir, PATHEXT } }),
    ).toMatchObject({ outcome: 'failed', detail: COREPACK_ERROR_LINE, exit: 'exited with code 1' });
  });
});

describe('#24464 — reading the failed child', () => {
  it('an uncaught Node error\'s `Error:` line is preferred over its `<file>:<line>` header', () => {
    expect(firstMeaningfulLine(COREPACK_STDERR)).toBe(COREPACK_ERROR_LINE);
    expect(firstMeaningfulLine('\n  /bin/sh: 1: pnpm: Permission denied\n')).toBe('/bin/sh: 1: pnpm: Permission denied');
    expect(firstMeaningfulLine('\n \n')).toBeUndefined();
  });

  it('Corepack\'s fetch failures are told apart from its other refusals', () => {
    expect(isCorepackFetchFailure(COREPACK_STDERR)).toBe(true);
    expect(isCorepackFetchFailure("Network access disabled by the environment; can't reach npm repository https://registry.npmjs.org\n")).toBe(true);
    expect(
      isCorepackFetchFailure('Usage Error: This project is configured to use yarn because /p/package.json has a "packageManager" field\n'),
    ).toBe(false);
    expect(isCorepackFetchFailure('Error when performing the request to http://example.test/x\n')).toBe(false);
  });
});
