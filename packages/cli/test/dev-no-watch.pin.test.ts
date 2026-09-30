// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#20681) — `os dev`'s watch opt-out is reachable, and the argv that used
 * to miss it fails instead of exiting 0.
 *
 * Measured on `main` before this change, through the source entry
 * (`tsx bin/run-dev.js`), in a directory holding an `objectstack.config.ts`:
 *
 * ```
 * $ os dev --no-watch
 * Error: Nonexistent flag: --no-watch        # exit 2
 *
 * $ os dev --watch=false
 * 📦 Package: false
 * 🔄 Watch: enabled
 * $ pnpm --filter false dev
 * No projects found in "…"                   # exit 0, nothing started
 * ```
 *
 * The first because `watch` declared no `allowNo`. The second because a boolean
 * flag has no `=value` spelling in oclif — `--watch=false` parses as `--watch`
 * plus the PACKAGE positional `false` — and pnpm exits 0 on a filter that
 * selects nothing.
 *
 * Two halves, two instruments:
 *
 *   • the opt-out is a PARSE-AND-DECIDE fact: oclif's own parser over the
 *     command's real declarations, fed into the one decision the watch loop
 *     reads (`devWatchActive`). Observing the watcher's absence on a real boot
 *     costs a full kernel boot per case and proves nothing further;
 *   • the loud failures are SHELL facts: an exit status only exists once a real
 *     child has exited (the reason `invocation-loudness.e2e.test.ts` spawns), so
 *     those cases spawn the source entry — which is what puts this file in the
 *     `integration` tier (`vitest-tiers.ts`).
 *
 * ⛔ Refusal prose is not pinned. The spawned cases assert the exit status, the
 * value the failure names, and that nothing was started.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from '@oclif/core';
import Dev, { devWatchActive } from '../src/commands/dev.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold start, with every command module loaded; ~2-10 s when healthy. */
const RUN_TIMEOUT_MS = 180_000;

/** What the fixture workspace's own `dev` script prints — proof it ran. */
const DEV_SCRIPT_MARK = 'DEV-SCRIPT-RAN';

const parseDev = (argv: string[]) =>
  Parser.parse(argv, { flags: Dev.flags, args: Dev.args, strict: true });

interface Run {
  code: number;
  out: string;
}

function runDev(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, 'dev', ...args],
      { cwd, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; a signalled child has none and
          // is reported as a failure, never as 0.
          code: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as unknown as { code: number }).code
              : 1
            : 0,
          out: `${String(stdout)}\n${String(stderr)}`,
        });
      },
    );
  });
}

/** The `✗` line `printError` writes — the one sentence the failure is judged by. */
const failureLine = (out: string): string =>
  out.split('\n').find((line) => line.trimStart().startsWith('✗')) ?? '';

describe('the watch opt-out is reachable', () => {
  it('`os dev --no-watch` parses, and the boot it describes runs no watcher', async () => {
    const { flags } = await parseDev(['--no-watch']);
    expect(flags.watch).toBe(false);
    expect(devWatchActive({ watch: flags.watch, artifact: flags.artifact, configExists: true })).toBe(false);
  });

  it('bare `os dev` keeps watch on', async () => {
    const { flags } = await parseDev([]);
    expect(flags.watch).toBe(true);
    expect(devWatchActive({ watch: flags.watch, artifact: flags.artifact, configExists: true })).toBe(true);
  });

  it('`--watch=false` is still NOT an off spelling — it parses as the PACKAGE `false`', async () => {
    // Why the orchestration half below exists: oclif gives a boolean flag no
    // `=value` form, so this argv reaches the monorepo branch with a package
    // name, not the single-environment boot with watch off.
    const { flags, args } = await parseDev(['--watch=false']);
    expect(flags.watch).toBe(true);
    expect(args.package).toBe('false');
  });
});

let projectDir: string;
let workspaceDir: string;
let watchEqualsFalse: Run;
let noWatchAtWorkspace: Run;
let bareAtWorkspace: Run;

beforeAll(async () => {
  // A project directory: a config file, and no pnpm workspace above it.
  projectDir = mkdtempSync(join(tmpdir(), 'os-dev-no-watch-project-'));
  writeFileSync(join(projectDir, 'objectstack.config.ts'), 'export default {};\n');

  // A workspace root whose own `dev` script announces that it ran — so the
  // `--no-watch` refusal below is measured against a fixture that DOES start
  // something when asked (`bareAtWorkspace` is that control).
  workspaceDir = mkdtempSync(join(tmpdir(), 'os-dev-no-watch-workspace-'));
  writeFileSync(join(workspaceDir, 'pnpm-workspace.yaml'), 'packages: []\n');
  writeFileSync(
    join(workspaceDir, 'package.json'),
    `${JSON.stringify({
      name: 'os-dev-no-watch-fixture',
      private: true,
      scripts: { dev: `node -e "console.log('${DEV_SCRIPT_MARK}')"` },
    })}\n`,
  );

  // Sequential on purpose: three cold tsx starts, each loading every command
  // module, in a container several agents share.
  watchEqualsFalse = await runDev(['--watch=false'], projectDir);
  noWatchAtWorkspace = await runDev(['--no-watch'], workspaceDir);
  bareAtWorkspace = await runDev([], workspaceDir);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe('a PACKAGE that selects no workspace project fails', () => {
  it('`os dev --watch=false` exits 1 instead of 0', () => {
    expect(watchEqualsFalse.code).toBe(1);
  });

  it('and the failure names the value that matched nothing', () => {
    expect(failureLine(watchEqualsFalse.out)).toMatch(/(^|\s)false(\s|$)/);
  });
});

describe('`--no-watch` where os dev boots no environment is refused, not ignored', () => {
  it('the fixture starts its own dev script when asked — the control', () => {
    expect(bareAtWorkspace.code).toBe(0);
    expect(bareAtWorkspace.out).toContain(DEV_SCRIPT_MARK);
  });

  it('exits 1, naming the flag', () => {
    expect(noWatchAtWorkspace.code).toBe(1);
    expect(failureLine(noWatchAtWorkspace.out)).toContain('--no-watch');
  });

  it('and starts nothing', () => {
    expect(noWatchAtWorkspace.out).not.toContain(DEV_SCRIPT_MARK);
  });
});
