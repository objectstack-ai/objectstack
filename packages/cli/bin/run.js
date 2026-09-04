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

await run(process.argv.slice(2), import.meta.url)
  .then(async (result) => {
    flush();
    return result;
  })
  .catch(async (error) => {
    await announceInvocationFailure(error);
    return handle(error);
  });
