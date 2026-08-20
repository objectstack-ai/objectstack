// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#10111, carved from #10087) — what a SHELL sees when the CLI is invoked
 * wrongly, which is the only thing either failure was ever judged by.
 *
 * Measured on `main` before this change, in a checklist run that was booting
 * the showcase app:
 *
 * ```
 * $ node packages/cli/dist/index.js
 * $ echo $?
 * 0                          # ...and not one byte on stdout or stderr
 *
 * $ objectstack dev --no-ui
 * Error: Nonexistent flag: --no-ui
 * See more help with --help
 *                            # followed by the full USAGE/FLAGS/ARGUMENTS dump
 * ```
 *
 * Backgrounded — which is how a runner boots a server — both read as a server
 * that came up and died: the process is gone, nothing is listening, and the one
 * sentence that would have said otherwise either does not exist or has scrolled
 * past. The measured cost was a boot cycle spent debugging the APPLICATION.
 *
 * So the assertions here are about the shell's view, not the module's:
 *
 *   • a real child process, because `process.exitCode` inside a vitest worker
 *     is not an exit status — the number a runner reads only exists once node
 *     has exited (the reason `qa-empty-glob-exit-code.e2e.test.ts` spawns too);
 *   • the FIRST line of stderr, because a backgrounded log is skimmed. "It is
 *     somewhere in the output" is the property the usage dump already had;
 *   • spawned through `bin/run-dev.js` + tsx, so the suite does not depend on
 *     `packages/cli/dist` having been built — `@objectstack/cli#test` depends on
 *     `^build` only, so this package's own `dist/` may legitimately be absent.
 *
 * ⛔ Not asserted, because it is out of scope and stays that way: that `dev`
 * ACCEPTS `--no-ui`. It does not, and this change does not add it. `serve`
 * declares its `ui` flag with `allowNo: true` and `dev` does not — reconciling
 * those two is a flag-surface decision, not a diagnosability one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const BIN = resolve(HERE, '../bin/run.js');
const CLI = resolve(HERE, '../bin/run-dev.js');
const BARREL = resolve(HERE, '../src/index.ts');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold start, with every command module loaded; ~2-10 s when healthy. */
const RUN_TIMEOUT_MS = 180_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runTsx(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      args,
      { cwd, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; null/undefined means the child
          // was signalled — a different failure, never reported as 0.
          code: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as unknown as { code: number }).code
              : 1
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

const firstLine = (text: string): string => text.split('\n')[0] ?? '';

let dir: string;
let linkDir: string;
let barrel: Run;
let barrelViaSymlink: Run;
let unknownFlag: Run;
let version: Run;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-invocation-e2e-'));
  linkDir = mkdtempSync(join(tmpdir(), 'os-invocation-link-'));
  const link = join(linkDir, 'index.ts');
  symlinkSync(BARREL, link);

  // Sequential on purpose: four cold tsx starts, each loading every command
  // module, in a container several agents share.
  barrel = await runTsx([BARREL], dir);
  barrelViaSymlink = await runTsx([link], dir);
  unknownFlag = await runTsx([CLI, 'dev', '--no-ui'], dir);
  version = await runTsx([CLI, '--version'], dir);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(linkDir, { recursive: true, force: true });
});

describe('[#10111] the package `main` run as if it were the CLI', () => {
  it('no longer exits 0 with zero output — the measured defect, inverted', () => {
    expect(barrel.code).not.toBe(0);
    expect(barrel.stderr.trim()).not.toBe('');
  });

  it('exits 1', () => {
    expect(barrel.code).toBe(1);
  });

  it('leads with one line saying this file starts nothing', () => {
    expect(firstLine(barrel.stderr)).toContain('objectstack: NOT A CLI ENTRY POINT');
    expect(firstLine(barrel.stderr)).toContain('starts nothing');
  });

  it('names the real entry point', () => {
    expect(barrel.stderr).toContain(BIN);
  });

  it('says it on stderr, leaving stdout clean for the pipelines that read it', () => {
    expect(barrel.stdout).toBe('');
  });

  it('fails the SAME way through a symlink — the #10086 hole, closed', () => {
    // Every `invokedDirectly` spelling in `scripts/` answers false here, which
    // turns the guard back into the silent exit-0 no-op it exists to remove.
    expect(barrelViaSymlink.code).toBe(1);
    expect(firstLine(barrelViaSymlink.stderr)).toContain('objectstack: NOT A CLI ENTRY POINT');
  });
});

describe('[#10111] an unknown flag on `dev`', () => {
  it('still fails — no flag surface was widened', () => {
    expect(unknownFlag.code).not.toBe(0);
    expect(unknownFlag.stderr).toContain('Nonexistent flag: --no-ui');
  });

  it('puts ONE unmistakable line FIRST on stderr, ahead of the usage dump', () => {
    const line = firstLine(unknownFlag.stderr);
    expect(line).toContain('objectstack: INVOCATION ERROR');
    expect(line).toContain('Nonexistent flag: --no-ui');
    expect(line).toContain('The command never ran');
  });

  it('attributes the failure to the invocation, not to a server that died', () => {
    expect(firstLine(unknownFlag.stderr)).toContain('nothing is listening');
    expect(firstLine(unknownFlag.stderr)).toContain('Invoked as: objectstack dev --no-ui');
  });

  it('keeps stdout empty', () => {
    expect(unknownFlag.stdout).toBe('');
  });
});

describe('[#10111] the success path the shims kept', () => {
  it('`--version` still exits 0 with the version on stdout and nothing added to stderr', () => {
    // The shims now inline what `execute()` did instead of calling it, so the
    // path that does NOT fail has to be pinned too.
    expect(version.code).toBe(0);
    expect(version.stdout).toContain('@objectstack/cli');
    expect(version.stderr).not.toContain('INVOCATION ERROR');
  });
});
