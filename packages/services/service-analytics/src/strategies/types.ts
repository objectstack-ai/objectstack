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

import type { FilterCondition, ValueShapeFieldDef } from '@objectstack/spec/data';
import type { IObjectQLEngine, StrategyContext } from '@objectstack/spec/contracts';

/**
 * [#19995] The engine's judge-only `where` admission, as the contract declares
 * it: `IObjectQLEngine.judgeFilter` (#20157). Derived from the contract rather
 * than re-declared, so a change to the member's signature reaches this
 * package's hook as a compile error instead of as drift (#4251).
 */
type EngineJudgeFilter = NonNullable<IObjectQLEngine['judgeFilter']>;

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
}

/** A {@link StrategyContext} that can answer for a compiled dataset (#10298). */
export interface DatasetScopedStrategyContext extends StrategyContext {
  getDatasetScope?(cubeName: string): DatasetScope | undefined;
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
}
