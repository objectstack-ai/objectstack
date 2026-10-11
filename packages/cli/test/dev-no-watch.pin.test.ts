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
 * ⛔ This CLI's refusal prose is not pinned. The spawned cases assert the exit
 * status, the value the failure names, and that nothing was started. The one
 * sentence read verbatim is pnpm's own no-match answer, because on the PACKAGE
 * path it is the refusal itself (`PNPM_NO_PROJECTS` says why).
 *
 * Every spawned assertion carries the child's whole answer as its failure
 * message (`told`): this file runs in a shared merge-queue runner, and a red
 * reading only `expected 1 to be +0` cannot be told apart from pnpm missing, a
 * spawn failure or a killed child.
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

/** One `os dev` child, reported as `execFile` handed it back — never folded into `1`. */
interface Run {
  /**
   * The exit status, `0` on success. `null` when the child has none because a
   * signal ended it (`signal` names which). A string when Node failed the run
   * before any exit status existed: a spawn error (`EAGAIN`, `ENOMEM`,
   * `ENOENT`) or `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`.
   */
  code: number | string | null;
  /** The signal that ended the child, or `null`. */
  signal: NodeJS.Signals | null;
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
          code: err ? (err.code ?? null) : 0,
          signal: err?.signal ?? null,
          out: `${String(stdout)}\n${String(stderr)}`,
        });
      },
    );
  });
}

/** A run spelled out as an assertion's failure message, so a red names its own cause. */
const told = (run: Run): string =>
  `os dev ended with code ${JSON.stringify(run.code)}, signal ${JSON.stringify(run.signal)}; ` +
  `its output (stdout, then stderr):\n${run.out}`;

/** The `✗` line `printError` writes — the one sentence the failure is judged by. */
const failureLine = (out: string): string =>
  out.split('\n').find((line) => line.trimStart().startsWith('✗')) ?? '';

/**
 * pnpm's own answer to a PACKAGE that selects nothing: the refusal itself, and
 * the one line proving pnpm judged the filter. `dev.ts` has no sentence of its
 * own for it (pnpm owns the filter grammar, so `--fail-if-no-match` makes pnpm
 * the one that answers). The `✗` line on that path is the CLI's catch-all for
 * EVERY failure of `pnpm … dev`, and it names `false` only because it echoes
 * the command; with pnpm off `PATH` the child prints that same `✗` line and
 * still exits 1. Measured on pnpm 10.28.0 and 10.31.0 in a directory holding
 * no workspace (`projectDir`'s shape): this line on stdout, exit 1.
 */
const PNPM_NO_PROJECTS = /^No projects found in "/m;

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
    expect(watchEqualsFalse.code, told(watchEqualsFalse)).toBe(1);
  });

  it('and the failure is pnpm refusing the PACKAGE, under a line naming the value that matched nothing', () => {
    expect(watchEqualsFalse.out, told(watchEqualsFalse)).toMatch(PNPM_NO_PROJECTS);
    expect(failureLine(watchEqualsFalse.out), told(watchEqualsFalse)).toMatch(/(^|\s)false(\s|$)/);
  });
});

describe('`--no-watch` where os dev boots no environment is refused, not ignored', () => {
  it('the fixture starts its own dev script when asked — the control', () => {
    expect(bareAtWorkspace.code, told(bareAtWorkspace)).toBe(0);
    expect(bareAtWorkspace.out, told(bareAtWorkspace)).toContain(DEV_SCRIPT_MARK);
  });

  it('exits 1, naming the flag', () => {
    expect(noWatchAtWorkspace.code, told(noWatchAtWorkspace)).toBe(1);
    expect(failureLine(noWatchAtWorkspace.out), told(noWatchAtWorkspace)).toContain('--no-watch');
  });

  it('and starts nothing', () => {
    expect(noWatchAtWorkspace.out, told(noWatchAtWorkspace)).not.toContain(DEV_SCRIPT_MARK);
  });
});
