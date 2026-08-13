// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';
// [#8220] The read-scope provenance mark: `withReadScope` below is one of the
// two merge boundaries that stamp it.
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import type { AnalyticsStrategy, StrategyContext } from './types.js';
import {
  invalidFilterError,
  lowerAnalyticsWhere,
  normalizeAnalyticsFilterTree,
  collectFilterLeaves,
  SQL_CONST_FALSE,
  SQL_CONST_TRUE,
  type NormalizedFilterNode,
} from './filter-normalizer.js';
import { findCrossFieldComparand, isFieldReference } from '../comparand-shape.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import { invalidMemberError } from '../dataset-refusal.js';
import { likePattern, LIKE_ESCAPE_CHAR, asciiLowerSqlExpr, type LikeShape } from '../like-pattern.js';
import { nextUtcCalendarDay } from '@objectstack/core';
import {
  rebucketCrossObject,
  RECOMBINABLE_METHODS,
  type CrossObjectDim,
  type MeasureRecombine,
  type RecombinableMethod,
} from './cross-object-rebucket.js';

/** Scalar analytics operators → their SQL spelling (display SQL only). */
const SCALAR_SQL_OPS: Record<string, string> = {
  equals: '=', notEquals: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
};

/**
 * The LIKE family: SQL spelling + where each one puts the wildcard.
 *
 * Deliberately the same pair of tables `NativeSQLStrategy.buildFilterClause`
 * carries (`opMap` / `likeShape`), because this file renders a description of
 * the statement THAT compiler produces. Keeping them as one table here is the
 * point of #5333: `startsWith` / `endsWith` were in neither the branch above nor
 * `SCALAR_SQL_OPS`, so they fell to the unmapped exit and the predicate vanished
 * from the echo while the query it documents ran `LIKE 'w%'`.
 *
 * [#5567] The pattern comes from the shared `likePattern`, which ESCAPES the
 * comparand, and the renderer binds an explicit `ESCAPE` alongside it. That is
 * not cosmetic for an echo: the execution this file describes goes through the
 * engine to `driver-sql`, whose `applyLike` has always escaped and bound
 * `ESCAPE`. Rendering the raw comparand meant the echoed statement was WIDER
 * than the query it claims to reproduce whenever the comparand carried a `_` or
 * `%` — the #3601 / #3602 / #3650 failure this render block exists to prevent.
 */
const LIKE_SQL_OPS: Record<string, { sql: string; shape: LikeShape; fold?: boolean }> = {
  contains: { sql: 'LIKE', shape: 'contains' },
  notContains: { sql: 'NOT LIKE', shape: 'contains' },
  startsWith: { sql: 'LIKE', shape: 'starts' },
  endsWith: { sql: 'LIKE', shape: 'ends' },
  // [#6520] `$icontains`: the same escaped pattern and bound `ESCAPE` as its
  // four case-EXACT neighbours, with `fold` adding the ASCII-only case fold to
  // both sides of the comparison. The flag is on this row alone — the family
  // above it is case-sensitive by ruling (#4706 Q2 = A).
  icontains: { sql: 'LIKE', shape: 'contains', fold: true },
};

/** One cross-object grouping dimension planned for FK-expand (#3654). */
interface CrossObjectPlanDim {
  /** The caller's dimension name (output key), e.g. `region`. */
  outputName: string;
  /** The base lookup FK column to group the base aggregate by, e.g. `account`. */
  fkField: string;
  /** The related object's attribute to resolve the FK to, e.g. `region`. */
  attr: string;
  /** The related object name (join target), e.g. `crm_account`. */
  refObject: string;
}

interface CrossObjectPlan {
  crossDims: CrossObjectPlanDim[];
}

/**
 * ObjectQLStrategy — Priority 2
 *
 * Translates an analytics query into an ObjectQL `engine.aggregate()` call.
 * This path works with any driver that supports the ObjectQL aggregate AST
 * (Postgres, Mongo, SQLite, etc.) without requiring raw SQL access.
 */
export class ObjectQLStrategy implements AnalyticsStrategy {
  readonly name = 'ObjectQLStrategy';
  readonly priority = 20;

  canHandle(query: AnalyticsQuery, ctx: StrategyContext): boolean {
    if (!query.cube) return false;
    const caps = ctx.queryCapabilities(query.cube);
    return caps.objectqlAggregate && typeof ctx.executeAggregate === 'function';
  }

  async execute(query: AnalyticsQuery, ctx: StrategyContext): Promise<AnalyticsResult> {
    const cube = ctx.getCube(query.cube!)!;
    const objectName = this.extractObjectName(cube);

    // Build groupBy from dimensions, honouring `timeDimensions` granularity.
    // A date dimension with a granularity becomes a STRUCTURED groupBy item
    // `{ field, dateGranularity }` — which `engine.aggregate()` buckets (driver
    // date_trunc or in-memory). Without this the ObjectQL path grouped raw
    // timestamps (one bucket per row) and date-bucketed dataset widgets never
    // matched their legacy `categoryGranularity` counterpart.
    type GroupByItem = string | { field: string; dateGranularity: string };
    const granByDim = new Map<string, string>();
    for (const td of query.timeDimensions ?? []) {
      if (td.granularity) granByDim.set(td.dimension, td.granularity);
    }
    const groupBy: GroupByItem[] = [];
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const field = this.resolveFieldName(cube, dim, 'dimension');
        const gran = granByDim.get(dim);
        groupBy.push(gran ? { field, dateGranularity: gran } : field);
        granByDim.delete(dim);
      }
    }
    // Time dimensions not also listed in `dimensions` still bucket + group.
    for (const [dim, gran] of granByDim) {
      groupBy.push({ field: this.resolveFieldName(cube, dim, 'dimension'), dateGranularity: gran });
    }

    // Build aggregations from measures
    const aggregations: Array<{ field: string; method: string; alias: string }> = [];
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        const { field, method } = this.resolveMeasureAggregation(cube, measure);
        aggregations.push({ field, method, alias: measure });
      }
    }

    // Build the engine filter. Every predicate — the caller's `where` and the
    // time-dimension windows alike — is contributed through
    // `mergeFilterOperand`, because one field routinely carries MULTIPLE
    // operators (a range `{$gte, $lte}` on `close_date`) and a plain assignment
    // would keep only the last.
    const filter: Record<string, unknown> = {};
    // Operands that cannot merge into their field's entry without one silently
    // replacing the other; ANDed in below so the engine intersects them.
    const conjuncts: Record<string, unknown>[] = [];
    this.applyFilterNode(normalizeAnalyticsFilterTree(query), cube, filter, conjuncts);
    // #3650 — and the time-dimension WINDOWS, through the SAME merge, so a
    // `dateRange` and a caller `where` bound on one field compose instead of
    // clobbering each other.
    for (const { field, bounds } of this.dateRangeBounds(cube, query)) {
      const extra = this.mergeFilterOperand(filter, field, bounds);
      if (extra) conjuncts.push(extra);
    }
    if (conjuncts.length > 0) {
      filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), ...conjuncts];
    }

    // #3654 — classify cross-object references. A cross-object DIMENSION within
    // the supported envelope is served by an FK-expand (`executeCrossObject`);
    // everything the engine cannot serve (cross-object measures/filters,
    // multi-hop, non-recombinable measures) is REJECTED by `planCrossObject` —
    // the engine has no join, and a silent mis-bucket is worse than a loud
    // error. `null` ⇒ the query is base-only and takes the direct path below.
    const plan = this.planCrossObject(cube, query, filter);
    if (plan) {
      return this.executeCrossObject(cube, query, aggregations, filter, plan, ctx);
    }

    // ADR-0021 D-C — the base object's read scope (tenant + RLS) MUST be ANDed
    // in before the query leaves the strategy (#3597). A base-only query has a
    // single object in play, so one base-object scope is sufficient here.
    const rows = await ctx.executeAggregate!(objectName, {
      // Structured groupBy items ({field, dateGranularity}) pass through the
      // executeAggregate bridge to engine.aggregate, which buckets them. The
      // contract types groupBy as string[]; the cast carries the richer shape.
      groupBy: groupBy.length > 0 ? (groupBy as unknown as string[]) : undefined,
      aggregations: aggregations.length > 0 ? aggregations : undefined,
      filter: this.withReadScope(objectName, filter, ctx),
      // ADR-0053 Phase 2 (D2): forward the reference tz so date buckets resolve
      // on that zone's calendar days. A non-UTC zone makes the engine bucket
      // in-memory (uniform across drivers); UTC/unset keeps the DB fast path.
      timezone: query.timezone,
      // ADR-0021 D-C (#3602): the second belt. `withReadScope` above is this
      // layer's own scoping; handing the engine the context makes ITS middleware
      // inject RLS too, so a future strategy that forgets `withReadScope` still
      // cannot read across tenants. Without it the operation reaches the engine
      // principal-less and plugin-security falls open — the #3597 shape.
      context: ctx.context,
    });

    // Remap short field names back to cube-qualified names. Driven by
    // `projectedDimensions`, so a `timeDimensions`-only bucket — grouped by
    // just above, and therefore present in `row` — reaches the caller instead
    // of being silently dropped (#4033).
    const mappedRows = rows.map(row => {
      const mapped: Record<string, unknown> = {};
      for (const dim of this.projectedDimensions(query)) {
        const shortName = this.resolveFieldName(cube, dim, 'dimension');
        if (shortName in row) mapped[dim] = row[shortName];
      }
      if (query.measures) {
        for (const m of query.measures) {
          // Alias was set to the full measure name
          if (m in row) mapped[m] = row[m];
        }
      }
      return mapped;
    });

    const fields = this.buildFieldMeta(query, cube);
    // Echo a representative SQL alongside the rows (#3588). `NativeSQLStrategy`
    // returns the statement it actually ran, and dataset responses surface that
    // string — it is how an author checks what their widget compiled to. This
    // path builds an AST, so it had nothing to echo, and the `sql` field simply
    // vanished from the response whenever a query was date-bucketed (native SQL
    // declines granularity, handing those queries here). An author reading the
    // response then couldn't tell "bucketing is not implemented" from "this
    // strategy doesn't report". Best-effort: rendering is a debugging aid and
    // must never fail a query that already ran.
    let sql: string | undefined;
    try {
      sql = (await this.generateSql(query, ctx)).sql;
    } catch {
      sql = undefined;
    }
    return sql ? { rows: mappedRows, fields, sql } : { rows: mappedRows, fields };
  }

  /**
   * Render a REPRESENTATIVE SQL string for an ObjectQL aggregate query.
   *
   * This path executes through `engine.aggregate()`, not raw SQL, so the string
   * is documentation rather than the literal statement — but it must be an
   * honest account of what the query does, because dataset responses echo it
   * and authors read it to verify their widget options landed (#3588). It
   * therefore renders date bucketing (`date_trunc`), the WHERE predicate,
   * ordering, and the row window.
   *
   * Filter VALUES are rendered as `$n` placeholders and returned in `params`,
   * never inlined: the echoed statement travels to the browser, and a filter
   * comparand can carry tenant data.
   */
  async generateSql(query: AnalyticsQuery, ctx: StrategyContext): Promise<{ sql: string; params: unknown[] }> {
    const cube = ctx.getCube(query.cube!);
    if (!cube) {
      throw new Error(`Cube not found: ${query.cube}`);
    }

    // [#7598, maintainer ruling 2026-08-12] The echo DECLINES a cross-field
    // comparison — 「`/analytics/sql` 的 echo 同样 decline(一致的响亮答案,
    // 不半渲染)」.
    //
    // This renderer describes an execution it does not perform, and there is no
    // honest description of a cross-field comparison available to it. The
    // reference reaches `engine.aggregate` intact and `driver-sql` compiles it
    // into a TOTAL column-to-column predicate — several repetitions of both
    // column expressions, so the answer matches the memory evaluator across
    // NULLs. What this file's `buildFilterClauseSql` can render is `amount >
    // $1` with the reference OBJECT in `params`: not a simplification of that
    // predicate but a different one, comparing a column against a value no row
    // can hold. Rendering it would hand a debugger SQL that reproduces NONE of
    // the rows the query returned — the #3601 / #3602 / #3650 failure this
    // whole render block exists to prevent, in its worst direction.
    //
    // Note what this does NOT affect: `execute()` calls `generateSql` inside a
    // `try`/`catch` precisely because the echo is a debugging aid that must
    // never fail a query that already ran, so `/analytics/query` still serves
    // these queries and returns rows — the response simply carries no `sql`
    // string. Only the dry-run face (`/analytics/sql`) refuses, which is the
    // "one consistent, loud answer" the ruling asked for.
    //
    // The READ SCOPE half needs no arm of its own: `compileScopedFilterToSql`
    // below still refuses a reference in its own fail-closed envelope
    // (`READ_SCOPE_COMPILE_FAILED` / 500, #5367 ruling kept verbatim by Q2 = A),
    // and that refusal is now reached from HERE rather than from
    // `NativeSQLStrategy.applyReadScope` — see `read-scope-sql.ts`'s header.
    const crossField = findCrossFieldComparand(this.loweredWhere(query));
    if (crossField) {
      throw invalidFilterError(
        `[analytics] cannot render display SQL for the field reference ` +
        `{ "$field": "${crossField.ref}" } under "${crossField.op}" on "${crossField.field}". ` +
        `The query itself is SERVED — \`NativeSQLStrategy.canHandle\` declines a cross-field ` +
        `comparison so it routes to the ObjectQL engine path, where driver-sql compiles it into a ` +
        `column-to-column predicate written TOTAL across NULLs and enforces the #5222 rulings ` +
        `(#7598, maintainer ruling 2026-08-12). This renderer has no faithful rendering of that ` +
        `predicate: what it can emit is a comparison against the reference object as a bound VALUE, ` +
        `which reproduces none of the rows the query returns. Refusing rather than half-rendering — ` +
        `an echo that contradicts execution is worse than no echo (#3601 / #3602 / #3650). Run the ` +
        `query itself (/analytics/query) to get its rows.`,
      );
    }

    const selectParts: string[] = [];
    const groupByParts: string[] = [];
    const params: unknown[] = [];

    // Date-bucketed dimensions render as `date_trunc('<granularity>', col)` —
    // the SQL shape the driver's own bucketing implements — so a `month` trend
    // no longer reads as if it grouped by the raw column.
    const granByDim = new Map<string, string>();
    for (const td of query.timeDimensions ?? []) {
      if (td.granularity) granByDim.set(td.dimension, td.granularity);
    }
    const tableName = this.extractObjectName(cube);
    // #3654 — plan cross-object dims (throws for out-of-envelope, so
    // `/analytics/sql` and `execute()` accept/reject the SAME set). An in-envelope
    // cross-object dim renders as a LEFT JOIN — its logical shape; `execute()`
    // serves it via FK-expand.
    // EVERY member the filter touches, including ones nested in an `$or` —
    // the envelope check rejects cross-object filters, so a member it cannot
    // see is a filter it cannot reject.
    const plan = this.planCrossObject(cube, query, Object.fromEntries(
      collectFilterLeaves(normalizeAnalyticsFilterTree(query))
        .map((f) => [this.resolveFieldName(cube, f.member, 'any'), true]),
    ));
    const crossByDim = new Map((plan?.crossDims ?? []).map((cd) => [cd.outputName, cd]));
    const joinClauses: string[] = [];
    const dimExpr = (dim: string): string => {
      const cd = crossByDim.get(dim);
      if (cd) {
        joinClauses.push(
          `LEFT JOIN "${cd.refObject}" ON "${tableName}"."${cd.fkField}" = "${cd.refObject}"."id"`,
        );
        return `"${cd.refObject}"."${cd.attr}"`;
      }
      const col = this.resolveFieldName(cube, dim, 'dimension');
      const gran = granByDim.get(dim);
      return gran ? `date_trunc('${gran}', ${col})` : col;
    };

    if (query.dimensions) {
      for (const dim of query.dimensions) {
        const expr = dimExpr(dim);
        selectParts.push(`${expr} AS "${dim}"`);
        groupByParts.push(expr);
      }
    }
    // A time dimension that is bucketed but not also listed in `dimensions`
    // still groups (see `execute`), so it belongs in the rendered GROUP BY too.
    for (const [dim] of granByDim) {
      if (query.dimensions?.includes(dim)) continue;
      const expr = dimExpr(dim);
      selectParts.push(`${expr} AS "${dim}"`);
      groupByParts.push(expr);
    }
    if (query.measures) {
      for (const m of query.measures) {
        const { field, method } = this.resolveMeasureAggregation(cube, m);
        const aggSql = method === 'count'
          ? 'COUNT(*)'
          : method === 'count_distinct'
            ? `COUNT(DISTINCT ${field})`
            : `${method.toUpperCase()}(${field})`;
        selectParts.push(`${aggSql} AS "${m}"`);
      }
    }

    // ADR-0021 D-C (#3602) — render the READ SCOPE too, not just the caller's
    // own filters (#3652 added those). Without it this string still reads as an
    // unscoped table scan while the real aggregate is scoped (#3601), so anyone
    // debugging a "why is this row missing" gets SQL that cannot reproduce the
    // result. Nothing leaks — the string is never executed, and scope VALUES
    // stay in `params`, which `execute()`'s echo discards — but a rendering
    // that contradicts execution is worse than no rendering.
    //
    // The cross-object guard runs here for the same reason: this must not
    // render SQL for a query `execute()` would reject outright (#3654).
    //
    // Faithfulness cuts both ways: the time-dimension WINDOWS render too, from
    // the same `dateRangeBounds` lowering `execute()` sends to the engine
    // (#3650). This comment used to explain why a BETWEEN was deliberately
    // absent — because `execute()` dropped the window and rendering one would
    // have invented a predicate. Now that it applies the window, omitting it
    // here would be the lie in the other direction.
    // (The cross-object envelope was already enforced by `planCrossObject` above,
    // so `/analytics/sql` rejects the same out-of-envelope set `execute()` does.)

    const whereParts: string[] = [];
    // Recursive, so the echoed statement carries the same disjunctions the
    // engine filter does — the echo exists to REPRODUCE execution, and an
    // `$or` rendered as a conjunction (or dropped) is exactly the lie this
    // block's comment above warns about, in the other direction.
    const filterClause = this.renderFilterNodeSql(
      normalizeAnalyticsFilterTree(query),
      cube,
      params,
    );
    if (filterClause) whereParts.push(filterClause);
    // Bounds bind as `$n` placeholders like every other comparand: this string
    // travels to the browser, and a window can carry tenant-derived dates.
    // A bare-day upper bound renders half-open (`< day+1`) because that is
    // what `execute()`'s driver actually runs for it on a datetime column
    // (#3777) — rendering the BETWEEN would hand a debugger SQL that drops
    // the final day's rows and cannot reproduce the result.
    for (const { field, bounds } of this.dateRangeBounds(cube, query)) {
      const nextDay = nextUtcCalendarDay(bounds.$lte);
      params.push(bounds.$gte, nextDay ?? bounds.$lte);
      whereParts.push(
        `(${field} >= $${params.length - 1} AND ${field} ${nextDay ? '<' : '<='} $${params.length})`,
      );
    }
    // Read scope last, so it reads as the outermost constraint. Compiled by the
    // same fail-closed compiler `NativeSQLStrategy` uses — it throws rather than
    // drop a predicate, which is the correct posture even for a display string:
    // silently omitting the scope is exactly the misleading output being fixed.
    const scope = ctx.getReadScope?.(tableName);
    if (scope != null) {
      const { sql: scopeSql, params: scopeParams } = compileScopedFilterToSql(scope, tableName);
      if (scopeSql) {
        let i = 0;
        // `compileScopedFilterToSql` emits `?`; renumber into this builder's $N.
        const rendered = scopeSql.replace(/\?/g, () => {
          params.push(scopeParams[i++]);
          return `$${params.length}`;
        });
        whereParts.push(`(${rendered})`);
      }
    }

    let sql = `SELECT ${selectParts.join(', ')} FROM "${tableName}"`;
    if (joinClauses.length > 0) sql += ' ' + joinClauses.join(' ');
    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }
    if (groupByParts.length > 0) {
      sql += ` GROUP BY ${groupByParts.join(', ')}`;
    }
    if (query.order && Object.keys(query.order).length > 0) {
      const orderClauses = Object.entries(query.order).map(([f, d]) => `"${f}" ${d.toUpperCase()}`);
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }
    if (query.limit != null) sql += ` LIMIT ${query.limit}`;
    if (query.offset != null) sql += ` OFFSET ${query.offset}`;

    return { sql, params };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * ADR-0021 D-C (#3597) — AND the object's read scope (tenant + RLS) into the
   * filter handed to `engine.aggregate`.
   *
   * This path used to drop the scope entirely, and the engine could not make up
   * for it: the aggregate bridge passes no `ExecutionContext`, so the security
   * middleware's principal-less fall-open skipped its own RLS injection. Both
   * belts were off at once — an authenticated caller received aggregates
   * computed over EVERY tenant's rows.
   *
   * Composed with `$and`, never by key merge: the query's own filter and the
   * scope can name the SAME field (e.g. a dashboard filtering `organization_id`),
   * and a spread would let caller input silently overwrite the security
   * predicate. `$and` makes that structurally impossible.
   */
  private withReadScope(
    objectName: string,
    filter: Record<string, unknown>,
    ctx: StrategyContext,
  ): Record<string, unknown> | undefined {
    // [#8220, A of #7929] This is the second read-scope MERGE BOUNDARY (the
    // first is plugin-security's CRUD injection), so the provenance mark is
    // stamped here: the scope is `'policy'` — a cross-field refusal from
    // inside it keeps the #7929 redaction — and the strategy-built user filter
    // is `'author'`: every name in it came from the caller's own query
    // (dimensions, measures, `where`, time windows) through this class's own
    // compilation, which is exactly the vouch the mark declares. Unmarked
    // content anywhere else stays withheld downstream, by the mark's declared
    // fail direction.
    const userFilter =
      Object.keys(filter).length > 0 ? markFilterSubtreeProvenance(filter, 'author') : undefined;
    if (typeof ctx.getReadScope !== 'function') return userFilter;
    const scope = ctx.getReadScope(objectName);
    if (scope === undefined || scope === null) return userFilter;
    const scopeFilter = markFilterSubtreeProvenance(scope as Record<string, unknown>, 'policy');
    if (!userFilter) return scopeFilter;
    return { $and: [userFilter, scopeFilter] };
  }

  /** Is `field` a resolved cross-object (relationship-traversal) reference? */
  private isCrossObjectField(cube: Cube, field: string, baseObject: string): boolean {
    if (!field.includes('.')) return false;
    const alias = field.split('.')[0];
    const joinedObject = cube.joins?.[alias]?.name ?? alias;
    return joinedObject !== baseObject;
  }

  /**
   * Plan how to serve cross-object references on this join-less path (#3654).
   *
   * `engine.aggregate()` cannot join. A cross-object DIMENSION within a
   * supported envelope is served by an FK-expand (`executeCrossObject`): group
   * the base aggregate on the lookup FK, resolve the FK to the related attribute
   * with a SCOPED read, re-bucket in memory. Returns `null` for a base-only
   * query (direct path), a plan for an in-envelope cross-object query.
   *
   * THROWS for anything outside the envelope — a cross-object MEASURE or FILTER
   * (needs a real join to evaluate), a MULTI-HOP dimension (`a.b.c`), or a
   * non-recombinable measure (`avg`/`count_distinct`, whose sub-bucket values
   * cannot be merged). A loud error beats the silent mis-bucket #3654 kills.
   * `generateSql()` calls this too, so the preview accepts/rejects the same set.
   *
   * [#5716] All four refusals below are `invalidMemberError` — `INVALID_FIELD` /
   * 400, naming the member — and the MESSAGES are unchanged (they are good
   * diagnostics, and #5923's tests read them). Each is decided by two caller-side
   * facts and nothing else: a member the query named, and whether that member
   * resolves across a join. Neither is an internal invariant — a cube where the
   * member exists and a driver that could serve it are both perfectly ordinary,
   * which is exactly what the "run this on a native-SQL driver" half of each
   * message says. They are member-level rather than dataset-level (hence not
   * `datasetInvalidError`) because the fix is always to change or drop ONE named
   * member, and because they fire on `/analytics/query` where no dataset exists.
   *
   * Detection is on RESOLVED field names, so a dotted dimension the cube
   * flattens to a real column is treated as base, not cross-object.
   */
  private planCrossObject(
    cube: Cube,
    query: AnalyticsQuery,
    filter: Record<string, unknown>,
  ): CrossObjectPlan | null {
    const baseObject = this.extractObjectName(cube);

    // A date bucket over a related object's field is not supported. Checked
    // FIRST: since #3650 a `dateRange` also lands in `filter`, so a cross-object
    // time dimension would otherwise be reported as a "cross-object filter" —
    // true of the lowered predicate, but not what the author wrote.
    for (const td of query.timeDimensions ?? []) {
      const field = this.resolveFieldName(cube, td.dimension, 'dimension');
      if (this.isCrossObjectField(cube, field, baseObject)) {
        throw invalidMemberError(
          `[Analytics] ObjectQLStrategy cannot bucket a cross-object time dimension ("${field}").`,
          { member: td.dimension, param: 'timeDimensions', cube: cube.name },
        );
      }
    }

    // A cross-object MEASURE or FILTER can only be evaluated with a real join.
    // [#5716] `member` is the entry AS THE REQUEST SPELLED IT (`revenue`), which
    // is what a caller can act on; `field` is what it RESOLVED to
    // (`account.balance`), which is what the message explains the refusal with.
    // The measure's request spelling used to be dropped here — the map kept only
    // the resolved field — so the envelope had nothing to name.
    const nonDim = [
      ...(query.measures ?? []).map((m) => ({
        where: 'measure', member: m, field: this.resolveMeasureAggregation(cube, m).field,
      })),
      ...Object.keys(filter).map((f) => ({ where: 'filter', member: f, field: f })),
    ].filter((r) => this.isCrossObjectField(cube, r.field, baseObject));
    if (nonDim.length > 0) {
      throw invalidMemberError(
        `[Analytics] ObjectQLStrategy cannot evaluate a cross-object ${nonDim[0].where} ` +
        `("${nonDim[0].field}") — the engine cannot join in an aggregate. Run this ` +
        `query on a native-SQL driver, or remove the cross-object ${nonDim[0].where}.`,
        {
          member: nonDim[0].member,
          // The two kinds share one throw, so the request key follows the kind
          // rather than being guessed by the reader of the message.
          param: nonDim[0].where === 'measure' ? 'measures' : 'where',
          cube: cube.name,
        },
      );
    }

    // Collect cross-object DIMENSIONS (single-hop only).
    const crossDims: CrossObjectPlanDim[] = [];
    for (const dim of query.dimensions ?? []) {
      const field = this.resolveFieldName(cube, dim, 'dimension');
      if (!this.isCrossObjectField(cube, field, baseObject)) continue;
      const [alias, ...rest] = field.split('.');
      const attr = rest.join('.');
      if (attr.includes('.')) {
        throw invalidMemberError(
          `[Analytics] ObjectQLStrategy supports only single-hop cross-object ` +
          `dimensions; "${field}" traverses more than one relationship.`,
          { member: dim, param: 'dimensions', cube: cube.name },
        );
      }
      crossDims.push({ outputName: dim, fkField: alias, attr, refObject: cube.joins?.[alias]?.name ?? alias });
    }

    if (crossDims.length === 0) return null;

    // Every measure must re-combine across the intermediate FK sub-buckets.
    for (const m of query.measures ?? []) {
      const { method } = this.resolveMeasureAggregation(cube, m);
      if (!RECOMBINABLE_METHODS.has(method)) {
        throw invalidMemberError(
          `[Analytics] ObjectQLStrategy cannot group by a cross-object dimension ` +
          `with a "${method}" measure ("${m}") — its value cannot be recombined ` +
          `across the intermediate FK grouping. Use sum/count/min/max, or run on ` +
          `a native-SQL driver.`,
          { member: m, param: 'measures', cube: cube.name },
        );
      }
    }

    return { crossDims };
  }

  /**
   * Serve a cross-object-dimension query by FK-expand (#3654). The pure
   * re-bucketing step lives in `cross-object-rebucket.ts`.
   */
  private async executeCrossObject(
    cube: Cube,
    query: AnalyticsQuery,
    aggregations: Array<{ field: string; method: string; alias: string }>,
    filter: Record<string, unknown>,
    plan: CrossObjectPlan,
    ctx: StrategyContext,
  ): Promise<AnalyticsResult> {
    const baseObject = this.extractObjectName(cube);
    const crossByDim = new Map(plan.crossDims.map((cd) => [cd.outputName, cd]));

    // Rewrite group-by: a cross-object dim becomes its base FK column; base and
    // time dims pass through. `baseDimFields` are the group keys carried into
    // the re-bucket verbatim (the FK columns are replaced by resolved attrs).
    type GroupByItem = string | { field: string; dateGranularity: string };
    const granByDim = new Map<string, string>();
    for (const td of query.timeDimensions ?? []) {
      if (td.granularity) granByDim.set(td.dimension, td.granularity);
    }
    const groupBy: GroupByItem[] = [];
    const baseDimFields: string[] = [];
    for (const dim of query.dimensions ?? []) {
      const cd = crossByDim.get(dim);
      if (cd) {
        groupBy.push(cd.fkField);
        continue;
      }
      const field = this.resolveFieldName(cube, dim, 'dimension');
      const gran = granByDim.get(dim);
      groupBy.push(gran ? { field, dateGranularity: gran } : field);
      baseDimFields.push(field);
      granByDim.delete(dim);
    }
    for (const [dim, gran] of granByDim) {
      const field = this.resolveFieldName(cube, dim, 'dimension');
      groupBy.push({ field, dateGranularity: gran });
      baseDimFields.push(field);
    }

    // Base aggregate, grouped by the FK, scoped to the base object. Threads the
    // ExecutionContext for the engine-side second belt too (#3602).
    const baseRows = await ctx.executeAggregate!(baseObject, {
      groupBy: groupBy.length > 0 ? (groupBy as unknown as string[]) : undefined,
      aggregations: aggregations.length > 0 ? aggregations : undefined,
      filter: this.withReadScope(baseObject, filter, ctx),
      timezone: query.timezone,
      context: ctx.context,
    });

    // Resolve each cross-object dim's FK → attribute, SCOPED to the referenced
    // object: a related record the caller cannot read never yields its
    // attribute, so it buckets as RESTRICTED (no leak; ADR-0021 D-C / #3602).
    const resolvedDims: CrossObjectDim[] = [];
    for (const cd of plan.crossDims) {
      const fkValues = [...new Set(baseRows.map((r) => r[cd.fkField]).filter((v) => v != null))];
      const fkToAttr = await this.resolveFkAttr(cd.refObject, cd.attr, fkValues, ctx);
      resolvedDims.push({ outputName: cd.outputName, fkField: cd.fkField, fkToAttr });
    }

    const measures: MeasureRecombine[] = (query.measures ?? []).map((m) => ({
      alias: m,
      // planCrossObject already asserted every measure is recombinable.
      method: this.resolveMeasureAggregation(cube, m).method as RecombinableMethod,
    }));

    const merged = rebucketCrossObject(baseRows, baseDimFields, resolvedDims, measures);

    // Map resolved group keys back to the caller's dimension names.
    const mappedRows = merged.map((row) => {
      const out: Record<string, unknown> = {};
      // Same projection set as the direct path and `buildFieldMeta`
      // ({@link projectedDimensions}) — a cross-object dimension carries the
      // caller's name already, everything else is remapped from its short name.
      for (const dim of this.projectedDimensions(query)) {
        if (crossByDim.has(dim)) {
          if (dim in row) out[dim] = row[dim];
        } else {
          const field = this.resolveFieldName(cube, dim, 'dimension');
          if (field in row) out[dim] = row[field];
        }
      }
      for (const m of query.measures ?? []) {
        if (m in row) out[m] = row[m];
      }
      return out;
    });

    return { rows: mappedRows, fields: this.buildFieldMeta(query, cube) };
  }

  /**
   * Resolve `fkValues` (ids of `refObject`) to their `attr` values, applying the
   * referenced object's OWN read scope (#3654 / #3602). Reuses the aggregate
   * bridge — `group by (id, attr)` is one row per record. Ids the scope hides
   * are simply absent from the map (⇒ RESTRICTED bucket downstream).
   */
  private async resolveFkAttr(
    refObject: string,
    attr: string,
    fkValues: unknown[],
    ctx: StrategyContext,
  ): Promise<Map<unknown, unknown>> {
    const map = new Map<unknown, unknown>();
    if (fkValues.length === 0 || typeof ctx.executeAggregate !== 'function') return map;
    const idFilter: Record<string, unknown> = { id: { $in: fkValues } };
    const scope = typeof ctx.getReadScope === 'function' ? ctx.getReadScope(refObject) : null;
    // [#8220] Same boundary family as `withReadScope`: the scope arm is policy.
    // `idFilter` is this method's own plumbing, not the caller's text — it
    // stays unmarked, which withholds, and that is correct for a filter no
    // author typed.
    if (scope != null) markFilterSubtreeProvenance(scope, 'policy');
    const filter = scope != null ? { $and: [idFilter, scope] } : idFilter;
    const rows = await ctx.executeAggregate(refObject, {
      groupBy: ['id', attr],
      aggregations: [{ field: 'id', method: 'count', alias: '_c' }],
      filter,
      context: ctx.context,
    });
    for (const r of rows) {
      if (r.id != null) map.set(r.id, r[attr]);
    }
    return map;
  }

  /**
   * Render one normalized filter as a display SQL predicate for `generateSql`.
   *
   * Mirrors `NativeSQLStrategy.buildFilterClause`'s operator vocabulary so the
   * two previews read alike, but binds the comparand VERBATIM: the value shown is
   * the one THIS path actually hands the engine (a real boolean, not SQL's 1/0).
   *
   * [#5526] "Verbatim" is now literal. This used to bind through
   * `coerceFilterValueForObjectQL`, which decoded the string a `string[]` leaf
   * carried back into a type — so an echo could show `7` for a filter the author
   * wrote as `'007'`. A leaf carries the author's value at its own type, so the
   * echo needs no conversion at all to stay honest about execution. The LIKE
   * family is still the one exception, for the reason `filter.zod.ts` gives: its
   * comparand is declared a `string`, and what binds is the PATTERN.
   *
   * `null` means "this leaf carries no predicate" — a value-less scalar leaf,
   * which `execute()` and `NativeSQLStrategy` drop too. It does NOT mean "I could
   * not render that operator": #5333 was exactly that conflation, and an
   * unrenderable operator now THROWS (see the exit below).
   */
  private buildFilterClauseSql(
    col: string,
    operator: string,
    values: unknown[] | undefined,
    params: unknown[],
  ): string | null {
    if (operator === 'set') return `${col} IS NOT NULL`;
    if (operator === 'notSet') return `${col} IS NULL`;

    if (!values || values.length === 0) return null;

    if (operator === 'in' || operator === 'notIn') {
      const placeholders = values
        .map((v) => { params.push(v); return `$${params.length}`; })
        .join(', ');
      return `${col} ${operator === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`;
    }

    // The LIKE family binds its PATTERN, which is text by construction — same
    // reason `NativeSQLStrategy` keeps the un-normalised column reference for
    // these: a prefix/suffix/substring match reads the column as stored.
    const like = LIKE_SQL_OPS[operator];
    if (like) {
      // [#5567] Escaped pattern + an explicit `ESCAPE`, matching what
      // `driver-sql`'s `applyLike` binds for the same operator — so an author
      // who copies this statement out runs the predicate that ran.
      params.push(likePattern(like.shape, values[0]));
      const patternRef = `$${params.length}`;
      params.push(LIKE_ESCAPE_CHAR);
      // [#6520] The fold, when the operator carries one, wraps BOTH sides:
      // folding only the comparand compares a folded needle against a raw column
      // and returns just the rows that were already lower-case — a wrong row set
      // that looks like a working predicate.
      const lhs = like.fold ? asciiLowerSqlExpr(col) : col;
      const rhs = like.fold ? asciiLowerSqlExpr(patternRef) : patternRef;
      return `${lhs} ${like.sql} ${rhs} ESCAPE $${params.length}`;
    }

    const op = SCALAR_SQL_OPS[operator];
    if (!op) {
      // [#5333] THROW rather than `return null`. `renderFilterNodeSql` reads a
      // `null` as "this node constrains nothing", so the old exit deleted the
      // predicate from the echoed statement — and a rendering WIDER than
      // execution is the failure this whole render block exists to prevent
      // (#3601 / #3602 / #3650): the author runs it to reproduce a result, gets
      // more rows, and concludes the filter never applied.
      //
      // It can throw because the vocabulary upstream is CLOSED: `fieldLeaves`
      // in `filter-normalizer.ts` is the only producer of leaf nodes, and it
      // refuses an operator outside `MONGO_TO_CUBE_OP` with `INVALID_FILTER` /
      // 400 before a leaf exists. So no caller-authored filter can land here —
      // an arrival means the normalizer's table gained an entry this renderer
      // has no arm for, which is our bug, not the caller's, and the one answer
      // that must never be given for it is a silently wider query. Same call
      // `convertFilter`'s `default:` arm made when it stopped reading an
      // unmapped operator as equality (#4128). Deliberately NOT
      // `invalidFilterError`'s 400 envelope: this is drift between two of our
      // own tables, not a caller-shaped mistake.
      throw new Error(
        `[analytics] ObjectQLStrategy cannot render display SQL for filter operator ` +
        `"${operator}" (on "${col}"). The analytics operator vocabulary is closed — ` +
        `filter-normalizer.ts refuses anything it cannot map — so this means a new ` +
        `operator reached the normalizer without an arm here. Add one rather than ` +
        `dropping the predicate: an echo without it describes a WIDER query than the ` +
        `one that ran (#5333).`,
      );
    }
    params.push(values[0]);
    return `${col} ${op} $${params.length}`;
  }

  /**
   * Resolve a member ref to a `{ sql, type? }` definition.
   *
   * Mirrors `NativeSQLStrategy.lookupMember` so the two strategies
   * accept the same naming conventions:
   *   1. `<cube>.<field>`           — canonical analytics qualifier.
   *   2. `<lookup>.<field>`         — relation traversal (e.g. `account.industry`).
   *      Tries literal key, then underscore-flattened key, then falls
   *      back to a synthetic dim whose `sql` is the dotted path so the
   *      ObjectQL aggregate engine can traverse it via the lookup field.
   *   3. `<field>`                  — bare column on the cube's table.
   */
  private lookupMember(
    cube: Cube,
    member: string,
    kind: 'dimension' | 'measure',
  ): { sql: string; type?: string } | undefined {
    const bag = kind === 'dimension' ? cube.dimensions : cube.measures;
    if (bag[member]) return bag[member];
    if (member.includes('.')) {
      const [first, ...rest] = member.split('.');
      const tail = rest.join('.');
      if (first === cube.name && bag[tail]) return bag[tail];
      if (bag[tail]) return bag[tail];
      const flat = member.replace(/\./g, '_');
      if (bag[flat]) return bag[flat];
      if (kind === 'dimension') return { sql: member, type: 'string' };
    } else if (bag[member]) {
      return bag[member];
    }
    return undefined;
  }

  private resolveFieldName(cube: Cube, member: string, kind: 'dimension' | 'measure' | 'any'): string {
    if (kind === 'dimension' || kind === 'any') {
      const dim = this.lookupMember(cube, member, 'dimension');
      if (dim) return dim.sql.replace(/^\$/, '');
    }
    if (kind === 'measure' || kind === 'any') {
      const measure = this.lookupMember(cube, member, 'measure');
      if (measure) return measure.sql.replace(/^\$/, '');
    }
    return member.includes('.') ? member.split('.')[1] : member;
  }

  private resolveMeasureAggregation(cube: Cube, measureName: string): { field: string; method: string } {
    const direct = this.lookupMember(cube, measureName, 'measure') as
      | { sql: string; type: string }
      | undefined;
    if (direct) {
      return {
        field: direct.sql.replace(/^\$/, ''),
        method: direct.type === 'count_distinct' ? 'count_distinct' : direct.type,
      };
    }
    // Accept `${field}_${type}` aliases (e.g. 'amount_sum') for measures whose
    // canonical name is just `${field}` (e.g. measure 'amount' of type 'sum').
    // This matches the convention used by clients that build measure names
    // from (field, function) pairs (e.g. the data-objectstack adapter).
    const fieldName = measureName.includes('.') ? measureName.split('.')[1] : measureName;
    const aggTypes = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'];
    for (const type of aggTypes) {
      const suffix = `_${type}`;
      if (fieldName.endsWith(suffix)) {
        const baseField = fieldName.slice(0, -suffix.length);
        const candidate = cube.measures[baseField];
        if (candidate && candidate.type === type) {
          return {
            field: candidate.sql.replace(/^\$/, ''),
            method: candidate.type === 'count_distinct' ? 'count_distinct' : candidate.type,
          };
        }
      }
    }
    return { field: '*', method: 'count' };
  }

  /**
   * AND one more operand onto `filter[field]`, merging operator objects rather
   * than overwriting them. Returns a standalone conjunct when the two cannot
   * share one entry, or `null` when the merge absorbed the operand.
   *
   * Every predicate this strategy contributes goes through here — the caller's
   * `where` and the time-dimension `dateRange` alike. Two operands on one field
   * are the normal case (`{$gte}` from a `where` plus `{$gte,$lte}` from a
   * window on `close_date`), and a plain assignment would keep only the last:
   * that is how a range used to lose a bound.
   *
   * Spreading is sound only while the operands name DIFFERENT operators. Where
   * they collide — two `$gte` bounds on one field, which a window makes routine
   * and which a `where` can already produce on its own through `$and` — the
   * spread keeps whichever came last and WIDENS the query. Same for a bare
   * equality meeting an operator object: neither can absorb the other. Those
   * are handed back for the caller to AND in separately, so the engine
   * intersects them instead of the strategy picking a winner.
   */
  /**
   * Fold a normalized filter node into the engine filter being built.
   *
   * AND-ed LEAVES merge per field through {@link mergeFilterOperand}, exactly
   * as the flat loop this replaced did — so a query without combinators still
   * produces byte-identical engine input. Anything structural (`$or`, `$not`,
   * a nested `$and` that cannot merge) becomes its own conjunct, which the
   * caller ANDs in. The engine speaks these combinators natively
   * (`FilterCondition` declares them and every driver compiles them), so this
   * path hands them over rather than lowering them.
   */
  private applyFilterNode(
    node: NormalizedFilterNode | null,
    cube: Cube,
    filter: Record<string, unknown>,
    conjuncts: Record<string, unknown>[],
  ): void {
    if (!node) return;

    if (node.kind === 'leaf') {
      const fieldName = this.resolveFieldName(cube, node.member, 'any');
      const extra = this.mergeFilterOperand(filter, fieldName, this.convertFilter(node.operator, node.values));
      if (extra) conjuncts.push(extra);
      return;
    }

    if (node.kind === 'and') {
      for (const child of node.children) this.applyFilterNode(child, cube, filter, conjuncts);
      return;
    }

    const rendered = this.filterNodeToCondition(node, cube);
    if (rendered) conjuncts.push(rendered);
  }

  /**
   * A node as a standalone `FilterCondition` the engine can consume.
   *
   * `null` = no constraint, which is the boolean TRUE — the AND identity but the
   * OR ABSORBER, so a `null` branch makes the whole disjunction unconstrained
   * instead of collapsing it to its surviving branches (#5325). FALSE is handed
   * to the engine as `{$not: {}}`, the spelling `driver-sql`, `formula` and
   * `driver-memory`'s matcher all already pin as the zero-row filter (#5134) —
   * this strategy invents no second one.
   */
  private filterNodeToCondition(
    node: NormalizedFilterNode | null,
    cube: Cube,
  ): Record<string, unknown> | null {
    if (!node) return null;

    if (node.kind === 'const') {
      return node.value ? null : { $not: {} };
    }

    if (node.kind === 'not') {
      const inner = this.filterNodeToCondition(node.child, cube);
      // `NOT TRUE ≡ FALSE` — a negation of nothing is the zero-row filter, not
      // the absence of a filter (which is what let `{$not: {}}` chart every row).
      return inner ? { $not: inner } : { $not: {} };
    }

    if (node.kind === 'or') {
      const branches = node.children.map((child) => this.filterNodeToCondition(child, cube));
      // One TRUE disjunct absorbs the disjunction.
      if (branches.some((c) => c === null)) return null;
      const kept = branches.filter((c): c is Record<string, unknown> => !!c);
      return kept.length > 0 ? { $or: kept } : null;
    }

    // `leaf` and `and` share the merge path so one field carrying several
    // operators composes here the same way it does at the top level.
    const filter: Record<string, unknown> = {};
    const conjuncts: Record<string, unknown>[] = [];
    this.applyFilterNode(node, cube, filter, conjuncts);
    if (conjuncts.length > 0) {
      filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), ...conjuncts];
    }
    return Object.keys(filter).length > 0 ? filter : null;
  }

  /**
   * Render a normalized filter node as the display SQL `/analytics/sql`
   * echoes. Values still bind as `$n` placeholders — the echo travels to the
   * browser, so a comparand is never inlined.
   *
   * The boolean identities render too (#5325). This string exists to REPRODUCE
   * execution: a `{$not: {}}` filter that runs as zero rows but echoes SQL with
   * no `WHERE` hands whoever is debugging "why is this chart empty" a statement
   * that returns the whole table. Same reason the absorbed `$or` branch and the
   * `params` truncation below match {@link NativeSQLStrategy.compileFilterNode}
   * exactly — including the invariant that a `null` return leaves `params`
   * untouched, so no comparand is left with no placeholder to consume it.
   */
  private renderFilterNodeSql(
    node: NormalizedFilterNode | null,
    cube: Cube,
    params: unknown[],
  ): string | null {
    if (!node) return null;

    if (node.kind === 'const') {
      return node.value ? SQL_CONST_TRUE : SQL_CONST_FALSE;
    }

    if (node.kind === 'leaf') {
      return this.buildFilterClauseSql(
        this.resolveFieldName(cube, node.member, 'any'),
        node.operator,
        node.values,
        params,
      );
    }

    if (node.kind === 'not') {
      const inner = this.renderFilterNodeSql(node.child, cube, params);
      return inner ? `NOT (${inner})` : SQL_CONST_FALSE;
    }

    const paramBase = params.length;
    const parts: string[] = [];
    for (const child of node.children) {
      const clause = this.renderFilterNodeSql(child, cube, params);
      if (clause === null) {
        if (node.kind !== 'or') continue;
        params.length = paramBase;
        return null;
      }
      parts.push(clause);
    }
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    return `(${parts.join(node.kind === 'or' ? ' OR ' : ' AND ')})`;
  }

  private mergeFilterOperand(
    filter: Record<string, unknown>,
    field: string,
    operand: unknown,
  ): Record<string, unknown> | null {
    const existing = filter[field];
    if (existing === undefined) {
      filter[field] = operand;
      return null;
    }
    const mergeable = (v: unknown): v is Record<string, unknown> =>
      !!v && typeof v === 'object' && !Array.isArray(v);
    if (!mergeable(existing) || !mergeable(operand)) return { [field]: operand };
    if (Object.keys(operand).some((op) => op in existing)) return { [field]: operand };
    filter[field] = { ...existing, ...operand };
    return null;
  }

  /**
   * Lower `timeDimensions[].dateRange` into resolved-field bounds (#3650).
   *
   * `dateRange` states a WINDOW on a time dimension; it is a SIBLING of `where`,
   * never folded into it. `normalizeAnalyticsFilters` reads only `where`, so
   * this path used to drop the window on the floor — no error, just every row
   * ever recorded. Nor is that a corner case: `NativeSQLStrategy.canHandle`
   * declines any query carrying a `granularity`, so a date-bucketed trend lands
   * HERE on every driver — and "bucketed trend" is precisely the shape that also
   * carries a range ("last 12 months", "this quarter").
   *
   * Bounds are inclusive on both ends — logically "from day X through day Y".
   * The `$lte` end is left as the bare calendar day on purpose: the driver's
   * filter compiler owns the calendar-day → instant translation, compiling a
   * bare-day `$lte` on a `datetime` column into the half-open `< nextDay`
   * (#3777) while a `date` column keeps the plain `<=`. `NativeSQLStrategy`
   * performs the same half-open translation itself because it binds into raw
   * SQL, so one dashboard reads the same on every driver.
   *
   * [#5526] Bounds are forwarded at the type `dateRange` is DECLARED with —
   * `string` (`AnalyticsQuerySchema`'s `timeDimensions[].dateRange: string[]`) —
   * and nothing re-types them. They used to pass through
   * `coerceFilterValueForObjectQL`, whose TSDoc advertised that "an epoch-ms
   * bound recovers as a number"; that was a lenient CONSUMER rescuing a shape the
   * contract does not declare, and the same guess is what read a `'007'` filter
   * comparand as `7` (Prime Directive #12 — the producer or the spec is where an
   * epoch-ms window would have to be declared, not here). An author who wants an
   * instant window writes it as one; a declared `string` binds as a string. No
   * STORAGE coercion happens here either, deliberately: `NativeSQLStrategy` needs
   * `coerceTemporal` because it binds into raw SQL and had to learn that a
   * SQLite `Field.datetime` is an INTEGER epoch (#2034); this path goes through
   * `engine.aggregate()`, where the driver's own CRUD filter coercion applies —
   * the very coercion that already makes a `where` bound on that same column
   * work today.
   *
   * A bare-string `dateRange` degenerates to the single point `[s, s]`, matching
   * `NativeSQLStrategy`. Relative phrases ("Last 7 days") are NOT resolved here;
   * neither SQL path resolves them, and inventing a second interpretation on the
   * driver-independent path is how the two would drift apart again.
   *
   * An oddly-sized array (the schema types `dateRange` as a plain `string[]`)
   * takes its first two entries, a one-entry array degenerating to a point.
   * `NativeSQLStrategy` drops such a window entirely — but "drop the window"
   * means "plot all of history", which is the very failure this fixes, so the
   * fallback here errs toward the narrower query instead.
   */
  private dateRangeBounds(
    cube: Cube,
    query: AnalyticsQuery,
  ): Array<{ field: string; bounds: Record<string, unknown> }> {
    const out: Array<{ field: string; bounds: Record<string, unknown> }> = [];
    for (const td of query.timeDimensions ?? []) {
      if (!td.dateRange) continue;
      const range = Array.isArray(td.dateRange) ? td.dateRange : [td.dateRange, td.dateRange];
      const [start, end = start] = range;
      if (start == null) continue;
      out.push({
        field: this.resolveFieldName(cube, td.dimension, 'dimension'),
        bounds: { $gte: start, $lte: end },
      });
    }
    return out;
  }

  /**
   * One leaf as the operand the engine's `FilterCondition` expects.
   *
   * [#5526] The comparand is passed through UNCONVERTED. That is the whole of
   * this path's share of the fix: the engine compares against the value as
   * STORED, and a leaf now carries the value the author wrote, so `'007'` stays
   * `'007'`, `true` stays `true` and `7` stays `7` with nothing in between to
   * re-type them. The two `coerceFilterValueForObjectQL` calls this replaced
   * existed only to undo `stringifyForCube`, and undoing it required guessing.
   *
   * The four LIKE-family arms are the exception, and a contract one:
   * `filter.zod.ts` declares `$contains` / `$notContains` / `$startsWith` /
   * `$endsWith` as `z.string()`, so this PRODUCER must hand the engine a real
   * string — `String(…)`, the same normalisation `like-pattern.ts` applies at the
   * two SQL emitters and `driver-sql`'s `applyLike` applies at the driver, so one
   * `$contains` means one thing on every face (#5567's invariant).
   *
   * [#5234] Those four `String(…)` calls now only ever see a value that renders
   * faithfully: `fieldLeaves` refuses an object comparand on this family before a
   * leaf exists. That ordering is load-bearing rather than incidental — this arm
   * is a PRODUCER for the engine, so stringifying an object here would have
   * laundered it into `'[object Object]'` and handed a driver a perfectly
   * well-typed string. A strict driver downstream could never have seen the shape
   * it was strict about, which is why the guard sits at the door and not here.
   */
  private convertFilter(operator: string, values?: unknown[]): unknown {
    if (operator === 'set') return { $ne: null };
    if (operator === 'notSet') return null;
    if (!values || values.length === 0) return undefined;

    const v0 = values[0];
    // A COPY, not the leaf's own array: the `$in` / `$nin` operand below travels
    // into the filter object the engine receives, and a node of this tree is
    // never shared (see `falseNode`). The old `values.map(coerce…)` copied as a
    // side effect of converting; dropping the conversion must not drop the copy.
    const all = [...values];
    switch (operator) {
      // [#7598] IMPLICIT equality for a literal, EXPLICIT `$eq` for a field
      // reference — the branch is on the COMPARAND, not on the operator, which
      // is the same fix and the same reasoning #7597 applied to
      // `parseFilterAST`, the spec's own lowering sink.
      //
      // `{ amount: 5 }` is implicit equality and every backend reads it that
      // way. `{ amount: { $field: 'budget' } }` is NOT: it is a field-spec
      // object whose only key is `$field`, which no backend reads as an
      // equality — `driver-sql` sees an unrecognised operator key and the
      // memory evaluator sees a comparand it never resolves. So the bare return
      // was correct for four years' worth of literals and silently wrong for
      // the one comparand the 2026-08-12 ruling routes HERE on purpose: with it,
      // `{ amount: { $eq: { $field: 'budget' } } }` — the shape
      // `compileCelToFilter` emits for a field-to-field CEL rule, and the shape
      // `canHandle` now declines native SQL for — would arrive at the driver as
      // something the driver cannot read, so the capability B exists to serve
      // would fail on its single most important spelling. Its five siblings
      // (`$ne`/`$gt`/`$gte`/`$lt`/`$lte`) were never affected: they emit their
      // operator explicitly two lines down.
      case 'equals': return isFieldReference(v0) ? { $eq: v0 } : v0;
      case 'notEquals': return { $ne: v0 };
      case 'gt': return { $gt: v0 };
      case 'gte': return { $gte: v0 };
      case 'lt': return { $lt: v0 };
      case 'lte': return { $lte: v0 };
      // [#5557] `contains` was `{ $regex: values[0] }` — the comparand dropped
      // VERBATIM into a regex position while its three siblings below already
      // passed as canonical spec operators. Three things were wrong with that,
      // and none of them waits on #4706's ruling about what `$regex` should
      // mean:
      //
      //   1. `$regex` is not in `filter.zod.ts`'s `FILTER_OPERATORS`, so this
      //      was a PRODUCER emitting an operator the contract does not declare
      //      (Prime Directive #12 — fix the producer, not the consumers).
      //   2. `compileScopedFilterToSql` in this very package is a
      //      `FilterCondition` consumer and fails closed on `$regex`, so one
      //      filter tree no longer travelled between two consumers of the same
      //      contract sitting in the same directory.
      //   3. On a backend that reads `$regex` as a real regex — driver-memory's
      //      `memory-matcher.ts` does, deliberately, for plugin-auth's adapter
      //      — an unescaped comparand changes what the author asked for:
      //      `a.b` also matched `axb`, and `50% (+)` did not compile at all, so
      //      the `catch { return false }` answered zero rows in silence.
      //      `driver-sql` meanwhile compiles `$regex` to a substring LIKE, so
      //      the same widget returned different row sets per driver.
      //
      // `MONGO_TO_CUBE_OP` maps `$contains` → `contains` and nothing else does,
      // so returning `$contains` here is the round trip of the author's own key.
      case 'contains': return { $contains: String(v0) };
      // `notContains` had no arm and fell to the `default` below, which returns
      // a BARE VALUE — i.e. `{field: 'x'}`, an equality. "does not contain x"
      // was compiled as "equals x". These three pass through as the canonical
      // spec operators every driver implements directly, so an anchored match
      // stays anchored rather than depending on regex dialect (#4128).
      case 'notContains': return { $notContains: String(v0) };
      case 'startsWith': return { $startsWith: String(v0) };
      case 'endsWith': return { $endsWith: String(v0) };
      case 'in': return { $in: all };
      case 'notIn': return { $nin: all };
      default:
        // Was `return v0` — a silent reinterpretation of the operator as an
        // equality, the write-side twin of the normalizer's dropped predicate
        // (#4128). Every operator `normalizeAnalyticsFilters` can emit is
        // handled above, so reaching here means the two drifted apart.
        throw new Error(
          `[analytics] ObjectQL strategy cannot express filter operator "${operator}". ` +
          `Treating it as an equality would silently query something the author did not ask for.`,
        );
    }
  }

  private extractObjectName(cube: Cube): string {
    return cube.sql.trim();
  }

  /**
   * [#7598] The query's `where`, lowered — the same input
   * `NativeSQLStrategy.canHandle` scans, so the strategy that DECLINED and the
   * echo that refuses read one shape rather than two.
   *
   * A throw from the lowering is swallowed for the same reason it is there: the
   * `where` is malformed either way and `normalizeAnalyticsFilterTree` below
   * refuses it with the message and envelope it has always had. This helper's
   * only job is finding a reference, and there is none to find in a filter that
   * does not lower.
   */
  private loweredWhere(query: AnalyticsQuery): unknown {
    try {
      return lowerAnalyticsWhere(query);
    } catch {
      return null;
    }
  }

  /**
   * The dimensions this query PROJECTS, in the order the result carries them:
   * every `dimensions` entry, then every granular `timeDimensions` entry that
   * is not already one of them.
   *
   * `timeDimensions` is not merely a filter carrier. An entry with a
   * `granularity` is GROUPED BY — see the `td.granularity` sites that build
   * groupBy here, in `generateSql` and in the cross-object path — so its
   * bucket is a COLUMN of the result; an entry without one only contributes a
   * `dateRange` predicate and must NOT be projected.
   *
   * Grouping, row mapping and {@link buildFieldMeta} have to agree on exactly
   * that set. When they did not, a bucketed query returned rows carrying only
   * the measures and a `fields` list that never mentioned the bucket — a trend
   * chart got N values and no x-axis (#4033) — even though the SQL had
   * selected `date_trunc(…) AS "<dim>"` all along. One definition, every
   * consumer.
   */
  private projectedDimensions(query: AnalyticsQuery): string[] {
    const out = [...(query.dimensions ?? [])];
    for (const td of query.timeDimensions ?? []) {
      if (td.granularity && !out.includes(td.dimension)) out.push(td.dimension);
    }
    return out;
  }

  private buildFieldMeta(query: AnalyticsQuery, cube: Cube): Array<{ name: string; type: string }> {
    const fields: Array<{ name: string; type: string }> = [];
    for (const dim of this.projectedDimensions(query)) {
      const d = this.lookupMember(cube, dim, 'dimension');
      fields.push({ name: dim, type: d?.type || 'string' });
    }
    if (query.measures) {
      for (const m of query.measures) {
        fields.push({ name: m, type: 'number' });
      }
    }
    return fields;
  }
}
