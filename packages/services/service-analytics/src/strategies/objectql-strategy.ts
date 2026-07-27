// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsStrategy, StrategyContext } from './types.js';
import { normalizeAnalyticsFilters, coerceFilterValueForObjectQL } from './filter-normalizer.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
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

    // Build filter from query filters. A single field may carry MULTIPLE
    // operators (e.g. a range `{$gte, $lte}` from `close_date` between two
    // bounds). Merge same-field operator objects instead of overwriting, or a
    // range would silently lose a bound (only the last operator would survive).
    const filter: Record<string, unknown> = {};
    const normalizedFilters = normalizeAnalyticsFilters(query);
    if (normalizedFilters.length > 0) {
      for (const f of normalizedFilters) {
        const fieldName = this.resolveFieldName(cube, f.member, 'any');
        const converted = this.convertFilter(f.operator, f.values);
        const existing = filter[fieldName];
        const mergeable = (v: unknown): v is Record<string, unknown> =>
          !!v && typeof v === 'object' && !Array.isArray(v);
        filter[fieldName] = mergeable(existing) && mergeable(converted)
          ? { ...existing, ...converted }
          : converted;
      }
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

    // Remap short field names back to cube-qualified names
    const mappedRows = rows.map(row => {
      const mapped: Record<string, unknown> = {};
      if (query.dimensions) {
        for (const dim of query.dimensions) {
          const shortName = this.resolveFieldName(cube, dim, 'dimension');
          if (shortName in row) mapped[dim] = row[shortName];
        }
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
    const plan = this.planCrossObject(cube, query, Object.fromEntries(
      normalizeAnalyticsFilters(query).map((f) => [this.resolveFieldName(cube, f.member, 'any'), true]),
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
    // Faithfulness cuts both ways: `execute()` does NOT apply
    // `timeDimensions[].dateRange` on this path (only `where` reaches the
    // engine), so neither does this. Rendering a BETWEEN here would invent a
    // predicate the ObjectQL path never applies. That gap is real but separate
    // — filed as #3650, not papered over here.
    // (The cross-object envelope was already enforced by `planCrossObject` above,
    // so `/analytics/sql` rejects the same out-of-envelope set `execute()` does.)

    const whereParts: string[] = [];
    for (const f of normalizeAnalyticsFilters(query)) {
      const clause = this.buildFilterClauseSql(
        this.resolveFieldName(cube, f.member, 'any'),
        f.operator,
        f.values,
        params,
      );
      if (clause) whereParts.push(clause);
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
    const userFilter = Object.keys(filter).length > 0 ? filter : undefined;
    if (typeof ctx.getReadScope !== 'function') return userFilter;
    const scope = ctx.getReadScope(objectName);
    if (scope === undefined || scope === null) return userFilter;
    const scopeFilter = scope as Record<string, unknown>;
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
   * Detection is on RESOLVED field names, so a dotted dimension the cube
   * flattens to a real column is treated as base, not cross-object.
   */
  private planCrossObject(
    cube: Cube,
    query: AnalyticsQuery,
    filter: Record<string, unknown>,
  ): CrossObjectPlan | null {
    const baseObject = this.extractObjectName(cube);

    // A cross-object MEASURE or FILTER can only be evaluated with a real join.
    const nonDim = [
      ...(query.measures ?? []).map((m) => ({ where: 'measure', field: this.resolveMeasureAggregation(cube, m).field })),
      ...Object.keys(filter).map((f) => ({ where: 'filter', field: f })),
    ].filter((r) => this.isCrossObjectField(cube, r.field, baseObject));
    if (nonDim.length > 0) {
      throw new Error(
        `[Analytics] ObjectQLStrategy cannot evaluate a cross-object ${nonDim[0].where} ` +
        `("${nonDim[0].field}") — the engine cannot join in an aggregate. Run this ` +
        `query on a native-SQL driver, or remove the cross-object ${nonDim[0].where}.`,
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
        throw new Error(
          `[Analytics] ObjectQLStrategy supports only single-hop cross-object ` +
          `dimensions; "${field}" traverses more than one relationship.`,
        );
      }
      crossDims.push({ outputName: dim, fkField: alias, attr, refObject: cube.joins?.[alias]?.name ?? alias });
    }
    // A date bucket over a related object's field is not supported.
    for (const td of query.timeDimensions ?? []) {
      const field = this.resolveFieldName(cube, td.dimension, 'dimension');
      if (this.isCrossObjectField(cube, field, baseObject)) {
        throw new Error(
          `[Analytics] ObjectQLStrategy cannot bucket a cross-object time dimension ("${field}").`,
        );
      }
    }

    if (crossDims.length === 0) return null;

    // Every measure must re-combine across the intermediate FK sub-buckets.
    for (const m of query.measures ?? []) {
      const { method } = this.resolveMeasureAggregation(cube, m);
      if (!RECOMBINABLE_METHODS.has(method)) {
        throw new Error(
          `[Analytics] ObjectQLStrategy cannot group by a cross-object dimension ` +
          `with a "${method}" measure ("${m}") — its value cannot be recombined ` +
          `across the intermediate FK grouping. Use sum/count/min/max, or run on ` +
          `a native-SQL driver.`,
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
      for (const dim of query.dimensions ?? []) {
        if (crossByDim.has(dim)) {
          if (dim in row) out[dim] = row[dim];
        } else {
          const field = this.resolveFieldName(cube, dim, 'dimension');
          if (field in row) out[dim] = row[field];
        }
      }
      for (const td of query.timeDimensions ?? []) {
        if (query.dimensions?.includes(td.dimension)) continue;
        const field = this.resolveFieldName(cube, td.dimension, 'dimension');
        if (field in row) out[td.dimension] = row[field];
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
   * two previews read alike, but binds through `coerceFilterValueForObjectQL`:
   * the comparand shown is the one THIS path actually hands the engine (a real
   * boolean, not SQL's 1/0). Returns null for an operator/value combination
   * that carries no predicate, matching `execute()`, which drops it too.
   */
  private buildFilterClauseSql(
    col: string,
    operator: string,
    values: string[] | undefined,
    params: unknown[],
  ): string | null {
    if (operator === 'set') return `${col} IS NOT NULL`;
    if (operator === 'notSet') return `${col} IS NULL`;

    if (!values || values.length === 0) return null;

    if (operator === 'in' || operator === 'notIn') {
      const placeholders = values
        .map((v) => { params.push(coerceFilterValueForObjectQL(v)); return `$${params.length}`; })
        .join(', ');
      return `${col} ${operator === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`;
    }

    if (operator === 'contains' || operator === 'notContains') {
      params.push(`%${values[0]}%`);
      return `${col} ${operator === 'contains' ? 'LIKE' : 'NOT LIKE'} $${params.length}`;
    }

    const op = SCALAR_SQL_OPS[operator];
    if (!op) return null;
    params.push(coerceFilterValueForObjectQL(values[0]));
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

  private convertFilter(operator: string, values?: string[]): unknown {
    if (operator === 'set') return { $ne: null };
    if (operator === 'notSet') return null;
    if (!values || values.length === 0) return undefined;

    const v0 = coerceFilterValueForObjectQL(values[0]);
    const all = values.map(coerceFilterValueForObjectQL);
    switch (operator) {
      case 'equals': return v0;
      case 'notEquals': return { $ne: v0 };
      case 'gt': return { $gt: v0 };
      case 'gte': return { $gte: v0 };
      case 'lt': return { $lt: v0 };
      case 'lte': return { $lte: v0 };
      case 'contains': return { $regex: values[0] };
      case 'in': return { $in: all };
      case 'notIn': return { $nin: all };
      default: return v0;
    }
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
