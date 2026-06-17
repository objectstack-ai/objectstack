// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsStrategy, StrategyContext } from './types.js';
import { normalizeAnalyticsFilters, coerceFilterValueForSql } from './filter-normalizer.js';

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

    const rows = await ctx.executeAggregate!(objectName, {
      // Structured groupBy items ({field, dateGranularity}) pass through the
      // executeAggregate bridge to engine.aggregate, which buckets them. The
      // contract types groupBy as string[]; the cast carries the richer shape.
      groupBy: groupBy.length > 0 ? (groupBy as unknown as string[]) : undefined,
      aggregations: aggregations.length > 0 ? aggregations : undefined,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
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

    const v0 = coerceFilterValueForSql(values[0]);
    const all = values.map(coerceFilterValueForSql);
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
