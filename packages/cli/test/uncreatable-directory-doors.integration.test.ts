// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os start` and `os create` refuse a directory that can never be made at
 * once, naming the path and the operating system's code, instead of hanging
 * in Node's recursive mkdir (#23858). `os serve` stops hanging on its runtime
 * state file's directory the same way, and goes on to its banner without the
 * file — saying so once, naming the file and the error (#24091).
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
 *   - `OS_HOME=/proc/os-23858-r2 OS_DATABASE_URL=:memory: os serve` (on
 *     `origin/main` b6805ac0f) bound its port and then looped on the runtime
 *     state file's directory, `OS_HOME` itself, before the banner: 794,594
 *     failing `mkdir` calls in 20 s and no `Press Ctrl+C to stop`. The
 *     database URL keeps the SQLite default out of `OS_HOME`, whose own
 *     bounded refusal (#23737) would otherwise end the boot first.
 *
 * ## Why every run is a bounded child of the BUILT entry
 *
 * A regression would hang, not fail. Each command runs in its own process
 * group with a hard SIGKILL of the whole group at `CHILD_BOUND_MS`, so a
 * reintroduced loop fails this file at the bound instead of hanging the suite.
 * `bin/run.js` with `NODE_ENV` unset is the entry an operator runs, and it
 * starts in about 3 s where the tsx source entry takes about 10 s, so the seven
 * children (run concurrently) keep this file under the 10 s line. The three
 * `serve` children never exit by themselves: each is killed whole as soon as
 * its banner tail is out, and `--port 0` keeps them off any fixed port.
 *
 * ## What is asserted — kind, exit code and named subject, never the prose
 *
 *   1. `os start` under `OS_HOME=/proc/<missing>`: settles inside the bound,
 *      exits 1, and its output names that path and `ENOENT`.
 *   2. CONTROL: `os start` under a creatable `OS_HOME` three levels deep makes
 *      `<home>/data` and goes on to its next refusal. `--port 70000` is that
 *      refusal: start's own invalid-port door, AFTER the home step and BEFORE
 *      any `serve` child, so neither `start` leg boots a server. The `/proc`
 *      leg passes it too, for the same reason.
 *   3. `os create plugin --dir /proc/<missing>/foo`: settles, exits 1, names the
 *      path and `ENOENT`.
 *   4. CONTROL: `os create plugin --dir <tmp>/a/b/foo` exits 0 and writes the
 *      project.
 *   5. `os serve` under `OS_HOME=/proc/<missing>`: prints its banner tail
 *      inside the bound. The state file cannot be written there; the boot
 *      goes on without it, and exactly one output line names that file, with
 *      `ENOENT`.
 *   6. CONTROL: `os serve` under a creatable `OS_HOME` three levels deep
 *      prints its banner tail, and by then that home holds one
 *      `runtime.env_local.<project>.json` naming the child's own pid. No
 *      output line names the file: a written file is not reported.
 *   7. `os serve` under an `OS_HOME` whose parent is a regular file, the
 *      portable uncreatable home (#24091): prints its banner tail, and exactly
 *      one output line names the state file it could not write, with
 *      `ENOTDIR`. Before #24091 the write's catch printed nothing, so a
 *      supervisor told "ready" met a missing file and no reason.
 *
 * Legs 1, 3 and 5 need a `/proc` that refuses `mkdir` with ENOENT, so they run
 * where `/proc/self` exists (Linux, which CI is). Leg 7 runs everywhere.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_AUTH_SECRET, E2E_SECRET_KEY, RUN_JS_RESOLVES_FROM_DIST, requireBuiltCli } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const RUN_JS = resolve(HERE, '../bin/run.js');

/** Each child's whole budget; the loop it guards against never ends. */
const CHILD_BOUND_MS = 60_000;

/** Start's own invalid-port refusal — after the home step, before any child. */
const UNSERVABLE_PORT = '70000';

const RUNS_PROC = existsSync('/proc/self');
const PROC_TOP = `/proc/os-23858-${process.pid}`;

/** The last line of `os serve`'s ready banner. */
const BANNER_TAIL = 'Press Ctrl+C to stop';

/** The platform with no application — the cheapest project that reaches a banner. */
const BARE_CONFIG = 'export default {};\n';

/**
 * The output lines that name a runtime state file under `home`. The file's
 * project half is a digest of the served root, so a line is matched on the
 * home-plus-`runtime.env_local.` prefix, never on a recomputed name.
 */
function linesNamingStateFile(output: string, home: string): string[] {
  const prefix = join(home, 'runtime.env_local.');
  return output.split('\n').filter((line) => line.includes(prefix));
}

interface Run {
  code: number | null;
  signal: NodeJS.Signals | null;
  killedAtBound: boolean;
  /** `until` appeared in the output, and the group was killed on it. */
  reached: boolean;
  pid: number | undefined;
  output: string;
}

let workdir: string;
let serveDir: string;
const runs = new Map<string, Run>();

/**
 * Run the built CLI in its own process group, killed whole at the bound — or,
 * with `until`, as soon as that text is in its output (a server never exits).
 */
function runCli(args: string[], env: Record<string, string>, opts: { cwd?: string; until?: string } = {}): Promise<Run> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [RUN_JS, ...args], {
      cwd: opts.cwd ?? workdir,
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
    let reached = false;
    const onData = (d: Buffer) => {
      output += d;
      if (opts.until !== undefined && !reached && output.includes(opts.until)) {
        reached = true;
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    let killedAtBound = false;
    const timer = setTimeout(() => {
      killedAtBound = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
    }, CHILD_BOUND_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      resolveRun({ code, signal, killedAtBound, reached, pid: child.pid, output });
    });
  });
}

/**
 * `os serve --port 0` over {@link BARE_CONFIG}, until its banner tail. The
 * database is in memory so the SQLite default never lands in `OS_HOME`; the
 * runtime state file is then the boot's one write there.
 */
function runServe(home: string): Promise<Run> {
  return runCli(
    ['serve', '--port', '0'],
    {
      OS_HOME: home,
      OS_DATABASE_URL: ':memory:',
      OS_SECRET_KEY: E2E_SECRET_KEY,
      // A production server boot with no auth secret is refused (ADR-0131 D9);
      // this file's property is about OS_HOME, not auth.
      OS_AUTH_SECRET: E2E_AUTH_SECRET,
      OS_DISABLE_CONSOLE: '1',
    },
    { cwd: serveDir, until: BANNER_TAIL },
  );
}

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  workdir = mkdtempSync(join(tmpdir(), 'os-23858-doors-'));
  serveDir = join(workdir, 'serve-project');
  mkdirSync(serveDir);
  writeFileSync(join(serveDir, 'objectstack.config.ts'), BARE_CONFIG);
  // A regular file where the home's parent directory would be: `ENOTDIR`.
  writeFileSync(join(workdir, 'serve-home-file'), '');
  const legs: Array<[string, Promise<Run>]> = [
    ['start-control', runCli(['start', '-p', UNSERVABLE_PORT], { OS_HOME: join(workdir, 'home', 'a', 'b', 'c') })],
    ['create-control', runCli(['create', 'plugin', 'foo', '--dir', join(workdir, 'create', 'a', 'b', 'foo')], {})],
    ['serve-control', runServe(join(workdir, 'serve-home', 'a', 'b', 'c'))],
    ['serve-notdir', runServe(join(workdir, 'serve-home-file', 'sub'))],
  ];
  if (RUNS_PROC) {
    legs.push(
      ['start-proc', runCli(['start', '-p', UNSERVABLE_PORT], { OS_HOME: `${PROC_TOP}-home` })],
      ['create-proc', runCli(['create', 'plugin', 'foo', '--dir', `${PROC_TOP}-cr/foo`], {})],
      ['serve-proc', runServe(`${PROC_TOP}-sv`)],
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

  it.runIf(RUNS_PROC)('os serve under OS_HOME=/proc/<missing> prints its banner instead of looping on the state file', () => {
    const run = runOf('serve-proc');
    expect(run.reached, run.output).toBe(true);
    const named = linesNamingStateFile(run.output, `${PROC_TOP}-sv`);
    expect(named, run.output).toHaveLength(1);
    expect(named[0]).toContain('ENOENT');
  });

  it('CONTROL: os serve under a creatable OS_HOME three levels deep writes its state file before the banner', () => {
    const run = runOf('serve-control');
    expect(run.reached, run.output).toBe(true);
    const home = join(workdir, 'serve-home', 'a', 'b', 'c');
    const files = readdirSync(home).filter((name) => /^runtime\.env_local\..+\.json$/.test(name));
    expect(files, `entries in ${home}: ${readdirSync(home).join(', ')}`).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(home, files[0]), 'utf8')).pid).toBe(run.pid);
    expect(linesNamingStateFile(run.output, home), run.output).toEqual([]);
  });
});

describe('a runtime state file that cannot be written is said once, and the boot goes on (#24091)', () => {
  it('os serve under an OS_HOME below a regular file reaches its banner, and one line names the file and ENOTDIR', () => {
    const run = runOf('serve-notdir');
    const home = join(workdir, 'serve-home-file', 'sub');
    expect(run.reached, run.output).toBe(true);
    const named = linesNamingStateFile(run.output, home);
    expect(named, run.output).toHaveLength(1);
    expect(named[0]).toMatch(/runtime\.env_local\.\S+\.json/);
    expect(named[0]).toContain('ENOTDIR');
  });
});
