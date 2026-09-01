// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The WIRING half of #12964 — `bin/run-dev.js` really asks, on a real failing
 * run, whether "command … not found" is about a missing command at all.
 *
 * ```
 * $ pnpm i18n:extract          # fresh worktree, pnpm install done, nothing built
 * …
 * Error: command i18n:extract:packages/platform-objects/scripts/i18n-extract.config.ts not found
 * $ echo $?
 * 2
 * ```
 *
 * The command file is right there in `src/commands/i18n/extract.ts`. oclif
 * `import()`s every command module while it builds its manifest, all of them
 * failed on a `@objectstack/spec` that had no `dist/`, and a command whose
 * module will not load is indistinguishable to `Config.runCommand` from one
 * that does not exist.
 *
 * ## Why this suite is spawned, and why it simulates
 *
 * The lead line is produced from a `process.on('warning')` collector installed
 * around `run()` — state that exists only inside a real CLI process, so an
 * in-process test cannot see it and `process.exit`-adjacent behaviour cannot be
 * asserted from a vitest worker at all.
 *
 * And CI's checkout is BUILT. ⚠️ That is the trap this file is written against:
 * an "unbuilt tree" test that runs in a built tree never enters the branch it
 * claims to cover, prints nothing, asserts nothing failed, and reads green
 * forever. So the unbuilt condition is MANUFACTURED for one child process
 * (`fixtures/unbuilt-spec-dist.hook.mjs`, a `--import` resolve hook that touches
 * no disk), and the three cases below are a POSITIVE CONTROL PAIR rather than a
 * single assertion:
 *
 *   1. hook on, real command id  → the lead lines appear;
 *   2. hook off, THE SAME command id → the command module loads and runs, so
 *      the run never reaches that branch at all;
 *   3. hook off, a command that really is missing → oclif's "not found" stands
 *      exactly as it did, with nothing added.
 *
 * (1) without (2) would pass in a tree where every run happens to be diagnosed;
 * (2) and (3) without (1) are two zero readings. Together they say the branch is
 * reachable, is not always taken, and is taken for the right reason.
 *
 * ## (4) — the same branch, read through a pipe nobody is draining
 *
 * Cases 1-3 all read the child through `execFile`, which drains continuously,
 * and that is the ONE reader for which this diagnostic was never at risk. The
 * merge queue is not that reader. `settings.debug` puts ~138 KB of oclif
 * `ModuleLoadError` blocks on stderr ahead of the lead lines, a pipe holds
 * 64 KiB, and `handle()` ends in `process.exit()` — so a loaded runner that is
 * slow to drain gets one buffer and loses everything after it: the lead lines
 * AND oclif's own `command … not found`. That is the #6531 defect
 * (`src/utils/format.ts`, `emitJson`) on stderr instead of stdout, and it is
 * invisible in a terminal, where stderr is a TTY and written synchronously.
 *
 * Case 4 holds the pipe unread until the child either exits or is still alive
 * at a cap, which makes the reading self-declaring rather than timing-based:
 *
 *   • released by CHILD EXIT ⇒ the child exited without waiting for its bytes,
 *     so whatever is missing was thrown away — the defect;
 *   • released by CAP ⇒ the child was still alive holding its own writes open,
 *     which is only possible if it is awaiting the drain — the fix.
 *
 * ⚠️ The cap has to sit between the child's drain budget (10 s, above it) and an
 * unfixed child's runtime (~1.4 s measured, below it). A runner slow enough to
 * push an unfixed child past the cap makes this case a zero reading rather than
 * a red one — it degrades to green-but-meaningless, never to a false alarm,
 * which is the only direction a queue-stability test may fail in.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** The SOURCE entry point — this suite is about it, and it needs no `dist/`. */
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const UNBUILT_HOOK = pathToFileURL(resolve(HERE, 'fixtures/unbuilt-spec-dist.hook.mjs')).href;

/**
 * A REAL command id, so "not found" is a lie rather than the truth. Its
 * argument names nothing: case 2 has to fail for its own reason (no config
 * file) instead of doing work, and the point there is only WHICH failure.
 */
const REAL_COMMAND = ['i18n', 'extract', 'nope.ts'];

/** oclif + tsx cold start, plus ~58 failing command imports in case 1. */
const RUN_TIMEOUT_MS = 180_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * `NODE_OPTIONS` is stated on every call, in both directions. `childEnv()`
 * strips the vitest-worker family and `NODE_PATH`, but not this one, so a
 * control leg that said nothing would silently inherit whatever the runner was
 * started with — and the control legs' whole job is to be un-simulated.
 */
function runCli(args: string[], cwd: string, nodeOptions: string | undefined): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(TSX, [CLI, ...args], { cwd, maxBuffer: 32 * 1024 * 1024, env: childEnv({ NO_COLOR: '1', NODE_OPTIONS: nodeOptions }) }, (err, stdout, stderr) => {
      resolvePromise({
        // `err.code` is the real exit status; `null`/undefined means the child
        // was signalled — a failure of a different kind, never reported as 0.
        code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
        stdout: String(stdout),
        stderr: String(stderr),
      });
    });
  });
}

/**
 * One pipe buffer on Linux — the exact size a truncated capture comes out at,
 * and the floor case 4 has to clear for its reading to mean anything.
 */
const PIPE_BUFFER_BYTES = 65_536;

/** How long case 4 holds the pipe unread. See the header for why this value. */
const UNDRAINED_CAP_MS = 5_000;

interface UndrainedRun {
  /** Which side of the race let go first — the whole verdict of case 4. */
  releasedBy: 'child-exit' | 'cap';
  waitedMs: number;
  stderr: string;
}

/**
 * Run the CLI with stderr on a pipe that is READ BY NOBODY until the child
 * either exits or outlives the cap, then drain it.
 *
 * `pause()` before any listener is what makes the kernel's 64 KiB the only
 * absorber: node does not start reading into its own buffer until something
 * asks it to, so the child hits real backpressure after one buffer instead of
 * two. Nothing here blocks the event loop — the vitest worker stays responsive
 * throughout, so this case cannot destabilise its neighbours.
 */
async function runCliUndrained(args: string[], cwd: string, nodeOptions: string): Promise<UndrainedRun> {
  const child = spawn(TSX, [CLI, ...args], {
    cwd,
    env: childEnv({ NO_COLOR: '1', NODE_OPTIONS: nodeOptions }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const pipe = child.stderr;
  if (!pipe) throw new Error('stderr was not piped');
  pipe.pause();

  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  const started = Date.now();
  // `race` reports its WINNER, so the verdict is captured at the moment it is
  // decided. Reading a mutable flag afterwards would let the loser overwrite it.
  const releasedBy = await Promise.race<'child-exit' | 'cap'>([
    exited.then(() => 'child-exit' as const),
    new Promise<'cap'>((done) => {
      const timer = setTimeout(() => done('cap'), UNDRAINED_CAP_MS);
      timer.unref();
    }),
  ]);
  const waitedMs = Date.now() - started;

  const chunks: Buffer[] = [];
  pipe.on('data', (chunk: Buffer) => chunks.push(chunk));
  pipe.resume();
  await new Promise<void>((done) => pipe.once('end', () => done()));
  await exited;

  return { releasedBy, waitedMs, stderr: Buffer.concat(chunks).toString() };
}

/** The sentence this change exists to contradict. */
const LEAD = 'objectstack: NOT A MISSING COMMAND';
const FIX = 'objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec';

let dir: string;
let unbuilt: Run;
let built: Run;
let genuinelyMissing: Run;
let undrained: UndrainedRun;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-run-dev-unbuilt-'));
  unbuilt = await runCli(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`);
  built = await runCli(REAL_COMMAND, dir, undefined);
  genuinelyMissing = await runCli(['definitely-not-a-command'], dir, undefined);
  undrained = await runCliUndrained(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`);
}, RUN_TIMEOUT_MS * 4);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('run-dev.js on a workspace package with no build output', () => {
  it('reproduces the misdiagnosis it is fixing — oclif still says "not found"', () => {
    // The upstream line is deliberately NOT suppressed: nothing here changes
    // which arguments the CLI accepts or how oclif reports, only what is said
    // alongside. Asserting it also proves case 1 really reached that failure
    // rather than dying earlier for some unrelated reason.
    expect(unbuilt.stderr).toContain('Error: command i18n:extract:nope.ts not found');
    expect(unbuilt.code).toBe(2);
  });

  it('names the real cause and the one command that fixes it', () => {
    expect(unbuilt.stderr).toContain(LEAD);
    expect(unbuilt.stderr).toContain('@objectstack/spec');
    expect(unbuilt.stderr).toContain(FIX);
  });

  it('keeps the oclif debug warning blocks — the listener order is load-bearing', () => {
    // @oclif/core installs its `warning` listener only when
    // `process.listenerCount('warning') <= 1`. A collector attached BEFORE
    // `run()` makes that 2, oclif silently declines, and every failing run
    // through this shim loses these blocks with nothing saying why (measured:
    // 1518 lines of report became 476). `at Plugin.warn` is that listener's
    // output, so this case reds if the attachment ever moves back.
    expect(unbuilt.stderr).toContain('at Plugin.warn');
  });
});

describe('the same probe, un-simulated (positive control)', () => {
  it('takes the other branch entirely: the command module loads and runs', () => {
    // Not "no lead line" alone — that is a zero reading. The command REACHED
    // its own argument handling, which is only possible if its module loaded.
    expect(`${built.stdout}${built.stderr}`).toContain('Config file not found');
    expect(built.stderr).not.toContain('Error: command');
    expect(built.stderr).not.toContain(LEAD);
    expect(built.code).toBe(1);
  });

  it('leaves a command that really is missing exactly as it was', () => {
    expect(genuinelyMissing.stderr).toContain('Error: command definitely-not-a-command not found');
    expect(genuinelyMissing.stderr).not.toContain(LEAD);
    expect(genuinelyMissing.stderr).not.toContain('objectstack: Fix:');
    expect(genuinelyMissing.code).toBe(2);
  });
});

describe('the same probe, read through a pipe nobody drains (the merge-queue shape)', () => {
  it('holds its own writes open instead of exiting on top of them', () => {
    // THE control for the two cases below, and it is not a restatement of them:
    // a child that reached the cap is still alive with bytes outstanding, which
    // is only reachable by awaiting the drain. An unfixed child answers
    // 'child-exit' here — it is already gone, and what it did not manage to
    // push into the first 64 KiB is gone with it. Without this line the two
    // assertions below would also pass against a run that was simply small
    // enough to fit, which is the zero reading this file exists to refuse.
    expect(undrained.releasedBy).toBe('cap');
    expect(undrained.waitedMs).toBeGreaterThanOrEqual(UNDRAINED_CAP_MS);
  });

  it('delivers more than the one buffer a pipe holds', () => {
    // The measured shape of the queue failure was a capture of exactly one
    // buffer. Asserting past it is what makes the two string assertions below
    // evidence about draining rather than about a short run.
    expect(Buffer.byteLength(undrained.stderr)).toBeGreaterThan(PIPE_BUFFER_BYTES);
  });

  it('still names the real cause and the one command that fixes it', () => {
    expect(undrained.stderr).toContain(LEAD);
    expect(undrained.stderr).toContain(FIX);
  });

  it("still carries oclif's own report, which is written after ours and exits on top of it", () => {
    // Not ours to print, and precisely why the fix is a DRAIN rather than a
    // reordering: `handle()` writes this and calls `process.exit` immediately.
    // It survives only because awaiting our own write emptied the buffer ahead
    // of it. This assertion failed in the queue alongside the lead line, and a
    // formatter that had merely failed to load could never have removed it.
    expect(undrained.stderr).toContain('Error: command i18n:extract:nope.ts not found');
  });
});
