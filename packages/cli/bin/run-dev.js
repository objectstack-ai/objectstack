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

/**
 * Long enough for a reader that is merely slow; bounded so a reader that never
 * reads at all cannot strand the failure path. `flush()` is no help here — it
 * drains STDOUT, and only on the success path.
 */
const STDERR_DRAIN_TIMEOUT_MS = 10_000;

/**
 * Write to stderr and WAIT for the bytes to reach it.
 *
 * ⚠️ `process.stderr.write(x)` followed by an exit is the #6531 defect, and
 * this shim had it. When stderr is a **pipe** node buffers the write
 * asynchronously and `process.exit` tears the process down with the buffer only
 * partly drained; `src/utils/format.ts` carries the whole argument for stdout
 * (`emitJson`). One thing makes it worse here: `settings.debug` is on, so
 * oclif's `displayWarnings()` has already queued ~138 KB of `ModuleLoadError`
 * blocks AHEAD of these lines. Measured on the #12964 repro with a reader that
 * was not draining: the pipe delivered exactly one 64 KiB buffer and everything
 * after it was lost — this diagnostic AND oclif's own `command … not found`,
 * which `handle()` writes a moment later and which the same tear-down takes.
 * That is why the merge queue saw it and a developer's terminal never does: a
 * TTY is written synchronously, a captured pipe is not.
 *
 * The `write` callback fires only once this chunk **and everything queued ahead
 * of it** has been handed to the pipe, so awaiting it drains that backlog too —
 * which is what leaves an empty buffer for `handle()`'s own write. The fix
 * belongs at the write rather than at the exit because there is no hook between
 * `handle()`'s `console.error` and its `process.exit`.
 *
 * ⛔ Deliberately NOT `process.stderr._handle.setBlocking(true)`: `format.ts`
 * records why — the same binary runs `os serve` / `os dev`, and a blocking
 * write to a pipe with a slow reader stalls the event loop.
 */
function writeStderr(text) {
  return new Promise((resolve) => {
    if (process.stderr.write(text, () => resolve())) return;
    // Backpressure: the callback lands when the reader catches up. The cap is
    // unref'd so it never keeps the process alive on its own.
    setTimeout(resolve, STDERR_DRAIN_TIMEOUT_MS).unref();
  });
}

/** See `bin/run.js` — the same lazy import, against `src/` instead of `dist/`. */
async function announceInvocationFailure(error) {
  try {
    const { invocationFailureLine } = await import('../src/utils/invocation.ts');
    const line = invocationFailureLine(error, process.argv.slice(2));
    if (line) await writeStderr(`${line}\n`);
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
    // One write, so the drain that matters happens once, immediately before
    // `handle()` gets its turn at the same pipe.
    const lines = unbuiltWorkspaceLines(error, moduleLoadFailures, INVOCATION_PREFIX) ?? [];
    if (lines.length) await writeStderr(`${lines.join('\n')}\n`);
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
