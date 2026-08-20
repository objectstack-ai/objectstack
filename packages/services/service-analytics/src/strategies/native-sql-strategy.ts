// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsStrategy, StrategyContext, DatasetScopedStrategyContext } from './types.js';
import {
  lowerAnalyticsWhere,
  normalizeAnalyticsFilterTree,
  toSqlBindValue,
  SQL_CONST_FALSE,
  SQL_CONST_TRUE,
  type NormalizedFilterNode,
} from './filter-normalizer.js';
import { findCrossFieldComparand, findUninterpretableTemporalMember } from '../comparand-shape.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { datasetInvalidError, invalidMemberError } from '../dataset-refusal.js';
import { likePattern, LIKE_ESCAPE_CHAR, asciiLowerSqlExpr, type LikeShape } from '../like-pattern.js';
import { nextUtcCalendarDay } from '@objectstack/core';

/**
 * The SQL wrapper for each aggregate a measure's `type` can name.
 *
 * A table rather than a `switch` so its coverage is *assertable*: the aggregate
 * vocabulary lives in `@objectstack/spec` (`AggregationFunction`), the dataset
 * compiler subtracts whatever it cannot lower (`UNSUPPORTED_AGGREGATES` — empty
 * since #6188 retired its two members, `array_agg` and `string_agg`, from the
 * spec itself), and `aggregation-lockstep.test.ts` checks that what remains is
 * exactly the keys below. A `switch` gave that no purchase — the missing case fell to
 * `default: COUNT(*)`, so an aggregate the spec grew would have returned a row
 * count instead of the number the author asked for, silently. objectui#2945.
 *
 * Non-aggregate metric types (`number`/`string`/`boolean`) are deliberately
 * absent — they are handled by {@link EXPRESSION_METRIC_TYPES}, which emits the
 * author's expression rather than wrapping it.
 */
const AGGREGATE_SQL: Record<string, (col: string) => string> = {
  // [#10298] `count` takes its COLUMN when the measure declares one. The
  // wrapper used to discard `col` and always emit `COUNT(*)`, so a measure
  // written `{ aggregate: 'count', field: 'resolved_by_article' }` counted
  // ROWS instead of non-null values — and a deflection rate built as
  // `kb_resolved_count / closed_count` read 100% where the truth was 12.5%,
  // with the numerator and denominator printed beside it as 8 and 8. `*` is
  // still `COUNT(*)`: the compiler writes `sql: m.field ?? '*'`, so the star
  // IS the "no field declared" spelling and must keep counting rows.
  'count': (col) => (col === '*' ? 'COUNT(*)' : `COUNT(${col})`),
  'sum': (col) => `SUM(${col})`,
  'avg': (col) => `AVG(${col})`,
  'min': (col) => `MIN(${col})`,
  'max': (col) => `MAX(${col})`,
  'count_distinct': (col) => `COUNT(DISTINCT ${col})`,
};

/**
 * The same six aggregates, restricted to the rows a measure's own `filter`
 * admits (#10298).
 *
 * Spelled `CASE WHEN` rather than SQL-standard `FILTER (WHERE …)` on purpose:
 * `FILTER` is Postgres and SQLite ≥ 3.30 only — MySQL has never had it — and
 * this strategy hand-compiles ONE statement for whichever SQL driver owns the
 * object. A portable conditional aggregate is the only form that cannot answer
 * a syntax error on one supported driver and a number on another.
 *
 * `count` over `*` counts a constant, because `COUNT(CASE WHEN p THEN * END)`
 * is not a thing; over a real column it counts that column's non-null values
 * among the admitted rows, which composes the two corrections this card makes.
 *
 * Keyed identically to {@link AGGREGATE_SQL} — `aggregation-lockstep.test.ts`
 * pins the two key sets equal, so an aggregate added to one and not the other
 * fails a test instead of silently losing its measure filter.
 */
const CONDITIONAL_AGGREGATE_SQL: Record<string, (col: string, pred: string) => string> = {
  'count': (col, pred) => `COUNT(CASE WHEN ${pred} THEN ${col === '*' ? '1' : col} END)`,
  'sum': (col, pred) => `SUM(CASE WHEN ${pred} THEN ${col} END)`,
  'avg': (col, pred) => `AVG(CASE WHEN ${pred} THEN ${col} END)`,
  'min': (col, pred) => `MIN(CASE WHEN ${pred} THEN ${col} END)`,
  'max': (col, pred) => `MAX(CASE WHEN ${pred} THEN ${col} END)`,
  'count_distinct': (col, pred) => `COUNT(DISTINCT CASE WHEN ${pred} THEN ${col} END)`,
};

/** Exported for the lockstep guard — the aggregates this strategy can lower. */
export const SUPPORTED_AGGREGATE_SQL_KEYS = Object.keys(AGGREGATE_SQL);

/**
 * Exported for the same guard — the aggregates this strategy can lower WITH a
 * measure-scoped filter (#10298). Equal to {@link SUPPORTED_AGGREGATE_SQL_KEYS}
 * by construction and pinned equal by the lockstep suite: an aggregate present
 * in one table only would silently drop the author's `filter` rather than fail.
 */
export const CONDITIONAL_AGGREGATE_SQL_KEYS = Object.keys(CONDITIONAL_AGGREGATE_SQL);

/**
 * Metric types that are a custom SQL *expression*, not an aggregate to wrap.
 *
 * `AggregationMetricType` (`data/analytics.zod.ts`) documents these three as
 * "Custom SQL expression returning a number / string / boolean" — the measure's
 * `sql` IS the whole computation (a ratio, a `CASE`, a window function), so the
 * only correct emission is the expression itself. They used to fall through to
 * `resolveMeasureSql`'s `COUNT(*)` fallback, which threw the expression away and
 * returned a row count. #4157.
 *
 * Named rather than derived as "everything that is not an aggregate": deriving it
 * would silently classify a *new* aggregate the spec grows (`median`, …) as an
 * expression and emit a bare column. `metric-type-coverage.test.ts` asserts these
 * two sets partition `AggregationMetricType`, so a new member fails a test
 * instead of picking a default.
 */
export const EXPRESSION_METRIC_TYPES = new Set(['number', 'string', 'boolean']);

/**
 * A dot-separated chain of bare identifiers — `amount`, `account.amount`,
 * `account.owner.region`. Distinguishes a relationship PATH, which
 * {@link NativeSQLStrategy.qualifyAndRegisterJoin} lowers into joins, from a SQL
 * expression that merely contains a dot. #4157.
 */
const IDENTIFIER_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * NativeSQLStrategy — Priority 1
 *
 * Pushes the analytics query down to the database as a native SQL statement.
 * This is the most efficient path and is preferred whenever the backing driver
 * supports raw SQL execution (e.g. Postgres, MySQL, SQLite).
 *
 * `resolveMeasureSql` used to answer `COUNT(*)` to three different questions it
 * could not otherwise answer — an undeclared measure, a custom-SQL-expression
 * metric type, and an unrecognised type. All three returned a plausible number
 * for a query that asked for something else. They now emit the expression or
 * throw; see that method. #4157.
 */
export class NativeSQLStrategy implements AnalyticsStrategy {
  readonly name = 'NativeSQLStrategy';
  readonly priority = 10;

  canHandle(query: AnalyticsQuery, ctx: StrategyContext): boolean {
    if (!query.cube) return false;
    // This strategy groups by the raw column expression (`GROUP BY <col>`) and
    // emits no `date_trunc` — it cannot bucket a date dimension to a coarser
    // granularity, nor resolve buckets on a non-UTC calendar. When the query
    // asks for granularity bucketing we therefore DECLINE so the lower-priority
    // ObjectQLStrategy handles it via `engine.aggregate` (native date_trunc when
    // UTC-safe, else uniform in-memory bucketing). Without this, a date-bucketed
    // query silently grouped by the raw timestamp — one bucket per row — and a
    // non-UTC reference timezone was ignored entirely (ADR-0053 Phase 2, #1982).
    if (query.timeDimensions?.some((td) => !!td.granularity)) return false;
    // ADR-0062 D6 — DECLINE federated (external-datasource) objects. This
    // strategy hand-compiles `FROM "<object>"` and bare column references, which
    // bypass the driver's physical-table resolution (`external.remoteName` /
    // `remoteSchema` / `columnMap`) and would query the WRONG table. Routing the
    // query to the lower-priority ObjectQL aggregate path keeps it correct —
    // that path goes through the driver's `getBuilder` (#2138/#2149). Applies to
    // the base object AND any joined object (a join would also hit the wrong
    // table). Until native-SQL learns the driver's resolution, "disabled" beats
    // "silently wrong".
    if (typeof ctx.isExternalObject === 'function') {
      const cube = ctx.getCube(query.cube);
      if (cube) {
        if (ctx.isExternalObject(this.extractObjectName(cube))) return false;
        const joinTargets = cube.joins ? Object.values(cube.joins) : [];
        for (const j of joinTargets) {
          const joinedObject = (j as { name?: string })?.name;
          if (joinedObject && ctx.isExternalObject(joinedObject)) return false;
        }
      }
    }
    // ── [#7598] DECLINE a `{ $field }` cross-field comparison ───────────────
    //
    // ## The maintainer ruling this implements (2026-08-12, Q1 = B)
    //
    // 「`NativeSQLStrategy.canHandle` 对携带 `$field` 的 `where` / read scope
    //   **decline**,落回 ObjectQL/engine 路径,由 driver 用它自有的 metadata 强制
    //   全部四条 #5222 裁定 —— 安全规则只存在一处,不复制、不新增
    //   `StrategyContext` 钩子、不动 `packages/spec`。⚠️ canHandle 依据 filter
    //   内容路由是新行为 —— 认可并接受,实现时在 canHandle 处注释记录本裁定。」
    //
    // (Q1 = B; option A — `StrategyContext.getDeclaredFields` / `getTenantColumn`
    // hooks plus a SECOND implementation of the four rulings inside this package
    // — was explicitly rejected: it builds an enumeration surface with no
    // measured consumer, and its fallback when a host omits a hook is either
    // "refuse" or "skip the check", and skipping the check is the defect #7598
    // exists to close. Q2 = A: `read-scope-sql`'s envelope is untouched.)
    //
    // ## What is new here, and why it is sound
    //
    // Every other decline above turns on the query's SHAPE (a granularity, a
    // federated object). This one turns on filter CONTENT, which is new
    // behaviour for `canHandle` — named as such in the ruling and accepted
    // there. It is the same mechanism ADR-0062 D6 already uses one branch up:
    // when this strategy cannot compile something CORRECTLY, routing to the
    // lower-priority ObjectQL path is better than compiling it anyway. What it
    // cannot compile correctly here is a column-to-column comparison, because
    // the four #5222 rulings (same-table columns only, declared-only
    // enumeration, tenant-isolation column forbidden on BOTH sides, same
    // comparison class) each turn on metadata `StrategyContext` does not expose
    // — an object's declared field set, its declared types, its
    // tenant-isolation column. `driver-sql` reads all four out of its own
    // `initObjects` capture, so declining puts the query in front of the one
    // component that can enforce them, instead of enforcing them twice.
    //
    // ## Both inputs, because a read scope is not the caller's `where`
    //
    // The caller's `where` and the RLS read scope are separate producers and
    // either can carry a reference — `compileCelToFilter` emits `{ $field }`
    // for a field-to-field comparison in an ADMIN-authored CEL rule, which is
    // the read-scope half and the one #5041 measured. The scopes of the JOINED
    // objects are read too, for the same reason `generateSql` injects them:
    // `applyReadScope` would compile each of them through `read-scope-sql`.
    //
    // `lowerAnalyticsWhere` rather than `query.where` raw, so the authored
    // ARRAY sugar (`['amount', '=', { $field: 'budget' }]`) is seen after
    // `parseFilterAST` has lowered it (#7597). A THROW from that lowering is
    // not this gate's to answer — the filter is malformed either way and
    // `normalizeAnalyticsFilterTree` refuses it a moment later with the message
    // and envelope it has always had — so it is caught and read as "no
    // reference found".
    if (this.carriesCrossFieldComparison(query, ctx)) return false;
    // ── [#8690] DECLINE an uninterpretable TEMPORAL comparand ───────────────
    //
    // ## The maintainer ruling this implements (2026-08-15, option B)
    //
    // > refuse the uninterpretable temporal comparand at the ObjectQL engine's
    // > single filter collection point … Includes the measured gap:
    // > `NativeSQLStrategy.canHandle` must **decline** an uninterpretable
    // > temporal comparand so raw-SQL paths fall through to the engine door.
    //
    // The refusal itself is NOT here and must not be: judging "can this column
    // read this comparand" needs the field's declared TYPE, which only the
    // engine's filter collection point holds (this package depends on no
    // driver and carries no field map). What is here is the ROUTING half —
    // without it a raw-SQL deployment binds `WHERE col >= 'last_30_days'`
    // directly, never reaches the door, and keeps answering 200 with zero rows.
    //
    // Same mechanism, same direction, as the two declines above and the #7598
    // one below it: when this strategy cannot serve something CORRECTLY,
    // routing to the lower-priority ObjectQL path beats compiling it anyway.
    // Content-based rather than shape-based, which #7598's ruling already
    // named as new-but-accepted behaviour for `canHandle`.
    //
    // ⚠️ Deliberately NO fail-closed backstop at the emitter, unlike #7598's.
    // There the routing gate's failure mode was a NEW wrong answer (a bound
    // `{"$field":…}` object); here a missed decline degrades to exactly
    // today's behaviour, and a throw at the emitter would answer 500 for a
    // filter the engine door answers 400 for — two envelopes for one mistake,
    // which is the drift this card exists to remove.
    if (this.carriesUninterpretableTemporalComparand(query, ctx)) return false;
    const caps = ctx.queryCapabilities(query.cube);
    return caps.nativeSql && typeof ctx.executeRawSql === 'function';
  }

  /**
   * [#8690] Does the query's `where` compare a declared TIME dimension against
   * a value no temporal storage rule can read? See the ruling at
   * {@link canHandle}.
   *
   * The classification comes from the CUBE, the only metadata this package has:
   * a dimension declares `type: 'time'` (compiled from the dataset dimension's
   * `type: 'date'`), and {@link lookupMember} is the same resolution every other
   * member lookup in this strategy uses, so "the member the gate classified"
   * and "the member the compiler emits" cannot drift apart.
   *
   * A `time` dimension is read with the DATETIME rule — the permissive one of
   * the three. That is the right direction because this is a routing decision,
   * not a verdict: the engine door re-judges with the field's real declared
   * type and has the final say, so under-classifying an exotic spelling merely
   * leaves today's behaviour, while over-classifying would silently move a
   * working dashboard off the fast path. The comparands this card measured
   * (`last_30_days`, `not-a-date-at-all`) are unreadable under all three rules,
   * so the decline fires for them whichever backing type the dimension has.
   *
   * `lowerAnalyticsWhere` rather than `query.where` raw, so the authored ARRAY
   * sugar is seen after `parseFilterAST` has lowered it; a THROW from that
   * lowering is not this gate's to answer — the filter is malformed either way
   * and `normalizeAnalyticsFilterTree` refuses it a moment later with the
   * message and envelope it has always had.
   */
  private carriesUninterpretableTemporalComparand(
    query: AnalyticsQuery,
    ctx: StrategyContext,
  ): boolean {
    const cube = query.cube ? ctx.getCube(query.cube) : undefined;
    if (!cube) return false;
    let where: unknown = null;
    try {
      where = lowerAnalyticsWhere(query);
    } catch {
      return false;
    }
    if (!where) return false;
    return findUninterpretableTemporalMember(
      where,
      (member) => (this.lookupMember(cube, member, 'dimension')?.type === 'time' ? 'datetime' : null),
    ) !== null;
  }

  /**
   * [#7598] Does serving this query require the cross-field capability this
   * strategy declines? See the ruling recorded at {@link canHandle}.
   *
   * ⚠️ This and {@link assertNoCrossFieldComparison} read the SAME inputs
   * through the SAME detector, which is what makes the decline and the
   * fail-closed backstop unable to drift: a shape one of them recognises is a
   * shape the other recognises.
   */
  private carriesCrossFieldComparison(query: AnalyticsQuery, ctx: StrategyContext): boolean {
    return this.crossFieldComparisonIn(query, ctx) !== null;
  }

  private crossFieldComparisonIn(
    query: AnalyticsQuery,
    ctx: StrategyContext,
  ): { source: string; op: string; field: string; ref: string } | null {
    let where: unknown = null;
    try {
      where = lowerAnalyticsWhere(query);
    } catch {
      // A `where` this compiler cannot even lower is refused downstream, with
      // its own message. Nothing to route.
      return null;
    }
    const inWhere = findCrossFieldComparand(where);
    if (inWhere) return { source: 'the query\'s `where`', ...inWhere };

    if (typeof ctx.getReadScope !== 'function') return null;
    const cube = query.cube ? ctx.getCube(query.cube) : undefined;
    if (!cube) return null;
    const objects = [this.extractObjectName(cube)];
    for (const alias of Object.keys(cube.joins ?? {})) {
      objects.push(cube.joins?.[alias]?.name ?? alias);
    }
    for (const objectName of objects) {
      const scope = ctx.getReadScope(objectName);
      if (scope === undefined || scope === null) continue;
      const inScope = findCrossFieldComparand(scope);
      if (inScope) return { source: `the read scope of "${objectName}"`, ...inScope };
    }
    return null;
  }

  /**
   * [#7598] The fail-closed backstop at the door that BINDS.
   *
   * ⚠️ **Unreachable by construction, and kept deliberately** — saying so
   * because #7598's brief asks that a refusal arm which has become unreachable
   * be named rather than left to be re-discovered. {@link canHandle} declines
   * every query this would fire on, and it declines using
   * {@link crossFieldComparisonIn} — the same walk over the same two inputs —
   * so `resolveStrategy` cannot hand this strategy a query carrying one.
   *
   * It is kept because of what the failure mode is if that ever stops being
   * true. The defect #7598 measured was not a missing error: it was a SILENT
   * BIND — `toSqlBindValue` JSON-stringifies the reference object, so the
   * statement compiled perfectly and compared a column against the text
   * `{"$field":"budget"}`, a value no row can hold. A routing gate that misses
   * a shape therefore degrades to a wrong ANSWER rather than to an error, and
   * that is the one class this package refuses to leave to a single guard
   * (Prime Directive #12 — refuse at the door, do not tolerate at the
   * consumer). One line, no measurable cost, and it turns a routing regression
   * into a loud refusal instead of an empty chart.
   *
   * Deliberately BARE — an undeclared 500, not `INVALID_FILTER` / 400 — for the
   * reason `buildFilterClauseSql`'s #5333 exit in `objectql-strategy.ts` gives
   * for the same class: the caller's filter is legal and is served on the
   * engine path, so an arrival here is drift between our own routing gate and
   * our own emitter. Billing the caller 400 for that would hide a platform bug
   * from 5xx alerting and tell a dashboard user to fix a filter that is fine.
   * Same tier as `resolveMeasureSql`'s unrecognised-`Metric.type` throw below.
   */
  private assertNoCrossFieldComparison(query: AnalyticsQuery, ctx: StrategyContext): void {
    const hit = this.crossFieldComparisonIn(query, ctx);
    if (!hit) return;
    throw new Error(
      `[native-sql-strategy] ${hit.source} carries a field reference ` +
      `{ "$field": "${hit.ref}" } under "${hit.op}" on "${hit.field}", which this strategy does not ` +
      `compile into a column-to-column comparison — it would BIND the reference object as the ` +
      `comparison's value and answer a wrong row set silently (#7598). \`canHandle\` declines such a ` +
      `query so it routes to the ObjectQL/engine path, whose driver compiles it and enforces the ` +
      `#5222 rulings with metadata it owns; reaching this throw means the decline and this emitter ` +
      `stopped agreeing, which is our bug and must never degrade to a silent answer.`,
    );
  }

  async execute(query: AnalyticsQuery, ctx: StrategyContext): Promise<AnalyticsResult> {
    const { sql, params } = await this.generateSql(query, ctx);
    const cube = ctx.getCube(query.cube!)!;
    const objectName = this.extractObjectName(cube);

    const rows = await ctx.executeRawSql!(objectName, sql, params);

    // Build field metadata
    const fields = this.buildFieldMeta(query, cube);

    return { rows, fields, sql };
  }

  async generateSql(query: AnalyticsQuery, ctx: StrategyContext): Promise<{ sql: string; params: unknown[] }> {
    const cube = ctx.getCube(query.cube!);
    if (!cube) {
      throw new Error(`Cube not found: ${query.cube}`);
    }

    // [#7598] Unreachable by construction — `canHandle` declined this query.
    // See {@link assertNoCrossFieldComparison} for why it is asserted anyway.
    this.assertNoCrossFieldComparison(query, ctx);

    const params: unknown[] = [];
    const selectClauses: string[] = [];
    const groupByClauses: string[] = [];
    const tableName = this.extractObjectName(cube);
    // Map of relation alias → JOIN clause. Populated lazily as dotted
    // dimensions/measures/filters are resolved.
    const joins = new Map<string, string>();

    // Build SELECT for dimensions
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const colExpr = this.resolveDimensionSql(cube, dim, tableName, joins);
        selectClauses.push(`${colExpr} AS "${dim}"`);
        groupByClauses.push(colExpr);
      }
    }

    // ── #10298 — the half of a compiled dataset the Cube cannot carry ──────
    // A dataset's definition-level `filter` and each measure's own scoped
    // `filter` live beside the Cube, in the dataset registry. `DatasetExecutor`
    // read them; this strategy did not — so `/api/v1/analytics/query`, which
    // addresses the registered Cube directly, answered UNFILTERED aggregates
    // under the author's measure names while the dashboard answered filtered
    // ones, for the same cube. `undefined` for any cube that is not a compiled
    // dataset, which is why an inferred or manifest cube compiles unchanged.
    const datasetScope = (ctx as DatasetScopedStrategyContext).getDatasetScope?.(query.cube!);

    // Build SELECT for measures
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        // The measure's own filter becomes a CONDITIONAL aggregate rather than
        // a `WHERE` conjunct: the statement carries several measures at once and
        // a `WHERE` would narrow ALL of them. Compiled here, inside the SELECT
        // loop, so its bound values are pushed onto `params` in the order the
        // placeholders appear in the statement — the SELECT list precedes the
        // WHERE clause, and `$n` is positional.
        const measureFilter = datasetScope?.measureFilters?.[measure];
        const predicate = measureFilter
          ? this.compileFilterNode(
              normalizeAnalyticsFilterTree({ where: measureFilter }),
              cube,
              tableName,
              joins,
              params,
              ctx,
            )
          : null;
        const aggExpr = this.resolveMeasureSql(cube, measure, tableName, joins, predicate);
        selectClauses.push(`${aggExpr} AS "${measure}"`);
      }
    }

    // Build WHERE clause. The filter is a TREE, so it compiles recursively —
    // a flat loop can only ever AND, which is precisely why an author's `$or`
    // used to be dropped instead of compiled.
    const whereClauses: string[] = [];
    const filterSql = this.compileFilterNode(
      normalizeAnalyticsFilterTree(query),
      cube,
      tableName,
      joins,
      params,
      ctx,
    );
    if (filterSql) whereClauses.push(filterSql);

    // [#10298] The dataset's OWN scope, for the door that never went through
    // `DatasetExecutor`. Applied as a plain conjunct because it narrows the
    // whole statement — every measure in it — which is exactly what the
    // definition-level filter means. Redundant on the dataset door (the
    // executor already merged it into `where`) and idempotent there: ANDing a
    // predicate with itself selects the same rows.
    if (datasetScope?.filter) {
      const scopeSql = this.compileFilterNode(
        normalizeAnalyticsFilterTree({ where: datasetScope.filter }),
        cube,
        tableName,
        joins,
        params,
        ctx,
      );
      if (scopeSql) whereClauses.push(scopeSql);
    }

    // Build time dimension filters
    if (query.timeDimensions && query.timeDimensions.length > 0) {
      for (const td of query.timeDimensions) {
        const colExpr = this.resolveFieldSql(cube, td.dimension, tableName, joins);
        if (td.dateRange) {
          const range = Array.isArray(td.dateRange) ? td.dateRange : [td.dateRange, td.dateRange];
          if (range.length === 2) {
            // Same epoch-vs-text root cause as buildFilterClause: a dateRange on a
            // SQLite `Field.datetime` column compares ISO TEXT against an INTEGER
            // epoch and matches nothing. Coerce both bounds to the storage form —
            // and normalise the column to that form too, because the column holds
            // BOTH forms at once and coercing only the bounds still empties the
            // half the writer stored the other way (#3912).
            const td2 = this.resolveStorageTarget(cube, td.dimension, tableName);
            const column = this.temporalColumn(ctx, td2, colExpr);
            // A bare-day window end means "through that whole day" (#3777). A
            // BETWEEN's inclusive upper bound anchors a bare `YYYY-MM-DD` to
            // midnight on a datetime column, dropping the final day's rows, so
            // the window compiles half-open — `>= start AND < end+1day` — the
            // same `[gte, lt)` the drill ranges emit. Equivalent to the old
            // BETWEEN for a `date` column (plain `YYYY-MM-DD` ordering), which
            // is what lets this path stay column-type-blind.
            const nextDay = nextUtcCalendarDay(range[1]);
            params.push(this.coerceTemporal(ctx, td2, range[0]));
            const lower = `${column} >= $${params.length}`;
            if (nextDay != null) {
              params.push(this.coerceTemporal(ctx, td2, nextDay));
              whereClauses.push(`(${lower} AND ${column} < $${params.length})`);
            } else {
              params.push(this.coerceTemporal(ctx, td2, range[1]));
              whereClauses.push(`(${lower} AND ${column} <= $${params.length})`);
            }
          }
        }
      }
    }

    // ── ADR-0021 D-C — enforce the join allowlist + inject per-object RLS ──
    // 1. Reject any join not backed by a relationship the dataset declared.
    const allowed = ctx.getAllowedRelationships?.(query.cube!);
    if (allowed) {
      for (const alias of joins.keys()) {
        if (!allowed.has(alias)) {
          // [#5367] `DATASET_INVALID` / 400 — verified caller-shaped before
          // enveloping. Every join in `joins` was registered by
          // `qualifyAndRegisterJoin`, and on the dataset route the only inputs
          // that can register one OUTSIDE the allowlist are the REQUEST's own:
          // `lookupMember`'s synthetic relation fallback mints a dotted
          // dimension nobody declared, so `selection.dimensions`,
          // `selection.timeDimensions` and a `runtimeFilter` member spelled
          // `account.name` each land here. The dataset's OWN dimensions and
          // measures cannot: `compileDataset`'s `assertDeclared` refuses an
          // undeclared relationship path at compile time (also 400
          // `DATASET_INVALID`, so the two agree rather than diverge), and
          // `resolveMeasureSql` has no synthetic fallback at all.
          //
          // The one non-caller trigger is the legacy
          // `config.getAllowedRelationships` hook for hand-authored cubes,
          // where a mismatch is the host's configuration rather than the
          // caller's query. It is unreachable from
          // `/analytics/dataset/query`: `queryDataset` registers the compiled
          // dataset first, so `getAllowedRelationships` answers from
          // `datasetRegistry` and never falls through to the hook.
          throw datasetInvalidError(
            `[NativeSQLStrategy] join "${alias}" is not backed by a declared relationship on ` +
            `cube "${query.cube}". v1 only joins along relationships listed in the dataset's \`include\`.`,
          );
        }
      }
    }
    // 2. Inject the tenant/RLS read scope for the base table AND every joined
    //    object — this is the predicate the raw-SQL path would otherwise skip.
    this.applyReadScope(this.extractObjectName(cube), tableName, ctx, whereClauses, params);
    for (const alias of joins.keys()) {
      // The joined OBJECT (for the RLS lookup) is the target table from the
      // cube's join map; the ALIAS is how it's referenced in SQL. These differ
      // for namespaced objects (alias `account` → object `crm_account`).
      const joinedObject = cube.joins?.[alias]?.name ?? alias;
      this.applyReadScope(joinedObject, alias, ctx, whereClauses, params);
    }

    let sql = `SELECT ${selectClauses.join(', ')} FROM "${tableName}"`;
    if (joins.size > 0) {
      sql += ' ' + Array.from(joins.values()).join(' ');
    }
    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    if (groupByClauses.length > 0) {
      sql += ` GROUP BY ${groupByClauses.join(', ')}`;
    }
    if (query.order && Object.keys(query.order).length > 0) {
      const orderClauses = Object.entries(query.order).map(([f, d]) => `"${f}" ${d.toUpperCase()}`);
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }
    if (query.limit != null) {
      sql += ` LIMIT ${query.limit}`;
    }
    if (query.offset != null) {
      sql += ` OFFSET ${query.offset}`;
    }

    return { sql, params };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * ADR-0021 D-C — inject an object's read scope (tenant + RLS predicate) into
   * the WHERE clause. The scope is a canonical `FilterCondition` (what the
   * RLSCompiler emits); `compileScopedFilterToSql` turns it into alias-qualified,
   * parameterized SQL (fail-closed — it throws rather than drop a predicate).
   * The `?` placeholders are then renumbered into the strategy's `$N` scheme.
   * No-op when the runtime provides no scope hook (the caller is then
   * responsible for isolation — see contract note).
   */
  private applyReadScope(
    objectName: string,
    alias: string,
    ctx: StrategyContext,
    whereClauses: string[],
    params: unknown[],
  ): void {
    if (typeof ctx.getReadScope !== 'function') return;
    const filter = ctx.getReadScope(objectName);
    if (filter === undefined || filter === null) return;
    const { sql, params: scopeParams } = compileScopedFilterToSql(filter, alias);
    if (!sql) return;
    let i = 0;
    const rendered = sql.replace(/\?/g, () => {
      params.push(scopeParams[i++]);
      return `$${params.length}`;
    });
    whereClauses.push(`(${rendered})`);
  }

  /** SQL-safe join alias for a relationship path (dots → `__`); single-segment
   *  paths are unchanged. Mirrors the dataset compiler's `cube.joins` keying so
   *  alias, allowlist, and per-hop RLS all agree on one valid identifier. */
  private joinAlias(path: string): string {
    return path.replace(/\./g, '__');
  }

  /**
   * Resolve a dimension/measure/filter SQL expression that may reference a
   * related table via dot notation (e.g. `account.industry`).
   *
   * A dotted `sql` is a relationship PATH (ADR-0071 multi-hop): every segment
   * but the last is a to-one relationship hop, the last is the column. Each hop
   * synthesises a `LEFT JOIN` aliased by its full path prefix, chained
   * parent→child. The convention (matching the auto-cube generator and
   * ObjectStack object schemas) for a single hop is:
   *
   *   <parentTable>.<lookupField> = <lookupField>.id
   *
   * i.e. the lookup field name on the parent table equals the related
   * table name. This holds for all `Field.lookup({ object: '...' })`
   * declarations where the field is named after its target object.
   *
   * Returns the qualified SQL reference (e.g. `"account"."industry"`).
   * Pure column references (no dot) are returned as-is.
   */
  private qualifyAndRegisterJoin(
    rawSql: string,
    parentTable: string,
    joins: Map<string, string>,
    cube?: Cube,
  ): string {
    if (!rawSql.includes('.')) {
      // Base-table column. When the cube can join other tables, a bare column
      // that also exists on a joined table (e.g. base `status` vs joined
      // `account.status`) makes the SQL engine raise "ambiguous column name".
      // Qualify plain identifiers with the base table; leave SQL expressions
      // and `*` untouched. Single-object cubes (no joins) keep bare columns so
      // their generated SQL is byte-for-byte unchanged.
      const canJoin = !!cube?.joins && Object.keys(cube.joins).length > 0;
      if (canJoin && /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawSql)) {
        return `"${parentTable}"."${rawSql}"`;
      }
      return rawSql;
    }
    // A dot does not by itself mean "relationship path". `SUM(account.amount)`
    // is one SQL EXPRESSION that happens to contain a dot, and splitting it as a
    // path produced `"SUM(account"."amount)"` plus a phantom
    // `LEFT JOIN "SUM(account"` — invalid SQL and a join to a table that does not
    // exist. Only qualify when every segment is a bare identifier; otherwise the
    // author wrote an expression and it is returned as-is. #4157.
    if (!IDENTIFIER_PATH.test(rawSql)) return rawSql;
    // Multi-hop (ADR-0071): the dotted path IS the join chain. Every segment but
    // the last is a relationship hop; the last is the column. The join ALIAS at
    // each hop is the full path PREFIX (`account`, then `account.owner`), which
    // encodes its own parent (the prefix minus its last segment) and FK column
    // (that segment). Register one LEFT JOIN per prefix, chaining parent→child.
    const segments = rawSql.split('.');
    const column = segments[segments.length - 1];
    const hops = segments.slice(0, -1);
    if (hops.length === 0 || !column) return rawSql;
    let parentAlias = parentTable;
    let prefix = '';
    for (const seg of hops) {
      prefix = prefix ? `${prefix}.${seg}` : seg;
      const alias = this.joinAlias(prefix);
      if (!joins.has(alias)) {
        // The joined TABLE is resolved from the Cube's `joins` map (emitted by
        // the dataset compiler, keyed by the same alias); fall back to the alias
        // as the table for legacy/same-name cubes.
        const joinTable = cube?.joins?.[alias]?.name ?? alias;
        // Only emit an explicit alias when the table differs from it; when they
        // match, `LEFT JOIN "account" ON …` is cleaner (and back-compat).
        const tableRef = joinTable === alias ? `"${alias}"` : `"${joinTable}" "${alias}"`;
        joins.set(
          alias,
          `LEFT JOIN ${tableRef} ON "${parentAlias}"."${seg}" = "${alias}"."id"`,
        );
      }
      parentAlias = alias;
    }
    return `"${parentAlias}"."${column}"`;
  }

  /**
   * Resolve a member reference (dimension, measure, or filter field) to its
   * cube definition.
   *
   * Accepts three naming conventions:
   *   1. `<cube>.<field>` — the canonical analytics qualifier (stripped to `<field>`).
   *   2. `<lookup>.<field>` — a relation traversal (e.g. `account.industry`).
   *      First tried as the literal key, then as the underscore-flattened
   *      key (`account_industry`), and finally returned as a synthetic
   *      definition whose `sql` is the dotted reference so the JOIN
   *      machinery can pick it up.
   *   3. `<field>` — a bare field name on the cube's table.
   */
  private lookupMember(
    cube: Cube,
    member: string,
    kind: 'dimension' | 'measure',
  ): { sql: string; type?: string } | undefined {
    const bag = kind === 'dimension' ? cube.dimensions : cube.measures;
    // Direct hit on the registered key (handles `cube.field` and exact dotted keys).
    if (bag[member]) return bag[member];
    if (member.includes('.')) {
      const [first, ...rest] = member.split('.');
      const tail = rest.join('.');
      // `<cube>.<field>` style.
      if (first === cube.name && bag[tail]) return bag[tail];
      // Plain second-segment lookup (legacy behaviour).
      if (bag[tail]) return bag[tail];
      // Underscore-flattened relation lookup (e.g. `account_industry`).
      const flat = member.replace(/\./g, '_');
      if (bag[flat]) return bag[flat];
      // Synthetic relation traversal — let qualifyAndRegisterJoin handle it.
      if (kind === 'dimension') {
        return { sql: member, type: 'string' };
      }
    } else if (bag[member]) {
      return bag[member];
    }
    return undefined;
  }

  private resolveDimensionSql(
    cube: Cube,
    member: string,
    parentTable: string,
    joins: Map<string, string>,
  ): string {
    const dim = this.lookupMember(cube, member, 'dimension');
    const raw = dim ? dim.sql : (member.includes('.') ? member.split('.')[1] : member);
    return this.qualifyAndRegisterJoin(raw, parentTable, joins, cube);
  }

  /**
   * @param predicate - The measure's own scoped filter, already compiled to a
   *   SQL boolean (`null` = the measure declares none, or declares one that
   *   constrains nothing — `compileFilterNode`'s TRUE). #10298.
   */
  private resolveMeasureSql(
    cube: Cube,
    member: string,
    parentTable: string,
    joins: Map<string, string>,
    predicate: string | null = null,
  ): string {
    const measure = this.lookupMember(cube, member, 'measure') as
      | { sql: string; type: string }
      | undefined;
    // `lookupMember`'s synthetic relation fallback is dimension-only, so an
    // undeclared measure name lands here — a typo, or a query naming a metric
    // this cube does not have. It used to return `COUNT(*)`: the caller asked
    // for revenue and got a row count, aliased AS "revenue". #4157.
    if (!measure) {
      const declared = Object.keys(cube.measures ?? {});
      // [#5716] `INVALID_FIELD` / 400, naming the member — the request's
      // `measures` entry is the only input, and #4437's gate already answers
      // exactly this code for the measure one character away (a measure whose
      // SOURCE FIELD the object lacks). Two spellings of "your `measures` entry
      // is wrong" must not get two wire shapes. `DATASET_INVALID` would be wrong
      // on the other face this fires on: `/analytics/query` names a cube, not a
      // dataset.
      throw invalidMemberError(
        `[native-sql-strategy] cube "${cube.name}" declares no measure "${member}"` +
          (declared.length ? ` (declared: ${declared.join(', ')})` : ' (it declares none)'),
        { member, param: 'measures', cube: cube.name },
      );
    }

    const col = measure.sql === '*'
      ? '*'
      : this.qualifyAndRegisterJoin(measure.sql, parentTable, joins, cube);

    if (predicate !== null) {
      const wrapConditional = CONDITIONAL_AGGREGATE_SQL[measure.type];
      if (wrapConditional) return wrapConditional(col, predicate);
      // [#10298] Deliberately BARE — an undeclared 500, same tier and same
      // reasoning as the "unrecognised type" throw below. A measure filter only
      // ever arrives here from a COMPILED DATASET, and `DatasetMeasure.aggregate`
      // is `AggregationFunction`, whose every member is a key of the table
      // above — so an expression metric type (`number`/`string`/`boolean`,
      // where `sql` IS the whole computation and there is no aggregate to make
      // conditional) cannot carry one. What would reach here is our own drift.
      // Emitting the unfiltered aggregate instead is precisely the defect this
      // card closes: a 200 carrying different arithmetic than the author declared.
      throw new Error(
        `[native-sql-strategy] measure "${member}" on cube "${cube.name}" carries a ` +
          `scoped filter, but its type "${measure.type}" has no conditional form ` +
          `(conditional: ${CONDITIONAL_AGGREGATE_SQL_KEYS.join(', ')}).`,
      );
    }

    const wrap = AGGREGATE_SQL[measure.type];
    if (wrap) return wrap(col);
    // A custom SQL expression: the measure's `sql` IS the computation, so emit
    // it unwrapped. In a grouped query the expression must itself be
    // aggregate-shaped — measures never join `GROUP BY` (only dimensions do), so
    // a scalar expression there is invalid SQL. That is the author's contract to
    // keep; silently substituting `COUNT(*)` did not keep it for them.
    if (EXPRESSION_METRIC_TYPES.has(measure.type)) return col;

    // [#5716] Deliberately BARE — an undeclared 500, and the one site on that
    // issue's list of nine that is NOT the author's mistake. `Metric.type` is the
    // CLOSED `AggregationMetricType` enum; `metric-type-coverage.test.ts` pins
    // that {@link AGGREGATE_SQL} ∪ {@link EXPRESSION_METRIC_TYPES} partitions it
    // exactly, `dataset-compiler` only ever writes a `SUPPORTED_AGGREGATES`
    // member into a cube, and `inferMeasure` mints six known types. So no
    // spec-valid cube can arrive here: what does is our own drift or a host
    // registering a cube object that never met `CubeSchema`. Answering the
    // CALLER 400 for that would hide a platform bug from ops alerting and tell a
    // dashboard user to fix metadata they cannot see. Same tier as
    // `dataset-compiler`'s "non-derived measure has no aggregate"; the reasoning
    // is written once in `dataset-refusal.ts`'s header.
    throw new Error(
      `[native-sql-strategy] measure "${member}" on cube "${cube.name}" has ` +
        `unrecognised type "${measure.type}" — expected an aggregate ` +
        `(${SUPPORTED_AGGREGATE_SQL_KEYS.join(', ')}) or a custom-expression type ` +
        `(${[...EXPRESSION_METRIC_TYPES].join(', ')}).`,
    );
  }

  private resolveFieldSql(
    cube: Cube,
    member: string,
    parentTable: string,
    joins: Map<string, string>,
  ): string {
    const dim = this.lookupMember(cube, member, 'dimension');
    if (dim) return this.qualifyAndRegisterJoin(dim.sql, parentTable, joins, cube);
    const measure = this.lookupMember(cube, member, 'measure');
    if (measure) return this.qualifyAndRegisterJoin(measure.sql, parentTable, joins, cube);
    const fieldName = member.includes('.') ? member.split('.')[1] : member;
    return fieldName;
  }

  /**
   * Resolve the (object, column) a filter member binds against, so its
   * comparand can be coerced to that column's on-disk storage form.
   *
   * Mirrors `resolveFieldSql`'s `sql` resolution but yields the *logical*
   * target rather than the qualified SQL:
   *   - A dotted column (`account.region`, emitted for a relation traversal)
   *     belongs to the JOINED object — resolve the alias → target table via the
   *     cube's `joins` map (alias `account` → object `crm_account` when
   *     namespaced) and take the tail as the column.
   *   - Otherwise the column lives on the cube's BASE table. Use the dimension's
   *     resolved `sql` (the real column, which may differ from the member name,
   *     e.g. dimension `assessed` → column `assessed_at`) rather than the member.
   */
  private resolveStorageTarget(
    cube: Cube,
    member: string,
    baseTable: string,
  ): { object: string; field: string } {
    const dim = this.lookupMember(cube, member, 'dimension');
    const measure = dim ? undefined : this.lookupMember(cube, member, 'measure');
    const rawSql = dim?.sql ?? measure?.sql ?? (member.includes('.') ? member.split('.').slice(1).join('.') : member);

    if (rawSql.includes('.')) {
      // Multi-hop (ADR-0071): the column's owning object is the join at the
      // relationship PATH (all segments but the last); the column is the last.
      const segments = rawSql.split('.');
      const field = segments[segments.length - 1];
      const relPath = segments.slice(0, -1).join('.');
      const object = cube.joins?.[this.joinAlias(relPath)]?.name ?? relPath;
      return { object, field };
    }
    return { object: baseTable, field: rawSql };
  }

  /**
   * Apply the storage-form coercion for a single comparand. Prefers the
   * driver-backed `coerceTemporalFilterValue` hook (single source of truth for
   * the date/datetime storage convention — see StrategyContext); when the hook
   * is absent, or returns the value unchanged (the field is not a temporal
   * column, or the dialect stores it as a native timestamp), falls back to
   * {@link toSqlBindValue} so an unbindable JS type still reaches the driver as
   * something it can bind.
   *
   * [#5526] `value` is `unknown`, not `string`, because a leaf now carries the
   * author's comparand at its own type. Both halves of this method were already
   * `unknown`-typed for it: the hook's contract is
   * `coerceTemporalFilterValue(object, field, value: unknown)` and the fallback
   * converts only what a driver cannot bind. What CHANGED is that a string is no
   * longer re-typed on the way out — the fallback used to be
   * `coerceFilterValueForSql`, which read `'007'` as the integer `7`.
   */
  private coerceTemporal(
    ctx: StrategyContext,
    target: { object: string; field: string },
    value: unknown,
  ): unknown {
    if (typeof ctx.coerceTemporalFilterValue === 'function') {
      const coerced = ctx.coerceTemporalFilterValue(target.object, target.field, value);
      // Hook returns the value untouched for non-temporal / native-timestamp
      // columns; only short-circuit when it actually changed the value.
      if (coerced !== value) return coerced;
    }
    return toSqlBindValue(value);
  }

  /**
   * The column side of {@link coerceTemporal}: normalise the reference so it
   * reads in the storage form the comparand was coerced into.
   *
   * A SQLite `Field.datetime` column carries an INTEGER epoch (a `Date` write)
   * and ISO TEXT (a REST/JSON write, a `NOW()` default — including the platform's
   * own `created_at`) at the SAME time, so coercing the value alone fixes one half
   * and empties the other. That is #3912: a `dateRange: last_30_days` on
   * `created_date` read 0 with 29 rows in range. Every other column and dialect
   * gets its reference back verbatim.
   */
  private temporalColumn(
    ctx: StrategyContext,
    target: { object: string; field: string },
    col: string,
  ): string {
    if (typeof ctx.coerceTemporalFilterColumn !== 'function') return col;
    return ctx.coerceTemporalFilterColumn(target.object, target.field, col) || col;
  }

  /**
   * Compile a normalized filter node into a boolean SQL expression, recursing
   * through the combinators. `null` = no constraint.
   *
   * Leaves go through {@link buildFilterClause} exactly as they did when this
   * was a flat loop, so the storage-form coercion and the calendar-day
   * upper-bound rule (#3777) apply at every depth — including inside an `$or`,
   * where a second, combinator-aware implementation would have been free to
   * drift from the first.
   *
   * Parenthesisation is explicit rather than left to SQL's precedence: `AND`
   * does bind tighter than `OR`, so `a AND b OR c` happens to be right, but
   * being right by construction is what keeps a future edit from making it
   * wrong.
   *
   * # `null` is the constant TRUE, and TRUE absorbs a disjunction (#5325)
   *
   * A `null` return means "constrains nothing", which is the boolean TRUE — the
   * AND identity, so it drops out of an `and`, but the OR ABSORBER, so one TRUE
   * disjunct makes the whole `or` TRUE. Filtering it out of an `or` narrowed the
   * query to the surviving branches. `NOT TRUE ≡ FALSE`, so a negation whose
   * operand constrains nothing compiles to the FALSE constant rather than
   * disappearing (which added no `WHERE` and charted every row).
   *
   * # The invariant that keeps `params` aligned
   *
   * **A call that returns `null` leaves `params` exactly as it found it.** It
   * has to: a value bound with no `$n` to consume it shifts every later
   * placeholder onto the wrong value, and a filter that binds the WRONG comparand
   * is worse than one that is merely too wide (#5297). Leaves decide emptiness
   * before they bind, and the absorbing `or` — the one place a clause that HAS
   * bound is discarded — truncates back to the length it started at, so the
   * invariant holds inductively for every node kind.
   */
  private compileFilterNode(
    node: NormalizedFilterNode | null,
    cube: Cube,
    parentTable: string,
    joins: Map<string, string>,
    params: unknown[],
    ctx: StrategyContext,
  ): string | null {
    if (!node) return null;

    if (node.kind === 'const') {
      return node.value ? SQL_CONST_TRUE : SQL_CONST_FALSE;
    }

    if (node.kind === 'leaf') {
      const colExpr = this.resolveFieldSql(cube, node.member, parentTable, joins);
      // Resolve the (object, column) this member binds against so the value
      // can be coerced to the column's storage form (see buildFilterClause).
      const target = this.resolveStorageTarget(cube, node.member, parentTable);
      return this.buildFilterClause(colExpr, node.operator, node.values, params, ctx, target);
    }

    if (node.kind === 'not') {
      const inner = this.compileFilterNode(node.child, cube, parentTable, joins, params, ctx);
      // `NOT TRUE ≡ FALSE`. Returning `null` here is what made `{$not: {}}` emit
      // no `WHERE` at all — a filter meaning "no rows" that showed all of them.
      // The normalizer already folds that case into a `const` node; this arm is
      // the same identity applied to anything else that constrains nothing.
      return inner ? `NOT (${inner})` : SQL_CONST_FALSE;
    }

    // Everything committed before this group, so an absorbed `or` can put both
    // back exactly as they were.
    const paramBase = params.length;
    const joinBase = new Map(joins);
    const parts: string[] = [];
    for (const child of node.children) {
      const clause = this.compileFilterNode(child, cube, parentTable, joins, params, ctx);
      if (clause === null) {
        // TRUE: the AND identity, the OR absorber.
        if (node.kind !== 'or') continue;
        params.length = paramBase;
        joins.clear();
        for (const [alias, clauseSql] of joinBase) joins.set(alias, clauseSql);
        return null;
      }
      parts.push(clause);
    }
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    return `(${parts.join(node.kind === 'or' ? ' OR ' : ' AND ')})`;
  }

  private buildFilterClause(
    rawCol: string,
    operator: string,
    // [#5526] `unknown[]`: the author's comparands, at their own types. Every
    // conversion below is one a BOUNDARY demands — `likePattern` because
    // `filter.zod.ts` declares the LIKE comparand a `string`, `coerceTemporal`
    // because a driver cannot bind every JS type — never a guess about which
    // type a string "really" was.
    values: unknown[] | undefined,
    params: unknown[],
    ctx: StrategyContext,
    target: { object: string; field: string },
  ): string | null {
    const opMap: Record<string, string> = {
      equals: '=', notEquals: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
      contains: 'LIKE', notContains: 'NOT LIKE',
      startsWith: 'LIKE', endsWith: 'LIKE',
      // [#6520] `$icontains` — `LIKE` like its neighbours; what separates it is
      // the ASCII fold applied below, not the keyword.
      icontains: 'LIKE',
    };
    /**
     * Where each string operator puts the wildcard. [#5567] The pattern itself is
     * built by the shared `likePattern`, which ESCAPES the comparand — `_` and
     * `%` are LIKE wildcards, so the old inline table quietly turned an author's
     * literal into a pattern (`$contains: '_admin'` also matched `xyadmin`).
     * `objectql-strategy.ts`'s `LIKE_SQL_OPS` carries the same table for the
     * `/analytics/sql` echo of this statement; they move together.
     */
    const likeShape: Record<string, LikeShape> = {
      contains: 'contains', notContains: 'contains',
      startsWith: 'starts', endsWith: 'ends',
      // [#6520] Same wildcard placement as `contains`; the case fold is what
      // differs, and it is applied to both sides of the comparison below.
      icontains: 'contains',
    };

    // Null predicates and the LIKE family read the column as stored — the former
    // is storage-independent, the latter is a substring match on the raw text —
    // so only the value comparisons take the normalised reference.
    if (operator === 'set') return `${rawCol} IS NOT NULL`;
    if (operator === 'notSet') return `${rawCol} IS NULL`;

    if (operator === 'in' || operator === 'notIn') {
      if (!values || values.length === 0) return null;
      // Dates can legitimately appear in an `in`/`notIn` set (e.g. a multi-day
      // KPI), so coerce each element to the column's storage form too — same
      // SQLite epoch-vs-text root cause as the scalar operators below.
      const placeholders = values.map(v => { params.push(this.coerceTemporal(ctx, target, v)); return `$${params.length}`; }).join(', ');
      return `${this.temporalColumn(ctx, target, rawCol)} ${operator === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`;
    }

    const sqlOp = opMap[operator];
    if (!sqlOp || !values || values.length === 0) return null;

    // The LIKE family reads the column as stored — a substring/prefix/suffix
    // match is on the raw text — so it keeps the un-normalised reference.
    const shape = likeShape[operator];
    if (shape) {
      // [#5567] Escaped pattern AND an explicit `ESCAPE`, bound together: the
      // escaping alone would search for a literal backslash on SQLite (no
      // default escape character there), the clause alone would change nothing.
      params.push(likePattern(shape, values[0]));
      const patternRef = `$${params.length}`;
      params.push(LIKE_ESCAPE_CHAR);
      // [#6520] `$icontains` folds ASCII case on BOTH sides. Only this operator
      // folds: the rest of the family is case-EXACT by ruling (#4706 Q2 = A),
      // and `objectql-strategy.ts`'s echo of this statement carries the same
      // `fold` flag on the same single row so the two keep describing one query.
      if (operator === 'icontains') {
        return `${asciiLowerSqlExpr(rawCol)} ${sqlOp} ${asciiLowerSqlExpr(patternRef)} ESCAPE $${params.length}`;
      }
      return `${rawCol} ${sqlOp} ${patternRef} ESCAPE $${params.length}`;
    }

    // A bare-day `lte` bound means "through that whole day" (#3777): compile
    // half-open (`< day+1`) so a datetime column keeps the final day's rows.
    // Equivalent to `<=` for a `date` column, so no column-type lookup needed.
    if (operator === 'lte') {
      const nextDay = nextUtcCalendarDay(values[0]);
      if (nextDay != null) {
        params.push(this.coerceTemporal(ctx, target, nextDay));
        return `${this.temporalColumn(ctx, target, rawCol)} < $${params.length}`;
      }
    }

    // Coerce so booleans/numbers bind as their native SQL types AND so a
    // relative-date / ISO-string comparand on a SQLite `Field.datetime`
    // column is converted to its INTEGER epoch storage form. Without this a
    // dashboard filter like `assessed_at >= '2025-06-18'` compiles to a
    // TEXT-vs-INTEGER affinity compare that is always false → "No rows",
    // even though the rows exist (the confirmed time-series chart bug).
    params.push(this.coerceTemporal(ctx, target, values[0]));
    return `${this.temporalColumn(ctx, target, rawCol)} ${sqlOp} $${params.length}`;
  }

  private extractObjectName(cube: Cube): string {
    return cube.sql.trim();
  }

  private buildFieldMeta(query: AnalyticsQuery, cube: Cube): Array<{ name: string; type: string }> {
    const fields: Array<{ name: string; type: string }> = [];
    if (query.dimensions) {
      for (const dim of query.dimensions) {
        const d = this.lookupMember(cube, dim, 'dimension');
        fields.push({ name: dim, type: d?.type || 'string' });
      }
    }
    if (query.measures) {
      for (const m of query.measures) {
        fields.push({ name: m, type: 'number' });
      }
    }
    return fields;
  }
}
