// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `bin/run-dev.js` must not be able to freeze in the kernel with its diagnostic
 * unwritten — the hang behind a merge queue that ejected 13 PRs and burned 22
 * queue builds before anyone could see what it was.
 *
 * ## What was actually wrong, and why no ceiling could have found it
 *
 * The shim bounds how long it waits for stderr to drain (`writeStderr`'s
 * `STDERR_DRAIN_STALL_MS`, polled by a 50 ms `setInterval`). That bound — like
 * every timer, callback and promise — only exists while the event loop runs.
 * Measured on the failing runs, from OUTSIDE the process so the instrument
 * could not perturb it:
 *
 * ```
 * pid=19236 state=S syscall=1(write) args=0x2,…,0x244 wchan=sock_alloc_send_pskb
 *     tid=19236 (node) syscall=1(write)          ← the MAIN thread
 *     fd2 flags=02000002 O_NONBLOCK=false
 * ```
 *
 * There is no pending JS handle to find: the loop is parked in `write(2)` on
 * fd 2 and the bound is not late, it is UNREACHABLE. That is why raising or
 * re-deriving a ceiling never helped — a ceiling separates slow from stuck, and
 * this was stuck at a point where nothing in the file had run yet.
 *
 * `src/utils/stderr-nonblocking.ts` carries the mechanism in full: node sets
 * `O_NONBLOCK` on fd 2 when it opens the pipe, libuv clears it again in the
 * pre-exec of any child spawned with inherited stdio, and the flag lives on the
 * SHARED open file description — so the spawner loses it too. Under `tsx` that
 * child is the esbuild service, spawned when a module has to be transformed,
 * which is why this is a cold-transform-cache defect: **27 of 30** runs of the
 * real child hung on a cold cache against **1 of 90** on a warm one.
 *
 * ## Why this file drives a fixture and not the real CLI
 *
 * ⭐ Because a 27-in-30 reproduction is still not a pin. The neighbouring
 * `run-dev-unbuilt-workspace.e2e.test.ts` already drives the real child, and
 * its own comments record what that costs: an oracle over this hazard can come
 * back green because the backlog happened to fit in what the kernel absorbed.
 * A pin whose subject is intermittent is a pin that reports "fixed" on the runs
 * where the defect simply did not fire.
 *
 * So the fixture MANUFACTURES the condition — materialise stderr, spawn a child
 * with inherited stdio, write past one pipe buffer at a reader that is gone —
 * and the two arms differ in exactly one thing: whether the guard is installed.
 * Both arms are deterministic and cost about a second.
 *
 * ⛔ This file deliberately does not touch, mirror or re-assert anything in
 * `run-dev-unbuilt-workspace.e2e.test.ts`. That file owns the unbuilt-workspace
 * cases; this one owns the write path underneath them.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transformSync } from 'esbuild';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const FIXTURE = resolve(HERE, 'fixtures/stderr-nonblocking-probe.mjs');
const SHIM = resolve(HERE, '../bin/run-dev.js');
const GUARD = resolve(HERE, '../src/utils/stderr-nonblocking.ts');

/**
 * The one ceiling here, and it is a CONSTANT on purpose.
 *
 * The lesson this file is downstream of is that a ceiling derived from a
 * calibration is a prediction about contention taken from a sample of the past,
 * and a shared runner will not honour it — two such ceilings were beaten here
 * before the last one became a constant. This one detects the same thing any
 * finite ceiling detects (a process that will never end) and is far above
 * anything either arm legitimately needs: the fixture is a bare `node` process
 * with no dependencies beyond node builtins and one 90-line module, and its
 * writes return in about a millisecond when they are not blocked.
 */
const HARD_CAP_MS = 60_000;

/**
 * How long the control arm is given AFTER it announces it is about to write.
 *
 * ⚠️ Read the direction of this one carefully. It is not an oracle over the
 * FIX — it only decides when to stop waiting for a child that is expected to be
 * frozen, and it starts counting from the child's own `WRITING` marker rather
 * than from spawn, so a slow boot cannot shorten it. If it were ever too short,
 * the control would call a healthy child frozen: a false GREEN in a positive
 * control, never a false red in the queue. And it cannot even do that quietly,
 * because an unblocked child reaches `WRITES RETURNED` in about a millisecond
 * and the control asserts that marker's ABSENCE.
 */
const FREEZE_GRACE_MS = 2_000;

interface Probe {
  code: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  marks: string;
}

let dir: string;
/** The guard, type-stripped into a module a bare `node` fixture can import. */
let guardModule: string;
let guarded: Probe;
let unguarded: Probe;

/**
 * Run the fixture against a pipe nobody reads, and report only how it ended
 * plus what it managed to say through the marker file.
 *
 * `killAfterWriting` is what makes the frozen arm cheap: it is armed only once
 * the child has said it reached the hazard.
 */
function runProbe(arm: 'guarded' | 'unguarded', killAfterWriting: boolean): Promise<Probe> {
  const marks = join(dir, `${arm}.marks`);
  writeFileSync(marks, '');
  const readMarks = (): string => {
    try {
      return readFileSync(marks, 'utf8');
    } catch {
      return '';
    }
  };
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [FIXTURE, marks, arm, guardModule], {
      env: childEnv({ NO_COLOR: '1' }),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // Nothing ever reads it. ⚠️ `pause()` alone does NOT starve the child: the
    // kernel pipe holds 64 KiB and node's readable buffer here absorbs about
    // another 64 KiB, and a fixture writing less than that reaches its own end
    // unblocked — measured, on the 192 KiB this was first written with. The
    // fixture now writes 2 MiB, which is past every absorber on the path.
    child.stderr?.pause();

    const started = Date.now();
    const cap = setTimeout(() => child.kill('SIGKILL'), HARD_CAP_MS);
    let grace: NodeJS.Timeout | undefined;
    const poll = killAfterWriting
      ? setInterval(() => {
          if (!grace && readMarks().includes('WRITING')) {
            grace = setTimeout(() => child.kill('SIGKILL'), FREEZE_GRACE_MS);
          }
        }, 50)
      : undefined;

    child.once('exit', (code, signal) => {
      clearTimeout(cap);
      if (grace) clearTimeout(grace);
      if (poll) clearInterval(poll);
      resolvePromise({ code, signal, elapsedMs: Date.now() - started, marks: readMarks() });
    });
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-stderr-nonblocking-'));
  // ⚠️ Type-stripped, not built. The guard moved to `src/` so `bin/run.js` can
  // reach a COMPILED copy from `dist/` (it is the published entry point and
  // nothing under `bin/` but itself is packed) — but this suite's whole subject
  // is the tree where nothing has been built, and the fixture is a bare `node`
  // process that cannot load a `.ts` file. `esbuild` is already a dependency of
  // this package and the file's only TypeScript is type annotations, so the
  // transform erases and copies rather than compiling. The SHIPPED `dist/` copy
  // is driven by `published-entry-stderr-nonblocking.e2e.test.ts`, through the
  // real entry point, which is where an emit difference would show up.
  guardModule = join(dir, 'stderr-nonblocking.mjs');
  writeFileSync(
    guardModule,
    transformSync(readFileSync(GUARD, 'utf8'), { loader: 'ts', format: 'esm', sourcefile: GUARD }).code,
  );
  unguarded = await runProbe('unguarded', true);
  guarded = await runProbe('guarded', false);
}, HARD_CAP_MS * 3);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('a stderr write must never park the event loop', () => {
  it('POSITIVE CONTROL: without the guard, the same child freezes and has to be killed', () => {
    // Not "it was killed" alone — that is also what a child too slow to have
    // started would look like. The markers say which: it reached the hazard,
    // armed it, announced the writes, and then said nothing more.
    expect(
      unguarded.marks,
      `the control never reached the hazard, so it measured NOTHING — this is a zero reading, not a pass. Markers:\n${unguarded.marks}`,
    ).toContain('WRITING');
    expect(
      unguarded.marks,
      `the hazard was not armed: fd 2 still had O_NONBLOCK after a spawn with inherited stdio, so this arm proves nothing about the guard. Markers:\n${unguarded.marks}`,
    ).not.toContain('HAZARD O_NONBLOCK=true');
    expect(
      unguarded.marks,
      `the unguarded child got PAST the blocking write, so this fixture no longer discriminates and the pin below is worthless. Markers:\n${unguarded.marks}`,
    ).not.toContain('WRITES RETURNED');
    expect(
      unguarded.signal,
      `the unguarded child ended on its own — the hazard did not bite, so the pin below has no control. Markers:\n${unguarded.marks}`,
    ).toBe('SIGKILL');
    // It stopped mid-loop rather than before it: the last progress marker is
    // where the main thread went into `write(2)` and did not come back.
    expect(
      unguarded.marks,
      `the control froze BEFORE any write landed, so it is not measuring the write path. Markers:\n${unguarded.marks}`,
    ).toContain('WROTE ');
  });

  it('THE PIN: with the guard, the same child issues every write and exits on its own', () => {
    const evidence = `ceiling ${HARD_CAP_MS} ms (constant, load-independent by design); this child ran ${guarded.elapsedMs} ms. Markers:\n${guarded.marks}`;
    // The guard reports what it did rather than being assumed to have run: on a
    // TTY or a plain file there is nothing to guard and it says so, and a
    // `false` here would make everything below a green over nothing.
    expect(guarded.marks, `the guard declined to install itself. ${evidence}`).toContain('GUARD true');
    expect(guarded.marks, `the guarded child never finished its writes. ${evidence}`).toContain('WRITES RETURNED');
    expect(guarded.signal, `the guarded child had to be killed — it was still alive at the ceiling. ${evidence}`).toBeNull();
    expect(guarded.code, `the guarded child did not exit with its own status. ${evidence}`).toBe(7);
  });

  it('the bytes are HELD by a live stream, not thrown away to buy the exit', () => {
    // ⚠️ The cheap way to make a blocking write stop blocking is to stop caring
    // about the bytes — destroy the stream, or swap it for a sink — and that
    // would pass every assertion above while deleting what `writeStderr` exists
    // to do. So the guarded arm has to show the writes were ACCEPTED and the
    // stream is intact.
    //
    // ⛔ Deliberately NOT asserted on `writableLength`, and the reason is a
    // measurement rather than taste: it reads **0** here on a healthy guarded
    // run, because libuv has taken all 192 KiB into its own write queue and
    // that counter only sees what the stream still holds above the handle. An
    // assertion that it is large would red on correct code — it was written
    // that way first and measured wrong before this comment existed.
    const written = Number(/bytesWritten=(\d+)/.exec(guarded.marks)?.[1]);
    expect(written, `no bytesWritten in the markers, so this reads nothing:\n${guarded.marks}`).not.toBeNaN();
    expect(written, `the guard did not accept the writes. Markers:\n${guarded.marks}`).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    expect(guarded.marks, `the guard reached its exit by destroying stderr. Markers:\n${guarded.marks}`).toContain(
      'destroyed=false',
    );
  });
});

describe('the shim installs the guard, and installs it in time', () => {
  it('calls it BEFORE run(), which is the whole of why it works', () => {
    // Comments are masked first, and that is not ceremony: this file's own
    // prose names the function, and `run-dev.js` names it twice in docblocks —
    // an unmasked search would find those and stay green with the call deleted.
    const shim = maskComments(readFileSync(SHIM, 'utf8'));
    const installed = shim.indexOf('keepStderrNonBlocking(');
    const started = shim.indexOf('run(process.argv.slice(2)');
    expect(shim, 'run-dev.js no longer imports the guard').toContain('../src/utils/stderr-nonblocking.ts');
    expect(installed, 'run-dev.js no longer calls keepStderrNonBlocking()').toBeGreaterThan(-1);
    expect(started, 'run-dev.js no longer calls run() — this parity case is reading the wrong file').toBeGreaterThan(-1);
    // oclif writes every one of its ~138 KB of warning blocks inside
    // `Config.load()`, i.e. inside `run()`. A guard installed after it is a
    // guard installed after the freeze.
    expect(
      installed,
      'the guard is installed AFTER run(), so oclif writes its warnings on the unguarded path and the hang comes back',
    ).toBeLessThan(started);
  });

  it('keeps the guard where the shim can reach it without a build', () => {
    // `bin/run-dev.js` exists to run from source in an UNBUILT tree, and it
    // reaches this file through `tsx`. A guard the shim could only reach behind
    // `dist/` would be missing in exactly the tree this whole suite is about —
    // which is why the move that put a COMPILED copy within reach of
    // `bin/run.js` had to leave the SOURCE within reach of this one, rather
    // than relocating the module wholesale.
    expect(readFileSync(GUARD, 'utf8')).toContain('export function keepStderrNonBlocking');
  });
});
