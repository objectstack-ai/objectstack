#!/usr/bin/env node

// The CLI entry point — `bin.objectstack` / `bin.os` in package.json, and the
// only file under `bin/` npm packs (it ships because it is the `bin` target;
// `files` never names the directory — see scripts/check-published-files.mjs).
//
// It used to be `await execute({ type: 'esm', dir: import.meta.url })`. What is
// inlined below IS `execute()` from @oclif/core 4.13.3, verbatim apart from the
// added lines, because `execute` swallows the error into `handle()` and
// there is no hook between the two. `handle()` writes the parse error and then
// a full usage dump; #10111 needs one unmistakable line to reach stderr FIRST,
// so a backgrounded runner that skims its log reads "the command never ran"
// instead of concluding that a server booted and died.
//
// ⛔ Nothing here changes which arguments the CLI accepts. `os dev --no-ui` is
// still rejected — it is only rejected legibly.
import { flush, handle, run } from '@oclif/core';

/**
 * Print the one-line invocation verdict, if this failure is one.
 *
 * Imported lazily, and deliberately: a static import of `../dist/` would make
 * an UNBUILT tree fail with `Cannot find module …/dist/utils/invocation.js`
 * instead of oclif's "command not found", which is the signature
 * `scripts/cli-build-prerequisite.mjs` classifies for every gate that shells
 * out to this CLI. The failure path is also the only path that needs it, so the
 * cost stays off every successful run.
 */
async function announceInvocationFailure(error) {
  try {
    const { invocationFailureLine } = await import('../dist/utils/invocation.js');
    const line = invocationFailureLine(error, process.argv.slice(2));
    if (line) process.stderr.write(`${line}\n`);
  } catch {
    // Unbuilt or half-built tree. Stay quiet rather than replacing oclif's
    // report with a module-resolution error about the reporter itself.
  }
}

// ⚠️ BEFORE `run()`, and that order is the whole point rather than tidiness.
//
// Node puts fd 2 on the NON-blocking path when it opens the pipe, and libuv
// clears that flag again in the pre-exec of any child spawned with inherited
// stdio — on the SHARED open file description, so the spawner loses it too.
// This binary is the one that spawns: `os dev` starts `os serve --dev` with
// inherited stdio, and that child starts the esbuild service with inherited
// stderr. Measured on the built binary with its output piped to a reader that
// stopped draining: fd 2 was left blocking from 5.2 s onward and the main
// thread then sat in `write(2)` (`wchan=sock_alloc_send_pskb`) 3.1 s later, 4
// of 4 runs — alive, idle, ignoring SIGINT, empty log, released only when the
// consumer resumed. `src/utils/stderr-nonblocking.ts` carries the whole
// derivation, including why the re-assert has to sit on the write path rather
// than run once here: the clearing that persisted came from a GRANDCHILD this
// process does not spawn and cannot see.
//
// Everything the CLI writes to stderr is written after this point — oclif's own
// output starts inside `Config.load()`, i.e. inside `run()` — so a guard
// installed here has not missed a write.
//
// Lazily imported for the reason `announceInvocationFailure` states above: a
// STATIC `../dist/` import would turn an unbuilt tree's "command not found"
// into a module-resolution error and break the classification every gate that
// shells out to this CLI depends on. ⛔ The `catch` therefore degrades to the
// behaviour this file had before the guard existed; it must never become a
// report, because the only stream it could report on is the one being repaired.
try {
  const { keepStderrNonBlocking } = await import('../dist/utils/stderr-nonblocking.js');
  keepStderrNonBlocking();
} catch {
  // Unbuilt or half-built tree — nothing to install and nothing to say.
}

/**
 * Make a FAILED stderr write non-fatal, so a caller whose read end is gone
 * still gets this CLI's own exit status instead of a crash. #14858, reached on
 * THIS entry point by the #15564 measurement.
 *
 * `process.stderr` is an `EventEmitter`, and an `error` event with nothing
 * listening IS an uncaught exception. `bin/run-dev.js` has carried this
 * listener since #14858; the published entry did not, and #15564 was filed
 * NOT REPRODUCED because the two probes that had been run against it — a
 * bad command id, and `OBJECTSTACK_DEBUG=1` over an unbuilt `@objectstack/spec`
 * — both answered exit 2 with no `uncaughtException`. Re-run here, they still
 * do (3/3 each, 57 and 35528 bytes drained). ⭐ They were not a guard; they
 * were the wrong lifecycle, and the difference is measurable rather than
 * arguable:
 *
 *     leg (bin/run.js, read end destroyed)      stderr writes   exit
 *     ---------------------------------------   -------------   ----------------
 *     `definitely-not-a-command`                1 @ 3231 ms      2, no crash
 *     OBJECTSTACK_DEBUG=1 + unbuilt spec       60 @ 932-960 ms   2, no crash
 *     `serve objectstack.config.ts`            21 @ 3180 ms on   1, `write EPIPE`
 *                                                                  3/3
 *
 * Two things separate the last row, and BOTH are needed:
 *
 *   • an event-loop TURN between the failing write and `process.exit`. A
 *     failing write reports through libuv's completion callback, so a write
 *     followed by a synchronous exit is never told. Both probe legs are that
 *     shape: everything they put on stderr is written after `run()` has already
 *     settled, by `handle()`, which exits on top of its own report — measured
 *     at one write 1 ms before exit, and at 59 warning blocks whose EPIPE
 *     arrives synchronously inside the write.
 *   • a RAW `process.stderr.write`. Node's `console.error` carries
 *     `ignoreErrors`: its write CALLBACK re-attaches a `noop` `error` listener
 *     when the completion reports one — so oclif's warning blocks cannot crash
 *     this process at any size (measured: 1 MiB through `console.error` does
 *     not, one line through `process.stderr.write` does, 3/3 each).
 *
 *     ⚠️ That protection is CONDITIONAL, and the condition is a fact about THIS
 *     process rather than about `console.error`: the callback re-attaches only
 *     `if (stream.listenerCount('error') === 0)`. Here nothing else ever listens
 *     — measured, the only `error` listener on `process.stderr` for a whole run
 *     is this file's own, below. `bin/run-dev.js` runs under `tsx`, which
 *     registers an off-thread module-customization hook; node pipes that
 *     worker's stderr into `process.stderr`, `Stream.prototype.pipe` prepends an
 *     `onerror` there, the count is 1, the keep-alive is never installed, and
 *     ONE SHORT `console.error` crashes 3/3 (#16691). ⛔ So "a `console.error`
 *     site needs no guard" is never a general reading of this paragraph.
 *
 * `os serve` is both: `printDiagnostic` in `src/commands/serve.ts` writes
 * straight to stderr (#7915) and the boot around it is asynchronous, so the
 * process is alive across the whole sequence. Measured on `examples/app-todo`
 * through this file, read end destroyed (`stdio: ['ignore','ignore','pipe']`,
 * then `child.stderr.destroy()`), traced with a `--import` observer that
 * installs NO listener here and wraps no write:
 *
 *     uncaughtException  code=EPIPE  msg=write EPIPE
 *           at afterWriteDispatched (node:internal/stream_base_commons:159:15)
 *     exit  code=1
 *
 * 3 of 3 runs, 3049-3433 ms in — the same frame and the same status #14858
 * traced on the dev shim. The same child read by a draining parent boots and
 * serves, exit 0 at a 20 s SIGTERM, having written 7926 bytes over 16.6 s. So
 * the crash costs the run at its FIRST diagnostic line and 20 of its 21 stderr
 * writes, on the entry point a customer's install actually runs (`files` names
 * only `dist`, but npm packs a `bin` target regardless — #14874).
 *
 * ⛔ Deliberately NOT narrowed to `error.code === 'EPIPE'`, for the reason
 * `bin/run-dev.js` records: the reason to tolerate is not WHICH error it is.
 * Every event here means one thing — a write to stderr failed — the only
 * channel it could be reported on is the stream that just failed, and there is
 * no other action to take.
 *
 * ⚠️ What it costs: a long-running command whose reader has gone now keeps
 * running instead of dying on its first diagnostic. That is the point (the
 * server is still serving, and its caller still gets the CLI's own status), but
 * it is a real behaviour change for a supervisor that destroyed the read end
 * and relied on the crash to end the child.
 */
// ⚠️ NAMED, and not for tidiness. Node parks an anonymous `once('error')` on
// this stream for the duration of a `console.error` (`ignoreErrors`), so
// "something is listening" is briefly true in any process and cannot tell this
// listener apart from that one — a pin that polled the COUNT passed against a
// tree with this whole block deleted, measured. The name is what
// `published-entry-stderr-error-listener.test.ts` waits for and asserts on;
// it also puts a legible frame in any listener dump.
process.stderr.on('error', function objectstackStderrErrorIsNotFatal() {
  // Nothing to report, and nowhere left to report it.
});

await run(process.argv.slice(2), import.meta.url)
  .then(async (result) => {
    flush();
    return result;
  })
  .catch(async (error) => {
    await announceInvocationFailure(error);
    return handle(error);
  });
