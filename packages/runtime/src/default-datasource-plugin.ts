// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import {
  DatasourceConnectionService,
  createDefaultDatasourceDriverFactory,
  type ConnectableDatasource,
  type IDatasourceDriverFactory,
} from '@objectstack/service-datasource';
import type { SqliteAbsentFileMode } from '@objectstack/driver-sql';

/**
 * DefaultDatasourcePlugin — the `default` datasource as a DECLARATION
 * (ADR-0062 D1, #3826).
 *
 * Before this plugin, the standalone stack pre-built the default driver and
 * smuggled it into the engine as a `driver.*` kernel service (`DriverPlugin`),
 * so its connect — and the "what if it cannot connect" decision — lived in
 * `ObjectQLEngine.init()`, a second implementation of the policy
 * `DatasourceConnectionService` already owns for every declared datasource.
 * #3741 → #3758 showed what two copies of that decision cost: a fix to one
 * missed the other for three months.
 *
 * Now the host hands this plugin a datasource *definition* (URL→config
 * translation and `mkdir` stay host concerns in `standalone-stack`), and the
 * plugin connects it through the SAME `DatasourceConnectionService` code path
 * as declared/runtime datasources: same driver factory, same failure verdict
 * (fail-fast — the definition is `bootCritical`; `OS_ALLOW_DRIVER_CONNECT_FAILURE`
 * to degrade), same retained state.
 *
 * **Ordering — phase, not list position.** The kernel resolves BOTH init and
 * start order from the plugin dependency graph, so registration order proves
 * nothing (a serve boot hoists `ObjectQLPlugin` ahead of anything a service
 * plugin depends on — exactly how the first cut of this plugin ended up
 * starting after boot schema-sync and shipping a server with no tables). The
 * connect therefore happens in **`init()`** — Phase 1 completes before ANY
 * `start()` runs, so the driver exists before `ObjectQLPlugin.start()`'s
 * `ql.init()` + schema sync in every topology — and this plugin declares a
 * hard dependency on ObjectQL so ITS `init()` (which registers the `'data'`
 * engine) runs first. `ObjectQLEngine.init()` then re-connects the already-
 * connected driver: every open-core driver's `connect()` is idempotent, and
 * the re-connect is exactly the boot verification #3741 wants kept.
 *
 * The connect itself always uses a locally-instantiated
 * `DatasourceConnectionService` (the shared `'datasource-connection'` service
 * is registered by the datasource-admin plugin's init, whose order relative to
 * this one is undetermined). `start()` then replays the registration through
 * the SHARED service when present — the `asDefault` idempotency guard turns it
 * into `already-registered` — so the `default` verdict lands in the retained
 * state the admin list reads and Setup → Datasources shows the primary DB's
 * real status (#3827).
 *
 * `DriverPlugin` remains the escape hatch for tests and pre-built/proxy
 * drivers — it is no longer how the standalone default boots.
 */
export interface DefaultDatasourceDefinition {
  /** Driver id the (injected or shared) factory can build (`sqlite`, `sqlite-wasm`, `postgres`, `mongodb`, `memory`). */
  driver: string;
  config?: Record<string, unknown>;
  label?: string;
}

export interface DefaultDatasourcePluginOptions {
  /** Arms the shared factory's dev sqlite step-down (#2229) + loosen-only self-heal passthroughs. */
  dev?: boolean;
  /**
   * Forwarded to the shared factory: what a `sqlite` default does when its
   * file does not exist (#6743). `'empty-in-memory'` is for read-only boots
   * (`os migrate plan`); the default `'create'` is every other boot.
   *
   * Ignored when {@link factory} is injected — a host that brings its own
   * factory owns its own open semantics.
   */
  sqliteAbsentFile?: SqliteAbsentFileMode;
  /**
   * Host-injected driver factory. Defaults to the shared open-core factory
   * (`createDefaultDatasourceDriverFactory`). The seam exists for hosts whose
   * `default` needs a driver the open-core factory cannot build — the cloud
   * distribution's `turso`, or an already-pooled instance adopted via
   * `createPrebuiltDriverFactory` — WITHOUT forking the connect + failure
   * -verdict orchestration this plugin owns (the #3741 → #3758 drift). The
   * factory only changes what `create()` returns; the policy-free init
   * connect, `bootCritical` verdict, escape hatch, and start() replay are
   * identical either way.
   *
   * Note the start() replay goes through the SHARED `'datasource-connection'`
   * service, whose factory is the host's admin-plugin one — after a NORMAL
   * boot that replay resolves `already-registered` before any factory is
   * consulted, but a degraded boot's real retry (init failed under
   * `OS_ALLOW_DRIVER_CONNECT_FAILURE`) retries with the shared factory. A
   * host injecting a factory for a kind the shared one cannot build should
   * expect that retry to report `skipped-unsupported` rather than reattempt.
   */
  factory?: IDatasourceDriverFactory;
}

export class DefaultDatasourcePlugin implements Plugin {
  name = 'com.objectstack.runtime.default-datasource';
  version = '1.0.0';
  /**
   * Hard dependency: ObjectQL's init() must register the `'data'` engine
   * before this plugin's init() connects the default driver into it. Any boot
   * composing this plugin composes ObjectQL (the standalone stack always
   * does); the kernel fails loudly on a genuinely missing dependency.
   */
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly def: DefaultDatasourceDefinition;
  private readonly dev?: boolean;
  private readonly sqliteAbsentFile?: SqliteAbsentFileMode;
  private readonly factory?: IDatasourceDriverFactory;
  /** The init()-time local connection service — held for destroy()'s teardown. */
  private connection?: DatasourceConnectionService;

  constructor(def: DefaultDatasourceDefinition, opts: DefaultDatasourcePluginOptions = {}) {
    this.def = def;
    this.dev = opts.dev;
    this.sqliteAbsentFile = opts.sqliteAbsentFile;
    this.factory = opts.factory;
  }

  private record(): ConnectableDatasource {
    return {
      name: 'default',
      label: this.def.label ?? 'Default',
      driver: this.def.driver,
      config: this.def.config ?? {},
      origin: 'code',
      bootCritical: true,
    };
  }

  init = async (ctx: PluginContext) => {
    const connection = new DatasourceConnectionService({
      factory: () => this.factory ?? createDefaultDatasourceDriverFactory({
        dev: this.dev,
        ...(this.sqliteAbsentFile ? { sqliteAbsentFile: this.sqliteAbsentFile } : {}),
      }),
      engine: () => {
        try {
          return ctx.getService('data');
        } catch {
          return undefined;
        }
      },
      // Structural cast: the kernel logger's `warn(msg, meta?)` satisfies the
      // service's minimal Logger shape; the nominal types come from different
      // packages.
      logger: ctx.logger as unknown as ConstructorParameters<typeof DatasourceConnectionService>[0]['logger'],
    });
    this.connection = connection;

    // Throws on failure (bootCritical ⇒ fail-fast per ADR-0062 D5), aborting
    // bootstrap exactly like the engine-level guard did — same escape hatch,
    // same DEGRADED BOOT banner when the operator overrides.
    const result = await connection.connect(this.record(), {
      asDefault: true,
      context: { origin: 'code', trigger: 'declared-auto' },
    });
    if (result.status === 'skipped-no-infra') {
      // A kernel with no data engine has nothing to connect a driver INTO —
      // not an error (metadata-only hosts exist), but worth a trace.
      ctx.logger.debug('[DefaultDatasourcePlugin] no engine — default datasource left unconnected');
      return;
    }
    ctx.logger.info('[DefaultDatasourcePlugin] default datasource ready', {
      driver: this.def.driver,
      status: result.status,
    });

    // Keep the `driver.<name>` kernel-service surface DriverPlugin used to
    // provide: `os migrate` locates the SQL driver through it
    // (`schema-migrate.ts` SQL_DRIVER_SERVICES), and serve's storage detection
    // reads it too. ObjectQLPlugin's discovery loop will see this service and
    // call registerDriver again — the engine's skip-if-present guard makes
    // that a no-op for the same driver name.
    try {
      const engine = ctx.getService<IDataEngine>('data');
      const driverName = engine?.getDefaultDriverName?.();
      const driver = driverName ? engine?.getDriverByName?.(driverName) : undefined;
      if (driver) {
        ctx.registerService(`driver.${driverName}`, driver);
      }
    } catch (e) {
      ctx.logger.debug('[DefaultDatasourcePlugin] driver.* service registration skipped', { error: e });
    }
  };

  start = async (ctx: PluginContext) => {
    // Replay through the SHARED connection service (registered by the
    // datasource-admin plugin's init — present by Phase 2 when that plugin is
    // in the stack). The asDefault guard makes this `already-registered` when
    // init() connected, and a REAL retry when the operator booted degraded via
    // OS_ALLOW_DRIVER_CONNECT_FAILURE — either way the verdict lands in the
    // retained state the admin list reads (#3827).
    // Note the default deliberately does NOT go through the host's
    // `DatasourceConnectPolicy`: the init()-time connect uses a policy-free
    // local instance (byte-for-byte with the pre-#3826 boot, where the default
    // never consulted a policy — that gate exists for OPTIONAL, typically
    // external, datasources), and on the replay below the `asDefault`
    // idempotency guard resolves before the policy gate. Only a degraded boot
    // (init failed under OS_ALLOW_DRIVER_CONNECT_FAILURE) reaches the shared
    // policy here — a denial then is worth a loud warning, not a brick: the
    // operator already chose to boot without the primary DB.
    try {
      const shared = ctx.getService<DatasourceConnectionService>('datasource-connection');
      if (typeof shared?.connect === 'function') {
        const result = await shared.connect(this.record(), {
          asDefault: true,
          context: { origin: 'code', trigger: 'declared-auto' },
        });
        if (result.status === 'skipped-policy') {
          ctx.logger.warn(
            `[DefaultDatasourcePlugin] the datasource connect policy denied the degraded-boot retry of the ` +
            `boot-critical 'default' datasource${result.reason ? ` (${result.reason})` : ''} — fix the host's ` +
            `DatasourceConnectPolicy; it should never gate the primary datasource.`,
          );
        }
      }
    } catch {
      // No shared service (lite kernel) — the init()-time connect stands alone.
    }

    // Metadata visibility — now, and AGAIN on `kernel:ready` because the
    // MetadataPlugin's artifact load rebuilds the registry and drops rows
    // registered before it. Idempotent: registerInMemory is last-write-wins.
    await this.registerVisibility(ctx);
    ctx.hook('kernel:ready', async () => {
      await this.registerVisibility(ctx);
    });
  };

  /**
   * `registerInMemory('datasource', …)` feeds the datasource-admin list
   * (`metadata.list('datasource')`), so Setup → Datasources shows the
   * primary DB — and, via the retained connect verdict, its REAL status
   * (#3827). Stamped `origin:'code'` → read-only in the admin UI.
   *
   * A second branch used to probe `metadata.addDatasource(…)` "for legacy
   * `getDatasources()` consumers" — typing this lookup (#4251) showed no
   * metadata service implements either method, in this repo or its history's
   * reach, so the probe never fired and the branch advertised parity it never
   * delivered. registerInMemory IS the datasource-visibility path.
   *
   * [#7561] `config` is stamped EMPTY, and deliberately so. `DatasourceSchema`
   * requires it (`config: z.record(…)`, not optional), and omitting it made
   * `/meta` re-parse this row into `_diagnostics: { valid: false, errors:
   * [{ path: 'config', code: 'invalid_type' }] }` — the second of the two error
   * shapes behind the 94/94-INVALID diagnostics baseline, alongside the
   * `fields.__search` stamp. The fix belongs at this producer, not in the
   * schema: a real datasource document genuinely needs its connection config,
   * so widening the spec would trade one honest verdict for a permanently
   * weaker one.
   *
   * Empty rather than `this.def.config` because this registration is a
   * deliberately NON-SECRET projection. The host's real config carries
   * connection credentials (`user` / `password` for postgres/mongo), and
   * `DatasourceSchema` itself refuses an inlined `password` — publishing it
   * here would put those credentials on `GET /api/v1/meta/datasources` for
   * every metadata reader. `{}` states exactly what this row has always
   * carried: the datasource EXISTS with this driver and label, and its
   * connection details are not surfaced through metadata. No information is
   * lost versus the omitted key — only the spelling changes, to the one the
   * contract accepts.
   */
  private async registerVisibility(ctx: PluginContext): Promise<void> {
    try {
      const metadata = ctx.getService<IMetadataService>('metadata');
      if (typeof metadata?.registerInMemory === 'function') {
        metadata.registerInMemory('datasource', 'default', {
          name: 'default',
          label: this.def.label ?? 'Default',
          driver: this.def.driver,
          config: {},
          origin: 'code',
        });
      }
    } catch (e) {
      ctx.logger.debug('[DefaultDatasourcePlugin] metadata service unavailable — default not listed', { error: e });
    }
  }

  /**
   * Kernel teardown (ADR-0062 D5, #3993): the default disconnects through the
   * SAME service that connected it — one teardown implementation, mirroring
   * the one connect implementation. The service resolves the driver the way
   * the default was registered (natural name via `asDefault`) and honours
   * ownership: a host-owned ADOPTED instance (`createPrebuiltDriverFactory`,
   * the cloud compositions — pools shared beyond this kernel) is never
   * closed here; only the retained verdict is cleared. Note the kernel's
   * teardown phase is `destroy()` — `stop()` exists nowhere in the Plugin
   * contract and is never called.
   */
  destroy = async () => {
    try {
      await this.connection?.disconnect('default', { asDefault: true });
    } catch {
      // Teardown is best-effort — the kernel is going away either way, and a
      // failed disconnect must not mask the real shutdown path.
    }
  };
}
