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

/**
 * Why {@link PrimaryDatasourceVerdict} could not name a primary datasource.
 *
 * Every member means the SAME thing to a readiness probe — *we cannot tell* —
 * and the ruling on #13408 fixes what a probe must do with that answer: fall
 * back to the old whole-node 503 (fail toward draining), never to "don't
 * drain". They are distinguished only so the reason can be logged and reported;
 * ⛔ a caller must not branch on them to keep a replica in rotation.
 */
export type PrimaryDatasourceUnresolvedReason =
  /** No platform system object is registered here — nothing to read the fact off. */
  | 'no-system-objects-registered'
  /** The platform's system objects are split across more than one datasource. */
  | 'system-objects-split'
  /** A registered system object routes nowhere: no binding and no default driver. */
  | 'system-object-unbound'
  /** The name resolved, but no driver is registered under it, so nothing probes it. */
  | 'no-driver-registered';

/**
 * WHICH datasource carries this deployment's platform system objects — the
 * machine-readable "primary/default datasource" fact the #13408 ruling requires
 * (2026-08-31, 第 6 场总监席决裁批 #12), stated as a verdict rather than a
 * `string | undefined` so "we could not tell" can never be mistaken for a name.
 *
 * ⛔ The ruling forbids deriving this from a heuristic such as "the first
 * datasource registered". The one implementation is
 * `ObjectQL.resolvePrimaryDatasource()`.
 */
export type PrimaryDatasourceVerdict =
  | {
      resolved: true;
      /** The datasource name, which is also a registered driver's name. */
      datasource: string;
      /**
       * How many registered platform system objects agreed on it. Never 0 — a
       * verdict read off nothing is `no-system-objects-registered`, not a name,
       * so a caller cannot act on a vacuous agreement.
       */
      witnesses: number;
    }
  | {
      resolved: false;
      reason: PrimaryDatasourceUnresolvedReason;
      /** The distinct datasource names seen, when more than one disagreed. */
      candidates?: readonly string[];
    };

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
/**
 * [#16159] The ADR-0112 `code` {@link DriverConnectError} carries, as a
 * constant a consumer can import instead of re-spelling.
 *
 * The docblock below already says this refusal is "Identified by `code` rather
 * than `instanceof` so it survives crossing package boundaries" — and until now
 * offered nothing to import, so the only way to FOLLOW that instruction was to
 * re-author the wire string in the consumer's own package. That acquires a
 * `check:error-code-provenance` stamp site there and is then free to drift from
 * what this engine throws, with no compile error to say so. The guidance and
 * the surface disagreed; this closes that half of #16159's table.
 *
 * ⛔ The string is byte-identical to the literal it replaces. This moves where a
 * spelling lives, never what it says; renaming the code is a separate breaking
 * decision and never a rider on this conversion.
 *
 * ⚠️ `ERR_DRIVER_CONNECT` IS registered in `ERROR_CODE_LEDGER` under
 * `@objectstack/objectql`, so this declaration is a `constdef` stamp site
 * `check:error-code-provenance` DOES see (that gate skips unregistered codes),
 * and it is listed under this package's own owner key, which is what makes the
 * gate accept it. Equally, no row moves in
 * `packages/runtime/src/dispatcher-error-vocabulary.ts`: that table records
 * UNREGISTERED code sites, so a registered code is invisible to it by
 * construction. The two gates are exactly inverted — measured on this branch,
 * not assumed.
 *
 * The `_CODE` NAME and the bare `readonly code = DRIVER_CONNECT_CODE;`
 * spelling are load-bearing rather than cosmetic: the first is the shape
 * `check:error-code-provenance`'s `constdef` pattern can see, the second is the
 * shape `check:dispatcher-error-vocabulary` classifies as `classconst` (an
 * `as const` suffix on the FIELD would take it out of that pattern). ⛔ Never
 * rename out of either shape to quiet a gate.
 *
 * Dropping the `ERR_` prefix from the CONSTANT's name follows this package's
 * existing precedents (`HOOK_TARGET_REBIND_ERROR_CODE`,
 * `READONLY_FIELD_REJECTED_CODE`). Re-exported from the `index.ts` barrel and,
 * like every other `*_CODE` here, NOT from the lean `core.ts` entry — even
 * though `DriverConnectError` itself IS on `core.ts`. That asymmetry is real,
 * it is #16260's subject for the whole family, and ⛔ this mechanical sweep does
 * not decide it.
 */
export const DRIVER_CONNECT_CODE = 'ERR_DRIVER_CONNECT' as const;

export class DriverConnectError extends Error {
  readonly code = DRIVER_CONNECT_CODE;

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

/** Why a declared datasource has no live driver (framework#3828). */
export type DatasourceUnavailableKind = 'blocked' | 'failed';

/** What the connection layer recorded about a datasource it could not connect. */
export interface DatasourceUnavailableInfo {
  kind: DatasourceUnavailableKind;
  /**
   * Tenant-safe detail, opt-in by the host. The operator-facing reason is
   * deliberately NOT carried here — see `DatasourceConnectDecision.publicReason`.
   */
  publicDetail?: string;
}

/**
 * Thrown by `getDriver()` when an object's `datasource` was **declared** but has
 * no live driver, and the connection layer knows why (framework#3828).
 *
 * Before this, all four of these produced the same sentence — `Datasource 'x'
 * is not registered.`:
 *
 *  1. the host's connect policy refused it (plan / egress isolation),
 *  2. it failed to connect at boot and `OS_ALLOW_DRIVER_CONNECT_FAILURE` let
 *     the server start anyway,
 *  3. the app misspelled the datasource name, and
 *  4. it is declared `active: false`.
 *
 * (3) is an authoring bug; (1) and (2) are states of the deployment. Answering
 * all of them identically sends the reader hunting for a typo that isn't there.
 * Cases the connection layer never recorded keep the original message — there is
 * genuinely nothing more to say about a name nobody declared.
 *
 * **The message never carries the underlying cause.** A connect failure's text
 * routinely contains the host, port, or DSN, and a policy's `reason` is written
 * for operators; neither is safe to hand to whoever is browsing a record. The
 * cause stays in the startup logs and the datasource-admin list, and this error
 * says which of those to read. A host that wants to tell tenants something
 * specific sets `publicReason` on its connect decision.
 */
/**
 * [#16159] The ADR-0112 `code` {@link DatasourceUnavailableError} carries, as a
 * constant a consumer can import instead of re-spelling.
 *
 * This row has a live first-party consumer making the card's argument for it:
 * `packages/rest/src/error-response.ts` matches this refusal by `code` and then
 * re-authors the same spelling into the response envelope it builds — two
 * spellings of one refusal, in two packages, with nothing but a grep keeping
 * them equal.
 *
 * ⛔ The string is byte-identical to the literal it replaces — the conversion
 * moves where a spelling lives, never what it says.
 *
 * ⚠️ `ERR_DATASOURCE_UNAVAILABLE` is registered in `ERROR_CODE_LEDGER` under
 * BOTH `@objectstack/objectql` and the datasource-service owner key (it is one
 * refusal raised from two sides), so this declaration is a `constdef` stamp
 * site `check:error-code-provenance` sees and accepts under this package's own
 * key, while `check:dispatcher-error-vocabulary` stays blind to it by
 * construction. See the note on {@link DRIVER_CONNECT_CODE} for why those two
 * gates answer oppositely.
 *
 * Naming, field spelling and barrel placement follow {@link DRIVER_CONNECT_CODE}
 * exactly, including the `core.ts` asymmetry #16260 owns.
 */
export const DATASOURCE_UNAVAILABLE_CODE = 'ERR_DATASOURCE_UNAVAILABLE' as const;

export class DatasourceUnavailableError extends Error {
  readonly code = DATASOURCE_UNAVAILABLE_CODE;

  constructor(
    public readonly datasource: string,
    public readonly objectName: string,
    public readonly kind: DatasourceUnavailableKind,
    publicDetail?: string,
  ) {
    const head =
      `[ObjectQL] Datasource '${datasource}' configured for object '${objectName}' is declared but not connected`;
    const why =
      kind === 'blocked'
        ? `: the host's datasource connect policy refused it.`
        : `: it failed to connect at startup and the server was started with ` +
          `OS_ALLOW_DRIVER_CONNECT_FAILURE. Nothing re-runs the connect — the server must be ` +
          `restarted once the datasource is reachable.`;
    const detail = publicDetail ? ` ${publicDetail}` : '';
    super(`${head}${why}${detail} See the startup logs or Setup → Datasources for the cause.`);
    this.name = 'DatasourceUnavailableError';
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
