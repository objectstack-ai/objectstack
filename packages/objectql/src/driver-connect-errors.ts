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
      `A driver that did not connect cannot serve queries, and the schema sync that runs right ` +
      `after init would issue DDL against it. Fix the datasource configuration (e.g. ` +
      `OS_DATABASE_URL), or set OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway and serve errors ` +
      `until the datasource becomes reachable.`,
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
 * The degraded-boot banner now lives in `@objectstack/types` because
 * `DatasourceConnectionService` owes the operator the same banner for the same
 * flag (framework#3758) and must not depend on the whole query engine to print
 * it. Re-exported here so this module stays the single import site for
 * engine-side driver-connect failure reporting.
 */
export { emitDegradedBootBanner } from '@objectstack/types';
