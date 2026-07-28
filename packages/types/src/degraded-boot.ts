// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Degraded-boot reporting, shared by every subsystem that can be told to boot
 * without a datasource it needs.
 *
 * Two of them exist today and they opt in through the *same* operator flag
 * (`OS_ALLOW_DRIVER_CONNECT_FAILURE`, see {@link resolveAllowDriverConnectFailure}):
 *
 *  - `ObjectQLEngine.init()` — a boot-registered driver whose `connect()`
 *    rejected (framework#3741).
 *  - `DatasourceConnectionService` — a declared datasource that objects bind to
 *    explicitly, or an `external` one with `validation.onMismatch:'fail'`,
 *    that could not be connected (framework#3758).
 *
 * They live in different packages but owe the operator the same thing: the
 * degraded state must be impossible to miss.
 */

/**
 * Emit the degraded-boot banner on a channel the host cannot accidentally
 * silence.
 *
 * `OS_ALLOW_DRIVER_CONNECT_FAILURE` only justifies itself if the state it opts
 * into is impossible to miss — and a logger-only banner is missable: `os serve`
 * swallows ALL of stdout while the kernel boots (its "boot-quiet" capture), and
 * `Logger` routes `warn` to stdout, so the one message that matters would be
 * invisible in exactly the situation it exists for. Writing to stderr as well
 * is the same belt-and-braces the kernel already uses for plugin startup
 * failures.
 *
 * Best-effort and never throws: falls back to `console.error`, then to silence
 * on runtimes that have neither (the logger still carries the structured
 * record either way).
 */
export function emitDegradedBootBanner(message: string): void {
  const proc = (globalThis as {
    process?: { stderr?: { write?: (chunk: string) => unknown } };
  }).process;
  try {
    if (typeof proc?.stderr?.write === 'function') {
      proc.stderr.write(`${message}\n`);
      return;
    }
  } catch {
    /* stderr unavailable / closed — fall through to console */
  }
  try {
    (globalThis as { console?: { error?: (msg: string) => void } }).console?.error?.(message);
  } catch {
    /* no output channel at all — the logger record is the remaining trace */
  }
}
