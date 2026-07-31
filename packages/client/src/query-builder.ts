// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Type-Safe Query Builder
 * 
 * Provides a fluent API for building ObjectStack queries with:
 * - Compile-time type checking
 * - Intelligent code completion
 * - Runtime validation
 * - Type-safe filters and selections
 */

import { QueryAST, FilterCondition, SortNode } from '@objectstack/spec/data';

/**
 * Type-safe filter builder
 */
export class FilterBuilder<T = any> {
  private conditions: FilterCondition[] = [];

  /**
   * Equality filter: field = value
   */
  equals<K extends keyof T>(field: K, value: T[K]): this {
    this.conditions.push([field as string, '=', value]);
    return this;
  }

  /**
   * Not equals filter: field != value
   */
  notEquals<K extends keyof T>(field: K, value: T[K]): this {
    this.conditions.push([field as string, '!=', value]);
    return this;
  }

  /**
   * Greater than filter: field > value
   */
  greaterThan<K extends keyof T>(field: K, value: T[K]): this {
    this.conditions.push([field as string, '>', value]);
    return this;
  }

  /**
   * Greater than or equal filter: field >= value
   */
  greaterThanOrEqual<K extends keyof T>(field: K, value: T[K]): this {
    this.conditions.push([field as string, '>=', value]);
    return this;
  }

  /**
   * Less than filter: field < value
   */
  lessThan<K extends keyof T>(field: K, value: T[K]): this {
    this.conditions.push([field as string, '<', value]);
    return this;
  }

  /**
   * Less than or equal filter: field <= value
   */
  lessThanOrEqual<K extends keyof T>(field: K, value: T[K]): this {
    this.conditions.push([field as string, '<=', value]);
    return this;
  }

  /**
   * IN filter: field IN (value1, value2, ...)
   */
  in<K extends keyof T>(field: K, values: T[K][]): this {
    this.conditions.push([field as string, 'in', values]);
    return this;
  }

  /**
   * NOT IN filter: field NOT IN (value1, value2, ...)
   */
  notIn<K extends keyof T>(field: K, values: T[K][]): this {
    this.conditions.push([field as string, 'not_in', values]);
    return this;
  }

  /**
   * LIKE filter: field LIKE pattern
   */
  like<K extends keyof T>(field: K, pattern: string): this {
    this.conditions.push([field as string, 'like', pattern]);
    return this;
  }

  /**
   * IS NULL filter: field IS NULL
   */
  isNull<K extends keyof T>(field: K): this {
    this.conditions.push([field as string, 'is_null', null]);
    return this;
  }

  /**
   * IS NOT NULL filter: field IS NOT NULL
   */
  isNotNull<K extends keyof T>(field: K): this {
    this.conditions.push([field as string, 'is_not_null', null]);
    return this;
  }

  /**
   * BETWEEN filter: field BETWEEN min AND max
   */
  between<K extends keyof T>(field: K, min: T[K], max: T[K]): this {
    this.conditions.push(['and', [field as string, '>=', min], [field as string, '<=', max]] as FilterCondition);
    return this;
  }

  /**
   * CONTAINS filter: field contains value (case-insensitive LIKE %value%)
   */
  contains<K extends keyof T>(field: K, value: string): this {
    this.conditions.push([field as string, 'like', `%${value}%`]);
    return this;
  }

  /**
   * STARTS WITH filter: field starts with value (LIKE value%)
   */
  startsWith<K extends keyof T>(field: K, value: string): this {
    this.conditions.push([field as string, 'like', `${value}%`]);
    return this;
  }

  /**
   * ENDS WITH filter: field ends with value (LIKE %value)
   */
  endsWith<K extends keyof T>(field: K, value: string): this {
    this.conditions.push([field as string, 'like', `%${value}`]);
    return this;
  }

  /**
   * EXISTS filter: field is not null (alias for isNotNull)
   */
  exists<K extends keyof T>(field: K): this {
    this.conditions.push([field as string, 'is_not_null', null]);
    return this;
  }

  /**
   * Build the filter condition
   */
  build(): FilterCondition {
    if (this.conditions.length === 0) {
      throw new Error('Filter builder has no conditions');
    }
    if (this.conditions.length === 1) {
      return this.conditions[0];
    }
    // Combine multiple conditions with AND
    return ['and', ...this.conditions];
  }

  /**
   * Get raw conditions array
   */
  getConditions(): FilterCondition[] {
    return this.conditions;
  }
}

/**
 * Type-safe query builder
 */
export class QueryBuilder<T = any> {
  private query: Partial<QueryAST> = {};
  private _object: string;

  constructor(object: string) {
    this._object = object;
    this.query.object = object;
  }

  /**
   * Select specific fields
   */
  select<K extends keyof T>(...fields: K[]): this {
    this.query.fields = fields as string[];
    return this;
  }

  /**
   * Add filters using a builder function
   */
  where(builderFn: (builder: FilterBuilder<T>) => void): this {
    const builder = new FilterBuilder<T>();
    builderFn(builder);
    const conditions = builder.getConditions();
    
    if (conditions.length === 1) {
      this.query.where = conditions[0];
    } else if (conditions.length > 1) {
      this.query.where = ['and', ...conditions] as FilterCondition;
    }
    
    return this;
  }

  /**
   * Add raw filter condition
   */
  filter(condition: FilterCondition): this {
    this.query.where = condition;
    return this;
  }

  /**
   * Sort by fields
   */
  orderBy<K extends keyof T>(field: K, order: 'asc' | 'desc' = 'asc'): this {
    if (!this.query.orderBy) {
      this.query.orderBy = [];
    }
    (this.query.orderBy as SortNode[]).push({
      field: field as string,
      order
    });
    return this;
  }

  /**
   * Limit the number of results
   */
  limit(count: number): this {
    this.query.limit = count;
    return this;
  }

  /**
   * Skip records (for pagination).
   * @deprecated Prefer `.offset()` for alignment with Spec canonical field names.
   */
  skip(count: number): this {
    this.query.offset = count;
    return this;
  }

  /**
   * Offset records (for pagination) — canonical alias for `.skip()`
   */
  offset(count: number): this {
    this.query.offset = count;
    return this;
  }

  /**
   * Paginate results
   */
  paginate(page: number, pageSize: number): this {
    this.query.limit = pageSize;
    this.query.offset = (page - 1) * pageSize;
    return this;
  }

  /**
   * Group by fields
   */
  groupBy<K extends keyof T>(...fields: K[]): this {
    this.query.groupBy = fields as string[];
    return this;
  }

  /**
   * Expand (eager-load) a related object with an optional sub-query
   */
  expand(relation: string, subQuery?: Partial<QueryAST>): this {
    if (!this.query.expand) {
      this.query.expand = {};
    }
    (this.query.expand as Record<string, any>)[relation] = subQuery || {};
    return this;
  }

  /**
   * Add full-text search
   */
  search(query: string, options?: { fields?: string[]; fuzzy?: boolean }): this {
    (this.query as any).search = { query, ...options };
    return this;
  }

  // `cursor()` and `distinct()` were REMOVED with `query.cursor` /
  // `query.distinct` (#4286, spec 18): no driver ever implemented keyset
  // pagination or SELECT DISTINCT, so both minted keys the engine ignored —
  // `cursor` re-served page 1 forever, `distinct`'s only effect was silently
  // degrading the REST count. Express a keyset as a `where` predicate on the
  // sort key; deduplicate with `groupBy` / `count_distinct` or the drivers'
  // `distinct(object, field)` door.

  /**
   * Build the final query AST
   */
  build(): QueryAST {
    return {
      object: this._object,
      ...this.query
    } as QueryAST;
  }

  /**
   * Get the current query state
   */
  getQuery(): Partial<QueryAST> {
    return { ...this.query };
  }
}

/**
 * Create a type-safe query builder for an object
 */
export function createQuery<T = any>(object: string): QueryBuilder<T> {
  return new QueryBuilder<T>(object);
}

/**
 * Create a type-safe filter builder
 */
export function createFilter<T = any>(): FilterBuilder<T> {
  return new FilterBuilder<T>();
}
