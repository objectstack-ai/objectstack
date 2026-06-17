// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Cube } from '../data/analytics.zod.js';
import type { FilterCondition } from '../data/filter.zod.js';
import type { ExecutionContext } from '../kernel/execution-context.zod.js';
import type { Dataset } from '../ui/dataset.zod.js';

/**
 * IAnalyticsService - Analytics / BI Service Contract
 *
 * Defines the interface for analytical query execution and semantic layer
 * metadata discovery in ObjectStack. Concrete implementations (Cube.js, custom, etc.)
 * should implement this interface.
 *
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete analytics engine implementations.
 *
 * Aligned with CoreServiceName 'analytics' in core-services.zod.ts.
 */

/**
 * An analytical query definition
 */
export interface AnalyticsQuery {
    /** Target cube name. Optional when cube is specified at a higher level (e.g. API request wrapper or cube-scoped endpoint). Implementations should validate presence at runtime. */
    cube?: string;
    /** Measures to compute (e.g. ['orders.count', 'orders.totalRevenue']) */
    measures: string[];
    /** Dimensions to group by (e.g. ['orders.status', 'orders.createdAt']) */
    dimensions?: string[];
    /**
     * WHERE clause — canonical filter shape per the unified Query DSL
     * (see `FilterConditionSchema` in `spec/data/filter.zod.ts`).
     * MongoDB-style: implicit equality, `$eq/$ne/$gt/$gte/$lt/$lte/
     * $in/$nin/$contains/...` operator wrappers, `$and/$or/$not`
     * logical combinators. This is the same filter shape used by
     * `find()`, dashboard widget `filter`, RLS, etc.
     *
     * @example
     * ```ts
     * { where: { is_active: true, stage: { $nin: ['lost'] } } }
     * ```
     */
    where?: Record<string, unknown>;
    /** Time dimension configuration */
    timeDimensions?: Array<{
        dimension: string;
        granularity?: string;
        dateRange?: string | string[];
    }>;
    /** Sort order for results */
    order?: Record<string, 'asc' | 'desc'>;
    /** Result limit */
    limit?: number;
    /** Result offset */
    offset?: number;
    /** Timezone for date/time calculations */
    timezone?: string;
}

/**
 * Analytics query result
 */
export interface AnalyticsResult {
    /** Result rows */
    rows: Record<string, unknown>[];
    /** Column metadata */
    fields: Array<{
        name: string;
        type: string;
        /** Human display label (e.g. measure `label`) — for legends/KPIs. */
        label?: string;
        /** Display format hint (e.g. measure `format` like "$0,0", "0.0%"). */
        format?: string;
    }>;
    /** Generated SQL (if available) */
    sql?: string;
    /**
     * Marginal aggregates — one entry per `DatasetSelection.totals` grouping,
     * in request order. Each entry's rows carry the grouping's dimension
     * columns plus the same measure columns as `rows`, computed with the
     * measure's true aggregate over the underlying data (never re-derived
     * from bucketed values). The grand-total grouping (`[]`) yields a single
     * dimensionless row.
     */
    totals?: Array<{
        /** The dimension subset this marginal was grouped by ([] = grand total). */
        dimensions: string[];
        rows: Record<string, unknown>[];
    }>;
}

/**
 * Cube metadata for discovery
 */
export interface CubeMeta {
    /** Cube name */
    name: string;
    /** Human-readable title */
    title?: string;
    /** Available measures */
    measures: Array<{ name: string; type: string; title?: string }>;
    /** Available dimensions */
    dimensions: Array<{ name: string; type: string; title?: string }>;
}

/**
 * Compare-to directive (ADR-0021): runs a time-shifted second query and
 * attaches `<measure>__compare` columns to each row.
 */
export interface DatasetCompareTo {
    /** previousPeriod = equal-length window immediately before; previousYear = same window −1y. */
    kind: 'previousPeriod' | 'previousYear';
    /** The time dimension (by name) whose dateRange is shifted. */
    dimension: string;
}

/**
 * A presentation's selection against a dataset (ADR-0021). Report/dashboard
 * widgets bind to a dataset and pick dimensions/measures BY NAME; this is the
 * wire shape a preview/query endpoint posts.
 */
export interface DatasetSelection {
    /** Dimension names from the dataset. */
    dimensions?: string[];
    /** Measure names from the dataset (may include derived measures). */
    measures: string[];
    /** Presentation-scope filter, ANDed with the dataset's intrinsic filter at render. */
    runtimeFilter?: FilterCondition;
    /** Optional time-dimension windows passed through to the runtime. */
    timeDimensions?: AnalyticsQuery['timeDimensions'];
    order?: Record<string, 'asc' | 'desc'>;
    limit?: number;
    offset?: number;
    /** Compare-to directive — runs a shifted query and attaches `<measure>__compare`. */
    compareTo?: DatasetCompareTo;
    /**
     * Server-side totals (matrix subtotals + grand total). Each grouping is a
     * subset of `dimensions` to additionally aggregate by; the selection is
     * re-run grouped only by those dimensions, so every total is the measure's
     * TRUE aggregate over the underlying rows — an `avg` total is the average
     * over all rows, not an average of bucket averages (the ADR-0021
     * governance line that forbids client-side re-aggregation). `[]` requests
     * the grand total. A matrix report asks for
     * `{ groupings: [rowDims, columnDims, []] }`. Results arrive on
     * `AnalyticsResult.totals` in request order. `order`/`limit`/`offset` do
     * not apply to totals queries — totals always cover the full selection.
     */
    totals?: { groupings: string[][] };
    timezone?: string;
}

export interface IAnalyticsService {
    /**
     * Execute an analytical query
     * @param query - The analytics query definition
     * @param context - The caller's ExecutionContext (tenant, user, roles). Used
     *   to compute the per-request tenant/RLS read scope for the raw-SQL path
     *   (ADR-0021 D-C). Optional for backward-compat and in-memory/dev use, but
     *   REQUIRED for multi-tenant isolation on cross-object queries.
     * @returns Query results with rows and field metadata
     */
    query(query: AnalyticsQuery, context?: ExecutionContext): Promise<AnalyticsResult>;

    /**
     * Get available cube metadata for discovery
     * @param cubeName - Optional cube name to filter (returns all if omitted)
     * @returns Array of cube metadata definitions
     */
    getMeta(cubeName?: string): Promise<CubeMeta[]>;

    /**
     * Generate SQL for a query without executing it (dry-run)
     * @param query - The analytics query definition
     * @param context - The caller's ExecutionContext (see {@link query}).
     * @returns Generated SQL string and parameters
     */
    generateSql?(query: AnalyticsQuery, context?: ExecutionContext): Promise<{ sql: string; params: unknown[] }>;

    /**
     * Execute a semantic-layer `dataset` (ADR-0021): compile it to the Cube
     * runtime, then run the presentation's `selection` (dimensions/measures by
     * name, runtime filter, compareTo) — returning chart-ready rows. The
     * `dataset` may be a saved definition or an inline draft (Studio preview).
     *
     * Optional: implementations that only support raw cube queries may omit it;
     * callers should feature-detect (`typeof svc.queryDataset === 'function'`).
     *
     * @param dataset - The dataset definition (saved or inline draft).
     * @param selection - Dimensions/measures to project + runtime directives.
     * @param context - The request's ExecutionContext (tenant/RLS, see {@link query}).
     * @param options - ADR-0037 P3: `previewDrafts` evaluates the selection over
     *   the base object's PENDING seed-draft rows (when one exists) so a draft
     *   preview charts real numbers before publish. Same principal, reads only;
     *   implementations without draft support ignore it.
     */
    queryDataset?(
        dataset: Dataset,
        selection: DatasetSelection,
        context?: ExecutionContext,
        options?: { previewDrafts?: boolean },
    ): Promise<AnalyticsResult>;
}

// ==========================================
// Strategy Pattern Contracts
// ==========================================

/**
 * Driver capability descriptor.
 *
 * Used by the strategy chain to decide at runtime which execution path
 * is available for a given cube / object.
 */
export interface DriverCapabilities {
    /** Driver supports native SQL execution (e.g. Postgres, MySQL, SQLite). */
    nativeSql: boolean;
    /** Driver supports ObjectQL aggregate() operations. */
    objectqlAggregate: boolean;
    /** Driver is an in-memory implementation (dev/test only). */
    inMemory: boolean;
}

/**
 * Context passed to every strategy so it can access shared infrastructure.
 */
export interface StrategyContext {
    /** Resolve a cube definition by name. */
    getCube(name: string): Cube | undefined;
    /** Probe driver capabilities for the object backing a cube. */
    queryCapabilities(cubeName: string): DriverCapabilities;
    /**
     * Execute a raw SQL string on the driver that owns `objectName`.
     * Only available when `nativeSql` capability is true.
     */
    executeRawSql?(objectName: string, sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
    /**
     * Execute an ObjectQL aggregate query.
     * Only available when `objectqlAggregate` capability is true.
     */
    executeAggregate?(objectName: string, options: {
        groupBy?: string[];
        aggregations?: Array<{ field: string; method: string; alias: string }>;
        filter?: Record<string, unknown>;
        /**
         * Reference timezone (IANA name) for date bucketing (ADR-0053 Phase 2).
         * Forwarded to the engine so `groupBy` items with a `dateGranularity`
         * bucket on that zone's calendar days. Unset / `'UTC'` keeps the UTC
         * fast path.
         */
        timezone?: string;
    }): Promise<Record<string, unknown>[]>;
    /**
     * Fallback in-memory analytics service (e.g. MemoryAnalyticsService from driver-memory).
     */
    fallbackService?: {
        query(query: AnalyticsQuery): Promise<AnalyticsResult>;
        getMeta(cubeName?: string): Promise<CubeMeta[]>;
        generateSql?(query: AnalyticsQuery): Promise<{ sql: string; params: unknown[] }>;
    };

    /**
     * ADR-0021 D-C — per-object read scope (RLS + tenant isolation).
     *
     * Returns the security predicate that MUST be ANDed into the query for the
     * given object, as a canonical Mongo-style `FilterCondition` (exactly what
     * the `RLSCompiler` emits). The strategy compiles it to alias-qualified,
     * parameterized SQL and injects it for the base table AND every joined
     * object, closing the raw-SQL bypass at `engine.ts` (`execute()` does not
     * thread tenant scope on its own).
     *
     * This hook is bound to the current request's `ExecutionContext` by the
     * `IAnalyticsService` implementation (see `query(query, context)`), so the
     * provider already knows the active tenant when it is called.
     *
     * @example
     * ```ts
     * getReadScope: (obj) => ({ organization_id: tenantId })
     * ```
     *
     * Returning `undefined`/`null` means "no scope for this object" (e.g. a
     * global control-plane table). When this hook is absent entirely the
     * strategy runs unscoped — callers that require isolation MUST provide it.
     */
    getReadScope?(objectName: string): FilterCondition | null | undefined;

    /**
     * ADR-0021 D-C — join allowlist. Returns the set of relationship aliases the
     * dataset behind `cubeName` explicitly declared via `include`. The strategy
     * REJECTS any join whose alias is not in this set (v1 only joins along
     * declared relationships). Returning `undefined` disables the check (legacy
     * Cube definitions that pre-date datasets).
     */
    getAllowedRelationships?(cubeName: string): Set<string> | undefined;
}

/**
 * AnalyticsStrategy — One link in the priority-ordered strategy chain.
 *
 * Each strategy is responsible for:
 * 1. Determining whether it *can* handle a query (via `canHandle`).
 * 2. Executing the query using its specific driver path.
 * 3. Optionally generating a SQL representation of the query.
 */
export interface AnalyticsStrategy {
    /** Human-readable strategy name (e.g. 'NativeSQLStrategy'). */
    readonly name: string;
    /** Priority (lower = higher priority). P1=10, P2=20, P3=30. */
    readonly priority: number;

    /**
     * Return `true` if this strategy can handle the given query in the
     * current runtime context (driver capabilities, cube availability, etc.).
     */
    canHandle(query: AnalyticsQuery, ctx: StrategyContext): boolean;

    /**
     * Execute the analytical query.
     * Called only when `canHandle` returned `true`.
     */
    execute(query: AnalyticsQuery, ctx: StrategyContext): Promise<AnalyticsResult>;

    /**
     * Generate a SQL representation without executing.
     * Called only when `canHandle` returned `true`.
     */
    generateSql(query: AnalyticsQuery, ctx: StrategyContext): Promise<{ sql: string; params: unknown[] }>;
}
