// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A SIGTERM to `os start` leaves nothing of its process group behind when
 * `start` exits (#34337).
 *
 * ## The defect, as measured on `origin/main` before the repair
 *
 * `start` forwards a SIGTERM to its `serve` child and exits with the child's
 * code once the child has exited (`ServeRestartCoordinator`, pinned by
 * `start-signal-forwarding.e2e.test.ts`). That half was never in question. On
 * a CONFIG project, though, `serve` bundles `objectstack.config.ts` with
 * esbuild, and esbuild serves its async API from a child process of its own
 * (`esbuild --service`) that stays for the life of `serve` and leaves only
 * after `serve` has gone. So when `start` exited, a member of its process group
 * was still in the process table. Measured on the built entry, SIGTERM to the
 * `start` pid alone: exit 0 at +66 ms, `[esbuild]` still in the group; the
 * cloud multi-replica drill read the same (exit 0 at +114 ms and +83 ms, its
 * `kill(-pid, 0)` succeeding after the exit).
 *
 * ## What is asserted
 *
 * The drill's own instrument: `process.kill(-pgid, 0)` read in `start`'s exit
 * handler answers ESRCH, i.e. no process of the group is left. The exit code is
 * the child's (0, a graceful kernel shutdown).
 *
 * Positive control on the same boot, before the signal: the process-table probe
 * sees `start` AND its `serve` child in the group, so "nothing left" cannot pass
 * on a probe that cannot see the group's members.
 *
 * ⛔ The signal goes to the `start` pid ALONE, never to its group: a group
 * signal reaches every member directly and hides what `start` does.
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset — the shipped entry, resolving commands
 * from `dist/` (`requireBuiltCli`). The source entry is not used: it runs under
 * tsx, whose own esbuild service is a child of the `start` parent and would be
 * read as the defect. The project is a `defineStack` config (not an artifact),
 * because the bundler only runs when there is a config to bundle. `start` is
 * spawned `detached`, so it leads its own process group and `afterEach` can
 * SIGKILL whatever a regression leaves.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
  KERNEL_ASSIGNED_PORT,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;
/** The kernel's graceful shutdown, plus event-loop delivery of the exit. */
const EXIT_TIMEOUT_MS = 60_000;

const STACK = {
  manifest: { id: 'com.example.pgrp', namespace: 'pgrp', version: '1.0.0', type: 'app', name: 'Pgrp' },
  objects: [{
    name: 'pgrp_note',
    label: 'Note',
    pluralLabel: 'Notes',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};

/** The members of process group `pgid`, read from the process table (zombies included). */
function groupMembers(pgid: number): string[] {
  const table = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,pgid=,args='], {
    encoding: 'utf8',
    env: childEnv(),
  });
  return table
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && Number(line.split(/\s+/)[1]) === pgid);
}

/** `kill(-pgid, 0)`: does any process of the group still exist? */
function groupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

let running: ChildProcess | undefined;
let workdir: string | undefined;

afterEach(() => {
  if (running?.pid !== undefined) {
    try { process.kill(-running.pid, 'SIGKILL'); } catch { /* group already gone */ }
  }
  running = undefined;
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = undefined;
});

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Read in the exit handler itself, before anything else runs. */
  groupLeft: boolean;
  members: string[];
}

describe('os start on SIGTERM', () => {
  it(
    'exits with its serve child\'s code and leaves no process of its group behind',
    async () => {
      requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
      const dir = mkdtempSync(join(tmpdir(), 'os-34337-project-'));
      workdir = dir;
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pgrp-host', private: true }));
      writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSource(STACK));
      linkSpec(dir);

      const parent = spawn(process.execPath, [CLI, 'start', '--port', KERNEL_ASSIGNED_PORT, '--no-ui'], {
        cwd: dir,
        env: childEnv({
          NO_COLOR: '1',
          OS_HOME: join(dir, '.home'),
          OS_LOG_LEVEL: 'error',
          OS_CLOUD_URL: 'off',
          OS_DATABASE_URL: undefined,
          OS_ARTIFACT_URL: undefined,
          OS_ARTIFACT_PATH: undefined,
          OS_CLUSTER_DRIVER: undefined,
          OS_MODE: undefined,
          NODE_ENV: undefined,
          OS_PORT: undefined,
          PORT: undefined,
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      running = parent;
      const pgid = parent.pid!;

      let output = '';
      const exited = new Promise<Exit>((settle) => {
        parent.once('exit', (code, signal) => {
          // The reading the drill took: right at the exit, before anything else.
          const groupLeft = groupExists(pgid);
          settle({ code, signal, groupLeft, members: groupLeft ? groupMembers(pgid) : [] });
        });
      });

      await new Promise<void>((booted, failed) => {
        const timer = setTimeout(
          () => failed(new Error(`os start never printed its banner.\n--- output ---\n${output.slice(-4000)}`)),
          BOOT_TIMEOUT_MS,
        );
        const onData = (d: unknown) => {
          output += String(d);
          if (READY.test(output)) { clearTimeout(timer); booted(); }
        };
        parent.stdout?.on('data', onData);
        parent.stderr?.on('data', onData);
        void exited.then(({ code, signal }) => {
          clearTimeout(timer);
          failed(new Error(`os start exited (${signal ?? code}) before its banner.\n--- output ---\n${output.slice(-4000)}`));
        });
      });

      // ── Positive control: the probe sees start AND its serve child ───────
      const before = groupMembers(pgid);
      expect(before.some((l) => /\bstart\b/.test(l)), `the probe does not see start:\n${before.join('\n')}`).toBe(true);
      expect(before.some((l) => /\bserve\b/.test(l)), `the probe does not see the serve child:\n${before.join('\n')}`).toBe(true);

      // ── The measurement: the start pid ALONE, never its group ──────────────
      process.kill(pgid, 'SIGTERM');

      let timer: ReturnType<typeof setTimeout> | undefined;
      const fate = await Promise.race([
        exited,
        new Promise<'timeout'>((settle) => { timer = setTimeout(() => settle('timeout'), EXIT_TIMEOUT_MS); }),
      ]);
      clearTimeout(timer);
      if (fate === 'timeout') throw new Error(`os start did not exit within ${EXIT_TIMEOUT_MS}ms of SIGTERM.\n${output.slice(-4000)}`);

      expect.soft(fate.code, `os start exited with ${fate.signal ?? fate.code}, not its serve child's code.\n${output.slice(-3000)}`).toBe(0);
      expect.soft(
        fate.members,
        'processes of the start process group were still alive when start exited ' +
          `(before the signal the group was:\n${before.join('\n')})`,
      ).toEqual([]);
      expect(fate.groupLeft, 'kill(-pgid, 0) still found a member of the start process group at its exit').toBe(false);
    },
    BOOT_TIMEOUT_MS + EXIT_TIMEOUT_MS + 30_000,
  );
});
