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
 * ## (4) — the same run, read by a parent that is not draining
 *
 * Cases 1-3 read the child through an `execFile` whose event loop is free, and
 * that is the one reader for which this diagnostic was never at risk. The merge
 * queue is not that reader: it runs the full suite sharded, and a worker whose
 * loop is starved stops draining its children for seconds at a time.
 *
 * What that costs is measurable and was measured. `settings.debug` puts ~138 KB
 * of oclif `ModuleLoadError` blocks on stderr AHEAD of the lead lines; a pipe
 * holds 64 KiB; and `handle()` ends in `process.exit()`, which Node documents as
 * dropping whatever has not drained. With the parent's loop blocked, an unfixed
 * `run-dev.js` delivers exactly one buffer — 64764 bytes measured — and loses
 * BOTH the lead lines and oclif's own `command … not found`, which is the pair
 * of assertions that reds in the queue. It is the #6531 defect
 * (`src/utils/format.ts`, `emitJson`) on stderr instead of stdout, and it is
 * invisible interactively, where stderr is a TTY and written synchronously.
 *
 * ⚠️ The stall has to block the LOOP, not merely pause the stream. A paused
 * `child.stderr` still lets node fill its own 64 KiB readable buffer, so the
 * kernel's buffer stops being the only absorber, ~128 KiB of headroom swallows
 * the whole run and the case passes against unfixed code — measured, and the
 * reason this is written the way it is. `Atomics.wait` blocks without spinning,
 * so the stall costs no CPU on a shared runner.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  /**
   * Wall clock for the whole child, spawn to callback. Read by case 5, which
   * sizes its own ceiling against a run of the SAME child on the SAME runner
   * rather than against a constant measured somewhere else.
   */
  elapsedMs: number;
}

/**
 * `NODE_OPTIONS` is stated on every call, in both directions. `childEnv()`
 * strips the vitest-worker family and `NODE_PATH`, but not this one, so a
 * control leg that said nothing would silently inherit whatever the runner was
 * started with — and the control legs' whole job is to be un-simulated.
 */
function runCli(args: string[], cwd: string, nodeOptions: string | undefined): Promise<Run> {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    execFile(TSX, [CLI, ...args], { cwd, maxBuffer: 32 * 1024 * 1024, env: childEnv({ NO_COLOR: '1', NODE_OPTIONS: nodeOptions }) }, (err, stdout, stderr) => {
      resolvePromise({
        elapsedMs: Date.now() - started,
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
 * One pipe buffer on Linux — what a truncated capture comes out at, and the
 * floor case 4 has to clear for its reading to mean anything.
 */
const PIPE_BUFFER_BYTES = 65_536;

/**
 * How long case 4 refuses to drain. Two constraints pin it, and the ORDER is
 * the whole design:
 *
 *   worst measured child runtime (6.9 s)  <  STALL_MS  <  the shim's
 *   no-progress bound (`STDERR_DRAIN_STALL_MS`, 15 s in `bin/run-dev.js`)
 *
 * Below the child's runtime the control cannot bite: the bulk of stderr is
 * emitted during `Config.load()` and the diagnostic ~3 s later, so a stall that
 * ends first lets the tail out and the case passes against unfixed code.
 * Above the shim's bound the fixed child correctly gives up, and the case would
 * red against a WORKING fix.
 *
 * ⚠️ Both failure directions have actually happened here. 4 s was tried and the
 * ablation against base came back GREEN — the case had silently stopped
 * discriminating once a contended box pushed child runtime past it. A slow
 * continuous reader was tried instead and failed the other way: it drains the
 * bulk long before the tail is written, so the tail meets an EMPTY pipe and
 * nothing is ever lost. Only a stall spanning the whole run reproduces this.
 */
const STALL_MS = 10_000;

/**
 * The shim's own no-progress bound, mirrored from `bin/run-dev.js`
 * (`STDERR_DRAIN_STALL_MS`) and held equal to it by a case below rather than
 * trusted. Case 5's ceiling no longer budgets it — that ceiling is a constant
 * now — and case 6 no longer reads it either, having stopped judging by a wall
 * clock at all. ONE case is still sized against it and would quietly stop
 * discriminating if it moved:
 *
 *   • `STALL_MS` above must stay strictly BELOW it, or case 4's stalled reader
 *     outlasts the shim's own give-up and reds against a WORKING fix.
 */
const SHIM_DRAIN_STALL_MS = 15_000;

/** Where that constant is written — read by the parity case, never imported. */
const SHIM = resolve(HERE, '../bin/run-dev.js');

/**
 * Case 5's ceiling — a CONSTANT, and deliberately this file's existing
 * per-child budget rather than a number of its own.
 *
 * ⚠️ Two ceilings have been tried here and both failed the same way, so the
 * history is written down instead of left to be rediscovered:
 *
 *   • `UNREAD_HARD_CAP_MS = 40_000`, read as "comfortably above the worst child
 *     runtime plus the shim's 15 s bound (~22 s measured)". Merge-queue shards
 *     running the full suite six ways sharded went over it three times in a
 *     day, on three trees that cannot reach this file.
 *   • then a per-run derivation, `clamp(40_000, RUN_TIMEOUT_MS, 4 x a case-1
 *     calibration + 2 x the shim's bound)`, on the theory that a contended
 *     shard can calibrate itself. It was evicted from the queue by its own new
 *     assertion at `cap 61464 ms = clamp(40000, 180000, 4 x 7866 ms measured
 *     child runtime + 2 x 15000 ms shim bound)`: the child outlived a ceiling
 *     built from a sample taken minutes earlier on that same runner by more
 *     than 7.8x that sample, against a FACTOR of 4.
 *
 * Raising the factor would be the same move a third time. Both ceilings were
 * sized comfortably above the worst thing on record when they were written, and
 * both were beaten by a runner that got busier afterwards. Nothing measures the
 * spread between a calibration and a later run on a shared, six-way-sharded
 * queue runner, so no factor can be justified as ENOUGH — only as not beaten
 * yet, which is what the constant it replaced could also say.
 *
 * ⭐ What removes the choice is the property this case actually pins. The
 * failure it was written against is an UNBOUNDED wait: a drain wait with no
 * bound armed at all, observed alive at 25 s, 30 s and 60 s and ending only
 * when something else killed it. ANY finite ceiling catches that. Tightening a
 * ceiling buys no detection at all — it buys false reds, and each one here
 * costs a queue rebuild. So the ceiling wants to be the LARGEST value that
 * keeps the failure legible, and it must not track load: a term tracking load
 * is a prediction about contention drawn from a sample of the past, which is
 * the one thing a shared runner will not honour.
 *
 * `RUN_TIMEOUT_MS` is that largest legible value, and it is not a new number:
 *
 *   • past it this case stops reporting a SIGKILL and starts reporting the
 *     `beforeAll` timeout, which reds all six cases and names none of them. So
 *     it is where legibility ends, not a preference;
 *   • it is already this file's budget for ONE child of this suite, and cases
 *     1-4 run the same child. A child here that legitimately needs more than
 *     180 s has broken the whole file, not this case — one number to get
 *     wrong instead of two;
 *   • every load figure on record clears it by an order of magnitude: 23x the
 *     7.9 s calibration, and 3.4x the worst legitimate lifetime yet measured
 *     (22.6 s of contended work against 8 competing copies of this child, plus
 *     both of the shim's 15 s bounds).
 *
 * The measurement is KEPT — as evidence in the failure message, never as an
 * input to the threshold. That is the whole correction: case 1's wall clock
 * tells a triage whether a red is a hang or a runner on fire, and it decides
 * nothing.
 */
const UNREAD_HARD_CAP_MS = RUN_TIMEOUT_MS;

interface Lifetime {
  code: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
}

/**
 * Run the CLI against a pipe that is never drained, and report only how the
 * process ENDED. Nothing is read, so the kernel's 64 KiB is the whole absorber
 * and the child hits real backpressure it can never clear.
 */
function runCliAgainstDeadReader(
  args: string[],
  cwd: string,
  nodeOptions: string,
  mode: 'never-read' | 'destroy-read-end',
  capMs: number,
): Promise<Lifetime> {
  return new Promise((resolvePromise) => {
    const child = spawn(TSX, [CLI, ...args], {
      cwd,
      env: childEnv({ NO_COLOR: '1', NODE_OPTIONS: nodeOptions }),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const pipe = child.stderr;
    if (!pipe) throw new Error('stderr was not piped');
    if (mode === 'destroy-read-end') pipe.destroy();
    else pipe.pause();

    const started = Date.now();
    // Ours, and it must be the ONLY thing that can end a hang — a child that
    // reaches it is the failure this case exists to catch.
    const cap = setTimeout(() => child.kill('SIGKILL'), capMs);
    child.once('exit', (code, signal) => {
      clearTimeout(cap);
      resolvePromise({ code, signal, elapsedMs: Date.now() - started });
    });
  });
}

/**
 * Run the CLI and DO NOT read it for `STALL_MS`, by blocking this thread.
 *
 * `Atomics.wait` rather than a spin loop: it parks the thread instead of
 * burning a core, which matters on a runner that is already the reason this
 * case exists. Nothing else in this file shares the worker while it is parked.
 */
async function runCliWhileParentStalls(args: string[], cwd: string, nodeOptions: string): Promise<Run> {
  const run = runCli(args, cwd, nodeOptions);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STALL_MS);
  return run;
}

/** The sentence this change exists to contradict. */
const LEAD = 'objectstack: NOT A MISSING COMMAND';
const FIX = 'objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec';

let dir: string;
let unbuilt: Run;
let built: Run;
let genuinelyMissing: Run;
let stalled: Run;
let unread: Lifetime;
let closedEnd: Lifetime;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-run-dev-unbuilt-'));
  unbuilt = await runCli(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`);
  built = await runCli(REAL_COMMAND, dir, undefined);
  genuinelyMissing = await runCli(['definitely-not-a-command'], dir, undefined);
  stalled = await runCliWhileParentStalls(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`);
  // ⛔ Nothing measured above is consulted here. Case 1's wall clock is read by
  // the failure message below, as evidence; the ceiling is a constant, so a
  // slow sample can no longer size the instrument that judges the next run.
  unread = await runCliAgainstDeadReader(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`, 'never-read', UNREAD_HARD_CAP_MS);
  closedEnd = await runCliAgainstDeadReader(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`, 'destroy-read-end', UNREAD_HARD_CAP_MS);
}, RUN_TIMEOUT_MS * 6);

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

describe('the same probe, read by a parent that stalls (the merge-queue shape)', () => {
  it('delivers more than the one buffer a stalled pipe holds', () => {
    // THE control for the three cases below, and not a restatement of them: the
    // measured failure was a capture of exactly one buffer, so clearing that
    // line is what makes the string assertions evidence about DRAINING rather
    // than about a run that happened to be short. Unfixed, this reads 64764.
    expect(Buffer.byteLength(stalled.stderr)).toBeGreaterThan(PIPE_BUFFER_BYTES);
  });

  it('still names the real cause and the one command that fixes it', () => {
    expect(stalled.stderr).toContain(LEAD);
    expect(stalled.stderr).toContain('@objectstack/spec');
    expect(stalled.stderr).toContain(FIX);
  });

  it("still carries oclif's own report, which is written after ours and exits on top of it", () => {
    // Not ours to print, and the reason the fix is a DRAIN rather than a
    // reordering: `handle()` writes this and calls `process.exit` immediately,
    // so it survives only because awaiting our own write had already emptied
    // the buffer ahead of it. This assertion reds in the queue beside the lead
    // line — and a formatter that had merely failed to LOAD could not have
    // removed it, which is what rules that reading out.
    expect(stalled.stderr).toContain('Error: command i18n:extract:nope.ts not found');
    expect(stalled.code).toBe(2);
  });
});

describe('the mirror direction: a reader that is never coming back', () => {
  /**
   * ⚠️ This case exists because the first fix for the stalled reader above
   * introduced a HANG here, and every instrument written for that fix pointed
   * the other way. Waiting for a drain is only safe if something bounds the
   * wait, and the bound has to be OBSERVED rather than assumed: the version
   * this replaces armed no bound at all (`write()` returned true, so an early
   * return skipped it) and read as correct in every stalled-reader test.
   */
  it('gives up and exits instead of waiting forever', () => {
    // A child still alive at the cap was SIGKILLed: signal set, code null.
    // That is the hang, and it is the whole point of this case.
    //
    // ⚠️ Both surviving assertions are about the PRODUCT: the child ends on
    // its OWN, and it ends with the status any other reader would have got.
    //
    // ⛔ The third assertion this case used to carry — `elapsedMs` below the
    // ceiling — is deliberately gone. Against a constant cap it asserts nothing
    // the first line does not: the harness kills at exactly that cap, so a
    // child that was not killed ran less than it. What it added was a race, at
    // the one instant where a child exiting on its own and the timer firing
    // are simultaneous, and it was the only reading here that a slower box
    // could move on its own. Detection unchanged, one fewer way to red.
    //
    // The numbers move into the message, because `expected 'SIGKILL' to be
    // null` alone does not tell a merge-queue triage which of two readings it
    // has. A child killed at 180 s whose calibration was 8 s is a hang; one
    // whose calibration was also minutes indicts the runner, not this code.
    const evidence =
      `cap ${UNREAD_HARD_CAP_MS} ms (RUN_TIMEOUT_MS, constant and load-independent by design); ` +
      `this child ran ${unread.elapsedMs} ms; case 1 measured the same child at ` +
      `${unbuilt.elapsedMs} ms on this runner minutes earlier`;
    expect(unread.signal, `the harness SIGKILLed the child — it was still alive at the ceiling. ${evidence}`).toBeNull();
    expect(unread.code, `the child did not exit 2 on its own. ${evidence}`).toBe(2);
  });

  // ⛔ There is deliberately NO assertion here that the child WAITED for the
  // bound before exiting, though an earlier version of this file had one. It
  // is not sound: whether the tail finds bytes still pending — and so whether
  // the bound is needed at all — depends on how much of the ~138 KB backlog
  // the kernel and node's own readable buffer happened to absorb, which moves
  // with load. Measured on one contended run the child exited at 7653 ms
  // having never needed the bound; on another, with 7621 bytes still pending,
  // the unfixed shim hung instead. Asserting the wait would red on the first
  // run and pass on the second, which is a flake, not a pin. What this case
  // pins is the property that actually matters and holds either way: the
  // process ENDS. That the bound itself runs and trips is shown out of band,
  // by tracing a run whose reader blocks its loop for the whole run — see the
  // PR for the `BOUND TRIPPED` trace.
  //
  // ⚠️ The same nondeterminism means an ABLATION of the bound can come back
  // GREEN, and a single green one here is a ZERO READING rather than evidence
  // this case has stopped discriminating. Measured on one box minutes apart,
  // same tree: disabling the no-progress branch red this case at 180072 ms
  // once, and passed it in 31.9 s the run before — that run's backlog fit in
  // what the kernel and node happened to absorb, so the write callback
  // resolved on its own and the branch was never reached. Re-run it, or drive
  // the child OUT OF BAND (`spawn`, `stderr.pause()`, never read) where the
  // pending bytes can actually be counted: 135408 bytes still held at a clean
  // exit 2 in 19271 ms, against 145638 held by a child still alive at 90 s
  // with the branch disabled.

  it("keeps its mirror of the shim's bound equal to the shim's own", () => {
    // The derivation above is only as good as `SHIM_DRAIN_STALL_MS` still being
    // what `bin/run-dev.js` waits. There is no import to take it from — that
    // file runs the CLI at module top — so it is mirrored, and a mirror with
    // nothing holding it is how a ceiling ends up sized around a bound that
    // moved. Same discipline as `INVOCATION_PREFIX` vs `CLI_NAME`: kept in
    // sync by a case, not by an import.
    const declared = /const STDERR_DRAIN_STALL_MS = ([\d_]+);/.exec(readFileSync(SHIM, 'utf8'))?.[1];
    expect(declared, `no STDERR_DRAIN_STALL_MS declaration found in ${SHIM}`).toBeDefined();
    expect(Number(String(declared).replaceAll('_', ''))).toBe(SHIM_DRAIN_STALL_MS);
  });

  it('a CLOSED read end ends the child on its own, with the status every other reader gets', () => {
    // ⚠️ THE NUMBER BELOW MOVED FROM 1 TO 2, and this case is why it could not
    // move quietly. It pinned 1 on purpose — 1 was what the CLI DID, never what
    // anyone contracted — and #14858 is the card that changed the CLI. ⛔ This
    // was not a broken test and the flip is not a regression.
    //
    // What the child USED TO DO with its read end destroyed: oclif's
    // `displayWarnings()` makes the first stderr write, the pipe is already
    // gone, node raises `write EPIPE` as an `error` event on `process.stderr`,
    // NOTHING WAS LISTENING, and the process died of an uncaught exception —
    // exit 1, 938-1174 ms in, 12 of 12 runs, traced with a `--import` observer
    // that installed no listener here and wrapped no write. `writeStderr()` was
    // never called at all, so the bound this case was once named after was
    // never armed, let alone paid. (An earlier version of this case read
    // `elapsedMs < STALL_MS` and was named for that bound; the wall clock went
    // because its whole measured term is child cold start, which is elastic,
    // and because it stayed green through the very ablation it named.)
    //
    // `bin/run-dev.js` now attaches a no-op `error` listener to
    // `process.stderr` before `run()`. A failed stderr write stops being fatal,
    // the run reaches the CLI's own exit path — oclif's `handle()`, status 2 —
    // and the closed reader answers what the drained and never-read readers
    // already answered (#14715 pinned 2 for the never-read one). Re-measured
    // for that change, one contiguous 2x2 ablation of the shim on one box, the
    // listener present/absent against the `write` callback kept/removed:
    //
    //   listener present, callback kept (as shipped)  exit 2,  1237-1312 ms
    //   listener present, callback removed            exit 2, 16271-16294 ms
    //   listener absent,  callback kept (the defect)  exit 1,   983-1028 ms
    //   listener absent,  callback removed            exit 1,   843-1031 ms
    //
    // ⭐ The exit status is still the observation, and it still carries no load
    // term. 1 means the child died on its first write and never reached the
    // drain; 2 means it got through to `handle()`, which on this run is only
    // reachable THROUGH `writeStderr()` — bound paid or not. BOTH rows that
    // remove the listener flip it back to 1, so this line pins the fix and not
    // the weather.
    //
    // ⛔ Do not "repair" a red here by loosening to `not.toBeNull()`; that is
    // the phantom check the wall clock already was. A red means the child is
    // dying on a stderr write again — the listener is gone, or something now
    // writes to stderr ahead of where it is attached.
    const evidence =
      `closed-read-end child ran ${closedEnd.elapsedMs} ms (harness cap ${UNREAD_HARD_CAP_MS} ms); ` +
      `case 1 measured the same child at ${unbuilt.elapsedMs} ms on this runner minutes earlier`;
    expect(closedEnd.signal, `the harness SIGKILLed the child — it was still alive at the ceiling. ${evidence}`).toBeNull();
    expect(
      closedEnd.code,
      `the child did not reach the CLI's own exit path — it died on a stderr write, so nothing is making ` +
        `EPIPE non-fatal on \`process.stderr\` any more (see #14858 and the ablation table above this ` +
        `assertion). ${evidence}`,
    ).toBe(2);
  });
});
