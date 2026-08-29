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

/**
 * Every module-load failure oclif reported while building its command table
 * (#12964), in emission order. Filled by the listener attached below.
 *
 * It HAS to be collected as it happens. `findCommand` `import()`s every command
 * module while `Config.load()` runs, warns on each one that will not load, and
 * then throws a plain "command … not found" that carries none of it — so by the
 * time the `.catch()` below holds the error, the only cause worth naming has
 * already gone past. `warning.detail` is where oclif puts the failing specifier.
 */
const moduleLoadFailures = [];

/**
 * The other reading of "command … not found": the command is there and its
 * MODULE would not load, because a workspace package this repo builds has no
 * usable `dist/`. See `scripts/cli-unbuilt-workspace-lead.mjs` for the whole
 * argument, including why the CLI's name is passed IN rather than imported
 * there.
 *
 * Lazy and `catch`-wrapped for the same reason as `announceInvocationFailure`:
 * a reporter that throws must never become the report.
 */
async function announceUnbuiltWorkspace(error) {
  try {
    const [{ unbuiltWorkspaceLines }, { INVOCATION_PREFIX }] = await Promise.all([
      import('../../../scripts/cli-unbuilt-workspace-lead.mjs'),
      import('../src/utils/invocation.ts'),
    ]);
    for (const line of unbuiltWorkspaceLines(error, moduleLoadFailures, INVOCATION_PREFIX) ?? []) {
      process.stderr.write(`${line}\n`);
    }
  } catch {
    // Stay quiet rather than replacing oclif's report with an error about the
    // reporter itself.
  }
}

process.env.NODE_ENV = 'development';
settings.debug = true;

const running = run(process.argv.slice(2), import.meta.url);

// ⚠️ ATTACHED AFTER `run()`, and that order is load-bearing rather than style.
// @oclif/core installs a `warning` listener of its own — `displayWarnings()` in
// `config/config.js`, which is what prints the `Warning: ModuleLoadError` stack
// plus `detail` under `settings.debug` — but it installs it ONLY when
// `process.listenerCount('warning') <= 1`, i.e. only node's own default is
// attached. A collector attached before `run()` makes that count 2, oclif
// silently declines to install, and every failing run through this shim quietly
// loses those blocks (measured on the #12964 repro: 1518 lines of report became
// 476, with nothing saying why).
//
// `run()` reaches `Config.load()` — and `displayWarnings()` inside it — in its
// SYNCHRONOUS prefix (`main.js`: `await Config.load(...)` is its first `await`;
// `config.js`: `displayWarnings()` precedes `load()`'s first `await`), and
// `process.emitWarning` defers to `nextTick`, so a listener attached here is
// installed second and still sees every warning. `run-dev-unbuilt-workspace.e2e`
// asserts oclif's blocks are still there, so a future oclif that moves that call
// past an `await` fails a test instead of going quiet.
process.on('warning', (warning) => {
  const detail = warning?.detail;
  if (typeof detail === 'string' && detail) moduleLoadFailures.push(detail);
});

await running
  .then(async (result) => {
    flush();
    return result;
  })
  .catch(async (error) => {
    await announceInvocationFailure(error);
    await announceUnbuiltWorkspace(error);
    return handle(error);
  });
