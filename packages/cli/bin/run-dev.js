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
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { flush, handle, run, settings } from '@oclif/core';

import { keepStderrNonBlocking } from '../src/utils/stderr-nonblocking.ts';

/**
 * How long stderr may make NO PROGRESS before this shim stops waiting for it.
 *
 * A wall-clock deadline is the wrong instrument: it cannot tell a reader that
 * is merely SLOW from one that is ABSENT, and those two want opposite answers —
 * the slow one must be waited for (it is the whole point of this file), the
 * absent one must never be (nobody is reading, so the bytes are worthless).
 * Progress separates them exactly: a live reader keeps draining however slowly,
 * an absent one drains nothing, ever.
 *
 * ## Where the number comes from — re-derive it, do not bump it
 *
 *   • A live reader under real load never stalled longer than **61 ms**: two
 *     samples of a vitest worker's event loop while this package's e2e suite
 *     ran beside it (12 680 and 9 663 samples of a 10 ms timer; p999 = 24/25 ms,
 *     max = 61/57 ms).
 *   • The stall that actually loses these bytes has to span the CLI's WHOLE
 *     RUN, not just an instant: the bulk (~138 KB of oclif warnings) is emitted
 *     during `Config.load()`, the diagnostic ~3 s later, and the bytes are only
 *     lost if the child exits while the reader is away. So the bound must
 *     outlast a whole run. Measured child runtime: **1.0 s idle, 6.9 s on a
 *     contended box** (same container, other agents building).
 *
 * 15 s is ~2.2x that worst measured runtime, so a stall long enough to cause
 * the bug is still waited out, and ~245x the worst measured live-reader stall,
 * so a merely slow reader is never cut off.
 *
 * ⚠️ Exceeding the bound degrades to the behaviour this file had BEFORE the
 * drain existed — lossy, but prompt. It can never degrade to a hang, which is
 * the property that matters: the failure this replaced was unbounded.
 */
const STDERR_DRAIN_STALL_MS = 15_000;

/** How often progress is sampled — comfortably under the 61 ms above. */
const STDERR_DRAIN_POLL_MS = 50;

/**
 * Write to stderr and WAIT for the bytes to reach it.
 *
 * ⚠️ `process.stderr.write(x)` followed by an exit is the #6531 defect, and
 * this shim had it. When stderr is a **pipe** node buffers the write
 * asynchronously and `process.exit` tears the process down with the buffer only
 * partly drained; `src/utils/format.ts` carries the whole argument for stdout
 * (`emitJson`). One thing makes it worse here: `settings.debug` is on, so
 * ~143 KB of `ModuleLoadError` blocks is already queued AHEAD of these lines —
 * three quarters of it from oclif's `displayWarnings()` and the rest from node's
 * OWN default `warning` handler, which stays attached and prints every warning
 * as well (#16691, drained run: 147 729 bytes over 179 writes, 111 751 of them
 * from `config.js`, 35 133 from `internal/process/warning.js`). Measured on the
 * #12964 repro with a reader that was not draining: the pipe delivered exactly
 * one 64 KiB buffer and everything after it was lost — this diagnostic AND
 * oclif's own `command … not found`, which `handle()` writes a moment later and
 * which the same tear-down takes.
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
 *
 * ⚠️ That last sentence is also this function's own PREMISE, not just a reason
 * to avoid a call: a bound enforced by a `setInterval` is worth nothing if a
 * write can park the thread. The premise is not free — libuv clears
 * `O_NONBLOCK` on fd 2's shared description in the pre-exec of any child
 * spawned with inherited stdio, and this shim runs under `tsx`, which spawns
 * the esbuild service on a cold transform cache. `keepStderrNonBlocking()`,
 * installed above `run()`, is what holds the premise true; without it this
 * bound is unreachable rather than late, which is a HANG and not a long wait.
 */
function writeStderr(text) {
  return new Promise((resolve) => {
    let poll;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      resolve();
    };

    // ⛔ The return value is deliberately NOT consulted. `write()` returns true
    // when the internal buffer sits below the highWaterMark, which is NOT the
    // same as the bytes having reached the pipe — and an earlier version of this
    // shim read it as "already flushed" and returned early. Measured: it
    // returned TRUE with writableLength = 7621, so the bound meant to cap the
    // wait was never armed at all and a reader that never drained hung the
    // process indefinitely (observed alive at 25 s, 30 s and 60 s). The
    // callback is the only thing that means "flushed"; it also fires on EPIPE,
    // which is what releases the closed-reader paths promptly.
    process.stderr.write(text, finish);

    let fewestPending = process.stderr.writableLength;
    let lastProgressAt = Date.now();
    poll = setInterval(() => {
      const pending = process.stderr.writableLength;
      if (pending < fewestPending) {
        fewestPending = pending;
        lastProgressAt = Date.now();
        return;
      }
      if (Date.now() - lastProgressAt >= STDERR_DRAIN_STALL_MS) finish();
    }, STDERR_DRAIN_POLL_MS);

    // ⛔ NOT unref'd, on purpose. `finish()` always clears it, so it cannot
    // outlive the wait — and an unref'd detector is exactly the silent no-op
    // this function already shipped once: a bound that never runs is
    // indistinguishable from one that never trips.
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
 * Where THIS process's loader sends a specifier — the probe
 * `unbuiltWorkspaceLines` uses to tell a stale build output apart from a build
 * output that was never consulted (#16547).
 *
 * It has to be the shim's own `import.meta.resolve` rather than one the
 * diagnostic builds for itself: this is the resolver that produced the failure
 * being reported, tsconfig `paths` and all, so it is the only one that can
 * answer for it. A resolver constructed anywhere else answers about a different
 * loader and could contradict the run it is describing.
 *
 * `undefined` on any failure, which the diagnostic reads as "no evidence of a
 * redirect" and which leaves the build remedy exactly as it was.
 */
function resolveThroughThisLoader(specifier) {
  try {
    return import.meta.resolve(specifier);
  } catch {
    return undefined;
  }
}

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
    const lines = unbuiltWorkspaceLines(error, moduleLoadFailures, INVOCATION_PREFIX, resolveThroughThisLoader) ?? [];
    if (lines.length) await writeStderr(`${lines.join('\n')}\n`);
  } catch {
    // Stay quiet rather than replacing oclif's report with an error about the
    // reporter itself.
  }
}

process.env.NODE_ENV = 'development';
settings.debug = true;

// ⚠️ BEFORE `run()`, and that order is the whole point rather than tidiness.
// The bound in `writeStderr` is a `setInterval`, so it can only fire while this
// process's event loop is running — and every byte oclif is about to put on
// stderr is written by `Config.load()`, long before this file gets control
// back. If one of those writes parks the main thread inside `write(2)`, no
// bound in this file has run yet or ever will: the process is frozen in the
// kernel with the diagnostic still unwritten, and only a reader or a kill ends
// it. Measured that way on an unbuilt workspace with the reader gone — 27 of 30
// cold-cache runs, main thread in `write(2)` on fd 2 at `sock_alloc_send_pskb`,
// still alive at a 90 s ceiling. `src/utils/stderr-nonblocking.ts` carries the whole
// derivation, including who clears the flag (a child spawned with inherited
// stdio — libuv clears `O_NONBLOCK` on the SHARED open file description) and
// why the re-assert has to sit on the write path rather than run once here.
keepStderrNonBlocking();

/**
 * This package's OWN tsconfig — the one its `src/` is written against, and the
 * one the guard below pins tsx to.
 */
const CLI_TSCONFIG = fileURLToPath(new URL('../tsconfig.json', import.meta.url));

/** This package's manifest, read for the dependency list the probe sweeps. */
const CLI_PACKAGE_JSON = fileURLToPath(new URL('../package.json', import.meta.url));

/**
 * The first of this package's OWN workspace dependencies that tsx is resolving
 * to TypeScript SOURCE instead of to build output — or '' when none is, which
 * is every run from a cwd that carries no redirecting tsconfig.
 *
 * ## What it detects, measured rather than reasoned (#16547)
 *
 * tsx reads the CWD's tsconfig, not the entry file's, and applies its
 * `compilerOptions.paths` to EVERY specifier it resolves — including this
 * CLI's own. Ten in-tree directories carry such a rule, written for tsc so a
 * `typecheck` grades against a producer's source rather than its last build
 * (`check:type-source-resolution` requires them), and #11094 named the runtime
 * half "a latent runtime redirect for any tsx-honouring tool". Run this shim
 * from one of them and the CLI's imports are re-routed:
 *
 *     cd examples/app-multi-package
 *     ../../node_modules/.bin/tsx ../../packages/cli/bin/run-dev.js lint objectstack.config.ts
 *     → exit 2, "command lint:objectstack.config.ts not found"
 *
 * ⚠️ NOT because the source is missing an export — the correction #16547's
 * repro earned over the reading it was filed with. `@objectstack/spec/data`'s
 * source subpath exports the very name the failure blames (470 names, measured
 * through `await import()`, `DATABASE_DRIVER_SELECTION_IDS` among them). What
 * breaks is the STATIC LINK, and the reason is module FORMAT: `packages/spec`
 * and `packages/types` declare no `"type": "module"`, so tsx loads their `.ts`
 * sources as CommonJS, and a static ESM named import can then bind only the
 * names `cjs-module-lexer` detects — which does not follow the two-hop
 * `export *` chain (`data/index.ts` → `./driver/index` →
 * `./config-registry.zod`) that publishes this one. Measured with a two-leg
 * fixture whose only difference was the `"type"` field: CJS leg SyntaxError,
 * ESM leg links. `packages/cli` IS `"type": "module"`, so every one of its
 * command modules is on the failing side of that seam.
 *
 * ## Why the probe is a RESOLUTION and not a tsconfig read
 *
 * The question "would this cwd redirect us" is decided by tsx's own resolver,
 * so it is asked of the resolver. Reading the cwd's tsconfig would mean
 * reimplementing get-tsconfig's lookup, its JSONC parse and its `extends`
 * walk — three chances to disagree with the thing whose behaviour is the whole
 * subject, for an answer this call gets exactly right.
 *
 * The criterion is that a resolution lands on a TypeScript SOURCE file. No
 * workspace package's `exports` map points at one — every one targets `dist/`
 * — so a `.ts` answer cannot be produced by node resolution alone. Measured on
 * this manifest: 0 of 49 workspace dependencies answer `.ts` from the repo
 * root, exactly 1 does from `examples/app-multi-package` (`@objectstack/spec`)
 * and exactly 1 from `packages/plugins/plugin-security` (`@objectstack/types`)
 * — the two directories #16547 reproduced from, each naming its own package.
 *
 * Cost, measured on the box this landed on: ~72 ms for the full 49-specifier
 * sweep (~1.35 ms per `import.meta.resolve`), against a ~11.3 s end-to-end
 * `lint` run through this shim — 0.6%, and it is paid once per process. The
 * alternative that needs no probe at all, re-execing unconditionally, costs a
 * whole second tsx bootstrap (~550 ms measured) on every run instead.
 *
 * ⚠️ The error direction is the safe one and is worth stating: a dependency
 * that legitimately published a `.ts` entry point would cost one unnecessary
 * re-exec, never a wrong answer — pinning this CLI to its own tsconfig is
 * always correct for this CLI's own code.
 */
function firstSourceRedirectedDependency() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(CLI_PACKAGE_JSON, 'utf8'));
  } catch {
    // No manifest, no probe. Degrade to the behaviour this shim had before the
    // pin existed rather than fail on the way to running the CLI.
    return '';
  }
  // The scope comes from this package's OWN name rather than a constant, so
  // "a package this repo builds" cannot drift away from what this repo calls
  // itself: `@objectstack/cli` → `@objectstack/`.
  const scope = String(manifest?.name ?? '').split('/')[0];
  if (!scope.startsWith('@')) return '';
  for (const dep of Object.keys(manifest?.dependencies ?? {})) {
    if (!dep.startsWith(`${scope}/`)) continue;
    let pathname;
    try {
      // The URL is parsed INSIDE the guard on purpose. This runs before the CLI
      // does anything, so a throw here would replace the whole run with an error
      // about the probe — the same rule the two reporters below are written to.
      pathname = new URL(import.meta.resolve(dep)).pathname;
    } catch {
      // Not installed, no such subpath, or an answer that is not a URL. Not this
      // probe's business, and never this probe's report.
      continue;
    }
    if (/\.[cm]?tsx?$/.test(pathname)) return dep;
  }
  return '';
}

// ⛔ The pin can only be applied by RE-EXEC, and that is a measured constraint
// rather than a preference. tsx parses its tsconfig in the loader's
// `initialize` / `globalPreload`, both of which have already run by the time
// this file gets control: setting `process.env.TSX_TSCONFIG_PATH` here and
// re-resolving answers the SOURCE path exactly as before (measured). So the
// choice is a second process or no pin at all.
//
// The env var doubles as the loop guard, and as the caller's override: a run
// that already carries one is either the child this block spawned or someone
// who pinned deliberately, and neither wants a second opinion.
if (!process.env.TSX_TSCONFIG_PATH) {
  const redirected = firstSourceRedirectedDependency();
  if (redirected) {
    // ⚠️ `process.stderr.write` followed by an exit is the #6531 defect this
    // file exists to avoid, and this is deliberately NOT that shape: what
    // follows the write is `spawnSync`, which blocks this process for the
    // whole lifetime of the child (seconds), so the write has the entire run
    // to drain instead of racing a tear-down. `keepStderrNonBlocking()` above
    // has already run, so the write cannot park the thread either.
    process.stderr.write(
      `objectstack: the current directory's tsconfig redirects '${redirected}' to TypeScript source, and tsx honours the CWD's tsconfig — re-running with tsx pinned to ${CLI_TSCONFIG}\n`,
    );
    const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      // Inherited, so the child holds the very fds this process was handed and
      // every byte-level property the suites below pin is the CHILD's, not a
      // forwarding copy. libuv clears `O_NONBLOCK` on fd 2's shared
      // description in the pre-exec — the hazard `keepStderrNonBlocking()`
      // exists for — and the child re-asserts it on its own write path, which
      // is why that guard had to live on the write rather than run once.
      stdio: 'inherit',
      env: { ...process.env, TSX_TSCONFIG_PATH: CLI_TSCONFIG },
    });
    if (!child.error) {
      // A signalled child is reported as a signal, never as an exit code: #14715
      // pinned that this CLI answers 2 for a failed run, and laundering a
      // SIGKILL into some number would make a killed child indistinguishable
      // from one that decided.
      if (child.signal) process.kill(process.pid, child.signal);
      process.exit(child.status ?? 1);
    }
    // Spawn itself failed. Degrade to the behaviour this shim had before the
    // pin existed — which is the failure #16547 describes, and still better
    // than replacing the CLI's report with one about the re-exec.
  }
}

/**
 * Make a FAILED stderr write non-fatal, so a caller whose read end is gone
 * still gets this CLI's own exit status instead of a crash. #14858.
 *
 * `process.stderr` is an `EventEmitter`, and an `error` event with nothing
 * listening IS an uncaught exception. With the parent's read end DESTROYED
 * (`stdio: ['ignore', 'ignore', 'pipe']`, then `child.stderr.destroy()`) the
 * first write comes from node's OWN default `warning` handler
 * (`internal/process/warning.js`: `onWarning` → `writeOut` → `console.error`),
 * and oclif's `displayWarnings()` makes writes 2 and 3 of the same warning
 * (#16691 re-traced the order; #15558 named `displayWarnings()` for the first
 * one). The pipe is already gone, node raises `write EPIPE` on
 * `process.stderr`, and this process died of an uncaught exception — 12 of 12
 * runs, 938-1174 ms in, well before `run()` settles and before `writeStderr()`
 * above is ever called. Traced with a `--import` observer that installs NO
 * listener on this stream and wraps no write (`uncaughtExceptionMonitor`, which
 * observes without preventing the default crash — an `uncaughtException` handler
 * would have changed the very thing being read):
 *
 *     uncaughtException  code=EPIPE  msg=write EPIPE
 *           at afterWriteDispatched (node:internal/stream_base_commons:159:15)
 *     exit  code=1
 *
 * Every OTHER reader of the same child answers **2** — drained (1209-1217 ms,
 * 147699 bytes delivered) and never-read (16178-16471 ms) both did, in the same
 * conditions. 2 is what oclif's `handle()` produces, and #14715 pinned it for
 * the never-read reader. So the closed reader was the one shape that could not
 * tell "the command failed" from "the CLI crashed", on the only channel it had
 * left.
 *
 * ⚠️ EVERY write on that path is a `console.error`, which is worth stating
 * because it reads as if it should be survivable — `bin/run.js` records that
 * Console's `ignoreErrors` keeps a warning block from crashing a process, and
 * THERE it does. What saves a process is not the temporary listener
 * `kWriteToConsole` parks across the write (its `finally` removes that one
 * before the completion arrives) but Console's write CALLBACK, which re-attaches
 * a `noop` when the completion reports an error — and only
 * `if (stream.listenerCount('error') === 0)`. Under `tsx` that count is never 0:
 * tsx registers an off-thread module-customization hook, so node pipes the hooks
 * worker's stderr into `process.stderr` and `Stream.prototype.pipe` prepends its
 * own `onerror` there (`node:internal/streams/legacy`). Console's keep-alive is
 * therefore never installed; `onerror` takes the first EPIPE, tears the pipe's
 * own listeners down including itself, finds no other `error` listener left and
 * RE-EMITS on `process.stderr` — that second emit is the uncaught one.
 * Ablated on plain node, one short line and nothing else changed: `console.error`
 * alone 0/3, `module.register()` of a no-op hook plus the SAME `console.error`
 * 3/3, a raw `process.stderr.write` 3/3 (#16691). ⇒ Payload size decides nothing
 * here, and this listener is what covers the `console.error` sites too, not only
 * `writeStderr()` above.
 *
 * ⛔ Deliberately NOT narrowed to `error.code === 'EPIPE'`, even though EPIPE is
 * the only code this path was measured to raise (4 events per run, no other
 * code, observed with a listener installed on purpose for that one question).
 * The reason to tolerate is not WHICH error it is: every event here means one
 * thing — a write to stderr failed — the only channel it could be reported on
 * is the stream that just failed, and there is no other action to take. A
 * predicate would buy no decision and would keep exactly this crash for
 * whatever code turns up next.
 *
 * ⚠️ What it costs, and it is not nothing. With the write no longer fatal the
 * run continues into `writeStderr()`'s drain, which for this path had NEVER
 * executed at all. Ablated 2x2 on this file, one contiguous run, shared box —
 * so read the ratios, not the absolutes:
 *
 *     this listener   write callback     exit   elapsed
 *     -------------   ---------------    ----   ---------------
 *     present         kept (= HEAD)        2    1237-1312 ms
 *     present         removed              2    16271-16294 ms   the 15 s bound
 *     absent          kept                 1     983-1028 ms     the defect
 *     absent          removed              1     843-1031 ms
 *
 * Row 1 against row 3 is the whole change, and it is ~250 ms: the child now
 * ends the way a drained reader's child ends instead of dying on its first
 * write. (The two runs are comparable because their unfixed rows agree — 938-
 * 1174 ms above, 983-1028 ms here.) Row 2 is what the drain costs when only the
 * no-progress bound can end it — a cost that is REACHABLE now and was not
 * before, because rows 3-4 never got there at all.
 */
process.stderr.on('error', () => {
  // Nothing to report, and nowhere left to report it.
});

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
