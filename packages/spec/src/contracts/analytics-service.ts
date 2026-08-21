// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AnalyticsQuery, Cube } from '../data/analytics.zod.js';
import type { FilterCondition } from '../data/filter.zod.js';
import type { PercentScale } from '../data/percent-scale.js';
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
 * An analytical query definition.
 *
 * [#4538] Re-exported from the zod source (`AnalyticsQuerySchema`,
 * data/analytics.zod.ts) instead of a hand-written mirror — the mirror had
 * drifted (`where` had decayed to `Record<string, unknown>` where the schema
 * declares the canonical `FilterCondition`; `timeDimensions[].granularity`
 * to bare `string`). One shape, both tiers: the schema carries no
 * `.default()`/`.transform()` — `timezone` is genuinely optional, because an
 * absent timezone means "the engine resolves it" (org-timezone chain,
 * #1982/#2018) — so what a caller authors is exactly what an executor
 * receives.
 */
export type { AnalyticsQuery } from '../data/analytics.zod.js';

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
        /**
         * ADR-0053 currency chain — the resolved ISO 4217 code for a MONETARY
         * measure (explicit measure `currency` → source-field default → tenant
         * default). Absent on non-monetary columns, which must never render a
         * symbol.
         */
        currency?: string;
        /**
         * The column's percent SCALE, when it is a percentage: `fraction` for a
         * 0–1 ratio (`1` ⇒ "100%"), `whole` for percentage points (`1` ⇒ "1%").
         * Resolved from metadata — a `derived: { op: 'ratio' }` measure is a
         * fraction by definition, and a measure over a `percent` field inherits
         * that field's scale (see `percentScaleOf` in `spec/data`). Absent when
         * the column is not a percentage; renderers that receive it must scale
         * by it instead of guessing from the value (objectui#3136).
         */
        percentScale?: PercentScale;
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
    /**
     * The time dimension (by name) whose `dateRange` is shifted.
     *
     * **Optional since #5011, resolved by the EXECUTOR — not by any consumer.**
     * When omitted the executor takes the selection's shiftable time dimensions
     * (its own long-standing criterion: a `timeDimensions` entry carrying a
     * `dateRange`) and:
     *
     * - exactly one candidate → that one is shifted;
     * - zero candidates → throws, saying a comparison needs a dated window;
     * - two or more → throws, listing the candidates by name so the author can
     *   pick one.
     *
     * The ambiguous and empty cases are LOUD by design. A consumer must never
     * paper over them by guessing a dimension (PD #12): the resolution rule
     * lives at the producer of the comparison — the executor — precisely so
     * every caller gets the same answer or the same error.
     */
    dimension?: string;
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
    /**
     * Presentation-scope date bucketing (framework#3588). Applies to every
     * selected dimension the dataset declares as a `date` dimension, so a
     * widget can bucket a trend by month without the dataset having to declare
     * that granularity for every consumer.
     *
     * Precedence, per dimension: an explicit `timeDimensions` entry for that
     * dimension wins, then this selection-level granularity, then the dataset
     * dimension's own `dateGranularity` default. Unset leaves each dimension on
     * its dataset default (which may be no bucketing at all — grouping by the
     * raw column).
     */
    dateGranularity?: 'day' | 'week' | 'month' | 'quarter' | 'year';
    /**
     * Result ordering, applied by key in insertion order (`{ revenue: 'desc' }`).
     *
     * Every key must be a selected dimension, a selected measure, or a
     * `<measure>__compare` column; anything else is rejected rather than
     * silently ignored. Ordering is applied AFTER measure-scoped filters are
     * merged, `compareTo` columns are attached, and derived measures are
     * evaluated — so a derived measure (e.g. a win-rate ratio) is a valid sort
     * key even though no single SQL statement computes it.
     */
    order?: Record<string, 'asc' | 'desc'>;
    /**
     * Max rows to return, applied after `order`. When `limit` is set without
     * `order`, rows are ordered by the selected dimensions ascending first, so
     * the truncated window is deterministic rather than an arbitrary subset.
     */
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
 * Analytics execution-path capability descriptor.
 *
 * Used by the strategy chain to decide at runtime which execution path
 * is available for a given cube / object.
 *
 * [#4538] Renamed from `DriverCapabilities`: that name belongs to the data
 * domain's driver feature-flag record (`DriverCapabilitiesSchema`,
 * data/driver.zod.ts — what every `IDataDriver.supports` declares), a
 * genuinely different concept that was squatting behind the same name on
 * this entry. This trio answers one narrow question — which analytics
 * execution path can serve a cube — and now says so in its name.
 */
export interface AnalyticsDriverCapabilities {
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
    queryCapabilities(cubeName: string): AnalyticsDriverCapabilities;
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
        /**
         * One entry per aggregate to compute. `filter` (#10576, the contract
         * half of #10413's ruling) is a per-aggregation predicate over the
         * SOURCE rows — SQL `FILTER (WHERE …)` semantics — so a strategy can
         * lower a measure-scoped filter (`stage: 'closed_won'`) into the one
         * aggregation it belongs to instead of dropping it (the #10413 silent
         * drop) or scoping the WHOLE call via the sibling `filter` below.
         * Bridges forward it to `engine.aggregate`'s `aggregations[].filter`
         * (`AggregationNodeSchema.filter`), which the engine honours on every
         * driver by lowering in memory when the driver has no native
         * conditional aggregation.
         */
        aggregations?: Array<{ field: string; method: string; alias: string; filter?: FilterCondition }>;
        filter?: Record<string, unknown>;
        /**
         * Reference timezone (IANA name) for date bucketing (ADR-0053 Phase 2).
         * Forwarded to the engine so `groupBy` items with a `dateGranularity`
         * bucket on that zone's calendar days. Unset / `'UTC'` keeps the UTC
         * fast path.
         */
        timezone?: string;
        /**
         * ADR-0021 D-C (#3602) — the request's ExecutionContext, forwarded to
         * `engine.aggregate` (`BaseEngineOptions.context`) so the ENGINE's own
         * middleware chain scopes the read.
         *
         * This is the second belt, independent of {@link StrategyContext.getReadScope}.
         * The two resolve scope through different paths — this one through the
         * engine's middleware (`mergeReadContext` → RLS/sharing injection into
         * `opCtx.ast.where`), `getReadScope` through `security.getReadFilter` at
         * the analytics layer — and both are kept on purpose:
         *
         * - Without this, a strategy that forgets to call `getReadScope` runs
         *   completely unscoped. That is exactly how #3597 happened, and the
         *   context-less bridge is what let it through: with no principal on the
         *   operation, the security middleware's fall-open skipped its own RLS
         *   injection, so BOTH belts were off at once.
         * - Without `getReadScope`, deployments that do not install
         *   plugin-security have no engine-side RLS at all — the analytics layer
         *   is their only belt.
         *
         * Optional because a bridge to a non-ObjectQL backend may have nowhere
         * to put it; the `@objectstack/service-analytics` auto-bridge always
         * forwards it.
         */
        context?: ExecutionContext;
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
     * ADR-0021 D-C (#3602) — the ExecutionContext of the request being served
     * (tenant, user, roles, transaction).
     *
     * Bound per call by the `IAnalyticsService` implementation from the
     * `context` argument of `query()` / `generateSql()` / `queryDataset()`.
     * Strategies forward it to `executeAggregate` so the engine's middleware
     * chain can apply its own RLS — the depth-in-defense layer beneath
     * {@link StrategyContext.getReadScope}, which only works if every strategy
     * remembers to call it (#3597 is what happens when one does not).
     *
     * `undefined` means the caller supplied no context (in-memory/dev use, or a
     * system-internal query). It does NOT mean "unrestricted": the analytics
     * layer's own scoping still applies, and the engine treats a context-less
     * operation per its own policy.
     */
    context?: ExecutionContext;

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

    /**
     * Coerce a filter comparand to the storage form of a temporal column on the
     * object backing the query, so a relative-date / ISO-string value (e.g. the
     * `{12_months_ago}` dashboard token expanded to `"2025-06-18"`) compares
     * correctly against the column on the active driver.
     *
     * Why this exists: `NativeSQLStrategy` compiles a raw `SELECT … WHERE col >= $N`
     * and binds the value directly, bypassing the driver's own CRUD coercion. Under
     * the better-sqlite3 driver a `Field.datetime` column is stored as an INTEGER
     * epoch (ms), so `col >= '2025-06-18'` is a TEXT-vs-INTEGER affinity compare
     * that is *always false* → empty result (the silent "No rows" bug). This hook
     * lets the strategy ask the driver for the storage-correct value instead.
     *
     * Driver/dialect correctness lives entirely behind this hook (single source of
     * truth = the driver):
     *   - SQLite `Field.datetime`           → epoch milliseconds (number).
     *   - `Field.date` (any dialect)        → `YYYY-MM-DD` text.
     *   - native-timestamp dialects (Postgres/MySQL) and non-temporal fields →
     *     the value is returned UNCHANGED, so the already-correct text/timestamp
     *     comparison is preserved and Postgres is never given an epoch integer.
     *
     * When the hook is absent (legacy wiring, non-SQL drivers) the strategy binds
     * the value as-is — exactly today's behaviour — so it is purely additive.
     *
     * @param objectName Logical object / table backing the cube.
     * @param fieldName  Bare column name the filter targets.
     * @param value      The stringified comparand from the normalized filter.
     */
    coerceTemporalFilterValue?(objectName: string, fieldName: string, value: unknown): unknown;

    /**
     * The companion of {@link StrategyContext.coerceTemporalFilterValue} for the
     * LEFT side of the same comparison: given the SQL the strategy was going to
     * emit for the column (an already-quoted, possibly alias-qualified reference),
     * return the SQL it must emit instead so the column reads in the same storage
     * form the coerced comparand is in.
     *
     * Why coercing the value alone is not enough: a SQLite `Field.datetime` column
     * is MIXED-form in practice. A JS `Date` binds as an INTEGER epoch, but a REST
     * / JSON write carries an ISO string (JSON has no `Date`) and a `NOW()` default
     * — including the platform's own `created_at` / `updated_at` stamps — lands as
     * ISO TEXT. Coercing the comparand to epoch ms therefore fixes the INTEGER rows
     * and breaks the TEXT ones, which is why a dashboard `dateRange: last_30_days`
     * still read 0 while the rows existed (#3912). The driver answers with an
     * expression that normalises whatever is stored, so both halves match.
     *
     * Everything else — `Field.date`, native-timestamp dialects, non-temporal
     * columns — gets `columnSql` back verbatim, and when the hook is absent the
     * strategy emits the bare column exactly as before, so it is purely additive.
     *
     * @param objectName Logical object / table backing the cube.
     * @param fieldName  Bare column name the filter targets.
     * @param columnSql  The SQL reference the strategy resolved for that column.
     */
    coerceTemporalFilterColumn?(objectName: string, fieldName: string, columnSql: string): string;

    /**
     * ADR-0062 D6 — is `objectName` a federated (external-datasource) object?
     *
     * The `NativeSQLStrategy` compiles its own `FROM "<object>"` and column
     * references, which bypass the driver's physical-table resolution and so
     * would query the WRONG table for a federated object whose `external.remoteName`
     * / `remoteSchema` / `columnMap` differ from the logical object/field names.
     * Until native-SQL learns the driver's physical resolution, the strategy
     * DECLINES external objects (see its `canHandle`), so they fall through to the
     * ObjectQL aggregate path — which routes through the driver's `getBuilder`
     * (honouring `remoteName`/`remoteSchema`, #2138/#2149). This keeps external
     * analytics correct ("reuse the driver's resolution") rather than silently
     * querying the wrong table.
     *
     * Returns `true` for a federated object, `false`/`undefined` otherwise. When
     * the hook is absent (legacy wiring) the strategy assumes non-external —
     * purely additive, no behavior change for managed objects.
     */
    isExternalObject?(objectName: string): boolean;
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
