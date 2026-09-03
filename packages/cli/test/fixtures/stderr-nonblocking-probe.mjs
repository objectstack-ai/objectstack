// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The hazard `bin/stderr-nonblocking.mjs` exists for, MANUFACTURED rather than
 * waited for — driven by `run-dev-stderr-nonblocking.e2e.test.ts`.
 *
 * ⚠️ The reason this fixture exists at all is that the real occurrence is
 * INTERMITTENT: over the real CLI it reproduced 27 of 30 runs on a cold `tsx`
 * transform cache and 1 of 90 on a warm one. A pin that drove the real child
 * would therefore be green most of the time on a developer box while the defect
 * was fully present — a test that only fails intermittently is not a pin. So
 * this fixture reproduces the CONDITION deterministically and in ~200 ms:
 *
 *   1. materialise `process.stderr`, which is when node opens the pipe and sets
 *      `O_NONBLOCK` on it — the state every healthy run starts in;
 *   2. spawn a trivial child with INHERITED stdio. libuv clears `O_NONBLOCK` on
 *      fds 0-2 in the child's pre-exec, and inheriting is `dup2`, so the flag —
 *      which lives on the shared open file description — is cleared for THIS
 *      process too. In the real defect this spawn is the esbuild service that
 *      `tsx` starts when it has to transform a module; nothing about the
 *      mechanism needs it to be esbuild;
 *   3. write far past every buffer on the path (2 MiB, against ~128 KiB of
 *      kernel pipe plus the parent's own readable buffer) to a reader that is
 *      never coming back.
 *
 * With the flag cleared, step 3 parks the MAIN THREAD inside `write(2)` and the
 * event loop stops: no timer, no callback, no bound of any kind can run, and the
 * process ends only when someone reads the pipe or kills it. With the guard
 * installed, the same writes queue in userland and the process exits on its own.
 *
 * Every step announces itself into a MARKER FILE rather than onto stderr —
 * stderr is the thing under test and, in the failing arm, the thing that is
 * blocked. The markers are what let the harness tell "froze at the write" from
 * "was still booting", so its verdict never rests on wall clock alone.
 *
 * argv: `<marker file> guarded|unguarded`
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

import { keepStderrNonBlocking } from '../../bin/stderr-nonblocking.mjs';

const [, , MARKS, ARM] = process.argv;
const mark = (line) => appendFileSync(MARKS, `${line}\n`);

/**
 * The flag itself, read from the kernel rather than inferred.
 *
 * Linux-only. `unreadable` elsewhere, and the harness treats that as "cannot
 * confirm" instead of quietly assuming the hazard was armed — the one reading
 * that would make the control vacuous is `true`, and only that one is refused.
 */
function nonBlocking() {
  try {
    const flags = /flags:\s*(\d+)/.exec(readFileSync('/proc/self/fdinfo/2', 'utf8'))?.[1];
    return flags === undefined ? 'unreadable' : String((parseInt(flags, 8) & 0o4000) !== 0);
  } catch {
    return 'unreadable';
  }
}

// Touching the stream is what materialises it; `writableLength` is the cheapest
// touch that cannot itself write anything.
void process.stderr.writableLength;
mark(`START O_NONBLOCK=${nonBlocking()}`);

spawnSync(process.execPath, ['-e', '0'], { stdio: 'inherit' });
mark(`HAZARD O_NONBLOCK=${nonBlocking()}`);

if (ARM === 'guarded') mark(`GUARD ${keepStderrNonBlocking()}`);

mark('WRITING');
const chunk = 'x'.repeat(8 * 1024);
// ⚠️ 2 MiB, and the size is a MEASUREMENT rather than a round number. A reader
// that is merely paused is not the only absorber: the kernel pipe holds 64 KiB
// and node's own readable buffer in the parent holds about another 64 KiB, so
// ~128 KiB can disappear before the writer ever meets backpressure. 192 KiB was
// tried first and the unguarded arm reached the end of its loop unblocked on
// one run in two — a control that green-lights the very hazard it exists to
// prove. 2 MiB is 16x that headroom, so no absorber on this path can swallow it.
let backpressured = 0;
for (let i = 0; i < 256; i++) {
  if (process.stderr.write(chunk) === false) backpressured += 1;
  // Progress, so a frozen arm shows WHERE it stopped rather than only that it
  // never finished — the difference between evidence and an empty timeout.
  //
  // ⚠️ Every 4 chunks (32 KiB), not every 32. The block lands around chunk 16 —
  // one kernel pipe plus one reader-side buffer in — so a coarser interval puts
  // the FIRST marker after the freeze, and the control then reads "froze before
  // any write landed" on a perfectly good reproduction. Measured that way.
  if ((i + 1) % 4 === 0) mark(`WROTE ${(i + 1) * 8} KiB`);
}
// ⚠️ `pending` is reported but deliberately NOT the evidence that the bytes
// were kept. Measured: it reads 0 here even on a perfectly healthy guarded run,
// because libuv has taken every chunk into its own write queue and
// `writableLength` only counts what the STREAM still holds above the handle.
// `bytesWritten` and `destroyed` are the readings that separate "buffered" from
// "thrown away", so those are what the harness asserts on.
mark(
  `WRITES RETURNED pending=${process.stderr.writableLength} bytesWritten=${process.stderr.bytesWritten} ` +
    `destroyed=${process.stderr.destroyed} backpressured=${backpressured}`,
);

// A distinctive status, so "exited on its own" is evidence about THIS file
// rather than about any process that happens to end in 0 or 1.
process.exit(7);
