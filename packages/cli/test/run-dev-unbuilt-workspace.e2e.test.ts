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
import { execFile } from 'node:child_process';
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
 * One pipe buffer on Linux — what a truncated capture comes out at, and the
 * floor case 4 has to clear for its reading to mean anything.
 */
const PIPE_BUFFER_BYTES = 65_536;

/**
 * How long case 4 refuses to drain. It only has to outlast the child, which
 * takes ~1.4-2.5 s here; the margin is for a loaded runner. Below the child's
 * own 10 s drain budget on purpose, so the fixed child is still waiting — a
 * stall longer than that budget would let it give up and prove nothing.
 */
const STALL_MS = 8_000;

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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-run-dev-unbuilt-'));
  unbuilt = await runCli(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`);
  built = await runCli(REAL_COMMAND, dir, undefined);
  genuinelyMissing = await runCli(['definitely-not-a-command'], dir, undefined);
  stalled = await runCliWhileParentStalls(REAL_COMMAND, dir, `--import ${UNBUILT_HOOK}`);
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
