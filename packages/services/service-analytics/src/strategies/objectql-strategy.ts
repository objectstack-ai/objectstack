// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsStrategy, StrategyContext } from './types.js';
import { normalizeAnalyticsFilters, coerceFilterValueForObjectQL } from './filter-normalizer.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

/** Scalar analytics operators → their SQL spelling (display SQL only). */
const SCALAR_SQL_OPS: Record<string, string> = {
  equals: '=', notEquals: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
};

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

    // ADR-0021 D-C — the read scope (tenant + RLS) MUST be ANDed in before the
    // query leaves the strategy. Rejects the query outright when a joined object
    // carries a scope this path cannot express (#3597).
    this.assertJoinedScopesEnforceable(cube, query, ctx);

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
    return { rows: mappedRows, fields };
  }

  async generateSql(query: AnalyticsQuery, ctx: StrategyContext): Promise<{ sql: string; params: unknown[] }> {
    const cube = ctx.getCube(query.cube!);
    if (!cube) {
      throw new Error(`Cube not found: ${query.cube}`);
    }

    // Generate a representative SQL even though ObjectQL uses AST internally
    const selectParts: string[] = [];
    const groupByParts: string[] = [];

    if (query.dimensions) {
      for (const dim of query.dimensions) {
        const col = this.resolveFieldName(cube, dim, 'dimension');
        selectParts.push(`${col} AS "${dim}"`);
        groupByParts.push(col);
      }
    }
    if (query.measures) {
      for (const m of query.measures) {
        const { field, method } = this.resolveMeasureAggregation(cube, m);
        const aggSql = method === 'count' ? 'COUNT(*)' : `${method.toUpperCase()}(${field})`;
        selectParts.push(`${aggSql} AS "${m}"`);
      }
    }

    const tableName = this.extractObjectName(cube);

    // ADR-0021 D-C (#3602) — the preview carries the SAME predicate the query
    // actually runs with. Emitting only SELECT/GROUP BY made `/analytics/sql`
    // read as an unscoped full-table scan while the real aggregate was scoped
    // (#3601), so anyone debugging a "why is this row missing" was handed SQL
    // that could not reproduce the result. Nothing leaked — this string is
    // never executed — but a preview that contradicts execution is worse than
    // no preview.
    //
    // Faithfulness cuts both ways: `execute()` does NOT apply
    // `timeDimensions[].dateRange` on this path (only `where` reaches the
    // engine), so neither does this. Rendering a BETWEEN here would invent a
    // predicate the ObjectQL path never applies. That gap is real but separate
    // — filed as #3650, not papered over here.
    this.assertJoinedScopesEnforceable(cube, query, ctx);

    const params: unknown[] = [];
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
    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.join(' AND ')}`;
    }
    if (groupByParts.length > 0) {
      sql += ` GROUP BY ${groupByParts.join(', ')}`;
    }

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

  /**
   * Fail-closed guard for cross-object queries (#3597).
   *
   * `engine.aggregate`'s `where` addresses the BASE object. A dotted member
   * (`account.region`) is traversed by the engine through the lookup field, but
   * there is no place in this call shape to hang a predicate on the JOINED
   * object — so a joined object's read scope cannot be enforced here.
   *
   * `NativeSQLStrategy` can express it (alias-qualified WHERE per join) and does.
   * When this path cannot, we reject rather than run a partially-scoped query:
   * the same posture as `resolveReadScopes` (throws rather than emit unscoped
   * SQL) and `compileScopedFilterToSql` (throws rather than drop a predicate).
   *
   * Only joins the query ACTUALLY references are considered — the scope map is
   * a deliberate superset of what gets scanned, so keying off the map alone
   * would reject queries that never touch the joined table.
   */
  private assertJoinedScopesEnforceable(
    cube: Cube,
    query: AnalyticsQuery,
    ctx: StrategyContext,
  ): void {
    if (typeof ctx.getReadScope !== 'function') return;

    const referenced = this.referencedFieldNames(cube, query);

    const offending = new Set<string>();
    for (const fieldName of referenced) {
      if (!fieldName.includes('.')) continue;
      const alias = fieldName.split('.')[0];
      const joinedObject = cube.joins?.[alias]?.name ?? alias;
      if (joinedObject === this.extractObjectName(cube)) continue;
      const scope = ctx.getReadScope(joinedObject);
      if (scope !== undefined && scope !== null) offending.add(joinedObject);
    }
    if (offending.size === 0) return;

    throw new Error(
      `[Analytics] ObjectQLStrategy cannot enforce the read scope of joined ` +
      `object(s) ${[...offending].map((o) => `"${o}"`).join(', ')} — denying the ` +
      `query (fail-closed, ADR-0021 D-C). This path reaches the joined table ` +
      `through the base object's lookup, where a per-join security predicate ` +
      `cannot be expressed. Run this query on a driver that supports native SQL ` +
      `(NativeSQLStrategy scopes each join), or drop the cross-object ` +
      `dimension/measure from the query.`,
    );
  }

  /**
   * Every field name the query puts in front of the engine — group-bys, filter
   * members and measure sources — resolved exactly as the corresponding clause
   * resolves it in `execute()`. A dotted name is a relationship traversal whose
   * first segment is the join alias, which is what the scope guard keys off.
   *
   * Derived from `(cube, query)` alone so `execute()` and `generateSql()` run
   * the guard over the identical field set; duplicates are fine, the caller
   * dedupes by offending object.
   */
  private referencedFieldNames(cube: Cube, query: AnalyticsQuery): string[] {
    const names: string[] = [];
    for (const dim of query.dimensions ?? []) {
      names.push(this.resolveFieldName(cube, dim, 'dimension'));
    }
    for (const td of query.timeDimensions ?? []) {
      names.push(this.resolveFieldName(cube, td.dimension, 'dimension'));
    }
    for (const f of normalizeAnalyticsFilters(query)) {
      names.push(this.resolveFieldName(cube, f.member, 'any'));
    }
    for (const m of query.measures ?? []) {
      names.push(this.resolveMeasureAggregation(cube, m).field);
    }
    return names;
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
