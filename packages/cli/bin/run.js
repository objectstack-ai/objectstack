#!/usr/bin/env node

// The CLI entry point — `bin.objectstack` / `bin.os` in package.json, and the
// only file under `bin/` npm packs (it ships because it is the `bin` target;
// `files` never names the directory — see scripts/check-published-files.mjs).
//
// It used to be `await execute({ type: 'esm', dir: import.meta.url })`. What is
// inlined below IS `execute()` from @oclif/core 4.13.3, verbatim apart from the
// one added line, because `execute` swallows the error into `handle()` and
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

await run(process.argv.slice(2), import.meta.url)
  .then(async (result) => {
    flush();
    return result;
  })
  .catch(async (error) => {
    await announceInvocationFailure(error);
    return handle(error);
  });
