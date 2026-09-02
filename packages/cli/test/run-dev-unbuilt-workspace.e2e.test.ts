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
 * trusted. It is the INELASTIC half of case 5's budget: the shim enforces it
 * with a `Date.now()` comparison, so a busy runner makes the child's WORK take
 * longer while this term stays 15 s.
 */
const SHIM_DRAIN_STALL_MS = 15_000;

/** Where that constant is written — read by the parity case, never imported. */
const SHIM = resolve(HERE, '../bin/run-dev.js');

/**
 * Case 5's ceiling, DERIVED per run rather than declared as a constant.
 *
 * ⚠️ What went wrong with the constant this replaces, stated so that nobody
 * re-buys it at a bigger round number. It read `UNREAD_HARD_CAP_MS = 40_000`,
 * derived as "comfortably above the worst child runtime plus the shim's 15 s
 * bound (~22 s measured)" — correct arithmetic over a sum whose two terms do
 * not behave alike:
 *
 *   • the shim's bound is wall clock and does not move with load;
 *   • the child's pre-drain work — tsx cold start, `Config.load()`, ~58 failing
 *     command imports — is the ONLY elastic term, and `bin/run-dev.js` itself
 *     records it at 1.0 s idle against 6.9 s contended, a 6.9x spread.
 *
 * So the elastic term's real budget was `40 − 15 = 25 s`, sized against one
 * box. Measured while writing this, on a 4-core container, same child: 7.4-8.3 s
 * with the repo's heavy-verify lock held, 15.1-20.0 s against 4 competing
 * copies of itself, 22.6 s against 8 — where the case finished in 38.5 s
 * against the 40 s cap. Merge-queue shards run the full suite six ways sharded
 * and went over it three times in a day, on three trees that cannot reach this
 * file.
 *
 * ⭐ The ceiling is not what makes this case discriminate, which is why deriving
 * it upward costs nothing. What it catches is an UNBOUNDED wait — the version
 * this case was written against was observed alive at 25 s, 30 s and 60 s — and
 * ANY finite ceiling catches an unbounded wait. The constant was buying false
 * reds, not detection.
 *
 * The derivation, recorded the way `STALL_MS` above records its own:
 *
 *   cap = clamp(FLOOR, CEILING, FACTOR x measured child runtime + 2 x the shim's bound)
 *
 *   • the measured child runtime is read IN BAND, from case 1 — the same argv
 *     under the same `--import` hook, run minutes earlier on this runner, and
 *     the first child of the file, so it also pays tsx's cold start and reads
 *     high. A contended shard therefore calibrates itself, which is the one
 *     thing a constant cannot do;
 *   • FACTOR covers the load getting WORSE between that sample and this case.
 *     It is not sized for the idle-to-contended spread, because the sample is
 *     already whatever the runner is;
 *   • the bound is counted TWICE because `run-dev.js` awaits two announcers
 *     (`announceInvocationFailure`, then `announceUnbuiltWorkspace`) and each
 *     one can pay it. Only the second writes on this path today —
 *     `invocationFailureLine` returns `undefined` unless the error is an oclif
 *     PARSE error and "command … not found" is not one — so widening that
 *     predicate would add a whole bound to the child's legitimate lifetime.
 *     Budgeting two means that change lands as a red in ITS own suite instead
 *     of as a queue ejection here;
 *   • FLOOR keeps the ceiling from ever falling BELOW the constant it replaces,
 *     on a runner fast enough for the derivation to go small;
 *   • CEILING keeps a real hang legible. Past `RUN_TIMEOUT_MS` this case stops
 *     reporting a SIGKILL and starts reporting the `beforeAll` timeout, which
 *     reds all six cases and names none of them.
 */
const UNREAD_CAP_RUNTIME_FACTOR = 4;
const UNREAD_CAP_FLOOR_MS = 40_000;
const UNREAD_CAP_CEILING_MS = RUN_TIMEOUT_MS;

function deriveUnreadCapMs(measuredChildRuntimeMs: number): number {
  const derived = UNREAD_CAP_RUNTIME_FACTOR * measuredChildRuntimeMs + 2 * SHIM_DRAIN_STALL_MS;
  return Math.min(UNREAD_CAP_CEILING_MS, Math.max(UNREAD_CAP_FLOOR_MS, derived));
}

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
/** Set in `beforeAll` from the measurement above; the floor until then. */
let unreadCapMs = UNREAD_CAP_FLOOR_MS;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-run-dev-unbuilt-'));
  unbuilt = await runCli(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`);
  built = await runCli(REAL_COMMAND, dir, undefined);
  genuinelyMissing = await runCli(['definitely-not-a-command'], dir, undefined);
  stalled = await runCliWhileParentStalls(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`);
  // Case 1 is the calibration sample: same argv, same hook, same runner, read
  // by a parent that never stalls — so its wall clock IS the elastic term the
  // ceiling has to clear. Everything after this point is sized against what
  // this box just did, not against what some other box once did.
  unreadCapMs = deriveUnreadCapMs(unbuilt.elapsedMs);
  unread = await runCliAgainstDeadReader(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`, 'never-read', unreadCapMs);
  closedEnd = await runCliAgainstDeadReader(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`, 'destroy-read-end', unreadCapMs);
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
    // ⚠️ Each assertion carries the derivation, because THIS is the line a
    // merge-queue triage reads and `expected 'SIGKILL' to be null` on its own
    // does not distinguish the two readings it can have: a child that hung, or
    // a ceiling that was too small for the runner. The numbers below say which,
    // without anyone having to open this file.
    const derivation =
      `cap ${unreadCapMs} ms = clamp(${UNREAD_CAP_FLOOR_MS}, ${UNREAD_CAP_CEILING_MS}, ` +
      `${UNREAD_CAP_RUNTIME_FACTOR} x ${unbuilt.elapsedMs} ms measured child runtime ` +
      `+ 2 x ${SHIM_DRAIN_STALL_MS} ms shim bound); this child ran ${unread.elapsedMs} ms`;
    expect(unread.signal, `the harness SIGKILLed the child — it was still alive at the ceiling. ${derivation}`).toBeNull();
    expect(unread.code, `the child did not exit 2 on its own. ${derivation}`).toBe(2);
    expect(unread.elapsedMs, derivation).toBeLessThan(unreadCapMs);
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

  it('a CLOSED read end is released at once, not held for the bound (EPIPE reaches the callback)', () => {
    // Pins the fast path measured alongside the hang: when the reader is gone
    // rather than idle, the write callback fires with EPIPE and the wait ends
    // immediately. A future change to the bound must not quietly make the
    // closed-reader paths pay it.
    expect(closedEnd.signal).toBeNull();
    expect(closedEnd.elapsedMs).toBeLessThan(STALL_MS);
  });
});
