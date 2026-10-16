// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os start` and `os create` refuse a directory that can never be made at
 * once, naming the path and the operating system's code, instead of hanging
 * in Node's recursive mkdir (#23858).
 *
 * ## The defect, measured on `origin/main` 0744f94366 (built CLI, Node v22.22.0)
 *
 * Node's recursive mkdir loops `mkdir("/proc/x") = ENOENT`, `mkdir("/proc") =
 * EEXIST`, retry, without end, and the synchronous form holds the event loop:
 *
 *   - `OS_HOME=/proc/os-23858-home os start` printed its header and nothing
 *     else: 168,465 failing `mkdir` calls in 20 s under `strace`, killed at
 *     the bound. That is the operator-state class (`--home` / `OS_HOME`).
 *   - `os create plugin foo --dir /proc/os-23858-cr/foo` printed its
 *     `Location:` row and hung the same way: 889,246 failing calls in 20 s.
 *     That is the author-chosen output-path class (`--dir`, `--out`,
 *     `--output`).
 *
 * ## Why every run is a bounded child of the BUILT entry
 *
 * A regression would hang, not fail. Each command runs in its own process
 * group with a hard SIGKILL of the whole group at `CHILD_BOUND_MS`, so a
 * reintroduced loop fails this file at the bound instead of hanging the suite.
 * `bin/run.js` with `NODE_ENV` unset is the entry an operator runs, and it
 * starts in about 3 s where the tsx source entry takes about 10 s, so the four
 * children (run concurrently) keep this file under the 10 s line.
 *
 * ## What is asserted — kind, exit code and named subject, never the prose
 *
 *   1. `os start` under `OS_HOME=/proc/<missing>`: settles inside the bound,
 *      exits 1, and its output names that path and `ENOENT`.
 *   2. CONTROL: `os start` under a creatable `OS_HOME` three levels deep makes
 *      `<home>/data` and goes on to its next refusal. `--port 70000` is that
 *      refusal: start's own invalid-port door, AFTER the home step and BEFORE
 *      any `serve` child, so no leg of this file ever boots a server. The
 *      `/proc` leg passes it too, for the same reason.
 *   3. `os create plugin --dir /proc/<missing>/foo`: settles, exits 1, names the
 *      path and `ENOENT`.
 *   4. CONTROL: `os create plugin --dir <tmp>/a/b/foo` exits 0 and writes the
 *      project.
 *
 * They need a `/proc` that refuses `mkdir` with ENOENT, so the `/proc` legs
 * run where `/proc/self` exists (Linux, which CI is).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_JS_RESOLVES_FROM_DIST, requireBuiltCli } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const RUN_JS = resolve(HERE, '../bin/run.js');

/** Each child's whole budget; the loop it guards against never ends. */
const CHILD_BOUND_MS = 60_000;

/** Start's own invalid-port refusal — after the home step, before any child. */
const UNSERVABLE_PORT = '70000';

const RUNS_PROC = existsSync('/proc/self');
const PROC_TOP = `/proc/os-23858-${process.pid}`;

interface Run {
  code: number | null;
  signal: NodeJS.Signals | null;
  killedAtBound: boolean;
  output: string;
}

let workdir: string;
const runs = new Map<string, Run>();

/** Run the built CLI in its own process group, killed whole at the bound. */
function runCli(args: string[], env: Record<string, string>): Promise<Run> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [RUN_JS, ...args], {
      cwd: workdir,
      detached: true,
      // Declared in full: no vitest worker variables, a HOME of this file's
      // own, and `NODE_ENV` unset — the built entry must resolve `dist/`.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(workdir, 'user-home'),
        NO_COLOR: '1',
        ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
        NODE_ENV: undefined,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    let killedAtBound = false;
    const timer = setTimeout(() => {
      killedAtBound = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
    }, CHILD_BOUND_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      resolveRun({ code, signal, killedAtBound, output });
    });
  });
}

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  workdir = mkdtempSync(join(tmpdir(), 'os-23858-doors-'));
  const legs: Array<[string, Promise<Run>]> = [
    ['start-control', runCli(['start', '-p', UNSERVABLE_PORT], { OS_HOME: join(workdir, 'home', 'a', 'b', 'c') })],
    ['create-control', runCli(['create', 'plugin', 'foo', '--dir', join(workdir, 'create', 'a', 'b', 'foo')], {})],
  ];
  if (RUNS_PROC) {
    legs.push(
      ['start-proc', runCli(['start', '-p', UNSERVABLE_PORT], { OS_HOME: `${PROC_TOP}-home` })],
      ['create-proc', runCli(['create', 'plugin', 'foo', '--dir', `${PROC_TOP}-cr/foo`], {})],
    );
  }
  const settled = await Promise.all(legs.map(([, p]) => p));
  legs.forEach(([label], i) => runs.set(label, settled[i]));
}, CHILD_BOUND_MS + 30_000);

afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

function runOf(label: string): Run {
  const run = runs.get(label);
  if (!run) throw new Error(`no run recorded for '${label}'`);
  if (run.killedAtBound) {
    throw new Error(
      `'${label}' had not settled after ${CHILD_BOUND_MS} ms and was killed — a directory prep is looping again. ` +
        `output tail: ${run.output.slice(-1500)}`,
    );
  }
  return run;
}

describe('a directory that can never be made is refused at the door, at once (#23858)', () => {
  it.runIf(RUNS_PROC)('os start under OS_HOME=/proc/<missing> exits 1, naming the path and ENOENT', () => {
    const run = runOf('start-proc');
    expect(run.code, run.output).toBe(1);
    expect(run.output).toContain(`${PROC_TOP}-home`);
    expect(run.output).toContain('ENOENT');
  });

  it('CONTROL: os start under a creatable OS_HOME three levels deep makes <home>/data', () => {
    const run = runOf('start-control');
    expect(run.code, run.output).toBe(1);
    expect(statSync(join(workdir, 'home', 'a', 'b', 'c', 'data')).isDirectory()).toBe(true);
    expect(run.output).not.toContain('ENOENT');
  });

  it.runIf(RUNS_PROC)('os create --dir /proc/<missing>/foo exits 1, naming the path and ENOENT', () => {
    const run = runOf('create-proc');
    expect(run.code, run.output).toBe(1);
    expect(run.output).toContain(`${PROC_TOP}-cr`);
    expect(run.output).toContain('ENOENT');
  });

  it('CONTROL: os create --dir under a creatable path three levels deep writes the project', () => {
    const run = runOf('create-control');
    expect(run.code, run.output).toBe(0);
    expect(statSync(join(workdir, 'create', 'a', 'b', 'foo', 'package.json')).isFile()).toBe(true);
  });
});
