// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsStrategy, StrategyContext } from './types.js';
import { normalizeAnalyticsFilters, coerceFilterValueForObjectQL } from './filter-normalizer.js';

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

    // Reject cross-object grouping/aggregation this path cannot perform — the
    // engine has no join, so it would silently mis-bucket or error (#3654). This
    // runs BEFORE scope injection and subsumes the #3597 joined-scope concern:
    // a rejected query never loads the joined object, so nothing is left
    // unscoped. Independent of read scope, so it fires with security off too.
    this.assertNoCrossObjectReferences(cube, query, groupBy, filter);

    // ADR-0021 D-C — the base object's read scope (tenant + RLS) MUST be ANDed
    // in before the query leaves the strategy (#3597).
    // (`assertNoCrossObjectReferences` above guarantees `objectName` is the only
    // object in play, so a single base-object scope is sufficient here.)

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
    let sql = `SELECT ${selectParts.join(', ')} FROM "${tableName}"`;
    if (groupByParts.length > 0) {
      sql += ` GROUP BY ${groupByParts.join(', ')}`;
    }

    return { sql, params: [] };
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
   * Fail-closed guard for cross-object references on the ObjectQL path
   * (#3654, subsuming #3597).
   *
   * `engine.aggregate()` has NO join: it never expands a lookup, and the SQL
   * driver's aggregate emits no `JOIN`. A dotted member like `account.region`
   * therefore reaches the engine as a bare column that no table in the query
   * provides. The failure is SILENT and wrong, not loud:
   *   - native SQL path → "column account.region does not exist" (a hard error);
   *   - in-memory path  → `row['account.region']` is always `undefined`, so every
   *     row collapses into ONE `(null)` bucket and the measure is summed across
   *     the whole table — a plausible-looking number that is actually a
   *     full-table total mislabelled `(null)`.
   *
   * So we reject any cross-object reference OUTRIGHT — regardless of read scope.
   * This also subsumes the #3597 concern: because the joined object is never
   * loaded on this path, there is nothing to leave unscoped. Cross-object
   * datasets are served by `NativeSQLStrategy`, which hand-compiles the LEFT
   * JOINs (and scopes each one); this path is the fallback NativeSQL declines
   * (date-granularity bucketing, in-memory driver, federated objects), and it
   * cannot join, so "loud rejection" beats "silent wrong answer".
   *
   * Detection is on the RESOLVED field names (post-`resolveFieldName`), so a
   * dotted dimension the cube flattens to a real column is NOT flagged — only
   * genuinely-unresolved relationship traversals are.
   */
  private assertNoCrossObjectReferences(
    cube: Cube,
    query: AnalyticsQuery,
    groupBy: Array<string | { field: string; dateGranularity: string }>,
    filter: Record<string, unknown>,
  ): void {
    // Field names as they will reach the engine. A dotted name whose first
    // segment names a DIFFERENT object is a relationship traversal the engine
    // cannot perform in an aggregate.
    const referenced = [
      ...groupBy.map((g) => (typeof g === 'string' ? g : g.field)),
      ...Object.keys(filter),
      ...(query.measures ?? []).map((m) => this.resolveMeasureAggregation(cube, m).field),
    ];

    const baseObject = this.extractObjectName(cube);
    const offending = new Set<string>();
    for (const fieldName of referenced) {
      if (!fieldName.includes('.')) continue;
      const alias = fieldName.split('.')[0];
      const joinedObject = cube.joins?.[alias]?.name ?? alias;
      if (joinedObject === baseObject) continue;
      offending.add(fieldName);
    }
    if (offending.size === 0) return;

    throw new Error(
      `[Analytics] ObjectQLStrategy cannot group or aggregate across a ` +
      `relationship (cross-object reference(s): ` +
      `${[...offending].map((f) => `"${f}"`).join(', ')}). ` +
      `engine.aggregate() does not join, so the referenced object is never ` +
      `loaded — this path would silently bucket every row under a single ` +
      `"(null)" group (or error outright on a SQL driver), and could not scope ` +
      `the joined object's rows. Run this query where NativeSQLStrategy handles ` +
      `it (a raw-SQL/JOIN-capable driver with no date-granularity bucketing), or ` +
      `drop the cross-object dimension/measure from the query.`,
    );
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
