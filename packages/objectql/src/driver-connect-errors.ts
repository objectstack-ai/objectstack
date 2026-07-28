// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/** One boot-registered driver whose `connect()` rejected during engine init. */
export interface DriverConnectFailure {
  driverName: string;
  error: unknown;
}

/**
 * One driver's verdict from `ObjectQL.checkDriversHealth()` (framework#3756) —
 * whether it can serve a query right now, not whether it connected at boot.
 */
export interface DriverHealth {
  driverName: string;
  healthy: boolean;
  /** Why it is unhealthy: `checkHealth()` returned false, threw, or timed out. */
  error?: string;
  /** True when the driver implements no `checkHealth()` and was assumed healthy. */
  skipped?: boolean;
}

/** `error.message` when it is an Error, its string form otherwise. */
function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/**
 * Thrown by `ObjectQL.init()` when one or more boot-registered drivers fail to
 * connect (framework#3741). Aborts kernel bootstrap: a server that cannot reach
 * its database must not report itself started.
 *
 * Two failures are collapsed into one class on purpose, because `init()` cannot
 * tell them apart and the correct response to both is the same — don't boot:
 *
 *  - the datasource is genuinely unreachable (wrong `OS_DATABASE_URL`, rotated
 *    password, closed network path), and
 *  - the driver is DELIBERATELY REFUSING to start (licence, server version,
 *    incompatible configuration, missing capability). Throwing from `connect()`
 *    is the supported way for a driver to veto boot; before this error existed,
 *    such a veto was caught and downgraded to a query-time error, which is why
 *    driver-mongodb's tenancy guard had to be hoisted into its constructor
 *    (#3724 / #3734).
 *
 * The message is self-contained — it names every failed driver and its cause —
 * because the CLI prints `error.message` alone (stack only under `DEBUG`).
 * Identified by `code` rather than `instanceof` so it survives crossing package
 * boundaries.
 */
export class DriverConnectError extends Error {
  readonly code = 'ERR_DRIVER_CONNECT' as const;

  /**
   * The first failure's `Error`, so its stack stays reachable for `DEBUG`
   * output and structured logging. Declared here rather than inherited: the
   * repo compiles against `lib: ES2020`, which predates `Error.cause`.
   */
  readonly cause?: unknown;

  constructor(
    public readonly failures: DriverConnectFailure[],
    public readonly totalDrivers: number,
  ) {
    const detail = failures
      .map((f) => `  • ${f.driverName}: ${failureMessage(f.error)}`)
      .join('\n');
    super(
      `${failures.length} of ${totalDrivers} data driver(s) failed to connect — refusing to boot.\n` +
      `${detail}\n` +
      `A driver that did not connect cannot serve queries (there is no lazy reconnection) and the ` +
      `schema sync that runs right after init would issue DDL against it. Fix the datasource ` +
      `configuration (e.g. OS_DATABASE_URL), or set OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway ` +
      `in an explicitly degraded state where every query to those drivers fails.`,
    );
    this.name = 'DriverConnectError';
    if (failures[0]?.error instanceof Error) {
      (this as { cause?: unknown }).cause = failures[0].error;
    }
  }

  /** Names of the drivers that failed, in registration order. */
  get failedDrivers(): string[] {
    return this.failures.map((f) => f.driverName);
  }
}

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
