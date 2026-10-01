// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A signal to `os start` takes its `serve` child down with it (#21114).
 *
 * ## The defect, as measured on `origin/main` before the repair
 *
 * `os start` is a supervisor: it spawns `os serve` as a SEPARATE process and
 * then waits. It listened for the child's `exit` and nothing else, so a SIGTERM
 * sent to the `start` pid alone (a plain `kill`, a CI step, a process manager)
 * ended the parent and left the child running, reparented to init, with its
 * port still bound and `/health` still answering 200. `os dev` never had the
 * defect: its `ServeRestartCoordinator` forwards SIGINT / SIGTERM to the child
 * and reaps the child when the parent exits.
 *
 * The repair is that `start` supervises its child through that SAME
 * coordinator, so there is one forwarding mechanism in the CLI, not two.
 *
 * ## What is asserted
 *
 * The ruling's pin, literally: a SIGTERM (and a SIGINT) to the PARENT leaves no
 * child process and a free port. `os dev`, booted on the same artifact and sent
 * the same signal, is the control: it states that the instrument reads the
 * shipped mechanism correctly, and that `dev`'s behaviour did not move.
 *
 * Both readings carry a positive control taken on the same boot before the
 * signal: the probe sees the child ALIVE and the port BOUND. Without that, "no
 * child" passes on a probe that cannot see children at all, and "port free"
 * passes on a child that bound somewhere else.
 *
 * ⛔ The signal goes to the parent's pid ALONE, never to its process group. A
 * group signal reaches the child directly and passes whether or not the parent
 * forwards anything — it is the shape that HID this defect (the neighbouring
 * `start-port-banner-agreement.e2e.test.ts` documents why it kills the group,
 * and for its purpose it is right to).
 *
 * ## Spawn shape
 *
 * The SOURCE entry, `bin/run-dev.js`, under the tsx loader passed as an
 * `--import` flag — never the `tsx` CLI, which spawns the script as a child of
 * its own and relays signals to it, so the pid this file signals would be tsx's
 * rather than the command's. Loaded this way the spawned pid IS the `os start` /
 * `os dev` parent, and the `serve` process is its direct child.
 *
 * The subject is the supervisor's wiring in `src/commands/start.ts`, which the
 * built entry runs byte for byte from `dist/`, so the source entry measures the
 * same code without a build prerequisite. The `development` posture it pins
 * re-opens `serve`'s port auto-shift; that is harmless here because the port is
 * read back out of the child's own banner (`boundPortFromBanner`) rather than
 * assumed from what this file asked for. The built entry was measured too, by
 * hand, before and after the repair (the PR that landed this records both).
 *
 * Each child gets its own process group (`detached: true`) so `afterEach` can
 * still SIGKILL a survivor — which is exactly what the unrepaired command
 * leaves behind — instead of leaking it into the container.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import {
  childEnv,
  boundPortFromBanner,
  portIsFree,
  reservePort,
} from './helpers/serve-process.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_DEV_JS = resolve(HERE, '../bin/run-dev.js');
const TSX_LOADER = resolve(HERE, '../../../node_modules/tsx/dist/loader.mjs');

/** The banner tail `printServerReady` ends with — the boot is fully printed. */
const BANNER_TAIL = /Press Ctrl\+C to stop/;

const BOOT_TIMEOUT_MS = 180_000;
/** The kernel's graceful shutdown, plus event-loop delivery of the exit. */
const EXIT_TIMEOUT_MS = 60_000;

/** A minimal but real compiled artifact, booted identically by both commands. */
const ARTIFACT = JSON.stringify({
  manifest: {
    id: 'com.example.signals',
    name: 'signals',
    version: '1.0.0',
    type: 'app',
    engines: { protocol: `^${PROTOCOL_MAJOR}` },
  },
  objects: [
    { name: 'sig_note', label: 'Note', fields: { name: { type: 'text', label: 'Name' } } },
  ],
  views: [],
  apps: [],
  flows: [],
  requires: [],
});

type Command = 'start' | 'dev';

/** The argv that boots `command` on `artifact` at `port`, with no Console. */
function argvFor(command: Command, artifact: string, port: number): string[] {
  // `start` declares `--ui` with `allowNo` (default on); `dev` declares it
  // default-off and rejects `--no-ui`. Both therefore boot without a Console.
  return command === 'start'
    ? ['start', '--artifact', artifact, '--port', String(port), '--no-ui']
    : ['dev', '--artifact', artifact, '--port', String(port)];
}

/**
 * The pids of `ppid`'s `serve` children, read from the process table — a child
 * whose argv carries the `serve` command token.
 *
 * ⚠️ Selected by argv, not "every child", and MEASURED to need it: on a cold
 * tsx transform cache the loader runs an `esbuild --service` process as a
 * second child of the CLI parent. It exits on its own a moment AFTER the parent
 * (alive at the parent's exit, gone 2 s later, 2 of 2 runs with
 * `TSX_DISABLE_CACHE=1`), so counting it reads as an orphaned server on the
 * file's first boot and on no other. The ruling's sentence is about the
 * `serve` child, and so is this probe. `-ww` keeps BSD `ps` from cutting the
 * argv at a terminal width.
 */
function serveChildPidsOf(ppid: number): number[] {
  const table = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args='], {
    encoding: 'utf8',
    env: childEnv(),
  });
  return table
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([pid, parent, ...args]) =>
      Number.isInteger(Number(pid)) && Number(parent) === ppid && args.includes('serve'))
    .map(([pid]) => Number(pid));
}

/** Does `pid` name a live process? (`EPERM` = alive, owned by someone else.) */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** SIGKILL a whole process group — the survivor sweep, never the measurement. */
const killGroup = (child: ChildProcess | undefined): void => {
  if (child?.pid === undefined) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
};

interface Exit { code: number | null; signal: NodeJS.Signals | null }

interface Booted {
  parent: ChildProcess;
  port: number;
  output: () => string;
  exited: Promise<Exit>;
}

let running: ChildProcess | undefined;
let workdir: string | undefined;

afterEach(() => {
  killGroup(running);
  running = undefined;
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = undefined;
});

/** Boot a real `os <command>` and resolve once its child printed the ready banner. */
function boot(command: Command): Promise<Booted> {
  const dir = mkdtempSync(join(tmpdir(), `os-${command}-signal-`));
  workdir = dir;
  const artifact = join(dir, 'objectstack.json');
  writeFileSync(artifact, ARTIFACT);
  const port = reservePort();

  return new Promise((resolveBoot, rejectBoot) => {
    const parent = spawn(
      process.execPath,
      ['--import', TSX_LOADER, RUN_DEV_JS, ...argvFor(command, artifact, port)],
      {
        cwd: dir,
        env: childEnv({
          NO_COLOR: '1',
          OS_HOME: join(dir, 'home'),
          OS_LOG_LEVEL: 'error',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    );
    running = parent;

    let output = '';
    let ready = false;
    const exited = new Promise<Exit>((settle) => {
      parent.once('exit', (code, signal) => settle({ code, signal }));
    });

    const timer = setTimeout(() => {
      if (ready) return;
      rejectBoot(new Error(`os ${command} never printed a complete banner.\n--- output ---\n${output}`));
    }, BOOT_TIMEOUT_MS);

    const onData = (d: unknown) => {
      output += String(d);
      if (!ready && BANNER_TAIL.test(output)) {
        ready = true;
        clearTimeout(timer);
        const readback = boundPortFromBanner(output);
        if (readback.state !== 'bound') {
          rejectBoot(new Error(`os ${command}: banner unreadable (${readback.state}).\n--- output ---\n${output}`));
          return;
        }
        resolveBoot({ parent, port: readback.port, output: () => output, exited });
      }
    };
    parent.stdout?.on('data', onData);
    parent.stderr?.on('data', onData);
    parent.on('error', (err) => { clearTimeout(timer); rejectBoot(err); });
    void exited.then(({ code, signal }) => {
      if (ready) return;
      clearTimeout(timer);
      rejectBoot(new Error(
        `os ${command} exited (${signal ?? code}) before its banner.\n--- output ---\n${output}`,
      ));
    });
  });
}

/** Signal the parent alone, then read what is left of its child and its port. */
async function signalParent(command: Command, signal: NodeJS.Signals): Promise<void> {
  const { parent, port, output, exited } = await boot(command);
  const parentPid = parent.pid!;

  // ── Positive controls, on the same boot, before the signal ─────────────
  const children = serveChildPidsOf(parentPid);
  expect(children, `os ${command}: the probe does not see exactly one serve child.\n${output()}`)
    .toHaveLength(1);
  expect(children.every(isAlive), `os ${command}: a child reads dead before the signal`).toBe(true);
  expect(portIsFree(port), `os ${command}: port ${port} reads free while the server is up`).toBe(false);

  // ── The measurement: the PARENT's pid alone, never its group ───────────
  process.kill(parentPid, signal);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const fate = await Promise.race([
    exited,
    new Promise<'timeout'>((settle) => { timer = setTimeout(() => settle('timeout'), EXIT_TIMEOUT_MS); }),
  ]);
  clearTimeout(timer);
  expect(fate, `os ${command} did not exit within ${EXIT_TIMEOUT_MS}ms of ${signal}.\n${output()}`)
    .not.toBe('timeout');

  // Soft, both: the two readings are independent facts, and a regression
  // should report each of them rather than stop at the first.
  expect.soft(
    children.filter(isAlive),
    `os ${command}: ${signal} to the parent left its serve child running (orphaned, ` +
      `reparented to init).\n--- output ---\n${output()}`,
  ).toEqual([]);
  expect.soft(
    portIsFree(port),
    `os ${command}: ${signal} to the parent left port ${port} bound.\n--- output ---\n${output()}`,
  ).toBe(true);
}

describe('a signal to the CLI parent takes its `serve` child down with it', () => {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    it(
      `os start: ${signal} to the parent leaves no child process and a free port`,
      () => signalParent('start', signal),
      BOOT_TIMEOUT_MS + EXIT_TIMEOUT_MS + 30_000,
    );

    it(
      `os dev (control): ${signal} to the parent leaves no child process and a free port`,
      () => signalParent('dev', signal),
      BOOT_TIMEOUT_MS + EXIT_TIMEOUT_MS + 30_000,
    );
  }
});
