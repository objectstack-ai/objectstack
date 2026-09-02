// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import { AggregationFunction } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IAnalyticsService, IDataDriver, IDataEngine, IObjectQLEngine } from '@objectstack/spec/contracts';
import { AnalyticsService } from './analytics-service.js';
import type { AnalyticsServiceConfig } from './analytics-service.js';
import type { AnalyticsDriverCapabilities } from './strategies/types.js';
import { pickDisplayField, type DimensionLabelDeps } from './dimension-labels.js';
import { assertReadScopeCannotVacate } from './read-scope-sql.js';

/**
 * The slice of the DECLARED engine contracts this plugin's auto-bridges
 * consume, derived from `IDataEngine` / `IObjectQLEngine` instead of being
 * re-declared structurally (#4251 B3, extending #11493's ruling and the
 * datasource half of #11833 that landed as PR #12011).
 *
 * A consumer-local structural re-declaration meets no compiler on the PRODUCER
 * side, so engine-surface drift lands here silently. This seam carried exactly
 * that: the hand-written `aggregate` declared `aggregations[].function` as
 * `string` where the contract declares a six-value enum, and nothing compiled
 * the two against each other.
 *
 * Three of these members could not be named from a contract until #12248
 * landed the #11833 ruling: `resolveEffectiveDatasource` and
 * `getDriverForObject` (fork 1, declared OPTIONAL exactly so seams like this
 * one keep degrading), and `getObject`'s structured `ServiceObject` return
 * (fork 3, which used to be `unknown`). Before those, the structural type was
 * the only way to name them at all.
 *
 * ## Optionality is load-bearing, and this preserves the profile exactly
 *
 * `aggregate` stays REQUIRED, as the hand-written type had it: it is the
 * member a `'data'` service must expose for this bridge to exist, and the
 * runtime `typeof svc.aggregate === 'function'` probe below is what decides
 * whether a registered service qualifies.
 *
 * Everything else stays OPTIONAL. A lightweight kernel can register a `'data'`
 * service with no raw-SQL escape hatch, no datasource registry and no schema
 * registry; the `engine?.x` / `typeof … === 'function'` probes below are the
 * other half of that graceful-degradation contract. `getObject` is REQUIRED on
 * `IObjectQLEngine`, so the `Partial<>` around it is not decoration — it is
 * what keeps this seam usable against an engine that is not ObjectQL.
 */
type DataEngineLike =
  Pick<IDataEngine, 'aggregate'>
  & Partial<Pick<IDataEngine, 'execute' | 'resolveEffectiveDatasource' | 'getDriverForObject'>>
  & Partial<Pick<IObjectQLEngine, 'getObject'>>;

/**
 * The slice of the `IDataDriver` CONTRACT the analytics layer consumes —
 * `temporalFilterValue` / `temporalFilterColumnSql` are first-class contract
 * members since ADR-0053 D-A2, no longer a duck-typed local invention.
 *
 * Since #12248 declared `IDataEngine.getDriverForObject?`, this is the
 * RETURN-side narrowing that member's own docblock prescribes, applied at the
 * two call sites below — not a re-declaration of the member. `Pick<IDataDriver,
 * …>` admits the full contract value, so the engine keeps handing back whatever
 * driver it registered while this seam states the only two members it reads.
 * The runtime `typeof` guards below remain the correct way to consume an
 * optional contract member.
 */
type TemporalDriverSurface = Pick<
  IDataDriver,
  'temporalFilterValue' | 'temporalFilterColumnSql'
>;

/**
 * Re-parse a bridge-supplied aggregation `method` as the engine contract's
 * `AggregationFunction` before it is forwarded as `function`, refusing
 * anything else.
 *
 * Both sides now declare the same six-value enum: `IDataEngine.aggregate`'s
 * `aggregations[].function`, and — since #12776 — the analytics strategy
 * contract (`StrategyContext.executeAggregate`) plus the two consumer-local
 * config mirrors this package keeps in lockstep with it (#12940). So this
 * parse is DEFENCE IN DEPTH behind a compile-time check, not the only check
 * (#11833).
 *
 * That is a reason to keep it, not to delete it. Types are erased: a
 * JavaScript app supplying its own `executeAggregate`, or host drift arriving
 * through a cube object that never met `CubeSchema`'s parse (the path
 * `aggregate-bridge-function-vocabulary.test.ts` drives end to end), still
 * reaches this seam carrying a method the engine does not declare. What the
 * refusal buys is in `plugin.ts`'s forward below and in #12209: the engine is
 * never handed a `function` no driver declares.
 *
 * Parsing with the spec's OWN enum keeps a single vocabulary — no local
 * literal list to drift, and `AggregationFunction`'s error map already knows
 * the retired `array_agg` / `string_agg` spellings.
 */
function parseEngineAggregateFunction(
  method: AggregationFunction,
  alias: string,
): NonNullable<Parameters<IDataEngine['aggregate']>[1]['aggregations']>[number]['function'] {
  const parsed = AggregationFunction.safeParse(method);
  if (!parsed.success) {
    throw new Error(
      `[Analytics] The aggregate bridge cannot forward the aggregation ` +
      `"${alias}": "${method}" is not one of the engine's aggregate functions ` +
      `(${AggregationFunction.options.join(', ')}). A custom-SQL measure is ` +
      `refused earlier, with a caller-facing diagnostic, by ObjectQLStrategy; ` +
      `reaching this point means the analytics layer produced a method the ` +
      `engine contract does not declare.`,
    );
  }
  return parsed.data;
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
  queryCapabilities?: (cubeName: string) => AnalyticsDriverCapabilities;
  /**
   * Execute raw SQL on a driver. Enables NativeSQLStrategy.
   */
  executeRawSql?: (objectName: string, sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
  /**
   * Execute ObjectQL aggregate. Enables ObjectQLStrategy.
   */
  executeAggregate?: (objectName: string, options: {
    groupBy?: string[];
    /**
     * The CUSTOM bridge's view of the aggregation entries — an app author's
     * own `executeAggregate`, as opposed to the auto-bridge below. Mirrors
     * `StrategyContext.executeAggregate`
     * (`packages/spec/src/contracts/analytics-service.ts`) and must stay in
     * lockstep with it; the two members that lockstep is load-bearing for:
     *
     * - `filter` (#10576, the #10413 contract field) — a custom bridge MUST
     *   forward it to the real engine the same way the auto-bridge does, or a
     *   measure-scoped filter this plugin lowers onto the aggregation
     *   silently never reaches storage.
     * - `method` is the spec's OWN six-value `AggregationFunction`, not
     *   `string`: #12776 narrowed the contract, #12940 brought this mirror
     *   back into line. This is the declaration a custom-bridge author types
     *   their handler against, so it is where the compile-time vocabulary
     *   #12776 bought for strategy authors reaches them too.
     */
    aggregations?: Array<{ field: string; method: AggregationFunction; alias: string; filter?: Record<string, unknown> }>;
    filter?: Record<string, unknown>;
    /** Reference timezone (IANA) for date bucketing — ADR-0053 Phase 2. */
    timezone?: string;
    /**
     * ADR-0021 D-C (#3602) — the request's ExecutionContext. A custom bridge
     * MUST forward it to its engine so engine-side RLS applies; dropping it is
     * what made the built-in bridge fall open in #3597.
     */
    context?: ExecutionContext;
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
  /**
   * [#8286] Echo the executed statement back to CALLERS in
   * `AnalyticsResult.sql` (`/api/v1/analytics/query`).
   *
   * Distinct from {@link AnalyticsServicePluginOptions.debug} above, which is
   * server-side log verbosity only: raising log level must never widen what
   * travels to a tenant. Default and rationale live with the service config —
   * see `AnalyticsServiceConfig.debugSql`. Undefined here means "no host
   * choice", which the service resolves to development-only.
   */
  debugSql?: boolean;
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
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['analytics'];
  version = '1.0.0';
  type = 'standard' as const;
  dependencies: string[] = [];
  /**
   * init() probes the `data` engine ObjectQLPlugin provides for the
   * auto-bridge — order-if-present so the probe verdict is deterministic
   * (ADR-0116, #4471). Soft, not hard: without an engine the plugin
   * degrades on purpose (per-query lazy resolution / explicit
   * `executeAggregate`).
   */
  optionalDependencies: string[] = ['com.objectstack.engine.objectql'];

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
      executeAggregate = async (objectName, { groupBy, aggregations, filter, timezone, context }) => {
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
          // [#10413 phase 2 / #10576] `a.filter` is the per-aggregation
          // predicate `ObjectQLStrategy` lowers a measure's own scoped
          // `filter` into. This map already renames `method` → `function`
          // for the engine's own vocabulary; dropping `filter` here — as this
          // bridge did before this line existed — would have made the
          // strategy's lowering a NO-OP on every real deployment that boots
          // through this auto-bridge (the default path: `new
          // AnalyticsServicePlugin({ cubes })` with no custom
          // `executeAggregate`), passing every unit test that stubs
          // `executeAggregate` directly while silently dropping the filter in
          // production — the exact declared-≠-enforced shape Prime Directive
          // #10 calls out. Omitted (not `filter: undefined`) when the
          // aggregation carries none, matching the engine's own
          // vacuous-filter convention.
          aggregations: aggregations?.map((a) => ({
            // [#11833] `function` is the engine contract's SIX-value
            // `AggregationFunction`. This bridge's own input declared
            // `method: string` when that history was written
            // (`StrategyContext.executeAggregate`, spec
            // `contracts/analytics-service.ts`), so the two ends of this
            // rename spoke different vocabularies: narrowing the engine side
            // to the contract turned the forward into a compile error — the
            // correct signal, and the one the deleted structural type hid by
            // declaring `function: string` on both sides.
            //
            // Since #12776 (contract) and #12940 (this plugin's own config
            // mirror above), BOTH ends declare the enum, so the rename is
            // enum-to-enum and the parse below is defence in depth behind a
            // compile-time check rather than the only check — see
            // `parseEngineAggregateFunction` for why erased types still leave
            // it load-bearing.
            //
            // It was closed by PARSING with the spec enum itself rather than
            // by widening back to `string` (what hid it) or casting past it
            // (which keeps the hole and adds a lie). `AggregationFunction` is
            // the same schema `AggregationNodeSchema.function` is built from,
            // so there is one vocabulary, and its own error map already
            // carries the `array_agg`/`string_agg` retirement prescriptions.
            //
            // TIERING, deliberately: the reachable producer of a non-aggregate
            // method — a custom-SQL measure (`AggregationMetricType`
            // `number`/`string`/`boolean`) — is already refused upstream with a
            // caller-blaming 400 by `ObjectQLStrategy.resolveMeasureAggregation`
            // (#12209). Anything still arriving here is host drift, which that
            // refusal's docblock assigns to the undeclared-500 tier — so this
            // throws rather than re-blaming the caller, and it answers loudly
            // instead of letting the engine answer `null` per bucket under the
            // author's own measure name (the #4157 class).
            function: parseEngineAggregateFunction(a.method, a.alias),
            field: a.field,
            alias: a.alias,
            ...(a.filter ? { filter: a.filter } : {}),
          })),
          // ADR-0053 Phase 2: thread the reference tz so date buckets resolve on
          // that zone's calendar days (engine buckets in-memory when non-UTC).
          timezone,
          // ADR-0021 D-C (#3602): thread the caller's identity so the engine's
          // middleware chain scopes the read itself. `BaseEngineOptions.context`
          // is `.optional()`, so nothing ever forced this bridge to pass it —
          // and it did not, which is how an authenticated aggregate reached the
          // engine with no principal and plugin-security fell open (#3597).
          context,
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
      executeRawSql = async (objectName, sql, params) => {
        const engine = tryGetExecutor();
        if (!engine || !engine.execute) {
          throw new Error(
            '[Analytics] Cannot execute raw SQL: no IDataEngine ("data") service with execute() is registered.',
          );
        }
        // NativeSQLStrategy emits `$1, $2, …` placeholders. Knex (used by
        // driver-sql) speaks `?` placeholders, so translate.
        const knexSql = sql.replace(/\$(\d+)/g, '?');
        // #5033 — `object` is ObjectQL's FIRST driver-selection key. This bridge
        // received the object name and dropped it, so every dataset raw-SQL read
        // fell through to the DEFAULT driver while the object-routed path
        // (`executeAggregate` → `engine.aggregate(objectName, …)`, right above)
        // resolved the object's own datasource. The two dataset execution paths
        // must give ONE answer to "which datasource is this object in": an
        // object routed elsewhere (ADR-0057 §3.6 telemetry split, an explicit
        // `object.datasource`, a `datasourceMapping` rule) read `no such table`
        // on the default DB and degraded to a confident `0` over live rows.
        const result = await engine.execute(knexSql, { args: params, object: objectName });
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
    let securityPresentAtInit = false;
    if (!getReadScope) {
      const trySecurity = (): SecurityReadFilter | undefined => {
        try {
          const svc = ctx.getService<SecurityReadFilter>('security');
          return svc && typeof svc.getReadFilter === 'function' ? svc : undefined;
        } catch {
          return undefined;
        }
      };
      // ALWAYS wire the bridge — resolution happens at call time, mirroring the
      // executeAggregate / executeRawSql auto-bridges above. Gating the
      // ASSIGNMENT on an init-time probe (as this did) made analytics RLS
      // silently plugin-ORDER-DEPENDENT: a kernel that registers this plugin
      // before the security plugin got NO read-scope provider at all, so every
      // strategy ran unscoped and only a WARN marked it. The repo's own
      // `bootStack` harness registers in exactly that order, which is why no
      // dogfood test could ever observe analytics RLS.
      securityPresentAtInit = !!trySecurity();
      getReadScope = (object, context) => trySecurity()?.getReadFilter(object, context);
      autoBridgedReadScope = true;
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
      fetchRecordLabels: async (targetObject, ids, scope, context) => {
        const map = new Map<unknown, string>();
        const displayField = pickDisplayField(dataEngine()?.getObject?.(targetObject)?.fields);
        if (!displayField || !executeAggregate || ids.length === 0) return map;
        // [#14329] The FOURTH read-scope door, and the same guard the other
        // three answer with. #13640 guarded the ObjectQL engine merge and
        // #13926 the echo merge and `NativeSQLStrategy.applyReadScope`; this
        // hook is a fourth consumer of the same `readScopeProvider` output
        // that meets NEITHER `compileScopedFilterToSql` nor the guard — the
        // `$and` below hands the scope straight to `executeAggregate`, so a
        // vacating spelling (`$not` over `$in: []` and its measured siblings,
        // reachable from any out-of-repo `getReadScope` producer the
        // `StrategyContext` spec contract admits) used to let this per-record
        // read run effectively unscoped for the ids in hand — leaking exactly
        // the display names the referenced object's RLS exists to hide.
        //
        // Placement mirrors `ObjectQLStrategy.resolveFkAttr`, this hook's
        // structural twin (same id-`$in` `$and` scope, same `executeAggregate`,
        // guarded since #13640): AFTER the early returns, because a call that
        // reads nothing cannot widen anything and refusing it would be pure
        // over-denial; and BEFORE the chunk loop, so one scope gets one verdict
        // rather than one per 500 ids. The condition is spelled to match the
        // composition on the next line exactly, so the set of scopes guarded
        // and the set of scopes `$and`-ed are provably the same set.
        //
        // ⛔ Zero compiler change: the #13571 lowering residue is ruled and
        // untouched. This guard is the walk, not the lowering.
        if (scope) assertReadScopeCannotVacate(scope, targetObject);
        // #3680 — the sort-key pass hands over the PRE-window id set (every
        // grouped value, not just the displayed page), so a high-cardinality
        // lookup dimension can push thousands of ids through here. Chunk the
        // `$in` so the bound-parameter count stays under every driver's limit
        // (SQLite's historic floor is 999 variables).
        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
          // #3602 — AND the referenced object's own read scope into the id filter,
          // with `$and` (never key-merge) so it cannot be displaced by the id
          // predicate — the same composition the strategy uses for the aggregate.
          // Without it this per-record read leaks display names the target's RLS
          // would hide (fires when the referenced object is stricter than the base).
          const idFilter: Record<string, unknown> = { id: { $in: ids.slice(i, i + CHUNK) } };
          const filter = scope ? { $and: [idFilter, scope] } : idFilter;
          // Group by (id, displayField) — one row per record — reusing the aggregate
          // bridge rather than adding a record-fetch capability. A count keeps engines
          // that require ≥1 aggregation happy; the count itself is unused.
          const rows = await executeAggregate(targetObject, {
            groupBy: ['id', displayField],
            aggregations: [{ field: 'id', method: 'count', alias: '_c' }],
            filter,
            // #3602 second belt — `scope` above is the analytics layer's own
            // predicate on this per-record read; the context makes the engine's
            // middleware scope it as well.
            context,
          });
          for (const r of rows) {
            if (r.id != null && r[displayField] != null) map.set(r.id, String(r[displayField]));
          }
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

    // Temporal storage-form coercion (fixes the SQLite datetime "No rows" bug).
    // The raw-SQL strategy binds dashboard relative-date tokens (already expanded
    // to ISO strings) directly, bypassing the driver's CRUD coercion. Delegate to
    // the driver — the single source of truth for the on-disk storage convention —
    // so a `Field.datetime` ISO comparand becomes epoch ms on SQLite, while
    // `Field.date` text and native-timestamp (Postgres) columns pass through
    // unchanged. Resolved at call time so plugin-init order does not matter.
    const coerceTemporalFilterValue = (
      objectName: string,
      fieldName: string,
      value: unknown,
    ): unknown => {
      try {
        const svc = ctx.getService<DataEngineLike>('data');
        const driver: TemporalDriverSurface | undefined = svc?.getDriverForObject?.(objectName);
        if (driver && typeof driver.temporalFilterValue === 'function') {
          return driver.temporalFilterValue(objectName, fieldName, value);
        }
      } catch {
        // No data engine / driver, or it doesn't support coercion — leave the
        // value as-is (today's behaviour; safe for text/native-timestamp paths).
      }
      return value;
    };

    // The column half of the same fix (#3912). A SQLite `Field.datetime` column
    // holds BOTH storage forms — INTEGER epoch from a `Date` write, ISO TEXT from
    // a REST/JSON write or a `NOW()` default — so coercing the comparand alone
    // matched whichever half the writer produced and returned an empty window for
    // the other. Ask the driver for the column expression that normalises both.
    const coerceTemporalFilterColumn = (
      objectName: string,
      fieldName: string,
      columnSql: string,
    ): string => {
      try {
        const svc = ctx.getService<DataEngineLike>('data');
        const driver: TemporalDriverSurface | undefined = svc?.getDriverForObject?.(objectName);
        if (driver && typeof driver.temporalFilterColumnSql === 'function') {
          return driver.temporalFilterColumnSql(objectName, fieldName, columnSql);
        }
      } catch {
        // Same tiering as above — an unresolvable driver emits the bare column,
        // which is today's behaviour and correct on every non-mixed dialect.
      }
      return columnSql;
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
      coerceTemporalFilterValue,
      coerceTemporalFilterColumn,
      relationshipResolver,
      labelResolver,
      // [#8286] Passed through as authored — `undefined` is "this host did not
      // choose", which the service resolves to development-only. Defaulting it
      // here would be a second copy of that decision, drifting the moment one
      // of the two moves.
      debugSql: this.options.debugSql,
      // Source-field metadata behind the display chains on result columns:
      // ADR-0053 currency (`currencyConfig.defaultCurrency`) and percent scale
      // (`max`, which is what marks whole-percent storage — objectui#3136).
      sourceFieldMeta: (object: string, field: string) => {
        const f = dataEngine()?.getObject?.(object)?.fields?.[field] as
          | { type?: string; max?: number; currencyConfig?: { defaultCurrency?: string } }
          | undefined;
        return f ? { type: f.type, max: f.max, defaultCurrency: f.currencyConfig?.defaultCurrency } : undefined;
      },
      // #5033 — the datasource an object is bound to, used ONLY to name the
      // actual cause when a dataset's SQL references a table that is not on the
      // datasource the query was routed to. Undefined ⇒ the object rides the
      // default datasource (or the engine cannot answer), and the diagnostic
      // says so rather than inventing a name.
      //
      // [#5288] Asked of the ENGINE's resolver, not of the object's declaration.
      // `getObject(name).datasource` is the declared value — step 1 of the five
      // `getDriver` routes by — so an object placed by a `datasourceMapping`
      // rule, by the ADR-0057 §3.6 lifecycle split, or by its package's
      // `defaultDatasource` answered `'default'`, and the diagnostic named a
      // database the rows are not in. Recomputing those rules here instead would
      // be the second implementation `resolveMappedDatasource` (#4462) exists to
      // prevent: it drifts by one step, silently, and the drift only surfaces as
      // an error message pointing at the wrong database.
      getObjectDatasource: (objectName: string) => dataEngine()?.resolveEffectiveDatasource?.(objectName),
      // ADR-0062 D6 — a federated object carries an `external` block (ADR-0015).
      // Reported so NativeSQLStrategy declines it (its hand-compiled FROM would
      // hit the wrong physical table) and the driver-correct ObjectQL path runs.
      isExternalObject: (objectName: string) => {
        const obj = dataEngine()?.getObject?.(objectName);
        return !!(obj && obj.external != null);
      },
      // [#3867] Existence probe for the cube auto-inference gate. Reads the
      // same schema registry the data path's #3770 gate consults, through the
      // engine accessor this bridge already uses above — so "which objects
      // exist" has one answer across /data and /analytics.
      //
      // `dataEngine()` resolves lazily and may be absent entirely (analytics
      // installed without a data engine). Reporting `false` there would 404
      // every cube, so an unresolvable engine reports `true` — "cannot answer,
      // do not block" — mirroring the tiering #3770 took on the data path.
      isRegisteredObject: (name: string) => {
        const engine = dataEngine();
        if (!engine) return true;
        return engine.getObject?.(name) != null;
      },
      // [#4437, #5520] Field names for the two source-field gates — measures
      // (#4437) and dimensions/timeDimensions (#5520). Read from the
      // SAME schema registry `isRegisteredObject` above consults (and the data
      // path's #4315 gate reads), so "which fields exist" has one answer across
      // /data and /analytics. `undefined` — no engine, unknown object, or an
      // object with no field map (an external datasource whose columns are not
      // mirrored locally) — means "cannot answer", and the gate stands down.
      getObjectFieldNames: (objectName: string) => {
        const fields = dataEngine()?.getObject?.(objectName)?.fields;
        if (!fields || typeof fields !== 'object') return undefined;
        const names = Object.keys(fields);
        return names.length > 0 ? names : undefined;
      },
      draftRowsResolver,
    };

    if (autoBridgedReadScope && securityPresentAtInit) {
      ctx.logger.info('[Analytics] Auto-bridged getReadScope → "security" service (getReadFilter)');
    } else if (autoBridgedReadScope) {
      // The bridge IS wired and will resolve at call time — this is only a
      // heads-up that security had not registered yet at our init. It becomes a
      // real problem only if no security service ever appears.
      ctx.logger.info(
        '[Analytics] getReadScope bridged to the "security" service; that service is not ' +
        'registered yet at init and will be resolved per query (plugin order is not significant).',
      );
    } else if (!getReadScope) {
      ctx.logger.warn(
        '[Analytics] No getReadScope configured and no "security" service with getReadFilter found — ' +
        'analytics queries will NOT enforce tenant/RLS scoping (ADR-0021 D-C). ' +
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
