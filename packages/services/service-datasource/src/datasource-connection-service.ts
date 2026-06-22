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

import type {
  IDatasourceDriverFactory,
  DatasourceConnectionSpec,
} from './contracts/datasource-driver-factory.js';
import {
  allowAllConnectPolicy,
  type DatasourceConnectPolicy,
  type DatasourceConnectContext,
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
  | 'failed-degraded';

export interface ConnectResult {
  name: string;
  status: ConnectStatus;
  reason?: string;
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

  constructor(cfg: DatasourceConnectionServiceConfig) {
    this.cfg = cfg;
    this.policy = cfg.policy ?? allowAllConnectPolicy;
    this.logger = cfg.logger;
  }

  /**
   * Auto-connect the declared (code-defined) datasources that pass the D2 gate.
   * Called from `AppPlugin.start()` with the app bundle's datasources + objects.
   * Each connected external datasource also has its bound objects' read metadata
   * synced so they are immediately queryable with zero app code.
   */
  async connectDeclared(input: {
    datasources: readonly ConnectableDatasource[];
    objects?: readonly DatasourceBoundObject[];
  }): Promise<ConnectResult[]> {
    const objects = input.objects ?? [];
    const results: ConnectResult[] = [];
    for (const ds of input.datasources) {
      if (!ds?.name) continue;
      if (ds.active === false) continue;
      if (!isDatasourceAddressed(ds, { objects })) continue; // D2 gate
      const bound = objects
        .filter((o) => o?.datasource === ds.name && typeof o?.name === 'string')
        .map((o) => o.name as string);
      results.push(
        await this.connect(ds, { objects: bound, context: { origin: ds.origin ?? 'code', trigger: 'declared-auto' } }),
      );
    }
    return results;
  }

  /**
   * Build + connect + register a single datasource's live driver. The shared
   * core used by both auto-connect and the runtime-admin pool registration.
   *
   * Failure policy (ADR-0062 D5): an `external` datasource with
   * `validation.onMismatch: 'fail'` fails fast (re-throws, bricking boot as
   * intended); everything else degrades with a warning so an optional replica's
   * connectivity blip never bricks boot.
   */
  async connect(
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
    let decision;
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
      );
    }

    try {
      const credentialsRef = record.external?.credentialsRef;
      const secret = credentialsRef ? await this.cfg.secrets?.resolve?.(credentialsRef) : undefined;
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
      return this.handleFailure(record, 'failed-degraded', errMsg(err), opts.context);
    }
  }

  /** Gracefully disconnect a previously-registered datasource pool. */
  async disconnect(name: string): Promise<void> {
    const driver = this.cfg.engine()?.getDriverByName?.(name) as { disconnect?: () => Promise<void> } | undefined;
    if (typeof driver?.disconnect === 'function') {
      try {
        await driver.disconnect();
      } catch (err) {
        this.logger?.warn?.(`datasource '${name}': disconnect failed: ${errMsg(err)}`);
      }
    }
  }

  /**
   * Apply the D5 connect-failure policy. A code-defined `external` datasource
   * with `onMismatch:'fail'` auto-connected at boot re-throws (fail-fast,
   * bricking boot as intended). Runtime-admin create/update + boot rehydration
   * always degrade-with-warning — a UI action or a replica blip must never
   * brick the running server (preserves the pre-ADR-0062 admin behavior).
   */
  private handleFailure(
    record: ConnectableDatasource,
    status: ConnectStatus,
    reason: string,
    context?: DatasourceConnectContext,
  ): ConnectResult {
    const isExternal = record.schemaMode && record.schemaMode !== 'managed';
    const failFast =
      context?.trigger === 'declared-auto' &&
      isExternal &&
      record.external?.validation?.onMismatch === 'fail';
    const msg = `datasource '${record.name}': connect failed — ${reason}`;
    if (failFast) {
      throw new Error(
        `${msg}. (schemaMode=${record.schemaMode}, validation.onMismatch='fail' ⇒ fail-fast per ADR-0062 D5)`,
      );
    }
    this.logger?.warn?.(`${msg} — degrading (datasource left unconnected)`);
    return { name: record.name, status, reason };
  }
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
