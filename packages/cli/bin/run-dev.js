#!/usr/bin/env tsx

// The SOURCE entry point — same CLI, run from `src/` through tsx, used by this
// repo's gates and e2e suites so they do not depend on `packages/cli/dist`
// having been built. Not published (`files` does not name `bin/`, and only the
// `bin` target itself is packed automatically).
//
// The body is `execute({ development: true })` from @oclif/core 4.13.3 inlined,
// for the reason `bin/run.js` states: `execute` hands the error straight to
// `handle()`, which prints a usage dump, and #10111 needs one unmistakable line
// to land on stderr before it. `NODE_ENV` and `settings.debug` are what
// `development: true` sets — they are set here so this shim keeps behaving
// exactly as it did.
import { flush, handle, run, settings } from '@oclif/core';

/** See `bin/run.js` — the same lazy import, against `src/` instead of `dist/`. */
async function announceInvocationFailure(error) {
  try {
    const { invocationFailureLine } = await import('../src/utils/invocation.ts');
    const line = invocationFailureLine(error, process.argv.slice(2));
    if (line) process.stderr.write(`${line}\n`);
  } catch {
    // Stay quiet rather than replacing oclif's report with an error about the
    // reporter itself.
  }
}

process.env.NODE_ENV = 'development';
settings.debug = true;

await run(process.argv.slice(2), import.meta.url)
  .then(async (result) => {
    flush();
    return result;
  })
  .catch(async (error) => {
    await announceInvocationFailure(error);
    return handle(error);
  });
