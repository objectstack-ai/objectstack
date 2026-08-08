// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--json` stdout reservation (#6217).
 *
 * ## The invariant
 *
 * `--json` has exactly one audience: a program. So the whole of a `--json`
 * run's **stdout must be one JSON document** — `JSON.parse(stdout)` with no
 * heuristic extraction. Anything else is a `--json` flag that isn't
 * machine-readable.
 *
 * It was not true for the commands that boot a kernel. `ObjectLogger` routes
 * `debug`/`info`/`warn` to **stdout** and only `error`/`fatal` to stderr
 * (`packages/core/src/logger.ts`), so `os migrate recorded-by --json` emitted
 * ~60 INFO lines above the payload and two more below it, with stderr
 * completely empty:
 *
 * ```
 * [StandaloneStack] no compiled artifact at '…' — booting without one
 * 2026-08-08T02:14:38.330Z INFO Registered metadata loader: filesystem (file:)
 * …
 * { "planId": "metadata.recorded-by-sentinel-to-null", … }
 * 2026-08-08T02:14:38.833Z INFO ✅ Graceful shutdown complete
 * ```
 *
 * A consumer then has to write a "find the last lone `{` and its matching `}`"
 * extractor — #4873 was forced to write one to assert its own payload — and
 * that heuristic silently picks the wrong text the moment a log line looks
 * like JSON.
 *
 * ## Why this shape
 *
 * Three routes were on the table (issue #6217):
 *
 * 1. redirect the kernel's output to **stderr** for the duration of a `--json`
 *    run — this module;
 * 2. drop the kernel logger to `silent` under `--json` — throws the operator's
 *    diagnostics away, warnings included, and would still leave the
 *    `console.log` lines that never went through the logger at all (the
 *    `[StandaloneStack] no compiled artifact …` line above is one);
 * 3. make the logger default to stderr repo-wide — a `packages/core` change
 *    that moves `os serve` / `os dev` output for every existing user and every
 *    log-scraping deployment, so a maintainer call, and out of scope here.
 *
 * Route 1 is the only one that keeps every diagnostic *and* gives the payload a
 * clean channel, and it is reachable from the CLI with no `packages/core`
 * change: `LoggerConfig` has a `level` but no destination/stream knob, so the
 * redirection has to happen on the stream itself. `os serve` already does
 * exactly this to keep its startup banner readable — it swaps
 * `process.stdout.write` for the boot window and buffers what it intercepts
 * (`boot-log-capture.ts`, #4012). This is that same seam, pointed at stderr
 * instead of at a buffer.
 *
 * Patching `process.stdout.write` covers every writer, not just the logger:
 * Node's global `console.log` / `console.info` / `console.debug` resolve
 * `process.stdout` and call `.write` on it per call, and `ObjectLogger.write()`
 * reads `process.stdout` per record too. Measured, all of them route through
 * one patched property.
 *
 * ## The payload's way out
 *
 * With stdout reserved, the payload needs a channel the reservation cannot
 * capture — that is {@link writeStdoutDirect}, which holds the real write and
 * is what `emitJson`/`emitText` are built on. It is the ONLY thing that may
 * reach stdout during a reservation, which is what makes "exactly one JSON
 * document" structural rather than aspirational.
 */

/** `process.stdout.write`, as a callable with the varargs Node accepts. */
type StreamWrite = (chunk: any, ...rest: any[]) => boolean;

/**
 * The real `process.stdout.write` while a reservation is in force, `null`
 * otherwise. Captured at reservation time rather than at module load, so a
 * reservation composes with any other stdout interception in the process
 * (`os serve`'s boot-quiet window) instead of tearing it out from underneath.
 */
let realStdoutWrite: StreamWrite | null = null;

/** Whether stdout is currently reserved for a machine-readable payload. */
export function isStdoutReserved(): boolean {
  return realStdoutWrite !== null;
}

/**
 * Reserve stdout for a `--json` payload: everything written to
 * `process.stdout` from here on is forwarded to **stderr**.
 *
 * Nothing is discarded — the operator keeps every boot line, every warning and
 * every degraded-boot notice, on the stream diagnostics belong on. Returns the
 * release, which restores the previous `process.stdout.write`; a second
 * reservation while one is in force is a no-op that releases nothing (the
 * outer reservation owns the stream).
 *
 * Callers in a one-shot CLI process are not obliged to release: see
 * `bootSchemaStack`, which deliberately holds the reservation past a failed
 * boot so a stray log from a half-started kernel cannot land next to the error
 * payload.
 */
export function reserveStdoutForJson(): () => void {
  if (realStdoutWrite) return () => { /* an inner reservation owns nothing */ };

  const original = process.stdout.write.bind(process.stdout) as StreamWrite;
  realStdoutWrite = original;

  // A property call on `process.stderr`, so `this` is the stderr stream and the
  // varargs (`encoding`, the drain callback) keep their native meaning — a
  // caller awaiting the write still resumes.
  const forward = ((chunk: any, ...rest: any[]): boolean =>
    (process.stderr as unknown as { write: StreamWrite }).write(chunk, ...rest)) as StreamWrite;

  process.stdout.write = forward as typeof process.stdout.write;

  return () => {
    if (realStdoutWrite !== original) return;
    realStdoutWrite = null;
    // Only take the stream back if it is still ours — another interception
    // layered on top has to unwind first.
    if ((process.stdout.write as unknown as StreamWrite) === forward) {
      process.stdout.write = original as typeof process.stdout.write;
    }
  };
}

/**
 * Write to the REAL stdout, bypassing any reservation, and resolve once the
 * bytes are handed off.
 *
 * The drain is not decoration: `console.log(big)` followed by an exit is cut
 * off at one 64 KiB pipe buffer, which is why `emitJson` exists at all — see
 * its doc comment in `format.ts`.
 */
export function writeStdoutDirect(text: string): Promise<void> {
  const write = realStdoutWrite ?? (process.stdout.write.bind(process.stdout) as StreamWrite);
  return new Promise<void>((resolve, reject) => {
    write(text, (err?: Error | null) => (err ? reject(err) : resolve()));
  });
}
