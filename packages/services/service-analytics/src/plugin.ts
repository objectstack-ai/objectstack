// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IAnalyticsService } from '@objectstack/spec/contracts';
import { AnalyticsService } from './analytics-service.js';
import type { AnalyticsServiceConfig } from './analytics-service.js';
import type { DriverCapabilities } from './strategies/types.js';
import { pickDisplayField, type DimensionLabelDeps } from './dimension-labels.js';

/**
 * Minimal IDataEngine surface required for the auto-bridge.
 * ObjectQL exposes:
 *   - `aggregate(object, { where, groupBy, aggregations: [{ function, field, alias }] })`
 *   - `execute(sql, options)` for raw SQL pass-through (enables NativeSQLStrategy
 *     and lets the analytics layer emit JOINs for relation traversal).
 */
interface DataEngineLike {
  aggregate(object: string, options: {
    where?: Record<string, unknown>;
    groupBy?: string[];
    aggregations?: Array<{ function: string; field: string; alias: string }>;
    /** Reference timezone (IANA) for date bucketing — ADR-0053 Phase 2. */
    timezone?: string;
  }): Promise<unknown[]>;
  execute?(command: unknown, options?: Record<string, unknown>): Promise<unknown>;
  /** Return the registered object schema (relationship → target + display-label resolution). */
  getObject?(name: string): {
    fields?: Record<string, {
      type?: string;
      reference?: string;
      options?: Array<{ value: unknown; label?: string }>;
    }>;
  } | undefined;
}

/**
 * Configuration for AnalyticsServicePlugin.
 */
export interface AnalyticsServicePluginOptions {
  /** Pre-defined cube definitions (from manifest). */
  cubes?: Cube[];
  /**
   * Probe driver capabilities for a given cube.
   * When omitted, defaults to in-memory only.
   */
  queryCapabilities?: (cubeName: string) => DriverCapabilities;
  /**
   * Execute raw SQL on a driver. Enables NativeSQLStrategy.
   */
  executeRawSql?: (objectName: string, sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
  /**
   * Execute ObjectQL aggregate. Enables ObjectQLStrategy.
   */
  executeAggregate?: (objectName: string, options: {
    groupBy?: string[];
    aggregations?: Array<{ field: string; method: string; alias: string }>;
    filter?: Record<string, unknown>;
    /** Reference timezone (IANA) for date bucketing — ADR-0053 Phase 2. */
    timezone?: string;
  }) => Promise<Record<string, unknown>[]>;
  /**
   * ADR-0021 D-C — context-aware per-object read scope (tenant + RLS). The
   * runtime supplies this from its sharing middleware so the analytics raw-SQL
   * path cannot bypass tenant isolation. Receives the request's ExecutionContext
   * and returns the RLS `FilterCondition` for the object (what `RLSCompiler`
   * emits). When omitted, the plugin auto-bridges to a registered `'security'`
   * service exposing `getReadFilter(object, context)` if one is present.
   */
  getReadScope?: (
    objectName: string,
    context?: ExecutionContext,
  ) =>
    | FilterCondition
    | null
    | undefined
    | Promise<FilterCondition | null | undefined>;
  /**
   * ADR-0021 D-C — join allowlist per cube (the dataset's declared `include`).
   * Typically wired from the dataset registry's compiled `allowedRelationships`.
   */
  getAllowedRelationships?: (cubeName: string) => Set<string> | undefined;
  /** Enable debug logging. */
  debug?: boolean;
}

/**
 * AnalyticsServicePlugin — Kernel plugin for multi-driver analytics.
 *
 * Lifecycle:
 * 1. **init** — Creates `AnalyticsService`, registers as `'analytics'` service.
 *    If an existing analytics service is already registered (e.g. MemoryAnalyticsService
 *    from dev-plugin), it is captured as the `fallbackService`.
 * 2. **start** — Triggers `'analytics:ready'` hook so other plugins can
 *    register cubes or extend the service.
 * 3. **destroy** — Cleans up references.
 *
 * @example
 * ```ts
 * import { LiteKernel } from '@objectstack/core';
 * import { AnalyticsServicePlugin } from '@objectstack/service-analytics';
 *
 * const kernel = new LiteKernel();
 * kernel.use(new AnalyticsServicePlugin({
 *   cubes: [ordersCube],
 *   queryCapabilities: (cube) => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
 *   executeRawSql: async (obj, sql, params) => pgPool.query(sql, params).then(r => r.rows),
 * }));
 * await kernel.bootstrap();
 *
 * const analytics = kernel.getService<IAnalyticsService>('analytics');
 * const result = await analytics.query({ cube: 'orders', measures: ['orders.count'] });
 * ```
 */
export class AnalyticsServicePlugin implements Plugin {
  name = 'com.objectstack.service-analytics';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies: string[] = [];

  private service?: AnalyticsService;
  private readonly options: AnalyticsServicePluginOptions;

  constructor(options: AnalyticsServicePluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    // Check if there is an existing analytics service (e.g. from dev-plugin)
    let fallbackService: IAnalyticsService | undefined;
    try {
      const existing = ctx.getService<IAnalyticsService>('analytics');
      if (existing && typeof existing.query === 'function') {
        fallbackService = existing;
        ctx.logger.debug('[Analytics] Found existing analytics service, using as fallback');
      }
    } catch {
      // No existing service — that's fine
    }

    // Auto-bridge: when caller did not supply executeAggregate, look up the
    // kernel's IDataEngine (registered as 'data' by ObjectQLPlugin) lazily and
    // translate AnalyticsStrategy's `{method, filter}` shape into the engine's
    // `{function, where}` shape. This lets users write
    //   `new AnalyticsServicePlugin({ cubes })`
    // without re-implementing the bridge in every app.
    let executeAggregate = this.options.executeAggregate;
    let autoBridged = false;
    if (!executeAggregate) {
      const tryGetDataEngine = (): DataEngineLike | undefined => {
        try {
          const svc = ctx.getService<DataEngineLike>('data');
          return svc && typeof svc.aggregate === 'function' ? svc : undefined;
        } catch {
          return undefined;
        }
      };
      // Probe now (warn if missing) but resolve at call time so plugin order
      // does not matter as long as 'data' exists by the time a query runs.
      if (!tryGetDataEngine()) {
        ctx.logger.warn(
          '[Analytics] No "data" service registered yet at init; ' +
          'will retry per-query. Register ObjectQLPlugin or pass executeAggregate.',
        );
      }
      executeAggregate = async (objectName, { groupBy, aggregations, filter, timezone }) => {
        const engine = tryGetDataEngine();
        if (!engine) {
          throw new Error(
            '[Analytics] Cannot execute aggregate: no IDataEngine ("data") service is registered. ' +
            'Add ObjectQLPlugin to the kernel or supply AnalyticsServicePlugin({ executeAggregate }).',
          );
        }
        const rows = await engine.aggregate(objectName, {
          where: filter,
          groupBy,
          aggregations: aggregations?.map((a) => ({
            function: a.method,
            field: a.field,
            alias: a.alias,
          })),
          // ADR-0053 Phase 2: thread the reference tz so date buckets resolve on
          // that zone's calendar days (engine buckets in-memory when non-UTC).
          timezone,
        });
        return rows as Record<string, unknown>[];
      };
      autoBridged = true;
    }

    // Auto-bridge raw SQL when the data engine exposes `execute()` and the
    // caller did not supply their own `executeRawSql`. This unlocks
    // NativeSQLStrategy (priority 10) which can emit `LEFT JOIN`s for
    // dotted dimension/measure references like `account.industry`.
    let executeRawSql = this.options.executeRawSql;
    let autoBridgedRawSql = false;
    if (!executeRawSql) {
      const tryGetExecutor = (): DataEngineLike | undefined => {
        try {
          const svc = ctx.getService<DataEngineLike>('data');
          return svc && typeof svc.execute === 'function' ? svc : undefined;
        } catch {
          return undefined;
        }
      };
      // Always wire the bridge — resolution happens at call time, mirroring
      // the executeAggregate auto-bridge above. This way plugin-init order
      // does not matter as long as `data` exists by the time a query runs.
      executeRawSql = async (_objectName, sql, params) => {
        const engine = tryGetExecutor();
        if (!engine || !engine.execute) {
          throw new Error(
            '[Analytics] Cannot execute raw SQL: no IDataEngine ("data") service with execute() is registered.',
          );
        }
        // NativeSQLStrategy emits `$1, $2, …` placeholders. Knex (used by
        // driver-sql) speaks `?` placeholders, so translate.
        const knexSql = sql.replace(/\$(\d+)/g, '?');
        const result = await engine.execute(knexSql, { args: params });
        // A driver that cannot run SQL (e.g. the in-memory driver) returns
        // null from execute(). Silently mapping that to [] made EVERY dataset
        // query on such environments report "No rows" while looking healthy
        // (HTTP 200, compiled SQL attached). Throw a TYPED error instead so
        // the orchestrator can fall back to an aggregate-based strategy —
        // never fabricate an empty result.
        if (result === null || result === undefined) {
          const err = new Error(
            '[Analytics] The "data" engine\'s driver returned null for raw SQL — ' +
            'this driver does not support SQL execution. The query will fall back ' +
            'to an aggregate-based strategy when one is available.',
          ) as Error & { code: string };
          err.code = 'RAW_SQL_UNSUPPORTED';
          throw err;
        }
        if (Array.isArray(result)) return result as Record<string, unknown>[];
        if (typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
          return (result as { rows: Record<string, unknown>[] }).rows;
        }
        return [];
      };
      autoBridgedRawSql = true;
    }

    // Default capabilities: when we have an aggregate bridge, advertise
    // ObjectQL support so ObjectQLStrategy is selected. Callers can still
    // override via options.queryCapabilities.
    const queryCapabilities = this.options.queryCapabilities
      ?? (() => ({
        nativeSql: !!executeRawSql,
        objectqlAggregate: !!executeAggregate,
        inMemory: false,
      }));

    // ADR-0021 D-C — wire the read-scope provider. Prefer an explicit option;
    // otherwise auto-bridge to a registered `'security'` service that exposes
    // `getReadFilter(object, context)` (resolved at call time so plugin-init
    // order does not matter). This keeps analytics decoupled from security.
    interface SecurityReadFilter {
      getReadFilter(
        object: string,
        context?: ExecutionContext,
      ):
        | FilterCondition
        | null
        | undefined
        | Promise<FilterCondition | null | undefined>;
    }
    let getReadScope = this.options.getReadScope;
    let autoBridgedReadScope = false;
    if (!getReadScope) {
      const trySecurity = (): SecurityReadFilter | undefined => {
        try {
          const svc = ctx.getService<SecurityReadFilter>('security');
          return svc && typeof svc.getReadFilter === 'function' ? svc : undefined;
        } catch {
          return undefined;
        }
      };
      if (trySecurity()) {
        getReadScope = (object, context) => trySecurity()?.getReadFilter(object, context);
        autoBridgedReadScope = true;
      }
    }

    // ADR-0021 — relationship → target-object resolver. A dataset's `include`
    // names lookup/master_detail FIELDS on the base object; the joined TABLE is
    // each field's `reference` target (which can differ from the field name,
    // e.g. lookup `account` → object `crm_account`). Resolve from the 'data'
    // engine's object schema at compile time so cross-object joins target the
    // right table. Resolved lazily so plugin-init order doesn't matter.
    const relationshipResolver = (baseObject: string, relationshipName: string): string | undefined => {
      const engine = (() => {
        try {
          const svc = ctx.getService<DataEngineLike>('data');
          return svc && typeof svc.getObject === 'function' ? svc : undefined;
        } catch { return undefined; }
      })();
      const obj = engine?.getObject?.(baseObject);
      const field = obj?.fields?.[relationshipName];
      if (field && (field.type === 'lookup' || field.type === 'master_detail') && field.reference) {
        return field.reference;
      }
      // Unknown to the schema — fall back to the relationship name as the table
      // (legacy same-name convention). Returning undefined would make the
      // compiler reject the dataset; the name-as-table fallback is safer for
      // engines that don't expose getObject.
      return engine ? undefined : relationshipName;
    };

    // ADR-0021 — dimension display-label resolution. `queryDataset` groups by a
    // dimension's raw stored value; for `select` fields the user-facing text is
    // the option label, and for `lookup`/`master_detail` fields it's the related
    // record's display name. Wire the two low-level capabilities the resolver
    // needs from the 'data' engine (resolved lazily so plugin-init order is free):
    //   - field metadata (select options + lookup target), via getObject
    //   - id→name pairs, via the executeAggregate bridge (group by id + name)
    const dataEngine = (): DataEngineLike | undefined => {
      try {
        const svc = ctx.getService<DataEngineLike>('data');
        return svc && typeof svc.getObject === 'function' ? svc : undefined;
      } catch { return undefined; }
    };
    const labelResolver: DimensionLabelDeps = {
      getObjectFields: (objectName) => dataEngine()?.getObject?.(objectName)?.fields,
      fetchRecordLabels: async (targetObject, ids) => {
        const map = new Map<unknown, string>();
        const displayField = pickDisplayField(dataEngine()?.getObject?.(targetObject)?.fields);
        if (!displayField || !executeAggregate || ids.length === 0) return map;
        // Group by (id, displayField) — one row per record — reusing the aggregate
        // bridge rather than adding a record-fetch capability. A count keeps engines
        // that require ≥1 aggregation happy; the count itself is unused.
        const rows = await executeAggregate(targetObject, {
          groupBy: ['id', displayField],
          aggregations: [{ field: 'id', method: 'count', alias: '_c' }],
          filter: { id: { $in: ids } },
        });
        for (const r of rows) {
          if (r.id != null && r[displayField] != null) map.set(r.id, String(r[displayField]));
        }
        return map;
      },
    };

    // ADR-0037 P3 — draft data preview: resolve the PENDING seed draft's rows
    // for an object via the kernel protocol (state:'draft' read — a published
    // seed's rows are already in the real table and must NOT overlay). Lazy
    // service lookup so plugin order doesn't matter; null ⇒ no pending seed ⇒
    // queryDataset falls through to live data.
    const draftRowsResolver = async (objectName: string): Promise<Record<string, unknown>[] | null> => {
      type ProtocolLike = {
        getMetaItems?(req: { type: string; previewDrafts?: boolean }): Promise<unknown>;
        getMetaItem?(req: { type: string; name: string; state?: string }): Promise<unknown>;
      };
      let protocol: ProtocolLike | undefined;
      try {
        protocol = ctx.getService<ProtocolLike>('protocol');
      } catch { return null; }
      if (!protocol?.getMetaItems || !protocol.getMetaItem) return null;
      const res = await protocol.getMetaItems({ type: 'seed', previewDrafts: true }).catch(() => null);
      const list = Array.isArray(res)
        ? res
        : (res && typeof res === 'object' && Array.isArray((res as { items?: unknown[] }).items)
          ? (res as { items: unknown[] }).items
          : []);
      const rows: Record<string, unknown>[] = [];
      let pending = false;
      for (const entry of list) {
        const body = ((entry as { item?: unknown })?.item ?? entry) as { name?: string; object?: string } | null;
        if (!body?.name || body.object !== objectName) continue;
        // Only a PENDING draft row qualifies; getMetaItem({state:'draft'})
        // throws no_draft when the seed is already published.
        const draft = await protocol.getMetaItem({ type: 'seed', name: body.name, state: 'draft' }).catch(() => null);
        const draftBody = (draft as { item?: { records?: unknown[] } } | null)?.item;
        if (!draftBody) continue;
        pending = true;
        for (const r of Array.isArray(draftBody.records) ? draftBody.records : []) {
          if (r && typeof r === 'object') rows.push(r as Record<string, unknown>);
        }
      }
      return pending ? rows : null;
    };

    const config: AnalyticsServiceConfig = {
      cubes: this.options.cubes,
      logger: ctx.logger,
      queryCapabilities,
      executeRawSql,
      executeAggregate,
      fallbackService,
      getReadScope,
      getAllowedRelationships: this.options.getAllowedRelationships,
      relationshipResolver,
      labelResolver,
      draftRowsResolver,
    };

    if (autoBridgedReadScope) {
      ctx.logger.info('[Analytics] Auto-bridged getReadScope → "security" service (getReadFilter)');
    } else if (!getReadScope) {
      ctx.logger.warn(
        '[Analytics] No getReadScope configured and no "security" service with getReadFilter found — ' +
        'the raw-SQL analytics path will NOT enforce tenant/RLS scoping on joined objects (ADR-0021 D-C). ' +
        'Supply getReadScope or register a security service in multi-tenant deployments.',
      );
    }

    if (autoBridged) {
      ctx.logger.info('[Analytics] Auto-bridged executeAggregate → "data" service (IDataEngine)');
    }
    if (autoBridgedRawSql) {
      ctx.logger.info('[Analytics] Auto-bridged executeRawSql → "data" service (IDataEngine.execute)');
    }

    this.service = new AnalyticsService(config);

    // Register or replace the analytics service
    if (fallbackService) {
      ctx.replaceService('analytics', this.service);
    } else {
      ctx.registerService('analytics', this.service);
    }

    if (this.options.debug) {
      ctx.hook('analytics:beforeQuery', async (query: unknown) => {
        ctx.logger.debug('[Analytics] Before query', { query });
      });
    }

    ctx.logger.info('[Analytics] Service initialized');
  }

  async start(ctx: PluginContext): Promise<void> {
    if (!this.service) return;

    // Notify other plugins that analytics is ready
    await ctx.trigger('analytics:ready', this.service);

    ctx.logger.info(
      `[Analytics] Service started with ${this.service.cubeRegistry.size} cubes: ` +
      `${this.service.cubeRegistry.names().join(', ') || '(none)'}`,
    );
  }

  async destroy(): Promise<void> {
    this.service = undefined;
  }
}
