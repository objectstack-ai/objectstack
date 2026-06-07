// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IAnalyticsService,
  AnalyticsQuery,
  AnalyticsResult,
  CubeMeta,
  DatasetSelection,
} from '@objectstack/spec/contracts';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { Dataset } from '@objectstack/spec/ui';
import type { Logger } from '@objectstack/spec/contracts';
import { createLogger } from '@objectstack/core';
import { CubeRegistry } from './cube-registry.js';
import type { AnalyticsStrategy, DriverCapabilities, StrategyContext } from './strategies/types.js';
import { NativeSQLStrategy } from './strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from './strategies/objectql-strategy.js';
import { compileDataset, type CompiledDataset, type RelationshipResolver } from './dataset-compiler.js';
import { DatasetExecutor } from './dataset-executor.js';

/**
 * Configuration for AnalyticsService.
 */
export interface AnalyticsServiceConfig {
  /** Pre-defined cube definitions (from manifest). */
  cubes?: Cube[];
  /** Logger instance. */
  logger?: Logger;
  /**
   * Probe driver capabilities for the object that backs a cube.
   * The service calls this function to decide which strategy can handle a query.
   */
  queryCapabilities?: (cubeName: string) => DriverCapabilities;
  /**
   * Execute raw SQL on the driver for a given object.
   * Required for NativeSQLStrategy.
   */
  executeRawSql?: (objectName: string, sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
  /**
   * Execute an ObjectQL aggregate query.
   * Required for ObjectQLStrategy.
   */
  executeAggregate?: (objectName: string, options: {
    groupBy?: string[];
    aggregations?: Array<{ field: string; method: string; alias: string }>;
    filter?: Record<string, unknown>;
  }) => Promise<Record<string, unknown>[]>;
  /**
   * Fallback IAnalyticsService (e.g. MemoryAnalyticsService).
   * Used by InMemoryStrategy.
   */
  fallbackService?: IAnalyticsService;
  /**
   * Custom strategies to add/replace the defaults.
   * They are merged with the built-in strategies and sorted by priority.
   */
  strategies?: AnalyticsStrategy[];
  /**
   * ADR-0021 D-C — context-aware per-object read scope (tenant + RLS). Supplied
   * by the runtime that owns the sharing middleware; receives the current
   * request's ExecutionContext and returns the RLS `FilterCondition` for the
   * object (exactly what `RLSCompiler` emits). The service binds the active
   * context per query and the strategy compiles the filter into alias-qualified
   * SQL injected into every base and joined table.
   *
   * MAY be async: the production bridge resolves RLS from the `security`
   * service's `getReadFilter`, which can hit the database. The service
   * pre-resolves the scope for every base + joined object of a query (before
   * the synchronous SQL builder runs), so a sync return still works unchanged.
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
   * Joins outside this set are rejected by the strategy. Compiled datasets
   * (via `queryDataset`/`registerDataset`) supply this automatically; this
   * config hook is a fallback for legacy hand-authored cubes.
   */
  getAllowedRelationships?: (cubeName: string) => Set<string> | undefined;
  /**
   * ADR-0021 — optional object-graph resolver used when compiling datasets:
   * `(baseObject, relationshipName) => relatedObjectName | undefined`. When
   * provided, `queryDataset` validates that every declared `include` exists.
   */
  relationshipResolver?: RelationshipResolver;
  /** Pre-defined datasets to compile + register at construction (ADR-0021). */
  datasets?: Dataset[];
}

/**
 * Default capabilities when probing is not configured — assumes in-memory only.
 */
const DEFAULT_CAPABILITIES: DriverCapabilities = {
  nativeSql: false,
  objectqlAggregate: false,
  inMemory: true,
};

/**
 * AnalyticsService — Multi-driver analytics orchestrator.
 *
 * Implements `IAnalyticsService` by delegating to a priority-ordered
 * strategy chain:
 *
 * | Priority | Strategy | Condition |
 * |:---:|:---|:---|
 * | P1 (10) | NativeSQLStrategy | Driver supports raw SQL |
 * | P2 (20) | ObjectQLStrategy | Driver supports aggregate AST |
 * | P3 (30) | (custom / InMemoryStrategy from driver-memory) | Injected by user |
 *
 * When `fallbackService` is configured, an internal delegate strategy
 * is automatically appended at priority 30 as a safety net.
 *
 * The service also owns a `CubeRegistry` for metadata discovery and
 * auto-inference from object schemas.
 */
export class AnalyticsService implements IAnalyticsService {
  private readonly strategies: AnalyticsStrategy[];
  /** Context-independent part of the StrategyContext (no per-request scope). */
  private readonly baseCtx: StrategyContext;
  /** Context-aware read-scope provider (bound to the request's context per call). */
  private readonly readScopeProvider?: AnalyticsServiceConfig['getReadScope'];
  /** Compiled datasets by name — feeds the join allowlist (D-C) and queryDataset. */
  private readonly datasetRegistry = new Map<string, CompiledDataset>();
  /** Optional object-graph resolver used when compiling datasets. */
  private readonly relationshipResolver?: RelationshipResolver;
  readonly cubeRegistry: CubeRegistry;
  private readonly logger: Logger;

  constructor(config: AnalyticsServiceConfig = {}) {
    this.logger = config.logger || createLogger({ level: 'info', format: 'pretty' });
    this.cubeRegistry = new CubeRegistry();

    // Register pre-defined cubes
    if (config.cubes) {
      this.cubeRegistry.registerAll(config.cubes);
    }

    this.readScopeProvider = config.getReadScope;
    this.relationshipResolver = config.relationshipResolver;

    // Compile + register pre-defined datasets (ADR-0021).
    if (config.datasets) {
      for (const ds of config.datasets) {
        try {
          this.registerDataset(ds);
        } catch (e) {
          this.logger?.warn?.(`[Analytics] Failed to register dataset "${ds?.name}": ${String((e as Error)?.message ?? e)}`);
        }
      }
    }

    // Build the context-independent strategy context. `getReadScope` is bound
    // per query in `callCtx(context)` so it can resolve the active tenant.
    this.baseCtx = {
      getCube: (name) => this.cubeRegistry.get(name),
      queryCapabilities: config.queryCapabilities || (() => DEFAULT_CAPABILITIES),
      executeRawSql: config.executeRawSql,
      executeAggregate: config.executeAggregate,
      fallbackService: config.fallbackService,
      // Prefer a compiled dataset's declared relationships (D-C join allowlist);
      // fall back to any explicitly-configured provider for legacy cubes.
      getAllowedRelationships: (cubeName: string) =>
        this.datasetRegistry.get(cubeName)?.allowedRelationships
        ?? config.getAllowedRelationships?.(cubeName),
    };

    // Build strategy chain (built-in + custom, sorted by priority)
    // InMemoryStrategy is NOT built-in — it lives in @objectstack/driver-memory
    // and should be passed via config.strategies when needed.
    // When fallbackService is configured, an internal delegate is added at P3.
    const builtIn: AnalyticsStrategy[] = [
      new NativeSQLStrategy(),
      new ObjectQLStrategy(),
    ];

    // Auto-add fallback delegate when fallbackService is provided
    if (config.fallbackService) {
      builtIn.push(new FallbackDelegateStrategy());
    }

    const custom = config.strategies || [];
    this.strategies = [...builtIn, ...custom].sort((a, b) => a.priority - b.priority);

    this.logger.info(
      `[Analytics] Initialized with ${this.cubeRegistry.size} cubes, ` +
      `${this.strategies.length} strategies: ${this.strategies.map(s => s.name).join(' → ')}`,
    );
  }

  /**
   * Build a per-call StrategyContext that binds the read-scope provider to the
   * current request's ExecutionContext (ADR-0021 D-C). The strategy then sees a
   * `getReadScope(objectName)` that already knows the active tenant.
   */
  private async callCtx(
    query: AnalyticsQuery,
    context?: ExecutionContext,
  ): Promise<StrategyContext> {
    if (!this.readScopeProvider) return this.baseCtx;
    // Pre-resolve the read scope for every object the strategy will scan (base
    // + all declared joins) BEFORE the synchronous SQL builder runs, since the
    // provider may be async (the production `security.getReadFilter` bridge).
    // The strategy then reads each object's filter synchronously from the map.
    const scopes = await this.resolveReadScopes(query, context);
    return {
      ...this.baseCtx,
      getReadScope: (objectName: string) => scopes.get(objectName) ?? null,
    };
  }

  /**
   * Resolve the read scope (tenant + RLS `FilterCondition`) for the base object
   * AND every joined object of the query's cube, keyed by object name. This is
   * the async pre-pass that lets the synchronous strategy enforce scoping even
   * when the provider (security `getReadFilter`) resolves asynchronously.
   *
   * The object set is `cube.sql` (base) plus every `cube.joins[*].name` — a
   * SUPERSET of what the strategy actually scans (the strategy only joins along
   * declared relationships), so no scanned object is ever left unscoped.
   *
   * Fail-closed: if the provider throws for an object, the whole query is
   * rejected rather than emitting SQL with that object unscoped.
   */
  private async resolveReadScopes(
    query: AnalyticsQuery,
    context?: ExecutionContext,
  ): Promise<Map<string, FilterCondition>> {
    const map = new Map<string, FilterCondition>();
    const provider = this.readScopeProvider;
    if (!provider || !query.cube) return map;
    const cube = this.cubeRegistry.get(query.cube);
    if (!cube) return map;

    const objects = new Set<string>();
    if (typeof cube.sql === 'string' && cube.sql.trim()) {
      objects.add(cube.sql.trim());
    }
    const joins = (cube as { joins?: Record<string, { name?: string }> }).joins;
    if (joins) {
      for (const [alias, j] of Object.entries(joins)) {
        objects.add(j?.name ?? alias);
      }
    }

    for (const object of objects) {
      let filter: FilterCondition | null | undefined;
      try {
        filter = await provider(object, context);
      } catch (e) {
        // Deny the entire query — never fall through to unscoped SQL.
        this.logger.error?.(
          `[Analytics] read-scope resolution failed for object "${object}" — ` +
          `rejecting query (fail-closed, ADR-0021 D-C)`,
          e instanceof Error ? e : new Error(String(e)),
        );
        throw new Error(
          `[Analytics] read-scope resolution failed for "${object}"; query denied (fail-closed).`,
        );
      }
      if (filter != null) map.set(object, filter);
    }
    return map;
  }

  /**
   * Execute an analytical query by delegating to the first capable strategy.
   */
  async query(query: AnalyticsQuery, context?: ExecutionContext): Promise<AnalyticsResult> {
    if (!query.cube) {
      throw new Error('Cube name is required in analytics query');
    }

    this.ensureCube(query);
    const ctx = await this.callCtx(query, context);
    const strategy = this.resolveStrategy(query, ctx);
    this.logger.debug(`[Analytics] Query on cube "${query.cube}" → ${strategy.name}`);

    return strategy.execute(query, ctx);
  }

  /**
   * Compile a `dataset` (ADR-0021) and register its Cube + join allowlist so it
   * can be queried by name. Idempotent (re-registering overwrites). Returns the
   * compiled dataset.
   */
  registerDataset(dataset: Dataset): CompiledDataset {
    const compiled = compileDataset(dataset, this.relationshipResolver);
    this.cubeRegistry.register(compiled.cube);
    this.datasetRegistry.set(dataset.name, compiled);
    return compiled;
  }

  /**
   * Execute a semantic-layer dataset (ADR-0021). Compiles the dataset (saved or
   * inline draft — Studio preview), registers its Cube + join allowlist, then
   * runs the selection through the `DatasetExecutor` with the request context so
   * tenant/RLS scoping (D-C) is applied. See {@link IAnalyticsService.queryDataset}.
   */
  async queryDataset(
    dataset: Dataset,
    selection: DatasetSelection,
    context?: ExecutionContext,
  ): Promise<AnalyticsResult> {
    const compiled = this.registerDataset(dataset);
    this.logger.debug(`[Analytics] queryDataset "${dataset.name}" (object=${dataset.object}, include=${(dataset.include ?? []).join(',') || '—'})`);
    return new DatasetExecutor(this).execute(compiled, selection, context);
  }

  /**
   * Get cube metadata for discovery.
   */
  async getMeta(cubeName?: string): Promise<CubeMeta[]> {
    // If a fallback service is configured, merge its metadata with the registry
    const cubes = cubeName
      ? [this.cubeRegistry.get(cubeName)].filter(Boolean) as Cube[]
      : this.cubeRegistry.getAll();

    return cubes.map(cube => ({
      name: cube.name,
      title: cube.title,
      measures: Object.entries(cube.measures).map(([key, measure]) => ({
        name: `${cube.name}.${key}`,
        type: measure.type,
        title: measure.label,
      })),
      dimensions: Object.entries(cube.dimensions).map(([key, dimension]) => ({
        name: `${cube.name}.${key}`,
        type: dimension.type,
        title: dimension.label,
      })),
    }));
  }

  /**
   * Generate SQL for a query without executing it (dry-run).
   */
  async generateSql(query: AnalyticsQuery, context?: ExecutionContext): Promise<{ sql: string; params: unknown[] }> {
    if (!query.cube) {
      throw new Error('Cube name is required for SQL generation');
    }

    this.ensureCube(query);
    const ctx = await this.callCtx(query, context);
    const strategy = this.resolveStrategy(query, ctx);
    this.logger.debug(`[Analytics] generateSql on cube "${query.cube}" → ${strategy.name}`);

    return strategy.generateSql(query, ctx);
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * Ensure a cube exists for the given query and that it knows about every
   * measure referenced by the query.
   *
   * - If no cube is registered for `query.cube`, infer a minimal cube from
   *   the query so downstream strategies (which assume `cube.sql` exists)
   *   don't crash.
   * - If a cube exists but the query references measures that aren't in
   *   `cube.measures` (e.g. `amount_sum`, `amount_avg` emitted by dashboard
   *   widget translators), inject suffix-inferred Metric entries so the
   *   strategies pick the right aggregation function and field.
   */
  private ensureCube(query: AnalyticsQuery): void {
    const name = query.cube!;
    let cube = this.cubeRegistry.get(name);

    if (!cube) {
      cube = this.inferCubeFromQuery(query);
      this.cubeRegistry.register(cube);
      this.logger.warn(
        `[Analytics] No cube registered for "${name}"; auto-inferred a minimal cube ` +
        `(sql="${name}", measures=${Object.keys(cube.measures).join(',') || '(none)'}, ` +
        `dimensions=${Object.keys(cube.dimensions).join(',') || '(none)'}). ` +
        `Define an explicit Cube in your stack for full control.`,
      );
      return;
    }

    // Cube exists — check for unknown measures referenced by the query and
    // augment the cube with suffix-inferred Metric definitions so callers
    // that pass `<field>_sum` / `<field>_avg` etc. get the right aggregation.
    const stripPrefix = (m: string) => (m.includes('.') ? m.split('.').slice(1).join('.') : m);
    const extraMeasures: Record<string, any> = {};
    for (const m of query.measures || []) {
      const key = stripPrefix(m);
      if (cube.measures[key] || extraMeasures[key]) continue;
      extraMeasures[key] = inferMeasure(key);
    }
    if (Object.keys(extraMeasures).length > 0) {
      const augmented: Cube = {
        ...cube,
        measures: { ...cube.measures, ...extraMeasures },
      };
      this.cubeRegistry.register(augmented);
      this.logger.debug(
        `[Analytics] Augmented cube "${name}" with inferred measures: ${Object.keys(extraMeasures).join(',')}`,
      );
    }
  }

  /** Build a minimal Cube from the fields referenced by an AnalyticsQuery. */
  private inferCubeFromQuery(query: AnalyticsQuery): Cube {
    const cubeName = query.cube!;
    const measures: Record<string, any> = {};
    const dimensions: Record<string, any> = {};

    const stripPrefix = (m: string) => (m.includes('.') ? m.split('.').slice(1).join('.') : m);

    // Always provide a default `count` measure
    measures.count = { name: 'count', label: 'Count', type: 'count', sql: '*' };

    for (const m of query.measures || []) {
      const key = stripPrefix(m);
      if (measures[key]) continue;
      const inferred = inferMeasure(key);
      measures[key] = inferred;
    }

    for (const d of query.dimensions || []) {
      const key = stripPrefix(d);
      if (dimensions[key]) continue;
      dimensions[key] = { name: key, label: key, type: 'string', sql: key };
    }

    if (query.where && typeof query.where === 'object' && !Array.isArray(query.where)) {
      // Canonical FilterCondition: top-level keys (excluding logical
      // combinators) are field names. We only need them to seed an
      // ad-hoc cube definition for free-form queries.
      for (const key of Object.keys(query.where as Record<string, unknown>)) {
        if (key.startsWith('$')) continue;
        const stripped = stripPrefix(key);
        if (dimensions[stripped] || measures[stripped]) continue;
        dimensions[stripped] = { name: stripped, label: stripped, type: 'string', sql: stripped };
      }
    }

    for (const td of query.timeDimensions || []) {
      const key = stripPrefix(td.dimension);
      if (dimensions[key]) continue;
      dimensions[key] = {
        name: key, label: key, type: 'time', sql: key,
        granularities: ['day', 'week', 'month', 'quarter', 'year'],
      };
    }

    return {
      name: cubeName,
      title: cubeName,
      sql: cubeName,
      measures,
      dimensions,
      public: false,
    };
  }

  /**
   * Walk the strategy chain and return the first strategy that can handle the query.
   */
  private resolveStrategy(query: AnalyticsQuery, ctx: StrategyContext): AnalyticsStrategy {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(query, ctx)) {
        return strategy;
      }
    }
    throw new Error(
      `[Analytics] No strategy can handle query for cube "${query.cube}". ` +
      `Checked: ${this.strategies.map(s => s.name).join(', ')}. ` +
      'Ensure a compatible driver is configured or a fallback service is registered.',
    );
  }
}

/**
 * Infer a Metric definition from a measure key name.
 *
 * Recognised suffix conventions (matches dashboard widget translators that
 * emit measures like `<field>_sum`, `<field>_avg`):
 *
 * | Suffix             | Aggregation     |
 * |:-------------------|:----------------|
 * | `count`            | `count(*)`      |
 * | `_sum`             | `sum(field)`    |
 * | `_avg` / `_average`| `avg(field)`   |
 * | `_min`             | `min(field)`    |
 * | `_max`             | `max(field)`    |
 * | `_count_distinct`  | `count(distinct field)` |
 *
 * Anything else is treated as a `sum(<key>)` — best-effort default for an
 * unknown numeric measure.
 */
export function inferMeasure(key: string): { name: string; label: string; type: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct'; sql: string } {
  if (key === 'count') {
    return { name: 'count', label: 'Count', type: 'count', sql: '*' };
  }
  const suffixes: Array<[string, 'sum' | 'avg' | 'min' | 'max' | 'count_distinct']> = [
    ['_count_distinct', 'count_distinct'],
    ['_sum', 'sum'],
    ['_avg', 'avg'],
    ['_average', 'avg'],
    ['_min', 'min'],
    ['_max', 'max'],
  ];
  for (const [suffix, type] of suffixes) {
    if (key.endsWith(suffix)) {
      const field = key.slice(0, -suffix.length) || '*';
      return { name: key, label: key, type, sql: field };
    }
  }
  return { name: key, label: key, type: 'sum', sql: key };
}

/**
 * FallbackDelegateStrategy — Internal strategy for fallback service delegation.
 *
 * Automatically added to the strategy chain when `fallbackService` is configured.
 * Not exported — consumers who need explicit in-memory support should use
 * `InMemoryStrategy` from `@objectstack/driver-memory`.
 */
class FallbackDelegateStrategy implements AnalyticsStrategy {
  readonly name = 'FallbackDelegateStrategy';
  readonly priority = 30;

  canHandle(query: AnalyticsQuery, ctx: StrategyContext): boolean {
    if (!query.cube) return false;
    return !!ctx.fallbackService;
  }

  async execute(query: AnalyticsQuery, ctx: StrategyContext): Promise<AnalyticsResult> {
    return ctx.fallbackService!.query(query);
  }

  async generateSql(query: AnalyticsQuery, ctx: StrategyContext): Promise<{ sql: string; params: unknown[] }> {
    if (ctx.fallbackService?.generateSql) {
      return ctx.fallbackService.generateSql(query);
    }
    return {
      sql: `-- FallbackDelegateStrategy: SQL generation not supported for cube "${query.cube}"`,
      params: [],
    };
  }
}
