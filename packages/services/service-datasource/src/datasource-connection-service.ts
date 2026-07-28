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
} from './contracts/datasource-driver-factory.js';
import {
  allowAllConnectPolicy,
  type DatasourceConnectPolicy,
  type DatasourceConnectContext,
  type DatasourceConnectDecision,
} from './contracts/connect-policy.js';
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
  active?: boolean;
  origin?: 'code' | 'runtime';
  /**
   * ADR-0062 D2(c): explicit opt-in to auto-connect even for a managed,
   * unrouted datasource. Defaults to false.
   */
  autoConnect?: boolean;
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
 *  - (c) it sets `autoConnect: true`.
 *
 * Deliberately NOT triggered by a `datasourceMapping` rule alone. A managed
 * datasource that is only *mapped* (namespace/package/default) but has no live
 * driver historically falls through to the `default` driver at query time
 * (`engine.getDriver` step 4) — e.g. `examples/app-crm`'s `crm_primary`
 * (`:memory:`, mapped + default-fallback, no `onEnable`). Connecting it would
 * divert those objects to a fresh, empty connection and silently change app
 * behavior. So mapping-only routing to a *managed* datasource is treated as
 * decorative, keeping existing apps byte-for-byte unchanged (D2's load-bearing
 * backward-compat guarantee). External datasources and explicit
 * `object.datasource` bindings never resolved to `default` (they throw when
 * unregistered), so auto-connecting them is a strict improvement, not a change.
 *
 * That same "no fallback" property is why gate (b) is also a **fail-fast**
 * trigger when the connect fails (framework#3758) — see
 * {@link DatasourceConnectionService.handleFailure}. Gate (c) is not: nothing
 * declares a dependency on an `autoConnect` datasource.
 */
export function isDatasourceAddressed(
  ds: Pick<ConnectableDatasource, 'name' | 'schemaMode' | 'autoConnect'>,
  ctx: { objects?: readonly DatasourceBoundObject[] },
): boolean {
  if (ds.schemaMode && ds.schemaMode !== 'managed') return true; // (a)
  if (ds.autoConnect === true) return true; // (c)
  if (ctx.objects?.some((o) => o?.datasource === ds.name)) return true; // (b)
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
  }): Promise<ConnectResult[]> {
    const objects = input.objects ?? [];
    const results: ConnectResult[] = [];
    const fatal: Error[] = [];
    for (const ds of input.datasources) {
      if (!ds?.name) continue;
      if (ds.active === false) continue;
      if (!isDatasourceAddressed(ds, { objects })) continue; // D2 gate
      const bound = objects
        .filter((o) => o?.datasource === ds.name && typeof o?.name === 'string')
        .map((o) => o.name as string);
      try {
        results.push(
          await this.connect(ds, { objects: bound, context: { origin: ds.origin ?? 'code', trigger: 'declared-auto' } }),
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
    opts: { objects?: readonly string[]; context?: DatasourceConnectContext } = {},
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
    opts: { objects?: readonly string[]; context?: DatasourceConnectContext } = {},
  ): Promise<ConnectResult> {
    const name = record.name;
    const engine = this.cfg.engine();
    const factory = this.cfg.factory();

    // Idempotent: never double-register (e.g. a legacy `onEnable` bridge already
    // registered this driver — the D8 escape hatch).
    if (engine?.getDriverByName?.(name)) {
      return { name, status: 'already-registered' };
    }

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
        return this.handleFailure(record, 'failed-credentials', `resolving credential '${credentialsRef}' threw: ${errMsg(err)}`, opts.context, opts.objects);
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
      const engineDriver = (handle.driver ?? handle) as { name?: string };
      try {
        engineDriver.name = name;
      } catch {
        /* frozen driver — registration may still work if name already matches */
      }
      engine.registerDriver(engineDriver);
      engine.registerDatasourceDef?.({
        name,
        schemaMode: record.schemaMode,
        external: record.external as { allowWrites?: boolean } | undefined,
      });

      // Register read metadata for bound federated objects (DDL-free). Boot
      // schema-sync ran before this driver existed, so do it on-demand now.
      for (const objectName of opts.objects ?? []) {
        try {
          await engine.syncObjectSchema?.(objectName);
        } catch (err) {
          this.logger?.warn?.(`datasource '${name}': syncObjectSchema('${objectName}') failed: ${errMsg(err)}`);
        }
      }

      this.logger?.info?.(`datasource '${name}': connected (driver=${record.driver}, schemaMode=${record.schemaMode ?? 'managed'})`);
      return { name, status: 'connected' };
    } catch (err) {
      return this.handleFailure(record, 'failed-degraded', errMsg(err), opts.context, opts.objects);
    }
  }

  /** Gracefully disconnect a previously-registered datasource pool. */
  async disconnect(name: string): Promise<void> {
    const engine = this.cfg.engine();
    const driver = engine?.getDriverByName?.(name) as { disconnect?: () => Promise<void> } | undefined;
    if (typeof driver?.disconnect === 'function') {
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
   * Apply the D5 connect-failure policy (also covers D3 credential failures).
   *
   * A boot-time (`declared-auto`) connect failure is **fatal** when the
   * datasource has no fallback path, which is true in two cases:
   *
   *  - **(a)** it is `external` with `validation.onMismatch:'fail'` — the author
   *    asked for a hard stop explicitly; or
   *  - **(b)** objects bind to it explicitly via `object.datasource` — those
   *    objects have **no fallback whatsoever**: `engine.getDriver` throws
   *    `Datasource 'x' is not registered` for them, it never resolves `default`
   *    (framework#3758). Leaving this at a warning produced the worst possible
   *    shape: a server that boots clean, serves most of the app, and fails every
   *    read/write of the bound objects with an error that reads nothing like
   *    "the analytics database is unreachable".
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
   */
  private handleFailure(
    record: ConnectableDatasource,
    status: ConnectStatus,
    reason: string,
    context?: DatasourceConnectContext,
    boundObjects: readonly string[] = [],
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
    }
    if (causes.length === 0) {
      this.logger?.warn?.(`${msg} — degrading (datasource left unconnected)`);
      return { name: record.name, status, reason };
    }

    const why = causes.join('; ');
    if (!resolveAllowDriverConnectFailure()) {
      throw new Error(
        `${msg}. (${why} ⇒ fail-fast per ADR-0062 D5). Fix the datasource configuration, or set ` +
        `OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway and serve errors until it is reachable.`,
      );
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
    external: record.external,
    pool: record.pool,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
