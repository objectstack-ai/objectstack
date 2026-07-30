// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IAnalyticsService, AnalyticsResult, CubeMeta } from '@objectstack/spec/contracts';
import type { Cube, AnalyticsQuery } from '@objectstack/spec/data';
import type { InMemoryDriver } from './memory-driver.js';
import { Logger, createLogger, nextUtcCalendarDay } from '@objectstack/core';

/**
 * Configuration for MemoryAnalyticsService
 */
export interface MemoryAnalyticsConfig {
  /** The data driver instance to use for queries */
  driver: InMemoryDriver;
  /** Cube definitions for the semantic layer */
  cubes: Cube[];
  /** Optional logger */
  logger?: Logger;
}

/**
 * Memory-Based Analytics Service
 * 
 * Implements IAnalyticsService using InMemoryDriver's aggregation capabilities.
 * Provides a semantic layer (Cubes, Metrics, Dimensions) on top of in-memory data.
 * 
 * Features:
 * - Cube-based semantic modeling
 * - Measure calculations (count, sum, avg, min, max, count_distinct)
 * - Dimension grouping
 * - Filter support
 * - Time dimension handling
 * - SQL generation (for debugging/transparency)
 * 
 * This implementation is suitable for:
 * - Development and testing
 * - Local-first analytics
 * - Small to medium datasets
 * - Prototyping BI applications
 */
export class MemoryAnalyticsService implements IAnalyticsService {
  private driver: InMemoryDriver;
  private cubes: Map<string, Cube>;
  private logger: Logger;

  constructor(config: MemoryAnalyticsConfig) {
    this.driver = config.driver;
    this.cubes = new Map(config.cubes.map(c => [c.name, c]));
    this.logger = config.logger || createLogger({ level: 'info', format: 'pretty' });
    this.logger.debug('MemoryAnalyticsService initialized', { cubeCount: this.cubes.size });
  }

  /**
   * Execute an analytical query using the memory driver's aggregation pipeline
   */
  async query(query: AnalyticsQuery): Promise<AnalyticsResult> {
    this.logger.debug('Executing analytics query', { cube: query.cube, measures: query.measures });

    // Get cube definition
    if (!query.cube) {
      throw new Error('Cube name is required');
    }
    const cube = this.cubes.get(query.cube);
    if (!cube) {
      throw new Error(`Cube not found: ${query.cube}`);
    }

    // Build MongoDB aggregation pipeline
    const pipeline: Record<string, any>[] = [];

    // Stage 1: $match for filters
    // Filters can arrive in two shapes (per spec/data/analytics.zod.ts):
    //   - Array of { member, operator, values } (cube-style, legacy)
    //   - FilterCondition (MongoDB-style — canonical spec shape, used by
    //     dashboard widget metadata directly).
    // Normalize both into the cube-style array before processing so the
    // existing pipeline logic stays untouched.
    const normalizedFilters = this.normalizeFilters(query);
    if (normalizedFilters.length > 0) {
      const matchStage: Record<string, any> = {};
      for (const filter of normalizedFilters) {
        const mongoOp = this.convertOperatorToMongo(filter.operator);
        const fieldPath = this.resolveFieldPath(cube, filter.member);

        if (filter.values && filter.values.length > 0) {
          // Coerce each filter value to a sensible runtime type so
          // `$eq` against in-memory numeric/boolean records still
          // matches. The cube spec serialises values as `string[]`,
          // but the in-memory driver compares with strict equality.
          const coerced = filter.values.map(v => this.coerceFilterValue(v));
          if (mongoOp === '$in') {
            matchStage[fieldPath] = { $in: coerced };
          } else if (mongoOp === '$nin') {
            matchStage[fieldPath] = { $nin: coerced };
          } else if (mongoOp === '$lte') {
            // A bare-day `lte` bound means "through that whole day" (#4042;
            // the SQL twin is #3777): compile half-open so timestamp values on
            // the final day stay in. Order-equivalent to `$lte` for plain
            // `YYYY-MM-DD` values.
            const nextDay = nextUtcCalendarDay(coerced[0]);
            matchStage[fieldPath] = nextDay != null ? { $lt: nextDay } : { $lte: coerced[0] };
          } else {
            matchStage[fieldPath] = { [mongoOp]: coerced[0] };
          }
        } else if (mongoOp === '$exists') {
          matchStage[fieldPath] = { $exists: filter.operator === 'set' };
        }
      }
      if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
      }
    }

    // Stage 2: Time dimension filters
    if (query.timeDimensions && query.timeDimensions.length > 0) {
      for (const timeDim of query.timeDimensions) {
        const fieldPath = this.resolveFieldPath(cube, timeDim.dimension);
        if (timeDim.dateRange) {
          const range = Array.isArray(timeDim.dateRange)
            ? timeDim.dateRange
            : this.parseDateRangeString(timeDim.dateRange);

          if (range.length === 2) {
            // The window matches BOTH stored forms of a datetime value — the
            // in-memory table holds whatever the writer produced: `Date`
            // objects from direct JS callers AND ISO strings (the driver's own
            // `created_at` default, every REST/JSON write). Mingo compares
            // cross-type as never-equal, so a single-form bound silently
            // empties the other half — the same disease driver-sql's
            // mixed-storage CASE repair cures, expressed as the `$or` a
            // schemaless store allows.
            //
            // Both spellings are half-open on a bare-day end (#4042; the SQL
            // twin is #3777): a `$lte`-at-midnight upper bound dropped the
            // final day's rows for `Date` values and the string spelling
            // inherits `<= day`'s whole-day intent via `< nextDay`.
            const start = String(range[0]);
            const end = String(range[1]);
            const nextDay = nextUtcCalendarDay(end);
            const stringBounds = nextDay != null
              ? { $gte: start, $lt: nextDay }
              : { $gte: start, $lte: end };
            const dateBounds = nextDay != null
              ? { $gte: new Date(start), $lt: new Date(`${nextDay}T00:00:00.000Z`) }
              : { $gte: new Date(start), $lte: new Date(end) };
            pipeline.push({
              $match: {
                $or: [
                  { [fieldPath]: stringBounds },
                  { [fieldPath]: dateBounds },
                ],
              }
            });
          }
        }
      }
    }

    // Stage 3: $group for measures and dimensions
    const groupStage: Record<string, any> = { _id: {} };
    
    // Add dimensions to _id
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const fieldPath = this.resolveFieldPath(cube, dim);
        const dimName = this.getShortName(dim);
        groupStage._id[dimName] = `$${fieldPath}`;
      }
    } else {
      groupStage._id = null; // No grouping, aggregate all
    }

    // Add measures as computed fields
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        const measureDef = this.resolveMeasure(cube, measure);
        const measureName = this.getShortName(measure);
        
        if (measureDef) {
          const aggregator = this.buildAggregator(measureDef);
          groupStage[measureName] = aggregator;
        }
      }
    }

    pipeline.push({ $group: groupStage });

    // Stage 4: $project to reshape results (use short names, we'll fix them later)
    const projectStage: Record<string, any> = { _id: 0 };
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const dimName = this.getShortName(dim);
        projectStage[dimName] = `$_id.${dimName}`;
      }
    }
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        const measureName = this.getShortName(measure);
        projectStage[measureName] = `$${measureName}`;
      }
    }
    pipeline.push({ $project: projectStage });

    // Stage 5: $sort (use short names)
    if (query.order && Object.keys(query.order).length > 0) {
      const sortStage: Record<string, any> = {};
      for (const [field, direction] of Object.entries(query.order)) {
        const shortName = this.getShortName(field);
        sortStage[shortName] = direction === 'asc' ? 1 : -1;
      }
      pipeline.push({ $sort: sortStage });
    }

    // Stage 6: $limit and $skip
    if (query.offset) {
      pipeline.push({ $skip: query.offset });
    }
    if (query.limit) {
      pipeline.push({ $limit: query.limit });
    }

    // Execute the aggregation pipeline
    const tableName = this.extractTableName(cube.sql);
    const rawRows = await this.driver.aggregate(tableName, pipeline);

    // Rename fields from short names to full cube.field names
    const rows = rawRows.map(row => {
      const renamedRow: Record<string, unknown> = {};
      
      // Rename dimensions
      if (query.dimensions) {
        for (const dim of query.dimensions) {
          const shortName = this.getShortName(dim);
          if (shortName in row) {
            renamedRow[dim] = row[shortName];
          }
        }
      }
      
      // Rename measures
      if (query.measures) {
        for (const measure of query.measures) {
          const shortName = this.getShortName(measure);
          if (shortName in row) {
            renamedRow[measure] = row[shortName];
          }
        }
      }
      
      return renamedRow;
    });

    // Build field metadata
    const fields: Array<{ name: string; type: string }> = [];
    
    if (query.dimensions) {
      for (const dim of query.dimensions) {
        const dimension = this.resolveDimension(cube, dim);
        fields.push({
          name: dim,
          type: dimension?.type || 'string'
        });
      }
    }
    
    if (query.measures) {
      for (const measure of query.measures) {
        const measureDef = this.resolveMeasure(cube, measure);
        fields.push({
          name: measure,
          type: this.measureTypeToFieldType(measureDef?.type || 'count')
        });
      }
    }

    this.logger.debug('Analytics query completed', { rowCount: rows.length });

    return {
      rows,
      fields,
      sql: this.generateSqlFromPipeline(tableName, pipeline) // For debugging
    };
  }

  /**
   * Get available cube metadata for discovery
   */
  async getMeta(cubeName?: string): Promise<CubeMeta[]> {
    const cubes = cubeName 
      ? [this.cubes.get(cubeName)].filter(Boolean) as Cube[]
      : Array.from(this.cubes.values());

    return cubes.map(cube => ({
      name: cube.name,
      title: cube.title,
      measures: Object.entries(cube.measures).map(([key, measure]) => ({
        name: `${cube.name}.${key}`,
        type: measure.type,
        title: measure.label
      })),
      dimensions: Object.entries(cube.dimensions).map(([key, dimension]) => ({
        name: `${cube.name}.${key}`,
        type: dimension.type,
        title: dimension.label
      }))
    }));
  }

  /**
   * Generate SQL representation for debugging/transparency
   */
  async generateSql(query: AnalyticsQuery): Promise<{ sql: string; params: unknown[] }> {
    if (!query.cube) {
      throw new Error('Cube name is required');
    }
    const cube = this.cubes.get(query.cube);
    if (!cube) {
      throw new Error(`Cube not found: ${query.cube}`);
    }

    const tableName = this.extractTableName(cube.sql);
    const selectClauses: string[] = [];
    const groupByClauses: string[] = [];

    // Build SELECT for dimensions
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const fieldPath = this.resolveFieldPath(cube, dim);
        selectClauses.push(`${fieldPath} AS "${dim}"`);
        groupByClauses.push(fieldPath);
      }
    }

    // Build SELECT for measures
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        const measureDef = this.resolveMeasure(cube, measure);
        if (measureDef) {
          const aggSql = this.measureToSql(measureDef);
          selectClauses.push(`${aggSql} AS "${measure}"`);
        }
      }
    }

    // Build WHERE clause
    const whereClauses: string[] = [];
    const normalizedFilters = this.normalizeFilters(query);
    if (normalizedFilters.length > 0) {
      for (const filter of normalizedFilters) {
        const fieldPath = this.resolveFieldPath(cube, filter.member);
        const sqlOp = this.operatorToSql(filter.operator);
        if (filter.values && filter.values.length > 0) {
          const literal = this.toSqlLiteral(filter.values[0]);
          whereClauses.push(`${fieldPath} ${sqlOp} ${literal}`);
        }
      }
    }

    let sql = `SELECT ${selectClauses.join(', ')} FROM ${tableName}`;
    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    if (groupByClauses.length > 0) {
      sql += ` GROUP BY ${groupByClauses.join(', ')}`;
    }
    if (query.order) {
      const orderClauses = Object.entries(query.order).map(([field, dir]) => 
        `"${field}" ${dir.toUpperCase()}`
      );
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }
    if (query.limit) {
      sql += ` LIMIT ${query.limit}`;
    }
    if (query.offset) {
      sql += ` OFFSET ${query.offset}`;
    }

    return { sql, params: [] };
  }

  // ===================================
  // Helper Methods
  // ===================================

  /**
   * Normalize filters into a cube-style array regardless of input shape.
   *
   * Accepts:
   *   - undefined / null → []
   *   - cube-style array `[{member, operator, values}]` → returned as-is
   *   - MongoDB FilterCondition object (per spec/data/filter.zod.ts):
   *       * implicit equality:  `{is_active: true}`
   *       * operator wrapper:   `{stage: {$nin: [...]}}`
   *       * mixed:              `{stage: 'won', amount: {$gte: 100}}`
   *     → flattened into one cube-style entry per (field, operator) pair
   *
   * Logical combinators (`$and`, `$or`, `$not`) are not yet expanded into
   * the cube pipeline; for current dashboard widget metadata the implicit
   * top-level AND of fields is sufficient. `$and` clauses are flattened
   * into the same AND list.
   */
  private normalizeFilters(query: unknown): Array<{ member: string; operator: string; values: string[] }> {
    if (!query || typeof query !== 'object') return [];

    const out: Array<{ member: string; operator: string; values: string[] }> = [];
    const where = (query as { where?: unknown }).where;

    if (where && typeof where === 'object' && !Array.isArray(where)) {
      this.flattenFilterCondition(where as Record<string, unknown>, out);
    }

    return out;
  }

  private flattenFilterCondition(
    cond: Record<string, unknown>,
    out: Array<{ member: string; operator: string; values: string[] }>,
  ): void {
    for (const [key, raw] of Object.entries(cond)) {
      if (raw == null) continue;

      // Logical combinators
      if (key === '$and' && Array.isArray(raw)) {
        for (const sub of raw) {
          if (sub && typeof sub === 'object') {
            this.flattenFilterCondition(sub as Record<string, unknown>, out);
          }
        }
        continue;
      }
      // $or / $not are not yet supported in the cube pipeline; ignore so
      // a partial query still runs rather than failing entirely.
      if (key === '$or' || key === '$not') continue;

      // Operator wrapper: { field: { $op: value, ... } }
      if (typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Date)) {
        const wrapper = raw as Record<string, unknown>;
        const opEntries = Object.keys(wrapper).filter(k => k.startsWith('$'));
        if (opEntries.length > 0) {
          for (const opKey of opEntries) {
            const cubeOp = this.mongoOperatorToCubeOperator(opKey);
            if (!cubeOp) continue;
            const v = wrapper[opKey];
            const values = Array.isArray(v)
              ? v.map(x => this.stringifyForCube(x))
              : [this.stringifyForCube(v)];
            out.push({ member: key, operator: cubeOp, values });
          }
          continue;
        }
        // Otherwise treat as nested relation (e.g. {profile: {verified: true}}).
        // Flatten with dot-prefixed keys.
        for (const [nestedKey, nestedVal] of Object.entries(wrapper)) {
          this.flattenFilterCondition({ [`${key}.${nestedKey}`]: nestedVal }, out);
        }
        continue;
      }

      // Implicit equality: { field: scalar | array }
      const values = Array.isArray(raw)
        ? raw.map(x => this.stringifyForCube(x))
        : [this.stringifyForCube(raw)];
      out.push({
        member: key,
        operator: Array.isArray(raw) ? 'in' : 'equals',
        values,
      });
    }
  }

  /**
   * Map MongoDB-style `$op` keys (from FilterCondition) to the cube-style
   * operator names accepted by `convertOperatorToMongo` / `operatorToSql`.
   */
  private mongoOperatorToCubeOperator(op: string): string | null {
    switch (op) {
      case '$eq': return 'equals';
      case '$ne': return 'notEquals';
      case '$gt': return 'gt';
      case '$gte': return 'gte';
      case '$lt': return 'lt';
      case '$lte': return 'lte';
      case '$in': return 'in';
      case '$nin': return 'notIn';
      case '$contains': return 'contains';
      case '$notContains': return 'notContains';
      case '$exists': return 'set';
      default: return null;
    }
  }

  /**
   * Stringify a filter value for cube-style storage. Booleans become
   * `'1'/'0'` so that downstream consumers expecting SQLite-style
   * numeric booleans match correctly. The in-memory pipeline uses
   * {@link coerceFilterValue} to recover real JS types from these
   * strings.
   */
  private stringifyForCube(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  /**
   * Recover a runtime value from its cube-stringified form for in-memory
   * comparison. Booleans, integers, floats and ISO-date-like strings are
   * coerced; everything else stays as a string.
   */
  private coerceFilterValue(s: string): unknown {
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    // Numeric strings: integer or float (no leading zeros except '0')
    if (/^-?\d+$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
    if (/^-?\d+\.\d+$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
    return s;
  }

  /**
   * Type-aware SQL literal formatter. Booleans and numbers are emitted
   * unquoted; everything else is single-quoted with embedded quotes
   * escaped.
   */
  private toSqlLiteral(s: string): string {
    if (s === 'true') return '1';
    if (s === 'false') return '0';
    if (s === 'null') return 'NULL';
    if (/^-?\d+(\.\d+)?$/.test(s)) return s;
    return `'${s.replace(/'/g, "''")}'`;
  }

  private resolveFieldPath(cube: Cube, member: string): string {
    // Handle both "cube.field" and "field" formats
    const parts = member.split('.');
    const fieldName = parts.length > 1 ? parts[1] : parts[0];

    // Check if it's a dimension
    const dimension = cube.dimensions[fieldName];
    if (dimension) {
      // Extract field path from SQL expression
      return dimension.sql.replace(/^\$/, ''); // Remove $ prefix if present
    }

    // Check if it's a measure (for filters)
    const measure = cube.measures[fieldName];
    if (measure) {
      return measure.sql.replace(/^\$/, '');
    }

    return fieldName;
  }

  private resolveMeasure(cube: Cube, measureName: string) {
    const parts = measureName.split('.');
    const fieldName = parts.length > 1 ? parts[1] : parts[0];
    const direct = cube.measures[fieldName];
    if (direct) return direct;

    // Accept `${field}_${type}` aliases (e.g. 'amount_sum') for measures whose
    // canonical name is just `${field}` (e.g. measure 'amount' of type 'sum').
    // This matches the convention used by the data-objectstack adapter and
    // other clients that build measure names from (field, function) pairs.
    const aggTypes = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'];
    for (const type of aggTypes) {
      const suffix = `_${type}`;
      if (fieldName.endsWith(suffix)) {
        const baseField = fieldName.slice(0, -suffix.length);
        const candidate = cube.measures[baseField];
        if (candidate && candidate.type === type) {
          return candidate;
        }
      }
    }
    return undefined;
  }

  private resolveDimension(cube: Cube, dimensionName: string) {
    const parts = dimensionName.split('.');
    const fieldName = parts.length > 1 ? parts[1] : parts[0];
    return cube.dimensions[fieldName];
  }

  private getShortName(fullName: string): string {
    const parts = fullName.split('.');
    return parts.length > 1 ? parts[1] : parts[0];
  }

  private buildAggregator(measure: { type: string; sql: string; filters?: any[] }): any {
    const fieldPath = measure.sql.replace(/^\$/, '');

    switch (measure.type) {
      case 'count':
        return { $sum: 1 };
      case 'sum':
        return { $sum: `$${fieldPath}` };
      case 'avg':
        return { $avg: `$${fieldPath}` };
      case 'min':
        return { $min: `$${fieldPath}` };
      case 'max':
        return { $max: `$${fieldPath}` };
      case 'count_distinct':
        return { $addToSet: `$${fieldPath}` }; // Will need post-processing for count
      default:
        return { $sum: 1 }; // Default to count
    }
  }

  private measureTypeToFieldType(measureType: string): string {
    switch (measureType) {
      case 'count':
      case 'sum':
      case 'count_distinct':
        return 'number';
      case 'avg':
      case 'min':
      case 'max':
        return 'number';
      case 'string':
        return 'string';
      case 'boolean':
        return 'boolean';
      default:
        return 'number';
    }
  }

  private convertOperatorToMongo(operator: string): string {
    const opMap: Record<string, string> = {
      'equals': '$eq',
      'notEquals': '$ne',
      'contains': '$regex',
      'notContains': '$not',
      'gt': '$gt',
      'gte': '$gte',
      'lt': '$lt',
      'lte': '$lte',
      'in': '$in',
      'notIn': '$nin',
      'set': '$exists',
      'notSet': '$exists',
      'inDateRange': '$gte', // Will need special handling
    };
    return opMap[operator] || '$eq';
  }

  private operatorToSql(operator: string): string {
    const opMap: Record<string, string> = {
      'equals': '=',
      'notEquals': '!=',
      'contains': 'LIKE',
      'notContains': 'NOT LIKE',
      'gt': '>',
      'gte': '>=',
      'lt': '<',
      'lte': '<=',
    };
    return opMap[operator] || '=';
  }

  private measureToSql(measure: { type: string; sql: string }): string {
    const fieldPath = measure.sql.replace(/^\$/, '');
    
    switch (measure.type) {
      case 'count':
        return 'COUNT(*)';
      case 'sum':
        return `SUM(${fieldPath})`;
      case 'avg':
        return `AVG(${fieldPath})`;
      case 'min':
        return `MIN(${fieldPath})`;
      case 'max':
        return `MAX(${fieldPath})`;
      case 'count_distinct':
        return `COUNT(DISTINCT ${fieldPath})`;
      default:
        return 'COUNT(*)';
    }
  }

  private extractTableName(sql: string): string {
    // For simple table names, return as-is
    // For complex SQL, this would need more sophisticated parsing
    return sql.trim();
  }

  private parseDateRangeString(range: string): string[] {
    // Simple parser for common date range strings
    // In production, this would use a proper date range parser
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    if (range === 'today') {
      return [today.toISOString(), new Date(today.getTime() + 86400000).toISOString()];
    } else if (range.startsWith('last ')) {
      const parts = range.split(' ');
      const num = parseInt(parts[1]);
      const unit = parts[2];
      const start = new Date(today);
      
      if (unit.startsWith('day')) {
        start.setDate(start.getDate() - num);
      } else if (unit.startsWith('week')) {
        start.setDate(start.getDate() - num * 7);
      } else if (unit.startsWith('month')) {
        start.setMonth(start.getMonth() - num);
      } else if (unit.startsWith('year')) {
        start.setFullYear(start.getFullYear() - num);
      }
      
      return [start.toISOString(), now.toISOString()];
    }
    
    return [range, range]; // Fallback
  }

  private generateSqlFromPipeline(table: string, pipeline: Record<string, any>[]): string {
    // Simplified SQL generation for debugging
    // This is a basic representation of the aggregation pipeline
    const stages = pipeline.map((stage, idx) => {
      const op = Object.keys(stage)[0];
      return `/* Stage ${idx + 1}: ${op} */ ${JSON.stringify(stage[op])}`;
    }).join('\n');
    
    return `-- MongoDB Aggregation Pipeline on table: ${table}\n${stages}`;
  }
}
