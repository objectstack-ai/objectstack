// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The #14858 crash class, manufactured INSIDE the published entry point's own
 * process — driven by `published-entry-stderr-error-listener.test.ts`.
 *
 * Loaded with `node --import <this> bin/run.js …` against a read end the parent
 * has destroyed, so everything below runs in the same process as the shipped
 * CLI, on the same open file description, after `bin/run.js` has had its chance
 * to attach the `error` listener.
 *
 * ## Why the failing write is manufactured rather than taken from a command
 *
 * The field reproduction is `os serve`: `printDiagnostic` writes straight to
 * stderr (#7915), the boot around it is asynchronous, and #15564 measured the
 * published entry dying there — `write EPIPE` at `afterWriteDispatched`, exit
 * 1, 3 of 3 runs, 3049-3433 ms in. Reproducing THAT needs a fixture app, a
 * database, a bound port and four seconds per leg, and it pins the crash to one
 * command that could stop writing raw tomorrow. What the entry point owes is
 * narrower and does not move: **a failed stderr write in this process must not
 * be fatal.** One raw write to a destroyed pipe is the whole of that hazard,
 * and it costs milliseconds.
 *
 * ⛔ The write is deliberately `process.stderr.write` and NOT `console.error`.
 * Node's `console.error` carries `ignoreErrors`, which parks a temporary
 * `error` listener across the write, so it cannot crash a process at any
 * payload size — measured at 1 MiB, 0 of 3, against one line through
 * `process.stderr.write` at 3 of 3. A probe written with `console.error` would
 * be green with the listener REMOVED, which is the one thing it must not be.
 *
 * ## The two arms, and why the unguarded one is not an ablation
 *
 * `OS_PUBLISHED_ENTRY_ERROR_PROBE_ARM=unguarded` makes this probe remove the
 * entry's listener in its own process before writing. That is the harness's
 * LIVE POSITIVE CONTROL: it shows, in the same run and against the same tree,
 * that this instrument can still see the crash — so the guarded arm's silence
 * is a reading rather than a zero. Nothing on disk is touched, so it costs no
 * restore and cannot leave a mutated tree behind.
 *
 * Markers go to a file: stderr is the thing under test and, on the arm that is
 * supposed to fail, the thing that is already broken.
 *
 * ## Why it waits for a NAMED listener and not for a count
 *
 * Node parks an anonymous `once('error', noop)` on this stream for the duration
 * of every `console.error` (`ignoreErrors`), so `listenerCount('error') > 0` is
 * briefly true in any process. An earlier version of this probe polled the
 * count, and under the ablation that deletes the entry's listener entirely it
 * still reported `LISTENER ATTACHED after 20 ms` — a green reading against a
 * tree with nothing guarding it. The name is the only thing that identifies
 * THIS listener, so it is what the poll waits for.
 *
 * env: `OS_PUBLISHED_ENTRY_ERROR_PROBE_MARKS` — the marker file.
 * env: `OS_PUBLISHED_ENTRY_ERROR_PROBE_ARM`   — `guarded` (default) | `unguarded`.
 */

import { appendFileSync } from 'node:fs';

const MARKS = process.env.OS_PUBLISHED_ENTRY_ERROR_PROBE_MARKS;
const UNGUARDED = process.env.OS_PUBLISHED_ENTRY_ERROR_PROBE_ARM === 'unguarded';

const mark = (line) => appendFileSync(MARKS, `${line}\n`);

/**
 * How long to wait for `bin/run.js` to attach its listener before proceeding
 * anyway.
 *
 * A CONSTANT, and far above anything the attach legitimately needs: it happens
 * at the top of `bin/run.js`, after one dynamic `import()` of a dependency-free
 * module, and every `@oclif/core` byte is written later, inside `run()`. The
 * bound exists only so an absent listener is REPORTED rather than waited on
 * forever — it is not an oracle over how fast the attach is, and the harness
 * asserts the mark this produces rather than the number in it.
 */
const ATTACH_WAIT_MS = 15_000;

/** Comfortably finer than anything being timed. */
const POLL_MS = 10;

/**
 * The listener `bin/run.js` attaches, by name. Mirrored rather than imported —
 * that file runs the CLI at module top, so there is nothing to import from it —
 * and held equal to the entry's spelling by a case in the driving suite, the
 * same discipline `run-dev-unbuilt-workspace.e2e.test.ts` uses for the shim's
 * drain bound.
 */
const LISTENER_NAME = 'objectstackStderrErrorIsNotFatal';

/** Is the entry's OWN listener on the stream right now? */
const guardAttached = () => process.stderr.listeners('error').some((fn) => fn?.name === LISTENER_NAME);

/**
 * ⛔ This probe installs NO `error` listener of its own on `process.stderr`.
 * `uncaughtExceptionMonitor` observes the default action without preventing it,
 * so an unguarded run still dies exactly as it would unobserved — an
 * `uncaughtException` handler would have changed the very thing being read.
 */
process.on('uncaughtExceptionMonitor', (error) => {
  mark(`UNCAUGHT code=${error?.code} msg=${error?.message}`);
});

process.on('exit', (code) => mark(`EXIT code=${code}`));

function writeAndOutliveIt() {
  // ONE raw write. The read end is already gone, so this fails; whether that
  // failure is fatal is the entire subject.
  process.stderr.write('published-entry-stderr-error-probe: one line to a read end that is gone\n');
  mark('WROTE');

  // ⚠️ The turn is the point, not the delay. A failing write reports through
  // libuv's completion callback, so a write followed by a SYNCHRONOUS exit is
  // never told at all — which is exactly why the two probes on #15564's card
  // read clean, and why a probe that exited here would reproduce their zero
  // reading instead of testing anything.
  //
  // ⛔ NOT unref'd: this timer is what keeps the process alive across that
  // turn, and an unref'd one would let the CLI's own exit race it away.
  setTimeout(() => {
    mark('SURVIVED');
    // A distinctive status, so "ended on its own past the write" is evidence
    // about THIS probe rather than about any process that happens to exit 0.
    process.exit(7);
  }, 250);
}

let waited = 0;
const poll = setInterval(() => {
  const attached = guardAttached();
  if (!attached && waited < ATTACH_WAIT_MS) {
    waited += POLL_MS;
    return;
  }
  clearInterval(poll);
  mark(attached ? `LISTENER ATTACHED after ${waited} ms` : `LISTENER ABSENT after ${waited} ms`);
  // The raw count too, as EVIDENCE in a failure message — never as the oracle.
  mark(`LISTENERS count=${process.stderr.listenerCount('error')}`);
  if (UNGUARDED) {
    // The live positive control — in this process only, never on disk.
    //
    // ⛔ BY NAME, not `removeAllListeners('error')`. The two are equivalent on
    // today's tree, but the control has to measure "the ENTRY's listener is
    // absent"; clearing the stream measures "no listener at all", and the day
    // anything else attaches one here — a library, a future prologue, node
    // itself — that would silently become a different experiment from the one
    // the driving case claims to run.
    for (const fn of process.stderr.listeners('error')) {
      if (fn?.name === LISTENER_NAME) process.stderr.removeListener('error', fn);
    }
    mark(`ARM unguarded listeners=${process.stderr.listenerCount('error')} guard=${guardAttached()}`);
  } else {
    mark(`ARM guarded listeners=${process.stderr.listenerCount('error')}`);
  }
  writeAndOutliveIt();
}, POLL_MS);
