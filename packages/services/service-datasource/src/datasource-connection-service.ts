// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DatasourceConnectionService — the single "definition → live driver" path
 * (ADR-0062 D1).
 *
 * Given a datasource definition, it: consults the injectable connect policy
 * (D5/epic seam), builds a driver via the host-provided driver factory,
 * resolves any `external.credentialsRef` to a cleartext secret via the
 * `SecretBinder` (D3, wired in Phase 2), opens the connection, and registers
 * the live driver + the datasource *definition* into the ObjectQL engine under
 * the datasource name (the engine routes by `driver.name === <datasource>`).
 *
 * Both origins converge here (D1):
 *  - **code-defined** datasources auto-connect at boot via
 *    {@link connectDeclared} (gated per D2 — see {@link isDatasourceAddressed}),
 *    called from `AppPlugin.start()`.
 *  - **runtime** (UI-created) datasources connect via {@link connect}, called
 *    from `DatasourceAdminServicePlugin`'s `registerPool` (create/update + boot
 *    rehydration).
 *
 * Idempotent: a datasource already registered as a live driver is skipped, so
 * an app's legacy `onEnable` driver registration (the escape hatch, ADR-0062
 * D8) and auto-connect never double-register.
 */

import {
  emitDegradedBootBanner,
  resolveAllowDriverConnectFailure,
} from '@objectstack/types';
import type {
  IDatasourceDriverFactory,
  DatasourceConnectionSpec,
  DatasourceDriverOwnership,
} from './contracts/datasource-driver-factory.js';
import {
  allowAllConnectPolicy,
  type DatasourceConnectPolicy,
  type DatasourceConnectContext,
  type DatasourceConnectDecision,
} from './contracts/connect-policy.js';
import {
  assertDatasourcePoolSupported,
  unsupportedPoolIssue,
} from './datasource-pool-support.js';
import { connectFailureRemedy } from './connect-failure-remedy.js';
import type { Logger } from './logger.js';
import type { IDataDriver, IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ConnectorCredentialHandle, IConnectorCredentialSource } from '@objectstack/types';
import { borrowConnectorCredential, borrowedConnectorOf } from './datasource-connector-credential.js';
import { datasourceEnvCredentialVar, type DatasourceEnvCredentialSource } from './datasource-env-credential.js';

/** A datasource definition this service can connect (code- or runtime-origin). */
export interface ConnectableDatasource {
  name: string;
  label?: string;
  driver: string;
  schemaMode?: 'managed' | 'external' | 'validate-only';
  config?: Record<string, unknown>;
  external?: (Record<string, unknown> & {
    credentialsRef?: string;
    /** The declared connector instance whose credential this datasource borrows (ADR-0015 D7). */
    connector?: string;
    validation?: { onMismatch?: 'fail' | 'warn' | 'ignore' };
  }) | undefined;
  pool?: Record<string, unknown>;
  /** Datasource-level TLS block — carried to the driver since #4410. */
  ssl?: Record<string, unknown>;
  active?: boolean;
  origin?: 'code' | 'runtime';
  /**
   * ADR-0062 D2(c): explicit opt-in to auto-connect even for a managed,
   * unrouted datasource. Defaults to false.
   */
  autoConnect?: boolean;
  /**
   * The HOST declares the platform cannot run without this datasource, so a
   * boot-time (`declared-auto`) connect failure is fatal regardless of object
   * bindings (#3826). Set by the runtime for the standalone `default` —
   * everything without an explicit binding routes TO it, so "no fallback path"
   * holds by construction even though nothing binds to it *explicitly*. Not
   * part of the app-facing datasource spec: host-composition plumbing only.
   */
  bootCritical?: boolean;
}

/** Minimal object shape used for the D2 routing gate + post-connect schema sync. */
export interface DatasourceBoundObject {
  name?: string;
  /** The object's explicit `datasource` binding (ADR-0015 federation). */
  datasource?: string;
}

/**
 * Engine surface this service drives (the ObjectQL `'data'` engine), DERIVED
 * from the published contracts rather than re-declared structurally — the
 * #4251 B3 sweep pattern, applied here exactly as `datasource-admin-plugin.ts`
 * applied it to its own `DataEngineLike` one file over, under #11493's ruling.
 *
 * [commit 77b91bdb4] Every member was hand-written here until this change, and the
 * inventory that filed its card measured what it cost. Three of them —
 * `registerDatasourceDef`, `markDatasourceUnavailable`,
 * `clearDatasourceUnavailable` — were declared by NO contract at all: real
 * `ObjectQL` methods, called across a package boundary, meeting no compiler on
 * the producer side, so drift landed silently in this consumer. Commit 8425c17cc
 * adopted all three onto {@link IDataEngine} per the ruling, and #12482 followed with
 * `syncObjectSchema`; deriving is what makes the next drift a build error here
 * instead of a re-declaration that quietly disagrees.
 *
 * One member was not merely a duplicate but wrong in the unsafe direction.
 * `registerDriver?: (driver: unknown, isDefault?: boolean) => void` promised
 * this seam accepts *any* value as a driver. The engine does not —
 * {@link IObjectQLEngine.registerDriver} takes an {@link IDataDriver} — so
 * under `strictFunctionTypes` the real engine was measurably NOT assignable to
 * this view, and a mis-shaped driver reaching `registerDriver` was a runtime
 * problem the type was structured not to see. Deriving repairs both halves at
 * once; `__tests__/connection-engine-like-contract.test.ts` pins them.
 *
 * Anchored on {@link IObjectQLEngine} rather than {@link IDataEngine} for one
 * member: `registerDriver` is declared only on the full engine contract. The
 * two describe the same instance — `packages/objectql`'s plugin registers one
 * object under both the `'data'` and `'objectql'` slots — but the `'data'`
 * slot's declared type is the data plane alone, which is why
 * `datasource-admin-plugin.ts` still reaches this type through a cast.
 *
 * `Partial<…>` is load-bearing, not shorthand — the same reason the sibling
 * `DataEngineLike` carries it. `registerDriver` is REQUIRED on the contract,
 * while this service treats its absence as a graceful-degradation signal
 * (`if (!factory || !engine?.registerDriver)` leaves the datasource
 * metadata-only, status `'skipped-no-infra'`). Making it required here would
 * change what a lightweight kernel does at boot.
 */
export type ConnectionEngineLike = Partial<
  Pick<
    IObjectQLEngine,
    | 'registerDriver'
    | 'registerDatasourceDef'
    | 'getDriverByName'
    | 'syncObjectSchema'
    | 'getDefaultDriverName'
    | 'markDatasourceUnavailable'
    | 'clearDatasourceUnavailable'
    | 'unregisterDriver'
  >
>;

/** Secret dereference surface (the `SecretBinder.resolve`, Phase 2 / D3). */
export interface ConnectionSecretResolver {
  resolve?: (credentialsRef: string) => Promise<string | undefined>;
}

export interface DatasourceConnectionServiceConfig {
  /** Resolve the host driver factory (lazy — may be registered after init). */
  factory: () => IDatasourceDriverFactory | undefined;
  /** Resolve the ObjectQL engine (lazy). */
  engine: () => ConnectionEngineLike | undefined;
  /** Dereference `credentialsRef` → cleartext (Phase 2). Optional in Phase 1. */
  secrets?: ConnectionSecretResolver;
  /**
   * The connector credential source an `external.connector` datasource
   * borrows through (ADR-0015 D7) — the automation service's, resolved lazily
   * per connect. Absent, or answering `undefined`, refuses such a datasource
   * at connect: nothing else can supply its credential.
   */
  connectorCredentials?: () => IConnectorCredentialSource | undefined;
  /**
   * [#27687] The runtime-environment credential slot a code-defined datasource
   * reads at connect (`datasource-env-credential.ts`). Absent ⇒ off: the slot
   * is read only when the host opted in.
   */
  envCredentials?: DatasourceEnvCredentialSource;
  /** Injectable connect policy. Defaults to {@link allowAllConnectPolicy}. */
  policy?: DatasourceConnectPolicy;
  logger?: Logger;
}

/** Outcome of a single {@link DatasourceConnectionService.connect} attempt. */
export type ConnectStatus =
  | 'connected'
  | 'already-registered'
  | 'skipped-policy'
  | 'skipped-no-infra'
  | 'skipped-unsupported'
  | 'failed-credentials'
  | 'failed-degraded';

export interface ConnectResult {
  name: string;
  status: ConnectStatus;
  reason?: string;
  /**
   * Teardown ownership recorded at connect time from the factory handle
   * (ADR-0062 D5, #3993). `'host'` marks an ADOPTED pre-built instance
   * (`createPrebuiltDriverFactory`) whose pool outlives this kernel —
   * {@link DatasourceConnectionService.disconnect} then clears the retained
   * state but never closes the driver. Absent ⇒ factory-built for this
   * connect; kernel teardown may disconnect it.
   */
  ownership?: DatasourceDriverOwnership;
}

/**
 * How a {@link ConnectStatus} reads to someone asking "can I use this
 * datasource right now?" (framework#3827).
 *
 *  - `available`   — a live driver is registered (`connected`, or
 *                    `already-registered` via the D8 `onEnable` escape hatch).
 *  - `blocked`     — the host connect policy refused it. A decision, not a
 *                    fault: never fail-fast, and it is expected to persist.
 *  - `failed`      — a connect was attempted and did not produce a usable
 *                    driver (unreachable, bad credential, unsupported driver).
 *  - `unattempted`  — no verdict: the D2 gate left it metadata-only, or there
 *                    was no factory/engine to try with. NOT the same as
 *                    healthy, and NOT the same as broken.
 */
export type DatasourceAvailability = 'available' | 'blocked' | 'failed' | 'unattempted';

/** The retained outcome of the last connect attempt for one datasource. */
export interface DatasourceConnectionState extends ConnectResult {
  availability: DatasourceAvailability;
}

/** Map a raw {@link ConnectStatus} onto its coarse availability class. */
export function availabilityOf(status: ConnectStatus): DatasourceAvailability {
  switch (status) {
    case 'connected':
    case 'already-registered':
      return 'available';
    case 'skipped-policy':
      return 'blocked';
    case 'skipped-unsupported':
    case 'failed-credentials':
    case 'failed-degraded':
      return 'failed';
    case 'skipped-no-infra':
      return 'unattempted';
  }
}

/**
 * The host-reserved name of the platform's primary datasource (ADR-0062,
 * #3826): the one {@link DatasourceConnectionService.connect} connects
 * `asDefault`, and the one runtime-admin create and app bundles may not use.
 */
export const DEFAULT_DATASOURCE_NAME = 'default';

/**
 * The name the engine's driver registry holds `datasource`'s driver under —
 * this package's ONE spelling of ADR-0062's default-driver rule.
 *
 * Every datasource but the default is registered under its own name
 * ({@link DatasourceConnectionService.connect} stamps it). The default keeps
 * its driver's NATURAL name and registers with `isDefault: true`, so
 * `getDriverByName('default')` can never find it: it is reached through the
 * engine's default-driver name instead. `undefined` when the default is asked
 * for and the engine has no default driver (or cannot say).
 *
 * `asDefault` defaults to "is this the reserved name". `disconnect` passes its
 * own flag through unchanged; the saved-datasource Test probe
 * (`ExternalDatasourceServicePlugin`, #24772) asks by name. ⛔ Never a second
 * copy of this rule at a call site: a copy is how the Test probe came to answer
 * "no registered driver" for a default that was live.
 */
export function registeredDriverName(
  engine: Pick<ConnectionEngineLike, 'getDefaultDriverName'> | undefined,
  datasource: string,
  asDefault: boolean = datasource === DEFAULT_DATASOURCE_NAME,
): string | undefined {
  return asDefault ? engine?.getDefaultDriverName?.() : datasource;
}

/**
 * ADR-0062 D2 — is this declared datasource "meaningfully addressed", such that
 * auto-connecting it is safe and intended?
 *
 * Returns true when:
 *  - (a) it is external (`schemaMode !== 'managed'`), OR
 *  - (b) some object **explicitly** binds to it (`object.datasource === name`), OR
 *  - (c) it sets `autoConnect: true`, OR
 *  - (d) a `datasourceMapping` rule ROUTES at least one registered object to it.
 *
 * ## (d), and why D2's phase-1 note no longer holds (#4462)
 *
 * D2 originally excluded (d) to keep `examples/app-crm` byte-for-byte
 * unchanged: its `crm_primary` was mapped but had no driver, so
 * `engine.getDriver` fell through to `default` and the app worked. Connecting
 * it would have diverted those objects to a fresh, empty connection — a
 * behavior change. So a mapping-only managed datasource was declared
 * "decorative".
 *
 * What that traded away was not visible from inside the boot path. An operator
 * who maps an object to an unreachable Postgres gets: a clean boot, `/ready`
 * 200, the datasource name in zero log lines, a `201` on the write, and their
 * rows in the DEFAULT store. They find out by going to look in the database
 * they declared and finding it empty. "Decorative" is not what a mapping rule
 * reads as; it reads as routing.
 *
 * The fix is the pair, and each half is what makes the other correct: routing
 * no longer falls through when a mapped datasource has no driver, so a mapped
 * object now has NO FALLBACK — which is exactly the property that made (b)
 * safe to auto-connect and fatal to fail. (d) inherits both.
 *
 * `ctx.mappedObjects` is supplied by the boot path from the ENGINE's own
 * resolver, never re-derived here — see `ObjectQLEngine.resolveMappedDatasource`.
 * A host that cannot supply it (no engine yet, no mapping configured) passes
 * nothing and (d) simply never fires, which is the pre-#4462 behavior.
 *
 * Gate (c) is not a fail-fast trigger: nothing declares a dependency on an
 * `autoConnect` datasource.
 */
export function isDatasourceAddressed(
  ds: Pick<ConnectableDatasource, 'name' | 'schemaMode' | 'autoConnect'>,
  ctx: {
    objects?: readonly DatasourceBoundObject[];
    /** Datasource name → the objects a `datasourceMapping` rule routes to it. */
    mappedObjects?: Readonly<Record<string, readonly string[]>>;
  },
): boolean {
  if (ds.schemaMode && ds.schemaMode !== 'managed') return true; // (a)
  if (ds.autoConnect === true) return true; // (c)
  if (ctx.objects?.some((o) => o?.datasource === ds.name)) return true; // (b)
  if ((ctx.mappedObjects?.[ds.name]?.length ?? 0) > 0) return true; // (d)
  return false;
}

export class DatasourceConnectionService {
  private readonly cfg: DatasourceConnectionServiceConfig;
  private readonly policy: DatasourceConnectPolicy;
  private readonly logger?: Logger;

  /**
   * Last connect verdict per datasource (framework#3827).
   *
   * Every `connect()` already produced a {@link ConnectResult} and every caller
   * threw it away, which is why a datasource that failed at boot was invisible
   * for the rest of the process: the admin list reported a hardcoded
   * `'unvalidated'` for everything, and `checkDriversHealth()` cannot see a
   * driver that was never registered. Retaining the verdict is what lets both
   * the admin surface and the query-time error say something true.
   */
  private readonly states = new Map<string, DatasourceConnectionState>();

  /**
   * [ADR-0015 D7] The `failed-credentials` verdicts the already-registered
   * guard recorded for an adopted plugin driver, by datasource name, each
   * with the connector instance the datasource names and the reason recorded.
   * The driver stays registered and borrows again on every request, so the
   * verdict judges the declaration at boot, not for the life of the process:
   * the first borrow the lender grants for THAT instance retracts it
   * ({@link retractOnLend}). A connect, reconnect or disconnect of the
   * datasource drops its entry, since it records a verdict of its own.
   */
  private readonly awaitingLend = new Map<string, { connector: string; reason: string }>();

  /** The lenders whose `onLent` this service subscribed to, one subscription each, with their unsubscribes. */
  private readonly lendSubscriptions = new Map<IConnectorCredentialSource, () => void>();
  /**
   * [#27687] Which datasource each derived env-credential variable was read
   * for. Two code datasources deriving one variable would read one password
   * for two connections; the second is refused instead.
   */
  private readonly envCredentialOwners = new Map<string, string>();

  constructor(cfg: DatasourceConnectionServiceConfig) {
    this.cfg = cfg;
    this.policy = cfg.policy ?? allowAllConnectPolicy;
    this.logger = cfg.logger;
  }

  /** The last connect verdict for one datasource, or `undefined` if never attempted. */
  getConnectionState(name: string): DatasourceConnectionState | undefined {
    return this.states.get(name);
  }

  /** Every retained connect verdict, in first-attempt order. */
  listConnectionStates(): DatasourceConnectionState[] {
    return Array.from(this.states.values());
  }

  /**
   * Auto-connect the declared (code-defined) datasources that pass the D2 gate.
   * Called from `AppPlugin.start()` with the app bundle's datasources + objects.
   * Each connected external datasource also has its bound objects' read metadata
   * synced so they are immediately queryable with zero app code.
   *
   * Throws when any datasource hits the D5 fail-fast verdict (see
   * {@link handleFailure}) — but only after attempting **all** of them, so one
   * boot names every misconfigured datasource instead of one per restart. This
   * mirrors `ObjectQLEngine.init()`'s aggregate `DriverConnectError`
   * (framework#3741); the same operator is reading both.
   */
  async connectDeclared(input: {
    datasources: readonly ConnectableDatasource[];
    objects?: readonly DatasourceBoundObject[];
    /**
     * Datasource name → the objects a `datasourceMapping` rule routes to it
     * (#4462), resolved by the caller from the ENGINE's own rule matcher so
     * this service never re-implements "does this rule match?". Absent ⇒ gate
     * (d) never fires, which is the pre-#4462 behavior.
     */
    mappedObjects?: Readonly<Record<string, readonly string[]>>;
  }): Promise<ConnectResult[]> {
    const objects = input.objects ?? [];
    const mappedObjects = input.mappedObjects ?? {};
    this.assertDeclaredPoolsAreHonoured(input.datasources);
    const results: ConnectResult[] = [];
    const fatal: Error[] = [];
    for (const ds of input.datasources) {
      if (!ds?.name) continue;
      if (ds.active === false) continue;
      if (!isDatasourceAddressed(ds, { objects, mappedObjects })) continue; // D2 gate
      const bound = objects
        .filter((o) => o?.datasource === ds.name && typeof o?.name === 'string')
        .map((o) => o.name as string);
      const mapped = mappedObjects[ds.name] ?? [];
      try {
        results.push(
          await this.connect(ds, {
            objects: bound,
            mappedObjects: mapped,
            context: { origin: ds.origin ?? 'code', trigger: 'declared-auto' },
          }),
        );
      } catch (err) {
        fatal.push(err instanceof Error ? err : new Error(String(err)));
        results.push({ name: ds.name, status: 'failed-degraded', reason: errMsg(err) });
      }
    }
    if (fatal.length === 1) throw fatal[0];
    if (fatal.length > 1) {
      throw new Error(
        `${fatal.length} declared datasource(s) failed to connect — refusing to boot.\n` +
        fatal.map((e) => `  • ${e.message}`).join('\n'),
      );
    }
    return results;
  }

  /**
   * Reject every declared `pool` block the datasource's driver cannot honour,
   * BEFORE a single connection is attempted (#5714).
   *
   * Three deliberate properties:
   *
   *  - **It is an authoring verdict, not a connect failure.** It never goes
   *    through {@link handleFailure}, so the D5 degradation policy and its
   *    `OS_ALLOW_DRIVER_CONNECT_FAILURE` escape hatch do not apply and are not
   *    suggested: that hatch exists for a database that is unreachable — a fact
   *    about the world, which may resolve itself. A `pool` the driver cannot
   *    read is a fact about the metadata, and no env var should boot past it.
   *  - **Every declared datasource is judged, not just the connected ones.**
   *    The ADR-0062 D2 gate leaves a managed, unrouted datasource unconnected;
   *    its `pool` block is exactly as dropped as a connected one's, and
   *    `examples/app-crm`'s specimen was of precisely that shape.
   *  - **`active: false` is skipped.** That flag is the operator's way to take
   *    a misconfigured datasource out of service; a boot that refuses to start
   *    over a datasource already switched off would break the remedy itself.
   *
   * All offenders are reported in one throw, mirroring the aggregate connect
   * failure below: one boot names everything to fix, not one per restart.
   */
  private assertDeclaredPoolsAreHonoured(datasources: readonly ConnectableDatasource[]): void {
    const issues: string[] = [];
    for (const ds of datasources) {
      if (!ds?.name || ds.active === false) continue;
      const issue = unsupportedPoolIssue({ driver: ds.driver, pool: ds.pool, name: ds.name });
      if (issue) issues.push(issue);
    }
    if (issues.length === 1) throw new Error(issues[0]);
    if (issues.length > 1) {
      throw new Error(
        `${issues.length} declared datasource(s) declare a \`pool\` block their driver cannot ` +
        `honour — refusing to boot.\n` +
        issues.map((m) => `  • ${m}`).join('\n'),
      );
    }
  }

  /**
   * Build + connect + register a single datasource's live driver. The shared
   * core used by both auto-connect and the runtime-admin pool registration.
   *
   * Failure policy (ADR-0062 D5): at boot, a datasource with **no fallback
   * path** fails fast (re-throws, bricking boot as intended) — `external` with
   * `validation.onMismatch: 'fail'`, or one that `opts.objects` shows is
   * explicitly bound by objects. Everything else degrades with a warning so an
   * optional replica's connectivity blip never bricks boot. See
   * {@link handleFailure}.
   *
   * Whatever the outcome — including the fail-fast throw — it is retained in
   * {@link getConnectionState} and, when the datasource ends up unusable,
   * reported to the engine so a query against a bound object can say *why*
   * instead of a bare "is not registered" (framework#3827 / #3828).
   */
  async connect(
    record: ConnectableDatasource,
    opts: {
      objects?: readonly string[];
      /**
       * Objects a `datasourceMapping` rule routes here (#4462). Like
       * `objects`, these have no fallback since routing stopped falling
       * through — so a boot-time failure with any of them is fatal.
       */
      mappedObjects?: readonly string[];
      context?: DatasourceConnectContext;
      /**
       * Register the built driver as the engine's DEFAULT driver, under the
       * driver's own name (#3826). Set by the runtime for the standalone
       * `default` datasource. Two deliberate differences from a normal connect:
       * the driver keeps its natural name (`sql`/`memory`/…) instead of being
       * stamped with the datasource name — routing to `default` goes through
       * the engine's default-driver fallback, never `drivers.get('default')`,
       * and renaming would change every name-keyed log/lookup the pre-#3826
       * boot produced — and `registerDriver` is called with `isDefault: true`.
       */
      asDefault?: boolean;
    } = {},
  ): Promise<ConnectResult> {
    try {
      const result = await this.attemptConnect(record, opts);
      this.recordState(result, this.lastPublicDetail);
      return result;
    } catch (err) {
      // A D5 fail-fast verdict. The boot is about to abort, but a host that
      // catches it (tests, an embedder, a plugin that degrades on its own) must
      // not be left with a datasource whose state says "never attempted".
      this.recordState(
        { name: record.name, status: 'failed-degraded', reason: errMsg(err) },
        undefined,
      );
      throw err;
    } finally {
      this.lastPublicDetail = undefined;
    }
  }

  /**
   * Policy-supplied, tenant-safe detail for the connect currently in flight.
   * Threaded through an instance field rather than the {@link ConnectResult} so
   * the public result shape stays the operator-facing one: `reason` is
   * privileged, and only this opt-in string may reach an end user (#3828).
   */
  private lastPublicDetail?: string;

  /** Retain the verdict and mirror an unusable datasource into the engine. */
  private recordState(result: ConnectResult, publicDetail: string | undefined): void {
    const availability = availabilityOf(result.status);
    this.states.set(result.name, { ...result, availability });
    const engine = this.cfg.engine();
    if (availability === 'available' || availability === 'unattempted') {
      engine?.clearDatasourceUnavailable?.(result.name);
      return;
    }
    engine?.markDatasourceUnavailable?.({
      name: result.name,
      kind: availability === 'blocked' ? 'blocked' : 'failed',
      ...(publicDetail ? { publicDetail } : {}),
    });
  }

  /**
   * Subscribe to `source`'s granted borrows, once per lender. `false` when
   * there is no lender or it offers no `onLent`, so nothing can retract a
   * verdict recorded against it.
   */
  private subscribeToLends(source: IConnectorCredentialSource | undefined): boolean {
    if (!source || typeof source.onLent !== 'function') return false;
    if (!this.lendSubscriptions.has(source)) {
      this.lendSubscriptions.set(source, source.onLent((connector) => this.retractOnLend(connector)));
    }
    return true;
  }

  /**
   * [ADR-0015 D7] The lender granted a borrow of `connector`: every
   * already-registered-guard verdict waiting on THAT instance is retracted —
   * re-recorded `already-registered`, which clears the engine's unavailable
   * mark — provided the retained state is still the verdict recorded and the
   * plugin's driver is still registered. A grant for any other instance
   * proves nothing about this one and leaves it standing.
   */
  private retractOnLend(connector: string): void {
    for (const [name, awaiting] of this.awaitingLend) {
      if (awaiting.connector !== connector) continue;
      this.awaitingLend.delete(name);
      const state = this.states.get(name);
      if (state?.status !== 'failed-credentials' || state.reason !== awaiting.reason) continue;
      if (!this.cfg.engine()?.getDriverByName?.(name)) continue;
      this.logger?.info?.(
        `datasource '${name}': connector instance '${connector}' lent its credential again — the boot's ` +
        `failed-credentials verdict is retracted`,
      );
      this.recordState({ name, status: 'already-registered' }, undefined);
    }
  }

  private async attemptConnect(
    record: ConnectableDatasource,
    opts: { objects?: readonly string[]; mappedObjects?: readonly string[]; context?: DatasourceConnectContext; asDefault?: boolean } = {},
  ): Promise<ConnectResult> {
    const name = record.name;
    const engine = this.cfg.engine();
    const factory = this.cfg.factory();
    this.awaitingLend.delete(name);

    // Idempotent: never double-register (e.g. a legacy `onEnable` bridge already
    // registered this driver — the D8 escape hatch). The default driver keeps
    // its natural name, so its guard is "does the engine already have a
    // default", not a name lookup.
    if (opts.asDefault) {
      if (engine?.getDefaultDriverName?.()) {
        return { name, status: 'already-registered' };
      }
    } else if (engine?.getDriverByName?.(name)) {
      // [ADR-0015 D7] …except for the credential it borrows. A plugin driver
      // (driver-odata) is adopted from its `driver.<name>` service before this
      // runs, so this guard is the only connect a datasource naming
      // `external.connector` ever reaches: without a verdict here an instance
      // that cannot lend (undeclared, disabled, no `auth`, no automation
      // service) would boot as available and fail every read with its cause in
      // the server log only. The borrow judges the declaration and resolves no
      // value. The driver is not evicted — it belongs to the plugin that
      // registered it (#13578), and it refuses each request on its own — but
      // the datasource is recorded failed (Setup → Datasources names why) and,
      // when objects bind to it, the boot fails as for any connect failure.
      //
      // The verdict is the boot's judgment of the declaration, and the driver
      // borrows again on every request, so once the instance is repaired the
      // first borrow the lender grants for it retracts the verdict and the
      // engine's unavailable mark (`retractOnLend`) — no restart. A lender
      // without `onLent`, or none at all, leaves the verdict until a restart,
      // and the degraded-boot banner says which.
      const connector = borrowedConnectorOf(record.external);
      if (connector !== undefined) {
        const source = this.cfg.connectorCredentials?.();
        const borrow = await borrowConnectorCredential(source, connector);
        if (!borrow.ok) {
          const retractable = this.subscribeToLends(source);
          const result = this.handleFailure(
            record,
            'failed-credentials',
            borrow.reason,
            opts.context,
            opts.objects,
            opts.mappedObjects,
            borrow.cause,
            retractable
              ? `until connector instance '${connector}' can lend its credential: the driver borrows again on every ` +
                `request, and the first borrow granted for '${connector}' clears this verdict and the unavailable ` +
                `mark, with no restart.`
              : undefined,
          );
          if (retractable) this.awaitingLend.set(name, { connector, reason: borrow.reason });
          return result;
        }
      }
      return { name, status: 'already-registered' };
    }

    // From here on THIS service is the thing that would build the driver, so it
    // refuses to build from a declaration it cannot honour (#5714). Placed
    // after the idempotency guard — a driver someone else already registered
    // (the D8 `onEnable` escape hatch) is not this path's to re-judge — and
    // before the policy gate, because an unhonourable `pool` is a property of
    // the declaration rather than of the host's connect decision. Boot-declared
    // datasources have already been judged in bulk by
    // {@link assertDeclaredPoolsAreHonoured}; this covers the runtime-admin
    // (`registerPool`) path and any host calling `connect()` directly.
    assertDatasourcePoolSupported({ driver: record.driver, pool: record.pool, name });

    // Policy gate (fail-closed on throw).
    let decision: DatasourceConnectDecision;
    try {
      decision = await this.policy.canConnect(
        { name, driver: record.driver, schemaMode: record.schemaMode, external: record.external },
        opts.context,
      );
    } catch (err) {
      decision = { allow: false, reason: `connect policy threw: ${errMsg(err)}` };
    }
    if (!decision.allow) {
      this.logger?.info?.(`datasource '${name}': connect denied by policy${decision.reason ? ` (${decision.reason})` : ''}`);
      // `reason` is operator-facing and stays in logs + the admin list;
      // only the opt-in `publicReason` may reach a tenant (#3828).
      this.lastPublicDetail = decision.publicReason;
      return { name, status: 'skipped-policy', reason: decision.reason };
    }

    if (!factory || !engine?.registerDriver) {
      this.logger?.debug?.(`datasource '${name}': no driver factory / engine — left metadata-only`);
      return { name, status: 'skipped-no-infra' };
    }
    if (!factory.supports(record.driver)) {
      return this.handleFailure(
        record,
        'skipped-unsupported',
        `no driver factory supports driver '${record.driver}'`,
        opts.context,
        opts.objects,
        opts.mappedObjects,
      );
    }

    // Credential resolution (ADR-0062 D3) — FAIL-CLOSED, and done *before* the
    // build try-block so a fail-fast verdict propagates (rather than being
    // swallowed and re-classified by the catch below). A declared
    // `external.credentialsRef` MUST resolve to a cleartext secret before we
    // open a connection: building a driver without it would silently connect
    // with no/wrong auth (or fail later with a confusing driver error). So an
    // absent secret store, or an unresolvable/undecryptable ref, leaves the
    // datasource unconnected with a clear message — never a silent skip.
    let secret: string | undefined;
    const credentialsRef = record.external?.credentialsRef;
    if (credentialsRef) {
      const resolver = this.cfg.secrets?.resolve;
      if (!resolver) {
        return this.handleFailure(
          record,
          'failed-credentials',
          `requires credential '${credentialsRef}' but no secret store (SecretBinder/ICryptoProvider) is configured`,
          opts.context,
          opts.objects,
        );
      }
      try {
        secret = await resolver(credentialsRef);
      } catch (err) {
        return this.handleFailure(record, 'failed-credentials', `resolving credential '${credentialsRef}' threw: ${errMsg(err)}`, opts.context, opts.objects, opts.mappedObjects, err);
      }
      if (secret == null || secret === '') {
        return this.handleFailure(
          record,
          'failed-credentials',
          `credential '${credentialsRef}' could not be resolved or decrypted (missing sys_secret row, or the encryption key changed)`,
          opts.context,
          opts.objects,
        );
      }
    }

    // [ADR-0015 D7] The other credential channel, FAIL-CLOSED for the same
    // reason as the block above: a datasource that names a connector instance
    // has no credential but the one it borrows, so a connect that cannot
    // borrow is refused here, naming why — never a driver built to fail its
    // first read with an upstream 401. The borrow judges the declaration
    // only (a runtime-created datasource never passed `defineStack`'s
    // check); a credential not set yet is the handle's to refuse per request,
    // and clears without a reconnect once it is set.
    let credential: ConnectorCredentialHandle | undefined;
    const connector = borrowedConnectorOf(record.external);
    if (connector !== undefined) {
      const borrow = await borrowConnectorCredential(this.cfg.connectorCredentials?.(), connector);
      if (!borrow.ok) {
        return this.handleFailure(record, 'failed-credentials', borrow.reason, opts.context, opts.objects, opts.mappedObjects, borrow.cause);
      }
      credential = borrow.handle;
    }

    // [#27687] The code author's route, after both declared channels and only
    // when neither is declared: a declared reference keeps precedence and its
    // failure above never falls through to here. `envCredentialVar` stays set
    // when the slot applied but the variable was empty, so a failed connect
    // can name the variable to set.
    //
    // [#28283] The owner is claimed here, before the build, so the check and
    // the claim are one step with no await between them; `claimedVariable`
    // records that THIS attempt made the claim, and the failure path below
    // releases it. A connect that failed holds no pool, so it must not refuse
    // a later name as a collision against it.
    let envCredentialVar: string | undefined;
    let claimedVariable: string | undefined;
    if (!credentialsRef && connector === undefined && !opts.asDefault) {
      const variable = this.envCredentialVarFor(name, opts.context);
      if (variable !== undefined) {
        const owner = this.envCredentialOwners.get(variable);
        if (owner !== undefined && owner !== name) {
          return this.handleFailure(
            record,
            'failed-credentials',
            `datasource '${name}' and datasource '${owner}' both derive the credential variable ${variable}, `
              + 'so one password would be read for two connections. Rename one of them.',
            opts.context,
            opts.objects,
            opts.mappedObjects,
          );
        }
        if (owner === undefined) {
          this.envCredentialOwners.set(variable, name);
          claimedVariable = variable;
        }
        const value = this.cfg.envCredentials?.read(variable);
        if (value) secret = value;
        else envCredentialVar = variable;
      }
    }

    // #13578 — set to the registry key ONLY when this attempt is the thing that
    // put it there, so the rollback below can never evict a driver someone else
    // owns. `registerDriver` is a no-op on a name it already holds (it keeps the
    // incumbent and discards the newcomer), and the `asDefault` branch's
    // idempotency guard above tests for A default rather than for THIS name — so
    // "we called register" is not evidence that "we registered".
    let registeredByThisAttempt: string | undefined;
    try {
      const handle = await factory.create({
        ...toSpec(record),
        ...(secret ? { secret } : {}),
        ...(credential ? { credential } : {}),
      });
      if (typeof handle?.connect === 'function') await handle.connect();

      // The engine routes a datasource to a driver by `driver.name === <datasource>`.
      // Prefer the factory's underlying engine driver (the `driver` escape hatch);
      // fall back to the handle. Stamp the name so routing resolves to this pool.
      // The DEFAULT driver (#3826) keeps its natural name instead: routing to
      // `default` goes through the engine's default-driver fallback, never
      // `drivers.get('default')`, and the natural name keeps logs/lookups
      // byte-for-byte with the pre-#3826 boot.
      // [commit 77b91bdb4] `DatasourceDriverHandle.driver` is declared `unknown` — the
      // factory escape hatch is open to any host-built driver — so a cast is
      // unavoidable somewhere on this path. It belongs HERE, at the one call
      // site that constructs the value, not widened into the exported seam
      // type where it told every consumer the engine accepts any value as a
      // driver.
      const engineDriver = (handle.driver ?? handle) as IDataDriver;
      if (!opts.asDefault) {
        try {
          // `IDataDriver.name` is `readonly`, and the engine routes by
          // `driver.name === <datasource>`, so the stamp goes through a
          // writable view (a frozen driver throws and is tolerated below).
          (engineDriver as { name?: string }).name = name;
        } catch {
          /* frozen driver — registration may still work if name already matches */
        }
      }
      // Fails SAFE when the engine cannot answer: an engine without
      // `getDriverByName` (the seam is `Partial<…>`) leaves us unable to tell
      // our registration from someone else's, and evicting on a guess is the
      // worse error of the two — so assume it was already held and roll nothing
      // back.
      const heldBefore =
        typeof engine.getDriverByName === 'function'
          ? engine.getDriverByName(engineDriver.name) !== undefined
          : true;
      engine.registerDriver(engineDriver, opts.asDefault === true);
      if (!heldBefore) registeredByThisAttempt = engineDriver.name;
      // [#27666] `driver` rides along: the engine keys its plugin-driver floor
      // on the def's driver id, and this registration is the ONLY one a
      // runtime-origin datasource gets (the manifest path never sees it), and
      // the only one left after `reconnect`'s eviction dropped the stored def.
      engine.registerDatasourceDef?.({
        name,
        driver: record.driver,
        schemaMode: record.schemaMode,
        external: record.external as { allowWrites?: boolean } | undefined,
      });

      // Register read metadata for bound federated objects (DDL-free). Boot
      // schema-sync ran before this driver existed, so do it on-demand now.
      //
      // #7737 — `mappedObjects` belongs in this loop too. An object a
      // `datasourceMapping` rule routes here (#4462) has exactly the problem
      // an explicitly-bound one has: boot schema-sync skipped it because this
      // driver did not exist yet, so without a re-drive its object ->
      // remote-table mapping is never installed and every read resolves to a
      // table named after the object. The two lists are already treated as
      // equals by the fail-fast policy below (both mean "no fallback
      // driver"); they were unequal only here. `syncObjectSchema` is
      // idempotent, so an object in both lists is harmless.
      //
      // [#22985] A refusal here is reported at `error`, once per object per
      // connect: see {@link objectStorageSyncFailureLine}. Both kinds of bound
      // object end up registered and served with no working storage while the
      // datasource answers `connected`, which is the durability class AGENTS.md
      // "Degradation log levels" sends to `error`. The connect is deliberately
      // NOT failed: one object's DDL refusal must not take every other object
      // on the datasource down with it.
      for (const objectName of [...(opts.objects ?? []), ...(opts.mappedObjects ?? [])]) {
        try {
          await engine.syncObjectSchema?.(objectName);
        } catch (err) {
          // `warn` is the contract's required channel and `error` its optional
          // one, so the fallback is spelled out: never `error?.(…)`, which
          // prints nothing against a sink that has no `error`.
          const logger = this.logger;
          if (logger) {
            (logger.error ?? logger.warn).call(logger, objectStorageSyncFailureLine(name, objectName), {
              datasource: name,
              object: objectName,
              error: errMsg(err),
            });
          }
        }
      }

      this.logger?.info?.(`datasource '${name}': connected (driver=${record.driver}, schemaMode=${record.schemaMode ?? 'managed'})`);
      return { name, status: 'connected', ...(handle.ownership ? { ownership: handle.ownership } : {}) };
    } catch (err) {
      // #13578 — failed-start ROLLBACK, the first path the card asked to be
      // walked. Registration happens partway through this block, so a throw
      // after it used to return `failed-degraded` while leaving a live entry in
      // the registry: a datasource the admin list reports as failed, whose
      // driver the readiness probe still pings. Narrow today (the steps after
      // `registerDriver` are individually guarded), but the window is real and
      // the rollback is what makes "failed ⇒ not registered" true by
      // construction rather than by the current arrangement of the lines.
      //
      // Before `handleFailure`, which records the unavailable mark: eviction
      // deliberately does not touch that map, and the mark must outlive it.
      if (registeredByThisAttempt) engine.unregisterDriver?.(registeredByThisAttempt);
      if (claimedVariable !== undefined) this.envCredentialOwners.delete(claimedVariable);
      // `err` itself is handed on, not just its message: the driver package's
      // build output being absent is reported as `err.code ===
      // 'ERR_MODULE_NOT_FOUND'`, and that structured signal is gone the moment
      // the error is stringified (#5794).
      //
      // [#28283] The unset variable is a note after the driver's own error,
      // never its explanation: an unreachable host, a missing driver module or
      // a TLS failure is not cured by a password, and the driver's error is
      // the one thing that says which failure this was.
      const reason = envCredentialVar === undefined
        ? errMsg(err)
        : `${errMsg(err)} (note: datasource '${name}' is defined in code and reads its credential from `
          + `${envCredentialVar} at connect, which is not set on this host)`;
      return this.handleFailure(record, 'failed-degraded', reason, opts.context, opts.objects, opts.mappedObjects, err);
    }
  }

  /**
   * [#27687] The env-credential variable this connect may read, or `undefined`
   * when the slot does not apply: the host did not opt in, the connect is not
   * the boot's declared-auto one, or the name is not one the host registers
   * from code. Provenance only — `context.origin` and `record.origin` are the
   * caller's to set and are never consulted.
   */
  private envCredentialVarFor(name: string, context: DatasourceConnectContext | undefined): string | undefined {
    const slot = this.cfg.envCredentials;
    if (!slot || context?.trigger !== 'declared-auto') return undefined;
    if (!slot.isCodeDatasource(name)) return undefined;
    return datasourceEnvCredentialVar(name);
  }

  /**
   * Gracefully disconnect a previously-registered datasource pool.
   *
   * Two teardown rules (ADR-0062 D5, #3993):
   *  - `asDefault` resolves the driver the way the default was registered —
   *    under its NATURAL name via the engine's default-driver fallback
   *    (`getDriverByName('default')` can never find it, by the #3826 design).
   *  - A `'host'`-owned (adopted) instance is never closed here: its pool
   *    outlives this kernel (shared proxy base / cross-kernel registry cache),
   *    so only the retained verdict is cleared and the host keeps the pool.
   */
  async disconnect(name: string, opts: { asDefault?: boolean } = {}): Promise<void> {
    const engine = this.cfg.engine();
    const driverName = registeredDriverName(engine, name, opts.asDefault === true);
    // [commit 77b91bdb4] Cast-free: `getDriverByName` now answers the contract's
    // `IDataDriver | undefined` instead of a locally re-declared `unknown`.
    // The `typeof … === 'function'` guard below stays — a host-built driver in
    // the registry satisfies the contract only structurally.
    const driver = driverName ? engine?.getDriverByName?.(driverName) : undefined;
    if (this.states.get(name)?.ownership === 'host') {
      this.logger?.debug?.(`datasource '${name}': adopted (host-owned) instance — pool left to the host, clearing state only`);
    } else if (typeof driver?.disconnect === 'function') {
      try {
        await driver.disconnect();
      } catch (err) {
        this.logger?.warn?.(`datasource '${name}': disconnect failed: ${errMsg(err)}`);
      }
    }
    // A removed/updated pool has no verdict any more. Leaving a stale `failed`
    // behind would make the admin list — and the query-time error — describe a
    // datasource that no longer exists in that state.
    this.states.delete(name);
    this.awaitingLend.delete(name);
    for (const [variable, owner] of this.envCredentialOwners) {
      if (owner === name) this.envCredentialOwners.delete(variable);
    }
    engine?.clearDatasourceUnavailable?.(name);

    // #13578 — the eviction this method never did. Closing the pool above only
    // ends the CONNECTION; the driver instance stayed in the engine registry,
    // so `checkDriversHealth()` (and through it `GET /api/v1/ready`) kept
    // naming a datasource whose record had already been deleted, with a process
    // restart as the only recovery.
    //
    // It goes LAST, and after the disconnect: `driver` above is resolved out of
    // the registry, so evicting first would leave the pool open with nothing
    // left holding a handle to close it.
    //
    // `driverName` rather than `name`: the DEFAULT driver is registered under
    // its NATURAL name (#3826), so `name` ('default') matches no registry key
    // and evicting by it would silently remove nothing — the same
    // exit-0-and-did-nothing shape this fix exists to remove.
    if (driverName) engine?.unregisterDriver?.(driverName);
  }

  /**
   * Rebuild one datasource's live pool from a NEW record, keeping the OLD pool
   * when the rebuild fails (#13804).
   *
   * The update path's problem is that {@link connect} alone cannot express a
   * reconfigure: its idempotency guard answers `already-registered` while the
   * old driver holds the name, and the engine's `registerDriver` keeps the
   * incumbent on a collision — so a changed record was persisted while the
   * pool built from the OLD record kept serving, with the retained `connected`
   * verdict describing a configuration the record no longer declares.
   *
   * Sequence: evict the old registration (the #13578 door), rebuild via the
   * one shared connect path, then settle by outcome —
   *
   *  - **rebuild succeeded** → the new pool is registered; the old pool's
   *    connection is closed (unless the instance was ADOPTED — host-owned,
   *    ADR-0062 D5 — in which case the host keeps it, exactly as
   *    {@link disconnect} would).
   *  - **rebuild failed or was refused** → the OLD driver instance is
   *    re-registered so the datasource is never left pool-less (the ruled
   *    "never brick a running server over a UI action" direction), and the
   *    retained verdict stays the LOUD failed one — the admin list reports
   *    `error`/`blocked` with a reason naming that the previous
   *    configuration's pool is still the one serving. Routing consults the
   *    registry before the unavailable mark, so the restored driver keeps
   *    serving while the verdict tells the operator the truth.
   *
   * The eviction window is real but narrow: between the evict and the new
   * registration, queries against this datasource fail with "not registered".
   * That is the cost of an in-place rebuild; the caller only takes it when a
   * connectivity-bearing field actually changed (a label edit never enters).
   *
   * `previous` is the record the LIVE pool was built from. It exists because
   * `unregisterDriver` removes the datasource def together with the driver
   * (the registry owns that invariant), so the keep-old-pool path must restore
   * the def the old pool was serving under — otherwise the write gate would
   * judge writes for a datasource whose def vanished mid-failure. It is
   * REQUIRED ([#27727]): the restored def's `driver` is what keeps a kept
   * plugin-driver pool behind the engine's correctness floor, and a restore
   * that cannot name it would serve that pool unfloored, silently. A call
   * without `previous.driver` is refused before anything is evicted.
   *
   * Not for the DEFAULT datasource: runtime-admin records can never be named
   * `default` (the name is host-reserved), and the default driver's natural-
   * name registration (#3826) would make a name-keyed swap evict nothing.
   *
   * [#27750] `objects` are the objects bound to the NEW record, passed to the
   * rebuild's {@link connect} so its sync loop gives them their tables on the
   * pool the new configuration opens (a changed `config` can point at a new,
   * empty database). The caller passes them only for a MANAGED datasource, the
   * same gate `registerPool` applies on create. The kept-old-pool path syncs
   * nothing: that pool already served those objects.
   */
  async reconnect(
    record: ConnectableDatasource,
    opts: {
      objects?: readonly string[];
      context?: DatasourceConnectContext;
      previous: Pick<ConnectableDatasource, 'driver' | 'schemaMode' | 'external'>;
    },
  ): Promise<ConnectResult> {
    const name = record.name;
    if (typeof opts?.previous?.driver !== 'string' || opts.previous.driver === '') {
      throw new Error(
        `datasource '${name}': reconnect needs \`previous\`, the record the live pool was built from, ` +
          'with its `driver` id — without it, when a pool is live, a failed rebuild would restore that pool ' +
          'under a definition that names no driver, and a plugin driver would be served without the engine\'s ' +
          'correctness floor. ' +
          'Pass the stored record as it was before this update.',
      );
    }
    const engine = this.cfg.engine();
    const oldDriver = engine?.getDriverByName?.(name);
    if (!oldDriver || !engine || typeof engine.unregisterDriver !== 'function') {
      // Nothing to swap (no live driver — the datasource was inactive, or its
      // last connect failed), or the engine has no eviction door. Either way a
      // plain connect is the whole job: it builds when the name is free, and
      // on a door-less engine it degrades to the pre-#13804 idempotent no-op —
      // the safe direction for a host that cannot express a swap.
      return this.connect(record, { objects: opts.objects, context: opts.context });
    }
    const oldOwnership = this.states.get(name)?.ownership;

    const restoreOldPool = (): void => {
      engine.registerDriver?.(oldDriver, false);
      // [#27666] The OLD record's driver id, not `record.driver`: the kept
      // pool was built from `previous`, and a reconfigure may have changed the
      // driver. Without it the engine would read the restored def as "not a
      // plugin driver" and serve the kept pool unfloored.
      engine.registerDatasourceDef?.({
        name,
        driver: opts.previous.driver,
        schemaMode: opts.previous.schemaMode,
        external: opts.previous.external as { allowWrites?: boolean } | undefined,
      });
    };
    const stillServingSuffix =
      " — the previous configuration's pool was kept and is still the one serving; the new configuration is NOT in force";

    engine.unregisterDriver(name);
    let result: ConnectResult;
    try {
      result = await this.connect(record, { objects: opts.objects, context: opts.context });
    } catch (err) {
      // `connect` re-throws authoring verdicts (an unhonourable `pool` block,
      // #5714) after recording a failed state. Same settlement as a returned
      // failure: the old pool comes back, the loud verdict stands.
      restoreOldPool();
      this.amendRetainedReason(name, stillServingSuffix);
      throw err;
    }

    if (availabilityOf(result.status) === 'available') {
      if (oldOwnership !== 'host' && typeof oldDriver.disconnect === 'function') {
        try {
          await oldDriver.disconnect();
        } catch (err) {
          this.logger?.warn?.(`datasource '${name}': closing the replaced pool failed: ${errMsg(err)}`);
        }
      }
      return result;
    }

    restoreOldPool();
    this.amendRetainedReason(name, stillServingSuffix);
    this.logger?.warn?.(
      `datasource '${name}': rebuild after reconfigure failed (${result.reason ?? result.status})` +
        stillServingSuffix,
    );
    return result;
  }

  /**
   * Append detail to the retained verdict's `reason` — used by
   * {@link reconnect} so the loud degraded verdict also says the OLD pool is
   * the one still serving (without it, `error` + a bare connect failure reads
   * as "this datasource is down", which is precisely not the state).
   */
  private amendRetainedReason(name: string, suffix: string): void {
    const st = this.states.get(name);
    if (!st) return;
    this.states.set(name, { ...st, reason: `${st.reason ?? 'reconnect failed'}${suffix}` });
  }

  /**
   * Kernel-teardown sweep (ADR-0062 D5, #3993): disconnect exactly the pools
   * THIS service opened — states with status `'connected'`, nothing else.
   * `'already-registered'` is deliberately excluded (someone else registered
   * that driver — an `onEnable` bridge, the default's idempotent replay — and
   * this service closing it would pull a pool from under its real owner);
   * host-owned adopted instances are skipped inside {@link disconnect}.
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.states.entries())
      .filter(([, st]) => st.status === 'connected')
      .map(([n]) => n);
    for (const n of names) {
      await this.disconnect(n, { asDefault: n === DEFAULT_DATASOURCE_NAME });
    }
    for (const unsubscribe of this.lendSubscriptions.values()) unsubscribe();
    this.lendSubscriptions.clear();
    this.awaitingLend.clear();
  }

  /**
   * Apply the D5 connect-failure policy (also covers D3 credential failures).
   *
   * A boot-time (`declared-auto`) connect failure is **fatal** when the
   * datasource has no fallback path, which is true in three cases:
   *
   *  - **(a)** it is `external` with `validation.onMismatch:'fail'` — the author
   *    asked for a hard stop explicitly; or
   *  - **(b)** objects bind to it explicitly via `object.datasource` — those
   *    objects have **no fallback whatsoever**: `engine.getDriver` throws
   *    `Datasource 'x' is not registered` for them, it never resolves `default`
   *    (framework#3758). Leaving this at a warning produced the worst possible
   *    shape: a server that boots clean, serves most of the app, and fails every
   *    read/write of the bound objects with an error that reads nothing like
   *    "the analytics database is unreachable"; or
   *  - **(c)** the host marked it {@link ConnectableDatasource.bootCritical} —
   *    the standalone `default` (#3826): everything WITHOUT a binding routes to
   *    it, so "no fallback" holds by construction, mirroring the engine-level
   *    guard (#3741) this connect path replaces; or
   *  - **(d)** a `datasourceMapping` rule routes objects to it (#4462). Same
   *    argument as (b), reached one clause later: since routing stopped falling
   *    through on a mapped-but-unconnected datasource, those objects have no
   *    fallback either. Before that, this case was not merely non-fatal — it was
   *    SILENT, and the objects' rows went to the default store.
   *
   * Anything else degrades with a warning: `autoConnect:true` means "connect it
   * if you can" with nothing declaring a dependency on it, and runtime-admin
   * create/update + boot rehydration must never brick a running server over a
   * UI action or a replica blip (preserves the pre-ADR-0062 admin behavior).
   *
   * The fatal path shares the engine's escape hatch,
   * `OS_ALLOW_DRIVER_CONNECT_FAILURE` (framework#3741) — the operator intent is
   * identical ("I know the database is unreachable, boot anyway") and two flags
   * would only mean one of them gets missed. When it is set the boot continues
   * and the degraded state is announced on a channel `os serve`'s boot-quiet
   * stdout capture cannot swallow.
   *
   * Either way the datasource is left unconnected with a clear message — never
   * a silent skip.
   *
   * The fail-fast throw's closing sentence is chosen by CAUSE (#5794): a driver
   * package that could not be loaded at all gets `pnpm install && pnpm build`
   * and nothing else, because for that cause both halves of the generic advice
   * are actively harmful — see `connect-failure-remedy.ts`. Everything above
   * that sentence, and every other cause's text, is unchanged.
   */
  private handleFailure(
    record: ConnectableDatasource,
    status: ConnectStatus,
    reason: string,
    context?: DatasourceConnectContext,
    boundObjects: readonly string[] = [],
    mappedObjects: readonly string[] = [],
    /**
     * The value that was actually thrown, when this failure came from one.
     * Carried alongside `reason` rather than folded into it because the signal
     * that identifies an unbuilt workspace is STRUCTURED (`err.code`), and
     * stringifying the error to a message drops it. Absent for the failures
     * this service diagnoses itself (an unsupported driver id, an unresolvable
     * credential) — those are never module-resolution failures.
     */
    cause?: unknown,
    /**
     * How the datasource recovers, for the degraded-boot banner, when that is
     * not the default "until it is reachable AND the server is restarted"
     * (the already-registered guard's verdict clears on the next lend).
     */
    recovery?: string,
  ): ConnectResult {
    const isExternal = record.schemaMode && record.schemaMode !== 'managed';
    const msg = `datasource '${record.name}': connect failed — ${reason}`;

    const causes: string[] = [];
    if (context?.trigger === 'declared-auto') {
      if (isExternal && record.external?.validation?.onMismatch === 'fail') {
        causes.push(`schemaMode=${record.schemaMode}, validation.onMismatch='fail'`);
      }
      if (boundObjects.length > 0) {
        causes.push(
          `${boundObjects.length} object(s) bind to it explicitly (${formatObjectList(boundObjects)}) ` +
          `and have no fallback datasource — every read/write of them would fail`,
        );
      }
      if (mappedObjects.length > 0) {
        causes.push(
          `${mappedObjects.length} object(s) are routed to it by a datasourceMapping rule ` +
          `(${formatObjectList(mappedObjects)}) and have no fallback datasource — their reads/writes ` +
          `would otherwise land in a DIFFERENT database than the one they declare`,
        );
      }
      if (record.bootCritical === true) {
        causes.push(
          `declared boot-critical by the host — it is the platform's primary datasource and ` +
          `every object without an explicit binding routes to it`,
        );
      }
    }
    if (causes.length === 0) {
      this.logger?.warn?.(`${msg} — degrading (datasource left unconnected)`);
      return { name: record.name, status, reason };
    }

    const why = causes.join('; ');
    if (!resolveAllowDriverConnectFailure()) {
      throw new Error(`${msg}. (${why} ⇒ fail-fast per ADR-0062 D5). ${connectFailureRemedy(cause)}`);
    }
    const banner =
      `⚠️ DEGRADED BOOT: ${msg} (${why}), but OS_ALLOW_DRIVER_CONNECT_FAILURE is set — starting ` +
      `anyway. Queries against the objects bound to it fail with ERR_DATASOURCE_UNAVAILABLE (HTTP ` +
      `503) ${recovery ?? 'until it is reachable AND the server is restarted: nothing re-runs the connect.'} ` +
      `Its state shows as 'error' in Setup → Datasources. Unset OS_ALLOW_DRIVER_CONNECT_FAILURE ` +
      `to restore fail-fast boot.`;
    this.logger?.warn?.(banner);
    // …and again on a channel the host cannot silence — see the helper's note
    // on `os serve`'s boot-quiet stdout capture.
    emitDegradedBootBanner(banner);
    return { name: record.name, status, reason };
  }
}

/** Up to 10 bound object names, then `+N more` — a name list, not a wall of text. */
function formatObjectList(names: readonly string[]): string {
  const head = names.slice(0, 10).join(', ');
  return names.length > 10 ? `${head}, +${names.length - 10} more` : head;
}

function toSpec(record: ConnectableDatasource): DatasourceConnectionSpec {
  return {
    name: record.name,
    driver: record.driver,
    config: record.config ?? {},
    // #4410: dropped here before, which is why the factory went looking for
    // `schemaMode` in two places that could never hold it.
    ...(record.schemaMode ? { schemaMode: record.schemaMode } : {}),
    external: record.external,
    pool: record.pool,
    ssl: record.ssl,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * [#22985] The ONE line `connect()` prints when a bound object's
 * `syncObjectSchema` throws — at `error`, carrying both halves AGENTS.md
 * "Degradation log levels" asks of a durability degradation: ① the
 * consequence, and that the deployment keeps looking healthy; ② the fix.
 *
 * Both kinds of bound object are covered, because the catch cannot tell them
 * apart and both land in the same place: a managed object's DDL never ran, so
 * its table/columns do not exist, and a federated object's binding to its
 * remote table was never installed, so its reads resolve to a table named
 * after the object. Either way the object stays registered and served while
 * this datasource answers `connected`. The remedy is the one the code path
 * gives: this loop runs inside `connectDeclared`, which every boot calls, so a
 * restart re-runs the sync once the refusal is resolved. `os migrate` is not
 * named, because it plans only the primary datasource and its telemetry
 * sibling, never a datasource an app declares.
 */
function objectStorageSyncFailureLine(datasource: string, objectName: string): string {
  return (
    `datasource '${datasource}': object '${objectName}' has NO working storage here — its schema sync was refused, ` +
    'so a managed object\'s table/columns were not created or altered, and a federated object is not bound to its ' +
    `remote table. The datasource still reports connected and '${objectName}' stays registered and served, so reads ` +
    'and writes against it fail, or hit a table named after the object, while the deployment looks healthy. ' +
    "Fix: resolve the driver's refusal (in this record's meta), then restart: every boot re-runs this sync when it " +
    'connects the declared datasource.'
  );
}
