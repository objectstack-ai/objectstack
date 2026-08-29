// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End a one-shot command's PROCESS once its work is done (#13027).
 *
 * ## The measurement
 *
 * `os migrate plan`, ObjectStack Cloud's staging control plane, `apply=false`,
 * inside `docker run --rm`. The command finished and said so:
 *
 * ```
 * 15:03:52.522   17 change(s): 0 safe, 0 needs-confirm, 17 destructive
 * 15:03:52.517 INFO Graceful shutdown started
 * 15:03:52.555 INFO OK Graceful shutdown complete
 * ```
 *
 * Elapsed inside the CLI: 4.3 seconds. The next line in the log is the run
 * being cancelled by hand **78 minutes later**. The shell's very next statement
 * was an `echo` that never printed, so the shell was still blocked on that one
 * `docker run`: the process printed its own graceful-shutdown line and then did
 * not exit.
 *
 * ## Why the fix is "exit deliberately" and not "find the handle"
 *
 * The composition `os migrate plan` performs (#12938) registers a host's
 * plugins for their DECLARATIONS: `init()` runs, `start()` is replaced with a
 * no-op. A host plugin that acquires something live during Phase 1 — an
 * interval, a pool, a watcher, a `kernel:ready` hook that starts a dispatcher —
 * and releases it from a path the suppressed `start()` (or a `destroy` the
 * host's own wrapper never forwards) would have installed now has no release
 * path at all. The event loop stays alive; the kernel has already reported a
 * clean shutdown, so nothing looks wrong.
 *
 * Chasing the handle means auditing host code this repo cannot see — the same
 * argument that made the composition declaration-only in the first place. A
 * one-shot command that has written its document owes the operator an exit, and
 * that is true whatever the host left running. ⛔ This is NOT a licence to skip
 * teardown: the caller still runs `stack.shutdown()` first, and this is the
 * last statement after it.
 *
 * ## Why it cannot simply be `process.exit(code)`
 *
 * `process.exit` tears the process down with an unflushed stdout **pipe**
 * buffer — the exact truncation `emitJson` exists to prevent, re-introduced one
 * statement later. `emitJson`/`emitText` already await their own write, but the
 * human-readable path is `console.log`, which does not. So this drains both
 * streams first, and refuses to hang while doing it: a stream that will not
 * drain must not become a second way for this command to never return.
 */

/** Injection seam — production values, replaced wholesale in unit tests. */
export interface OneShotExitDeps {
  /** Streams to drain before exiting. */
  streams?: Array<{ write(chunk: string, cb?: () => void): unknown } | undefined>;
  /** The exit call itself. */
  exit?: (code: number) => never;
  /** Upper bound on waiting for a drain, in ms. */
  drainTimeoutMs?: number;
  /** Timer factory, so a test does not have to wait in real time. */
  setTimeoutFn?: typeof setTimeout;
}

/**
 * Wait for everything already queued on `stream` to reach the OS.
 *
 * A no-op write's callback fires once every write queued **before** it has been
 * flushed, which is the documented way to ask this question. The timeout is not
 * belt-and-braces: a pipe whose reader has gone away never drains, and this
 * function's whole job is to stop a command from hanging.
 */
function drain(
  stream: { write(chunk: string, cb?: () => void): unknown } | undefined,
  timeoutMs: number,
  setTimeoutFn: typeof setTimeout,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!stream || typeof stream.write !== 'function') {
      resolve();
      return;
    }
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeoutFn(done, timeoutMs);
    (timer as { unref?: () => void })?.unref?.();
    try {
      stream.write('', done);
    } catch {
      done();
    }
  });
}

/**
 * Flush stdout/stderr, then end the process with `code`.
 *
 * Returns `Promise<never>` in production. In a test the injected `exit` may
 * return normally, and then so does this — that is deliberate, so a unit test
 * can assert the code without killing its own runner.
 */
export async function exitOneShotCommand(
  code = 0,
  deps: OneShotExitDeps = {},
): Promise<never> {
  const {
    streams = [process.stdout, process.stderr],
    exit = process.exit.bind(process) as (c: number) => never,
    drainTimeoutMs = 2_000,
    setTimeoutFn = setTimeout,
  } = deps;

  await Promise.all(streams.map((s) => drain(s, drainTimeoutMs, setTimeoutFn)));
  return exit(code);
}
