// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Strategy pattern types — re-exported from @objectstack/spec/contracts
 * for convenience. The canonical definitions live in the spec package.
 *
 * [#4538] `DriverCapabilities` → `AnalyticsDriverCapabilities`: the old name
 * belonged to the data domain's driver feature-flag record
 * (`DriverCapabilitiesSchema` — every `IDataDriver.supports`); the analytics
 * execution-path trio was renamed with its spec declaration.
 */
export type {
  AnalyticsStrategy,
  StrategyContext,
  AnalyticsDriverCapabilities,
} from '@objectstack/spec/contracts';

import type { FilterCondition, FixedReadLeaf, ValueShapeFieldDef } from '@objectstack/spec/data';
import type { IObjectQLEngine, StrategyContext } from '@objectstack/spec/contracts';
import type { DATASET_DURATION_AGGREGATES, DatasetDurationUnit } from '@objectstack/spec/ui';

/**
 * [#19995] The engine's judge-only `where` admission, as the contract declares
 * it: `IObjectQLEngine.judgeFilter` (#20157). Derived from the contract rather
 * than re-declared, so a change to the member's signature reaches this
 * package's hook as a compile error instead of as drift (#4251).
 */
type EngineJudgeFilter = NonNullable<IObjectQLEngine['judgeFilter']>;

/**
 * [ADR-0155 D4] The answer {@link DatasetScopedStrategyContext.fixedReadLeafClassOf}
 * gives: the class a leaf falls in (`'other-datasource'` or
 * `'registration-by-name'`, with what names it), `null` for neither, or
 * `undefined` when the host cannot say.
 */
export type FixedReadLeafClassAnswer =
  | { readonly class: 'other-datasource' | 'registration-by-name' }
  | null
  | undefined;

/**
 * [#19995] A host's answer to "would the ENGINE admit this `where`?": the
 * engine's own verdict, or `undefined` when the host cannot answer. The
 * arguments are `judgeFilter`'s own; only the `undefined` answer is added,
 * which is this package's "cannot answer, do not block" tier.
 */
export type ReadScopeFilterJudge = (
  ...args: Parameters<EngineJudgeFilter>
) => ReturnType<EngineJudgeFilter> | undefined;

/**
 * The semantic scope a compiled DATASET carries beside its Cube (#10298).
 *
 * `compileDataset` splits a dataset into two halves: the parts the Cube model
 * can express (measures, dimensions, joins) and the parts it cannot — the
 * dataset's definition-level `filter` and each measure's own scoped `filter`.
 * Until #10298 the second half was read by `DatasetExecutor` alone, so the
 * dashboard door applied it and the strict `/api/v1/analytics/query` door —
 * which addresses the registered Cube directly and never touches the executor
 * — silently answered UNFILTERED aggregates under the same measure names, for
 * the same cube. Two doors, two numbers.
 *
 * This is the channel that carries the missing half to the strategy, so both
 * doors compile the same declaration. It is deliberately declared HERE rather
 * than on the spec's {@link StrategyContext}: the analytics package builds the
 * context object it hands its own strategies, and nothing about this channel
 * is an authorable surface — no metadata key, no wire shape, no error code —
 * so widening the published contract would buy nothing and cost a spec edit.
 * A strategy that does not know the hook keeps the behaviour it had.
 *
 * Every member is optional and tiered "cannot answer, do not block": a cube
 * that is not a compiled dataset (an inferred cube, a manifest cube) answers
 * `undefined` and compiles exactly as it did before.
 */
export interface DatasetScope {
  /** The dataset's definition-level filter — its intrinsic scope. */
  filter?: FilterCondition;
  /** Per-measure scoped filters, keyed by measure name. */
  measureFilters?: Record<string, FilterCondition>;
  /**
   * [#25778] The dataset's duration measures, keyed by measure name — the
   * second half of a compiled dataset the Cube cannot carry. A cube metric
   * names ONE column; a duration reads two, so a duration measure is
   * deliberately ABSENT from `cube.measures` and present here only.
   *
   * Absent rather than approximated, so it fails closed: a reader that does
   * not know this channel finds no such measure and refuses it (`INVALID_FIELD`
   * / 400), where a cube metric standing in for it (an aggregate over one of
   * its columns) would have answered an instant, or the average year (#16737),
   * under the duration's name. The readers that DO serve it: the native-SQL
   * strategy (`duration-measure-sql.ts`), the draft-preview evaluator, and the
   * service's own gates (the field-level read gate, the measure mint, the
   * strategy-route refusal).
   */
  measureDurations?: Record<string, DurationMeasureSpec>;
}

/**
 * [#25778] One compiled duration measure: the time from `from` to `to` — two
 * `datetime` columns of the dataset's base object — on each record, in `unit`,
 * reduced by `aggregate`. The dataset's `duration` key (`@objectstack/spec/ui`,
 * `DatasetMeasureDurationSchema`) with the measure's aggregate beside it.
 */
export interface DurationMeasureSpec {
  aggregate: (typeof DATASET_DURATION_AGGREGATES)[number];
  from: string;
  to: string;
  unit: DatasetDurationUnit;
  /**
   * Display only, read by the discovery surface (`AnalyticsService.getMeta`),
   * which lists the measure though the cube does not carry it: the measure's
   * resolved `label` and its `format`. No strategy reads either.
   */
  label?: string;
  format?: string;
}

/** A {@link StrategyContext} that can answer for a compiled dataset (#10298). */
export interface DatasetScopedStrategyContext extends StrategyContext {
  getDatasetScope?(cubeName: string): DatasetScope | undefined;
  /**
   * [#20933] Every object whose read scope `getReadScope` answers for this
   * query — `AnalyticsService.queryObjects`, the one set the object-level
   * admission read: the base object, every join the cube declares, and every
   * object a member reaches through a relationship path.
   *
   * For a strategy that must look at the scopes BEFORE it compiles, so it reads
   * them over the set the door scoped instead of re-deriving which objects the
   * query reads. `undefined` when the context carries no read scope at all.
   * Declared HERE rather than on the spec's {@link StrategyContext} for the
   * reason `getDatasetScope` is: nothing about it is an authorable surface.
   */
  readScopedObjects?: readonly string[];
  /**
   * [#20986] The object `field` on `objectName` DECLARES as its target — a
   * relationship field's `reference` — or `undefined` when the host cannot
   * answer (no resolver wired, a field it does not know, a field that names
   * no target).
   *
   * Tier 2 of the one hop resolver (`hop-object.ts`), which every strategy
   * reads to name the object a relationship-path hop with no declared join
   * reaches: the table it joins, the read scope it applies to that join, the
   * object it reads the related value from. `AnalyticsService` hands its
   * strategies the SAME function its field gate and its admitted and scoped
   * set resolve hops with, so the object a strategy joins is the object the
   * door admitted. Declared HERE rather than on the spec's
   * {@link StrategyContext} for the reason `getDatasetScope` is: nothing about
   * it is an authorable surface. Absent, a hop reads the object named after
   * the relationship — the behaviour a strategy had before it knew the hook.
   */
  relationshipReference?(objectName: string, field: string): string | undefined;
  /**
   * [#14079] The DECLARED type of `field` on `objectName` — `'number'`,
   * `'boolean'`, `'text'`, … — or `undefined` when the host cannot answer (no
   * data engine wired, an object or field it does not know).
   *
   * The one question this package's three SQL compilers cannot answer from
   * the filter alone: a text operator aimed at a column whose STORED value is
   * never text (`NON_TEXT_STORED_VALUE_TYPES`, `@objectstack/spec`) compiles
   * to the contract's constant — `1 = 0` for a positive operator, `1 = 1` for
   * `$notContains` — instead of a `LIKE` that coerces on SQLite and is
   * refused at query time on Postgres (SQLSTATE 42883, a 500). The service
   * answers it from `AnalyticsServiceConfig.sourceFieldMeta`, the same hook
   * the result-column display chains read. Declared HERE rather than on the
   * spec's {@link StrategyContext} for the reason `getDatasetScope` is: nothing
   * about it is an authorable surface, and a strategy that does not know the
   * hook keeps the behaviour it had — "cannot answer, do not block".
   */
  declaredFieldType?(objectName: string, field: string): string | undefined;
  /**
   * [#20445] The DECLARED value shape of `field` on `objectName` — its type
   * and, for a multi-capable type, `multiple` — or `undefined` when the host
   * cannot answer (no data engine wired, an object or field it does not know).
   *
   * The question the `$empty` operator turns on: what counts as empty is the
   * field's row of the ruled per-type table, which `expandEmptyOperator`
   * (`@objectstack/spec/data`) reads off exactly this shape, and the type
   * alone cannot answer it (a `lookup` is null-only, a `lookup` with
   * `multiple: true` is list-valued). Answered from the same
   * `AnalyticsServiceConfig.sourceFieldMeta` hook `declaredFieldType` reads.
   * Unlike that hook's text-operator rule, a compiler that gets no answer
   * REFUSES the operator rather than keeping an older behaviour: there is no
   * declaration-free SQL for it (`empty-operator-sql.ts` says why).
   */
  declaredValueShape?(objectName: string, field: string): ValueShapeFieldDef | undefined;
  /**
   * [#15684] The SQL dialect of the datasource backing `objectName` —
   * `'sqlite'` / `'postgres'` / `'mysql'`, or `undefined` when the host cannot
   * answer (no data engine wired, a non-SQL driver, a client neither side
   * models).
   *
   * The second question this package's three SQL compilers cannot answer from
   * the filter alone. The case-EXACT text family (`$contains` /
   * `$notContains` / `$startsWith` / `$endsWith`, #4706 Q2 = A) has no single
   * construct that is case-exact AND parses on every dialect: SQLite's `LIKE`
   * folds ASCII unconditionally and needs `GLOB`, MySQL follows the column's
   * collation and needs `CAST(… AS BINARY)`, and both of those are errors on
   * Postgres — where `LIKE` is already exactly the ruled semantics. So the
   * construct is chosen per dialect (`text-match-sql.ts`), and the dialect is
   * an input rather than a guess.
   *
   * The service answers it from `AnalyticsServiceConfig.sqlDialect`, which the
   * plugin fills from the driver that will EXECUTE the statement — the driver
   * stays the single source of truth for its own dialect, the same posture
   * `coerceTemporalFilterColumn` takes. Declared HERE rather than on the
   * spec's {@link StrategyContext} for the reason `declaredFieldType` is:
   * nothing about it is an authorable surface, and a strategy that does not
   * know the hook keeps the behaviour it had — "cannot answer, do not block".
   */
  sqlDialect?(objectName: string): string | undefined;
  /**
   * [#21441] The date-bucket expression the driver backing `objectName`
   * groups `field` by at `granularity`, as SQL text in that driver's dialect:
   * `strftime('%Y-%m', …)` on SQLite, `to_char(…, 'YYYY-MM')` on PostgreSQL
   * (over `(col)::timestamptz AT TIME ZONE 'UTC'` for a `datetime`, and
   * `(col)::date::timestamp` for a `date` since #21485). `undefined` when the
   * host cannot answer: no hook wired, a driver with no bucket expression (a
   * non-SQL driver), or a SQL client that driver does not model.
   *
   * `ObjectQLStrategy.generateSql` prints a date-bucketed dimension in this
   * expression, so its echo runs on that dialect and answers the face's
   * bucket keys. The service answers it from
   * `AnalyticsServiceConfig.dateBucketSql`, which the plugin fills from the
   * driver that EXECUTES the aggregate: the driver stays the single source of
   * its bucketing, the posture `sqlDialect` takes. Declared HERE rather than
   * on the spec's {@link StrategyContext} for the reason `declaredFieldType`
   * is: nothing about it is an authorable surface, and a strategy that does
   * not know the hook keeps the behaviour it had.
   *
   * [#33697] With `timezone` (a resolved IANA area/location name), the zoned
   * expression a driver declaring `supports.zonedDateBucketing` groups by, or
   * `undefined` where the driver buckets no zone. An implementer that does not
   * bucket the zone it is asked for answers `undefined`, never its UTC
   * expression: the echo would print a statement grouped on the wrong calendar.
   */
  dateBucketSql?(objectName: string, field: string, granularity: string, timezone?: string): string | undefined;
  /**
   * [#19995] The ENGINE's own `where` admission verdict for `objectName`,
   * `IObjectQLEngine.judgeFilter` (#20157), or `undefined` when the host
   * cannot answer (no data engine wired, an engine without the member, or an
   * `executeAggregate` this package did not bridge to that engine).
   *
   * The one question the ObjectQL face cannot answer from a read scope alone.
   * The engine refuses some scope shapes through doors that read the object's
   * declared field map: a text operator over a field that never holds a
   * string, a temporal comparand the field's storage rule cannot read, a
   * filter on a virtual field or through a dotted path. Those refusals are
   * the engine's 400, and their message names the policy. So
   * `ObjectQLStrategy` asks the engine about the scope, alone, before it
   * composes it with the caller's filter, and refuses in the withheld
   * `READ_SCOPE_COMPILE_FAILED` / 500 (#5367).
   *
   * `AnalyticsService` answers it from `AnalyticsServiceConfig.judgeFilter`,
   * which `AnalyticsServicePlugin` fills from the data engine its own
   * `executeAggregate` auto-bridge executes on, so the judge is the executor.
   * Declared HERE rather than on the spec's {@link StrategyContext} for the
   * reason `declaredFieldType` is: nothing about it is an authorable surface,
   * and a strategy that does not know the hook keeps the behaviour it had.
   * "Cannot answer, do not block".
   */
  judgeFilter?: ReadScopeFilterJudge;
  /**
   * [#21080] Does the data engine hold a middleware registered FOR
   * `objectName` — `IObjectQLEngine.hasObjectMiddleware` — or `undefined` when
   * the host cannot say (no data engine, or an engine without the member)?
   *
   * The engine's object-keyed middlewares include read gates (the comment,
   * activity and attachment gates, the approval snapshot redaction). They run
   * on every engine operation, and `NativeSQLStrategy` runs none: it executes
   * raw SQL through the driver. So that strategy declines a query that reads
   * an object this answers `true` for, and the engine path serves it with the
   * caller's context. Unlike the hooks above, an `undefined` answer DECLINES
   * too: a read gate this strategy cannot see is not a gate it may skip.
   *
   * `AnalyticsService` passes through `AnalyticsServiceConfig.hasObjectMiddleware`,
   * which `AnalyticsServicePlugin` fills from the data engine. Declared HERE
   * rather than on the spec's {@link StrategyContext} for the reason
   * `getDatasetScope` is: nothing about it is an authorable surface. A context
   * built without the hook asks nothing, and the strategy keeps the behaviour
   * it had.
   */
  hasObjectMiddleware?(objectName: string): boolean | undefined;
  /**
   * [ADR-0155 D4, plan step 5] The engine seam's recognition of D4's two
   * classes for a fixed-read leaf (`SharedRecordIds`) a read scope carries
   * (`@objectstack/objectql`'s `fixedReadLeafClassOfEngine`): an object naming
   * the class when the leaf's object is bound to another datasource than its
   * inner table, or a middleware or find hook is registered for that table by
   * name; `null` when neither applies; `undefined` when the host cannot say.
   *
   * `NativeSQLStrategy` compiles the leaf itself (Q2 as ruled), so it asks this
   * before it compiles and declines a query to the ObjectQL strategy on a
   * class, and on `undefined` too: a class it cannot see is not one it may
   * read around. The engine's seam then gives the class its answer. ⛔ No
   * second copy of either class in this package.
   *
   * `AnalyticsService` passes through `AnalyticsServiceConfig.fixedReadLeafClassOf`.
   * Declared HERE for the reason `getDatasetScope` is: nothing about it is an
   * authorable surface. A context built without the hook declines every scope
   * that carries the leaf.
   */
  fixedReadLeafClassOf?(leaf: FixedReadLeaf): FixedReadLeafClassAnswer;
  /**
   * [ADR-0155 D4] Where this service logs a fixed-read leaf its read-scope
   * compiler or merges refuse, once per evaluator (`read-scope-sql.ts`'s
   * `FixedReadLeafRefusalSink`). Absent, the refusal is thrown unlogged.
   */
  fixedReadLeafRefusal?: { readonly log: { error?(message: string): void; warn(message: string): void } | undefined; readonly state: { logged: boolean } };
  /**
   * The data engine's aggregate of `objectName`, grouped ALSO by attributes of
   * related records (one {@link RelationGroupAggregateRelation} per relation),
   * which a SQL driver answers as one `LEFT JOIN … GROUP BY` — or `undefined`
   * when the host cannot run it (no data engine bridged by this package).
   *
   * `ObjectQLStrategy` serves a cross-object dimension through it first, and
   * by its FK-expand (`resolveFkAttr`, an `id IN (…)` read of the related
   * object) only when this is absent or answers `joined: false`: the engine
   * declines every read it cannot prove is the FK-expand's own read as one
   * statement (a driver that compiles no join — memory, Turso — among
   * them), before it reads anything the strategy's path reads again. On a
   * driver that compiles no semi-join at all (MongoDB, OData) it answers a
   * `refusal` the strategy throws: no path serves the dimension there.
   *
   * `AnalyticsServicePlugin` wires it only when it bridges `executeAggregate`
   * itself, to the same engine. Declared HERE rather than on the spec's
   * {@link StrategyContext} for the reason `getDatasetScope` is: nothing about
   * it is an authorable surface.
   */
  executeRelationGroupAggregate?(
    objectName: string,
    options: Parameters<NonNullable<StrategyContext['executeAggregate']>>[1],
    relations: readonly RelationGroupAggregateRelation[],
  ): Promise<RelationGroupAggregateAnswer>;
  /**
   * The data engine's aggregate of `objectName` ordered by `cut.orderBy` (the
   * aggregated row's columns), cut to `cut.limit` groups and counted before
   * the cut, all in the driver's own statement (objectql
   * `aggregate-order-cut.ts`) — or `undefined` when the host cannot run it.
   *
   * `ObjectQLStrategy` reads a top-N through it first. The request is
   * declinable: where the engine cannot serve the cut (a driver that compiles
   * none, an aggregate it computes in memory, a `having`) it reads nothing and
   * answers `served: false`, and the strategy reads every group and cuts in
   * memory, as before. `AnalyticsServicePlugin` wires it only when it bridges
   * `executeAggregate` itself, to the same engine. Declared HERE rather than on
   * the spec's {@link StrategyContext} for the reason `getDatasetScope` is:
   * nothing about it is an authorable surface.
   */
  executeOrderCutAggregate?(
    objectName: string,
    options: Parameters<NonNullable<StrategyContext['executeAggregate']>>[1],
    cut: OrderCutAggregateRequest,
  ): Promise<OrderCutAggregateAnswer>;
}

/** The order and cut a {@link DatasetScopedStrategyContext.executeOrderCutAggregate} asks of the engine. */
export interface OrderCutAggregateRequest {
  /** Aggregated-row columns (a group key's column, a measure's alias), in priority order. */
  readonly orderBy: ReadonlyArray<{ readonly field: string; readonly order: 'asc' | 'desc' }>;
  /** The most groups to answer, 1 or more. */
  readonly limit: number;
}

/** The engine's answer: the cut rows and the count of groups before the cut, or why it declined (nothing read). */
export type OrderCutAggregateAnswer =
  | { readonly served: true; readonly rows: Record<string, unknown>[]; readonly totalGroups: number }
  | { readonly served: false; readonly reason: string };

/** One relation a {@link DatasetScopedStrategyContext.executeRelationGroupAggregate} groups through. */
export interface RelationGroupAggregateRelation {
  /** The single-valued relation (FK) field of the aggregated object. */
  readonly field: string;
  /** The object it references (the hop the door admitted and scoped). */
  readonly object: string;
  /** The caller's read scope of `object`, judged and marked as at `resolveFkAttr`. */
  readonly where?: Record<string, unknown>;
  /** Each related attribute, and the output column it answers under. */
  readonly attrs: ReadonlyArray<{ readonly attr: string; readonly alias: string }>;
  /** The output column: `1` where a readable related record joined, `0` where none did. */
  readonly resolvedAlias: string;
}

/**
 * The engine's answer: the grouped rows, or why it declined (the rows path
 * then serves). [#33876] `refusal`: the read's driver compiles no semi-join
 * (no `DriverCapabilities.readableIdsLeaf` bit: MongoDB, OData), so the
 * dimension is served on NO path — the strategy throws it, `INVALID_QUERY` /
 * 400, instead of falling back to its FK-expand.
 */
export type RelationGroupAggregateAnswer =
  | { readonly joined: true; readonly rows: Record<string, unknown>[] }
  | { readonly joined: false; readonly reason: string; readonly refusal?: Error };
