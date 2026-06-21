// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { registerMetadataTypeActions } from '@objectstack/spec/kernel';
import type {
  IDatasourceDriverFactory,
  DatasourceConnectionSpec,
  TestConnectionResult,
} from './contracts/index.js';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
  type ProbeInput,
} from './datasource-admin-service.js';
import type { Logger } from './logger.js';

/**
 * Minimal metadata-service surface used for datasource persistence + the
 * bound-object count. Kept structural so the plugin doesn't hard-depend on the
 * concrete `MetadataManager`.
 */
interface MetadataServiceLike {
  get: (type: string, name: string) => Promise<unknown>;
  list: (type: string) => Promise<unknown[]>;
  register: (type: string, name: string, data: unknown) => Promise<void>;
  unregister: (type: string, name: string) => Promise<void>;
  listObjects?: () => Promise<unknown[]>;
}

/** Engine surface used for hot pool (de)registration. */
interface DataEngineLike {
  registerDriver?: (driver: unknown, isDefault?: boolean) => void;
  registerDatasourceDef?: (def: { name: string; schemaMode?: string; external?: { allowWrites?: boolean } }) => void;
  getDriverByName?: (name: string) => unknown;
  // sys_metadata CRUD used to persist runtime datasource records durably (same
  // table runtime objects use). Optional — absent on lightweight kernels, in
  // which case persistence degrades to in-memory (pre-existing behavior).
  findOne?: (object: string, query: { where?: Record<string, unknown> }) => Promise<Record<string, unknown> | undefined | null>;
  find?: (object: string, query: { where?: Record<string, unknown> }) => Promise<Record<string, unknown>[]>;
  insert?: (object: string, row: Record<string, unknown>) => Promise<unknown>;
  update?: (object: string, row: Record<string, unknown>, opts: { where: Record<string, unknown> }) => Promise<unknown>;
  delete?: (object: string, opts: { where: Record<string, unknown> }) => Promise<unknown>;
}

/**
 * Durable persistence for runtime datasource records via the `sys_metadata`
 * table — the same store runtime objects use (the protocol writes objects there
 * directly). `MetadataManager.register()` alone is in-memory unless a writable
 * `datasource:` loader is wired, which standalone `serve` does not do; so a
 * UI-created datasource vanished on restart. These helpers persist on write and
 * the plugin restores them into the registry on boot before rehydrating pools.
 * Credential cleartext is never stored — only the opaque `external.credentialsRef`.
 */
const DS_META_TYPE = 'datasource';
const SYS_METADATA = 'sys_metadata';

function newMetaId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `meta_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function persistDatasourceRow(engine: DataEngineLike | undefined, record: { name: string }): Promise<void> {
  if (!engine?.insert || !engine.findOne) return; // no durable store — in-memory only
  const now = new Date().toISOString();
  const existing = await engine.findOne(SYS_METADATA, {
    where: { type: DS_META_TYPE, name: record.name, state: 'active' },
  });
  if (existing) {
    await engine.update?.(
      SYS_METADATA,
      { metadata: JSON.stringify(record), updated_at: now, version: ((existing.version as number) || 0) + 1, state: 'active' },
      { where: { id: existing.id } },
    );
  } else {
    await engine.insert(SYS_METADATA, {
      id: newMetaId(),
      name: record.name,
      type: DS_META_TYPE,
      scope: 'platform',
      metadata: JSON.stringify(record),
      state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    });
  }
}

async function deleteDatasourceRow(engine: DataEngineLike | undefined, name: string): Promise<void> {
  if (!engine?.findOne) return;
  const existing = await engine.findOne(SYS_METADATA, { where: { type: DS_META_TYPE, name, state: 'active' } });
  if (!existing) return;
  if (engine.delete) await engine.delete(SYS_METADATA, { where: { id: existing.id } });
  else await engine.update?.(SYS_METADATA, { state: 'inactive' }, { where: { id: existing.id } });
}

async function loadDatasourceRows(engine: DataEngineLike | undefined): Promise<Array<Record<string, unknown>>> {
  if (!engine?.find) return [];
  const rows = await engine.find(SYS_METADATA, { where: { type: DS_META_TYPE, state: 'active' } });
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows ?? []) {
    const raw = (r as { metadata?: unknown }).metadata;
    try {
      out.push(typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>));
    } catch {
      /* skip corrupt row */
    }
  }
  return out;
}

/**
 * Host-provided secret binding. Encrypts a cleartext credential into the secret
 * store and returns an opaque `credentialsRef`; `unbind` deletes it. Wired by
 * the stack that owns the `ICryptoProvider` + `sys_secret` store. When absent,
 * the plugin fails *closed*: creating/updating a datasource *with* a secret
 * throws rather than risk persisting cleartext.
 */
export interface SecretBinder {
  bind: (input: { value: string; namespace?: string; key?: string }, hint: { name: string }) => Promise<string>;
  unbind?: (credentialsRef: string) => Promise<void>;
  /**
   * Dereference a `credentialsRef` back to cleartext for opening a live
   * connection (boot rehydration + hot pool registration). Optional: when
   * absent, pools for secret-bearing datasources are built without the
   * credential (fine for credential-less drivers like sqlite/memory).
   */
  resolve?: (credentialsRef: string) => Promise<string | undefined>;
}

export interface DatasourceAdminServicePluginOptions {
  /** Secret binding backed by the host's crypto provider + `sys_secret`. */
  secrets?: SecretBinder;
  /** Override the driver factory (defaults to the `'datasource-driver-factory'` service). */
  driverFactory?: IDatasourceDriverFactory;
  logger?: Logger;
}

/**
 * DatasourceAdminServicePlugin — registers `IDatasourceAdminService` into the
 * kernel as the `'datasource-admin'` service (ADR-0015 Addendum).
 *
 * Bridges the decoupled {@link DatasourceAdminService} to live infrastructure:
 *  - persistence + bound-object count via the `'metadata'` service
 *    (`register`/`unregister` write through to the runtime DB loader),
 *  - connection probe + hot pool (de)registration via the
 *    `'datasource-driver-factory'` capability and the `'data'` engine,
 *  - secret encryption via a host-provided {@link SecretBinder} (fail-closed).
 *
 * Every dependency degrades gracefully: a missing driver factory turns
 * `testConnection` into a clear `{ ok: false }` and skips hot pool registration
 * (the driver is picked up at next boot); a missing secret binder makes
 * secret-bearing create/update fail loudly instead of leaking cleartext.
 */
export class DatasourceAdminServicePlugin implements Plugin {
  name = 'com.objectstack.service-datasource-admin';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies: string[] = [];

  private service?: DatasourceAdminService;
  private config?: DatasourceAdminServiceConfig;
  private readonly options: DatasourceAdminServicePluginOptions;

  constructor(options: DatasourceAdminServicePluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    const logger = this.options.logger;

    // Contribute the metadata-admin "Test connection" type-level action,
    // co-located with the route handler that serves it
    // (`POST /api/v1/datasources/:name/test`, see admin-routes.ts). The
    // open-source framework deliberately ships no declarative datasource
    // action, so the button is emitted by `/api/v1/meta` only when this
    // backend plugin is installed — never advertising a route the host
    // can't serve. `${ctx.recordId}` resolves to the datasource's name.
    registerMetadataTypeActions('datasource', [
      {
        name: 'test_connection',
        label: 'Test connection',
        icon: 'plug-zap',
        type: 'api',
        target: '/api/v1/datasources/${ctx.recordId}/test',
        method: 'POST',
        variant: 'secondary',
        refreshAfter: false,
        locations: ['record_header', 'list_item'],
      },
    ] as any);

    // Resolve infra services lazily, per call — `init()` may run before the
    // `data` / `metadata` plugins have registered their services (plugin start
    // order is dependency- not registration-driven), and admin requests only
    // arrive long after the full boot completes.
    const metadataOf = (): MetadataServiceLike | undefined =>
      safeGetService<MetadataServiceLike>(ctx, 'metadata');
    const engineOf = (): DataEngineLike | undefined =>
      safeGetService<DataEngineLike>(ctx, 'data');

    const factory = (): IDatasourceDriverFactory | undefined =>
      this.options.driverFactory ?? safeGetService<IDatasourceDriverFactory>(ctx, 'datasource-driver-factory');

    const config: DatasourceAdminServiceConfig = {
      probe: (input) => this.probe(factory(), input),

      listDatasourceRecords: async () => {
        const rows = ((await metadataOf()?.list('datasource')) ?? []) as StoredDatasource[];
        // Artefact-loaded rows may omit `origin`; treat them as code-defined.
        return rows.map((r) => ({ ...r, origin: r.origin ?? 'code' }));
      },

      getDatasourceRecord: async (name) => {
        const row = (await metadataOf()?.get('datasource', name)) as StoredDatasource | undefined;
        return row ? { ...row, origin: row.origin ?? 'code' } : undefined;
      },

      putDatasourceRecord: async (record) => {
        const metadata = metadataOf();
        if (!metadata?.register) {
          throw new Error('Metadata service is unavailable; cannot persist datasource.');
        }
        // In-memory registry (immediate visibility) + durable sys_metadata row
        // (survives restart; restored on boot by restoreRuntimeDatasources).
        await metadata.register('datasource', record.name, record);
        await persistDatasourceRow(engineOf(), record);
      },

      deleteDatasourceRecord: async (name) => {
        const metadata = metadataOf();
        if (!metadata?.unregister) {
          throw new Error('Metadata service is unavailable; cannot remove datasource.');
        }
        await metadata.unregister('datasource', name);
        await deleteDatasourceRow(engineOf(), name);
      },

      writeSecret: async (input, hint) => {
        const binder = this.options.secrets;
        if (!binder?.bind) {
          throw new Error(
            'No secret store configured: refusing to persist a datasource credential in cleartext. ' +
              'Wire a SecretBinder (CryptoProvider + sys_secret) into DatasourceAdminServicePlugin.',
          );
        }
        return binder.bind(input, hint);
      },

      removeSecret: async (ref) => {
        await this.options.secrets?.unbind?.(ref);
      },

      countBoundObjects: async (datasource) => {
        const metadata = metadataOf();
        const objects = ((await metadata?.listObjects?.()) ??
          (await metadata?.list('object')) ??
          []) as Array<{ datasource?: string }>;
        return objects.filter((o) => o?.datasource === datasource).length;
      },

      registerPool: async (record) => {
        const f = factory();
        const engine = engineOf();
        if (!f || !engine?.registerDriver || !f.supports(record.driver)) return;
        // Recover the cleartext credential from `sys_secret` so the pool opens
        // with the real password. The cleartext is never persisted on the
        // record (only `credentialsRef`), so it must be dereferenced here —
        // both on create/update and on boot rehydration. Credential-less
        // drivers (sqlite/memory) simply have no ref and skip this.
        const credentialsRef = record.external?.credentialsRef;
        const secret = credentialsRef ? await this.options.secrets?.resolve?.(credentialsRef) : undefined;
        const handle = await f.create({ ...this.toSpec(record), ...(secret ? { secret } : {}) });
        if (typeof handle?.connect === 'function') await handle.connect();
        // The engine routes a datasource to a driver by `driver.name === <datasource name>`
        // (see ObjectQL engine.getDriver). Prefer the factory's underlying engine
        // driver (the `driver` escape hatch); fall back to the handle itself. Stamp
        // the name so routing resolves to this pool.
        const engineDriver = (handle.driver ?? handle) as { name?: string };
        try {
          engineDriver.name = record.name;
        } catch {
          /* frozen driver — registration may still work if name already matches */
        }
        engine.registerDriver(engineDriver);
        engine.registerDatasourceDef?.({
          name: record.name,
          schemaMode: record.schemaMode,
          external: record.external as { allowWrites?: boolean } | undefined,
        });
      },

      unregisterPool: async (name) => {
        const driver = engineOf()?.getDriverByName?.(name) as { disconnect?: () => Promise<void> } | undefined;
        if (typeof driver?.disconnect === 'function') await driver.disconnect();
      },

      logger,
    };

    this.config = config;
    this.service = new DatasourceAdminService(config);
    ctx.registerService('datasource-admin', this.service);

    // Setup-app nav (ADR-0029 D7): datasources are a *capability* this plugin
    // owns, so it contributes its own entry into the `group_integrations` slot
    // (core setup-nav must not fill capability-owned slots). datasource is a
    // metadata type, so the entry opens the generic metadata-admin engine route
    // rather than a bespoke page or an object view.
    try {
      const manifest = ctx.getService<{ register(m: any): void }>('manifest');
      if (manifest && typeof manifest.register === 'function') {
        manifest.register({
          id: 'com.objectstack.service-datasource.nav',
          namespace: 'sys',
          version: this.version,
          type: 'plugin',
          scope: 'system',
          name: 'Datasource Navigation',
          description: 'Contributes the Datasources entry to the Setup app Integrations group.',
          navigationContributions: [
            {
              app: 'setup',
              group: 'group_integrations',
              priority: 100,
              items: [
                {
                  id: 'nav_datasources',
                  type: 'url',
                  label: 'Datasources',
                  url: '/apps/setup/component/metadata/resource?type=datasource',
                  icon: 'database',
                  requiredPermissions: ['manage_platform_settings'],
                },
              ],
            },
          ],
        });
      }
    } catch (err) {
      this.options.logger?.warn?.('datasource nav contribution skipped', err);
    }
  }

  async start(ctx: PluginContext): Promise<void> {
    // Restore UI-created (runtime) datasources from the durable sys_metadata
    // store back into the in-memory registry, THEN rebuild their live pools.
    // `register()` is in-memory only in standalone serve (no writable
    // `datasource:` loader), so without this a node restart drops every
    // UI-created datasource. Code-defined datasources come from the artifact and
    // are unaffected.
    await this.restoreRuntimeDatasources(ctx);
    await this.rehydratePools();
    if (this.service) await ctx.trigger('datasource-admin:ready', this.service);
  }

  /** Reload persisted runtime datasource rows (sys_metadata) into the registry. */
  private async restoreRuntimeDatasources(ctx: PluginContext): Promise<void> {
    const engine = safeGetService<DataEngineLike>(ctx, 'data');
    const metadata = safeGetService<MetadataServiceLike>(ctx, 'metadata');
    if (!engine?.find || !metadata?.register) return;
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await loadDatasourceRows(engine);
    } catch (err) {
      this.options.logger?.warn?.('datasource restore: reading sys_metadata failed', err);
      return;
    }
    let restored = 0;
    for (const rec of rows) {
      const name = (rec as { name?: string }).name;
      if (!name) continue;
      try {
        await metadata.register('datasource', name, rec);
        restored += 1;
      } catch (err) {
        this.options.logger?.warn?.(`datasource restore: register '${name}' failed`, err);
      }
    }
    if (restored > 0) this.options.logger?.info?.(`datasource: restored ${restored} runtime record(s) from sys_metadata`);
  }

  /**
   * Boot-time rehydration: list persisted runtime datasources and re-register
   * each one's connection pool (driver build → connect → registerDriver),
   * decrypting its `sys_secret` credential on the way via the configured
   * `registerPool` (which resolves `credentialsRef`). Code-defined datasources
   * are owned by the host stack's own boot path and skipped here. Entirely
   * best-effort: a missing factory/engine, an unpersisted dev store (nothing
   * to rehydrate), or a single failing pool never blocks boot.
   */
  private async rehydratePools(): Promise<void> {
    const cfg = this.config;
    if (!cfg?.registerPool || !cfg.listDatasourceRecords) return;

    let records: StoredDatasource[];
    try {
      records = await cfg.listDatasourceRecords();
    } catch (err) {
      this.options.logger?.warn?.('datasource rehydrate: listing records failed', err);
      return;
    }

    const runtime = records.filter((r) => r.origin === 'runtime' && (r.active ?? true));
    if (runtime.length === 0) return;

    let registered = 0;
    for (const record of runtime) {
      try {
        await cfg.registerPool(record);
        registered++;
      } catch (err) {
        this.options.logger?.warn?.(`datasource rehydrate: pool '${record.name}' failed`, err);
      }
    }
    this.options.logger?.info?.(
      `Rehydrated ${registered}/${runtime.length} runtime datasource pool(s) on boot`,
    );
  }

  async destroy(): Promise<void> {
    this.service = undefined;
  }

  // --- internals -----------------------------------------------------------

  private toSpec(record: StoredDatasource): DatasourceConnectionSpec {
    return {
      name: record.name,
      driver: record.driver,
      config: record.config ?? {},
      external: record.external,
      pool: record.pool,
    };
  }

  /** Probe a connection via the driver factory: build → connect → ping → close. */
  private async probe(
    factory: IDatasourceDriverFactory | undefined,
    input: ProbeInput,
  ): Promise<TestConnectionResult> {
    if (!factory) {
      return { ok: false, error: 'No driver factory is registered to test connections.' };
    }
    if (!factory.supports(input.driver)) {
      return { ok: false, error: `No driver factory supports driver '${input.driver}'.` };
    }

    let driver: any;
    try {
      driver = await factory.create({
        driver: input.driver,
        config: input.config,
        secret: input.secret,
        external: input.external,
      });
    } catch (err) {
      return { ok: false, error: `Failed to build driver: ${errMsg(err)}` };
    }

    const startedAt = monotonicNow();
    try {
      if (typeof driver?.connect === 'function') await driver.connect();
      // Prefer a cheap ping; fall back to the engine driver's health check, then
      // a schema introspection round-trip — whichever the handle exposes.
      if (typeof driver?.ping === 'function') await driver.ping();
      else if (typeof driver?.checkHealth === 'function') await driver.checkHealth();
      else if (typeof driver?.introspectSchema === 'function') await driver.introspectSchema();
      const latencyMs = elapsedSince(startedAt);
      let serverVersion: string | undefined;
      try {
        serverVersion = typeof driver?.serverVersion === 'function' ? await driver.serverVersion() : undefined;
      } catch {
        /* version is best-effort */
      }
      return { ok: true, latencyMs, ...(serverVersion ? { serverVersion } : {}) };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    } finally {
      try {
        if (typeof driver?.disconnect === 'function') await driver.disconnect();
      } catch {
        /* best-effort teardown */
      }
    }
  }
}

function safeGetService<T>(ctx: PluginContext, name: string): T | undefined {
  try {
    return ctx.getService<T>(name);
  } catch {
    return undefined;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Monotonic clock when available (avoids wall-clock skew); falls back to 0. */
function monotonicNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : 0;
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Math.round(monotonicNow() - startedAt));
}
