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

/** A datasource definition this service can connect (code- or runtime-origin). */
export interface ConnectableDatasource {
  name: string;
  label?: string;
  driver: string;
  schemaMode?: 'managed' | 'external' | 'validate-only';
  config?: Record<string, unknown>;
  external?: (Record<string, unknown> & {
    credentialsRef?: string;
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

/** Engine surface this service drives (the ObjectQL `'data'` engine). */
export interface ConnectionEngineLike {
  registerDriver?: (driver: unknown, isDefault?: boolean) => void;
  registerDatasourceDef?: (def: {
    name: string;
    schemaMode?: string;
    external?: { allowWrites?: boolean };
  }) => void;
  getDriverByName?: (name: string) => unknown;
  /**
   * Register read metadata (DDL-free) for a federated object so its physical
   * remote table/columns resolve for queries. Idempotent; called per bound
   * external object after the driver is registered, because boot schema-sync
   * ran before this driver existed (ADR-0015 §18; matches what the legacy
   * `onEnable` bridge does manually).
   */
  syncObjectSchema?: (objectName: string) => Promise<void>;
  /**
   * Name of the engine's DEFAULT driver, when one is set. Used by the
   * `asDefault` connect path's idempotency guard (#3826): the default driver
   * keeps its natural name, so `getDriverByName('default')` can never detect a
   * prior registration.
   */
  getDefaultDriverName?: () => string | undefined;
  /**
   * Tell the engine a datasource was *declared* but is not connected, and why
   * (framework#3828). Without this the engine cannot distinguish "the app
   * misspelled a datasource name" from "the host's policy refused it" from "it
   * failed to connect and the operator set OS_ALLOW_DRIVER_CONNECT_FAILURE" —
   * all three used to surface as the same bare `is not registered`.
   *
   * `publicDetail` is the only part safe to echo to an end user; the operator
   * -facing reason stays in the logs and the datasource-admin list.
   */
  markDatasourceUnavailable?: (info: {
    name: string;
    kind: 'blocked' | 'failed';
    publicDetail?: string;
  }) => void;
  /** Drop a previous {@link markDatasourceUnavailable} record (reconnect / removal). */
  clearDatasourceUnavailable?: (name: string) => void;
}

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

  private async attemptConnect(
    record: ConnectableDatasource,
    opts: { objects?: readonly string[]; mappedObjects?: readonly string[]; context?: DatasourceConnectContext; asDefault?: boolean } = {},
  ): Promise<ConnectResult> {
    const name = record.name;
    const engine = this.cfg.engine();
    const factory = this.cfg.factory();

    // Idempotent: never double-register (e.g. a legacy `onEnable` bridge already
    // registered this driver — the D8 escape hatch). The default driver keeps
    // its natural name, so its guard is "does the engine already have a
    // default", not a name lookup.
    if (opts.asDefault) {
      if (engine?.getDefaultDriverName?.()) {
        return { name, status: 'already-registered' };
      }
    } else if (engine?.getDriverByName?.(name)) {
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

    try {
      const handle = await factory.create({ ...toSpec(record), ...(secret ? { secret } : {}) });
      if (typeof handle?.connect === 'function') await handle.connect();

      // The engine routes a datasource to a driver by `driver.name === <datasource>`.
      // Prefer the factory's underlying engine driver (the `driver` escape hatch);
      // fall back to the handle. Stamp the name so routing resolves to this pool.
      // The DEFAULT driver (#3826) keeps its natural name instead: routing to
      // `default` goes through the engine's default-driver fallback, never
      // `drivers.get('default')`, and the natural name keeps logs/lookups
      // byte-for-byte with the pre-#3826 boot.
      const engineDriver = (handle.driver ?? handle) as { name?: string };
      if (!opts.asDefault) {
        try {
          engineDriver.name = name;
        } catch {
          /* frozen driver — registration may still work if name already matches */
        }
      }
      engine.registerDriver(engineDriver, opts.asDefault === true);
      engine.registerDatasourceDef?.({
        name,
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
      for (const objectName of [...(opts.objects ?? []), ...(opts.mappedObjects ?? [])]) {
        try {
          await engine.syncObjectSchema?.(objectName);
        } catch (err) {
          this.logger?.warn?.(`datasource '${name}': syncObjectSchema('${objectName}') failed: ${errMsg(err)}`);
        }
      }

      this.logger?.info?.(`datasource '${name}': connected (driver=${record.driver}, schemaMode=${record.schemaMode ?? 'managed'})`);
      return { name, status: 'connected', ...(handle.ownership ? { ownership: handle.ownership } : {}) };
    } catch (err) {
      // `err` itself is handed on, not just its message: the driver package's
      // build output being absent is reported as `err.code ===
      // 'ERR_MODULE_NOT_FOUND'`, and that structured signal is gone the moment
      // the error is stringified (#5794).
      return this.handleFailure(record, 'failed-degraded', errMsg(err), opts.context, opts.objects, opts.mappedObjects, err);
    }
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
    const driverName = opts.asDefault ? engine?.getDefaultDriverName?.() : name;
    const driver = (driverName ? engine?.getDriverByName?.(driverName) : undefined) as
      | { disconnect?: () => Promise<void> }
      | undefined;
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
    engine?.clearDatasourceUnavailable?.(name);
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
      await this.disconnect(n, { asDefault: n === 'default' });
    }
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
      `503) until it is reachable AND the server is restarted: nothing re-runs the connect. ` +
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
