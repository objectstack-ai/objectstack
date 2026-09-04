// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stderr hazard, manufactured INSIDE the published entry point's own
 * process — driven by `published-entry-stderr-nonblocking.e2e.test.ts`.
 *
 * Loaded with `node --import <this> bin/run.js …`, so everything below runs in
 * the same process as the shipped CLI, on the same open file description, after
 * `bin/run.js` has had its chance to install `keepStderrNonBlocking()`. Its
 * sibling `stderr-nonblocking-probe.mjs` proves the GUARD works; this one
 * proves the published binary actually has it, on the compiled copy that ships.
 *
 * ## Why the hazard is manufactured here too
 *
 * The field reproduction is a real `os dev`: it spawns `os serve --dev` with
 * inherited stdio, that child spawns the esbuild service with inherited stderr,
 * and fd 2 is left blocking from ~5 s onward for the rest of the run. Measured
 * on the built binary, that parks the main thread in `write(2)` 3.1 s after a
 * reader stops — but it needs a fixture app, a dev server, a reader that stops
 * at the right moment and a BURST of output while it is away (at the default
 * log level an idle dev server emits ~0.5 KB/s and never fills the 64 KiB pipe,
 * so 90 s of stopped reader produced no park at all). None of that belongs in a
 * pin. `spawnSync(node -e 0, { stdio: 'inherit' })` clears the same flag on the
 * same shared description in ~30 ms, which is the whole of what the grandchild
 * did, and the burst is written deliberately instead of waited for.
 *
 * ## What it refuses to assume
 *
 * It waits for the guard but does NOT require it, and says which it saw. A
 * probe that gave up when the guard was absent would report "the guard is
 * missing" for the one case that has to be legible in the other direction — the
 * ablation, where the point is to watch the write PARK. So both arms reach the
 * same writes and the harness reads the outcome.
 *
 * Markers go to a file: stderr is the thing under test and, when this fails, the
 * thing that is blocked.
 *
 * env: `OS_PUBLISHED_ENTRY_PROBE_MARKS` — the marker file.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

/** Set by `keepStderrNonBlocking()` on the stream it has wrapped. */
const INSTALLED = Symbol.for('objectstack.stderr-nonblocking');

/**
 * How long to wait for `bin/run.js` to install the guard before proceeding
 * anyway.
 *
 * A CONSTANT, and far above anything the install legitimately needs: it happens
 * at the top of `bin/run.js`, after one dynamic `import()` of a dependency-free
 * module, and every `@oclif/core` byte is written later, inside `run()`. The
 * bound exists only so an absent guard is REPORTED rather than hung on — it is
 * not an oracle over how fast the install is, and the harness asserts the mark
 * this produces rather than the number in it.
 */
const GUARD_WAIT_MS = 15_000;

/** Comfortably finer than anything being timed. */
const POLL_MS = 10;

const MARKS = process.env.OS_PUBLISHED_ENTRY_PROBE_MARKS;
const mark = (line) => appendFileSync(MARKS, `${line}\n`);

/**
 * The flag itself, read from the kernel rather than inferred.
 *
 * Linux-only. `unreadable` elsewhere, and the harness treats that as "cannot
 * confirm" instead of quietly assuming the hazard was armed — the one reading
 * that would make this vacuous is `true`, and only that one is refused.
 */
function nonBlocking() {
  try {
    const flags = /flags:\s*(\d+)/.exec(readFileSync('/proc/self/fdinfo/2', 'utf8'))?.[1];
    return flags === undefined ? 'unreadable' : String((parseInt(flags, 8) & 0o4000) !== 0);
  } catch {
    return 'unreadable';
  }
}

function armAndWrite() {
  mark(`BEFORE SPAWN O_NONBLOCK=${nonBlocking()}`);
  // libuv clears O_NONBLOCK on fds 0-2 in the child's pre-exec, and inheriting
  // is `dup2`, so the flag — which lives on the shared open file description —
  // is cleared for THIS process too. `os dev` does exactly this at
  // `dev.ts:471`; so does the esbuild service two levels below it.
  spawnSync(process.execPath, ['-e', '0'], { stdio: 'inherit' });
  mark(`HAZARD O_NONBLOCK=${nonBlocking()}`);

  mark('WRITING');
  // 2 MiB, sized past every absorber on the path: the kernel pipe holds 64 KiB
  // and the parent's own readable buffer about as much again, so ~128 KiB can
  // disappear before a writer ever meets backpressure.
  const chunk = 'x'.repeat(8 * 1024);
  let backpressured = 0;
  for (let i = 0; i < 256; i++) {
    if (process.stderr.write(chunk) === false) backpressured += 1;
    // Progress, so a frozen run shows WHERE it stopped rather than only that it
    // never finished — the difference between evidence and an empty timeout.
    if ((i + 1) % 4 === 0) mark(`WROTE ${(i + 1) * 8} KiB`);
  }
  mark(
    `WRITES RETURNED bytesWritten=${process.stderr.bytesWritten} ` +
      `destroyed=${process.stderr.destroyed} backpressured=${backpressured}`,
  );

  // A distinctive status, so "exited on its own" is evidence about THIS probe
  // rather than about any process that happens to end in 0 or 1.
  process.exit(7);
}

let waited = 0;
// ⛔ NOT unref'd: this timer is what keeps the process alive until the probe has
// run, and an unref'd one would let the CLI's own exit race it away.
const poll = setInterval(() => {
  const installed = process.stderr[INSTALLED] === true;
  if (!installed && waited < GUARD_WAIT_MS) {
    waited += POLL_MS;
    return;
  }
  clearInterval(poll);
  mark(installed ? `GUARD INSTALLED after ${waited} ms` : `GUARD ABSENT after ${waited} ms`);
  armAndWrite();
}, POLL_MS);
