import { describe, it, expect } from 'vitest';
import {
  QuerySchema,
  FieldNodeSchema,
  AggregationFunction,
  type QueryAST,
} from './query.zod';

describe('AggregationFunction', () => {
  it('should accept valid aggregation functions', () => {
    const validFunctions = [
      'count', 'sum', 'avg', 'min', 'max',
      'count_distinct', 'array_agg', 'string_agg'
    ];

    validFunctions.forEach(fn => {
      expect(() => AggregationFunction.parse(fn)).not.toThrow();
    });
  });

  it('should reject invalid aggregation functions', () => {
    expect(() => AggregationFunction.parse('COUNT')).toThrow();
    expect(() => AggregationFunction.parse('median')).toThrow();
  });
});

describe('QuerySchema - Basic', () => {
  it('should accept simple query', () => {
    const query: QueryAST = {
      object: 'account',
      fields: ['name', 'email'],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with filters', () => {
    const query: QueryAST = {
      object: 'account',
      fields: ['name', 'email'],
      filters: ['status', '=', 'active'],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with sort', () => {
    const query: QueryAST = {
      object: 'account',
      fields: ['name', 'email'],
      orderBy: [
        { field: 'name', order: 'asc' },
        { field: 'created_at', order: 'desc' },
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with pagination', () => {
    const query: QueryAST = {
      object: 'account',
      fields: ['name'],
      top: 10,
      skip: 20,
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with distinct', () => {
    const query: QueryAST = {
      object: 'account',
      fields: ['status'],
      distinct: true,
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });
});

/**
 * [#4196] `FieldNode`'s nested-select object form was declared-but-inert — no
 * producer, and no consumer that read `.fields`/`.alias` (ADR-0078's silently
 * inert declaration; ADR-0049 enforce-or-remove). It is gone, and the rejection
 * carries the prescription rather than zod's "expected string, received object":
 * the parse error is the channel an upgrading consumer actually hits.
 */
describe('FieldNode — the nested-select object form is REMOVED (#4196)', () => {
  it('accepts a field name, and a dotted path through a relationship', () => {
    expect(FieldNodeSchema.parse('name')).toBe('name');
    expect(FieldNodeSchema.parse('owner.name')).toBe('owner.name');
    expect(() => QuerySchema.parse({
      object: 'task', fields: ['title', 'owner.name'],
    })).not.toThrow();
  });

  it('rejects the object form with the removal prescription, not a type mismatch', () => {
    expect(() => FieldNodeSchema.parse({ field: 'owner', fields: ['name'] }))
      .toThrow(/nested-select object form.*removed in @objectstack\/spec 18.*expand/s);
    // …and through the query it is reached from, since that is where an author
    // writes it.
    expect(() => QuerySchema.parse({
      object: 'task', fields: [{ field: 'owner', fields: ['name'] }],
    })).toThrow(/nested-select object form.*expand/s);
  });

  it("leaves a non-object mistake with zod's own message", () => {
    // The prescription is for the shape that USED to be legal. A number was
    // never a FieldNode, so telling its author it was "removed" would misinform.
    expect(() => FieldNodeSchema.parse(42)).toThrow(/expected string/i);
    expect(() => FieldNodeSchema.parse(42)).not.toThrow(/nested-select/);
  });

  it('the replacement is `expand`, and it still parses', () => {
    expect(() => QuerySchema.parse({
      object: 'task',
      fields: ['title'],
      expand: { owner: { object: 'user', fields: ['name'] } },
    } satisfies QueryAST)).not.toThrow();
  });
});

describe('QuerySchema - Aggregations', () => {
  // ============================================================================
  // Basic Aggregation Tests
  // ============================================================================
  
  it('should accept query with simple COUNT aggregation', () => {
    const query: QueryAST = {
      object: 'order',
      aggregations: [
        { function: 'count', alias: 'total_orders' },
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with SUM aggregation', () => {
    const query: QueryAST = {
      object: 'order',
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'total_amount' },
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with AVG aggregation', () => {
    const query: QueryAST = {
      object: 'order',
      aggregations: [
        { function: 'avg', field: 'amount', alias: 'avg_amount' },
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with MIN aggregation', () => {
    const query: QueryAST = {
      object: 'product',
      aggregations: [
        { function: 'min', field: 'price', alias: 'min_price' },
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with MAX aggregation', () => {
    const query: QueryAST = {
      object: 'product',
      aggregations: [
        { function: 'max', field: 'price', alias: 'max_price' },
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with multiple aggregations', () => {
    const query: QueryAST = {
      object: 'order',
      aggregations: [
        { function: 'count', alias: 'total_orders' },
        { function: 'sum', field: 'amount', alias: 'total_amount' },
        { function: 'avg', field: 'amount', alias: 'avg_amount' },
        { function: 'min', field: 'amount', alias: 'min_amount' },
        { function: 'max', field: 'amount', alias: 'max_amount' },
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  // ============================================================================
  // COUNT DISTINCT Tests
  // ============================================================================

  it('should accept COUNT DISTINCT aggregation', () => {
    const query: QueryAST = {
      object: 'order',
      aggregations: [
        { function: 'count_distinct', field: 'customer_id', alias: 'unique_customers' },
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept aggregation with distinct flag', () => {
    const query: QueryAST = {
      object: 'order',
      aggregations: [
        { function: 'count', field: 'customer_id', distinct: true, alias: 'unique_customers' },
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  // ============================================================================
  // GROUP BY Tests
  // ============================================================================

  it('should accept query with single GROUP BY field', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'count', alias: 'order_count' },
      ],
      groupBy: ['customer_id'],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with multiple GROUP BY fields', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id', 'status'],
      aggregations: [
        { function: 'count', alias: 'order_count' },
        { function: 'sum', field: 'amount', alias: 'total_amount' },
      ],
      groupBy: ['customer_id', 'status'],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept GROUP BY with multiple aggregations', () => {
    const query: QueryAST = {
      object: 'sales',
      fields: ['region', 'product_category'],
      aggregations: [
        { function: 'sum', field: 'revenue', alias: 'total_revenue' },
        { function: 'avg', field: 'revenue', alias: 'avg_revenue' },
        { function: 'count', alias: 'num_sales' },
        { function: 'min', field: 'sale_date', alias: 'first_sale' },
        { function: 'max', field: 'sale_date', alias: 'last_sale' },
      ],
      groupBy: ['region', 'product_category'],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  // ============================================================================
  // HAVING Clause Tests
  // ============================================================================

  it('should accept query with HAVING clause on COUNT', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'count', alias: 'order_count' },
      ],
      groupBy: ['customer_id'],
      having: { order_count: { $gt: 5 } },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with HAVING clause on SUM', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'total_amount' },
      ],
      groupBy: ['customer_id'],
      having: { total_amount: { $gt: 1000 } },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with HAVING clause on AVG', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'avg', field: 'amount', alias: 'avg_amount' },
      ],
      groupBy: ['customer_id'],
      having: { avg_amount: { $gte: 500 } },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with complex HAVING clause', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'count', alias: 'order_count' },
        { function: 'sum', field: 'amount', alias: 'total_amount' },
      ],
      groupBy: ['customer_id'],
      having: { $and: [{ order_count: { $gt: 3 } }, { total_amount: { $gt: 1000 } }] },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with HAVING and WHERE clauses', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      filters: ['status', '=', 'completed'],
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'total_amount' },
      ],
      groupBy: ['customer_id'],
      having: { total_amount: { $gt: 5000 } },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  // ============================================================================
  // Complex Aggregation Scenarios
  // ============================================================================

  it('should accept query with aggregation and sorting', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'total_amount' },
      ],
      groupBy: ['customer_id'],
      orderBy: [{ field: 'total_amount', order: 'desc' }],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with aggregation and pagination', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'count', alias: 'order_count' },
      ],
      groupBy: ['customer_id'],
      orderBy: [{ field: 'order_count', order: 'desc' }],
      top: 10,
      skip: 0,
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with ARRAY_AGG aggregation', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'array_agg', field: 'product_id', alias: 'products' },
      ],
      groupBy: ['customer_id'],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept query with STRING_AGG aggregation', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'string_agg', field: 'product_name', alias: 'product_names' },
      ],
      groupBy: ['customer_id'],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  // ============================================================================
  // Real-World Aggregation Examples (SQL Comparisons)
  // ============================================================================

  it('should accept sales report aggregation (SQL: SELECT region, SUM(amount) FROM sales GROUP BY region)', () => {
    const query: QueryAST = {
      object: 'sales',
      fields: ['region'],
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'total_sales' },
      ],
      groupBy: ['region'],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept customer summary aggregation (SQL: Multi-metric GROUP BY)', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'count', alias: 'num_orders' },
        { function: 'sum', field: 'amount', alias: 'lifetime_value' },
        { function: 'avg', field: 'amount', alias: 'avg_order_value' },
        { function: 'max', field: 'created_at', alias: 'last_order_date' },
      ],
      groupBy: ['customer_id'],
      having: { num_orders: { $gt: 1 } },
      orderBy: [{ field: 'lifetime_value', order: 'desc' }],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept product analytics aggregation', () => {
    const query: QueryAST = {
      object: 'order_item',
      fields: ['product_id'],
      aggregations: [
        { function: 'count', alias: 'times_purchased' },
        { function: 'sum', field: 'quantity', alias: 'total_quantity' },
        { function: 'sum', field: 'line_total', alias: 'total_revenue' },
      ],
      groupBy: ['product_id'],
      orderBy: [{ field: 'total_revenue', order: 'desc' }],
      top: 20,
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });
});

/**
 * [#4286] `query.joins` and `query.windowFunctions` were declared-but-inert:
 * no engine or driver read either on the query path, so every join and OVER
 * clause a caller declared was silently dropped (ADR-0078; ADR-0049
 * enforce-or-remove). Both are tombstoned rather than deleted —
 * `BaseQuerySchema` is not `.strict()`, so a plain deletion would have
 * silently STRIPPED the keys (the ADR-0104 class); `retiredKey()` keeps the
 * removal audible in both channels (`tsc` and the parse).
 */
describe('QueryAST.joins — REMOVED (#4286)', () => {
  it('rejects a query carrying `joins` with the prescription, even as an empty array', () => {
    expect(() => QuerySchema.parse({ object: 'order', joins: [] }))
      .toThrow(/query\.joins.*removed.*expand/s);
    expect(() => QuerySchema.parse({
      object: 'order',
      joins: [{
        type: 'inner',
        object: 'customer',
        on: { 'order.customer_id': { $eq: { $field: 'customer.id' } } },
      }],
    })).toThrow(/query\.joins.*removed/s);
  });

  it('still accepts absence — `undefined` is not authoring', () => {
    expect(() => QuerySchema.parse({ object: 'order', joins: undefined })).not.toThrow();
  });

  it('the replacement parses: related records through `expand`, a related column as a dotted path', () => {
    const parsed = QuerySchema.parse({
      object: 'order',
      fields: ['id', 'customer_id.name'],
      expand: { customer_id: { object: 'customer', fields: ['name'] } },
    });
    expect(parsed).not.toHaveProperty('joins');
  });
});

describe('QueryAST.windowFunctions — REMOVED (#4286)', () => {
  it('rejects a query carrying `windowFunctions` with the prescription naming the door', () => {
    expect(() => QuerySchema.parse({
      object: 'order',
      windowFunctions: [{ function: 'row_number', alias: 'rn', over: {} }],
    })).toThrow(/query\.windowFunctions.*removed.*findWithWindowFunctions/s);
    expect(() => QuerySchema.parse({ object: 'order', windowFunctions: [] }))
      .toThrow(/query\.windowFunctions.*removed/s);
  });

  it('still accepts absence — `undefined` is not authoring', () => {
    expect(() => QuerySchema.parse({ object: 'order', windowFunctions: undefined })).not.toThrow();
  });
});

describe('QuerySchema - Complex Queries', () => {
  it('should accept complex query with aggregations, HAVING, ordering and paging', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'total_amount' },
        { function: 'count', alias: 'order_count' },
      ],
      groupBy: ['customer_id'],
      having: { order_count: { $gt: 5 } },
      orderBy: [{ field: 'total_amount', order: 'desc' }],
      top: 100,
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  // [#4286] This case used to stack `joins` + `windowFunctions` on top — both
  // parsed and then did nothing. The composition that actually executes is
  // expand + aggregation + HAVING declaration + ordering + paging.
  it('should accept query combining expand with the other declared features', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['id', 'customer_id', 'amount'],
      distinct: true,
      where: { status: 'completed' },
      expand: { customer_id: { object: 'customer', fields: ['name'] } },
      aggregations: [
        { function: 'avg', field: 'amount', alias: 'avg_amount' },
      ],
      groupBy: ['customer_id'],
      having: { avg_amount: { $gt: 500 } },
      orderBy: [{ field: 'avg_amount', order: 'desc' }],
      top: 50,
      offset: 0,
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });
});

describe('QuerySchema - Edge Cases and Null Handling', () => {
  it('should handle null values in filter expressions', () => {
    const query: QueryAST = {
      object: 'account',
      fields: ['name'],
      filters: ['deleted_at', 'is_null', null],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should handle undefined for optional fields', () => {
    const query: QueryAST = {
      object: 'account',
      fields: undefined,
      filters: undefined,
      sort: undefined,
      aggregations: undefined,
      joins: undefined,
      groupBy: undefined,
      having: undefined,
      windowFunctions: undefined,
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should handle empty arrays', () => {
    // `joins: []` / `windowFunctions: []` moved to the retirement pins — the
    // tombstones refuse even an empty array (#4286).
    const query: QueryAST = {
      object: 'account',
      fields: [],
      aggregations: [],
      groupBy: [],
      orderBy: [],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should handle zero and negative values in pagination', () => {
    const queries = [
      { object: 'account', top: 0, skip: 0 },
      { object: 'account', top: 1, skip: 0 },
      { object: 'account', top: 100, skip: 1000 },
    ];

    queries.forEach(query => {
      expect(() => QuerySchema.parse(query)).not.toThrow();
    });
  });

  it('should handle complex nested null filters', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['id'],
      filters: [
        ['approved_at', 'is_null', null],
        'and',
        ['rejected_at', 'is_null', null],
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  // [#4196] This case used to assert the opposite — that `{ field, fields,
  // alias }` entries parse. They did, and then nothing honoured them: the pin
  // proved the DECLARATION, which is exactly how a declared-but-inert shape
  // survives a green suite. The `alias` half was the emptiest of all; no
  // projection anywhere was ever named by it.
  it('refuses relationship field nodes, with or without an alias', () => {
    expect(() => QuerySchema.parse({
      object: 'account',
      fields: ['name', { field: 'owner', fields: ['name', 'email'] }],
    })).toThrow(/nested-select object form.*removed/s);
    expect(() => QuerySchema.parse({
      object: 'account',
      fields: ['name', { field: 'manager', fields: ['name'], alias: 'mgr' }],
    })).toThrow(/`alias` has no replacement here/);
  });

  it('should handle aggregation without field for COUNT', () => {
    const query: QueryAST = {
      object: 'order',
      aggregations: [
        { function: 'count', alias: 'total_count' },
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should handle optional distinct flag in aggregation', () => {
    const query: QueryAST = {
      object: 'order',
      aggregations: [
        { function: 'count', field: 'customer_id', alias: 'unique_customers', distinct: true },
        { function: 'sum', field: 'amount', alias: 'total_amount' }, // distinct undefined
      ],
      groupBy: ['region'],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should reject invalid object type', () => {
    expect(() => QuerySchema.parse({
      object: 123, // Should be string
      fields: ['name'],
    })).toThrow();
  });

  it('should reject invalid field types in array', () => {
    expect(() => QuerySchema.parse({
      object: 'account',
      fields: [123, 456], // Should be strings or objects
    })).toThrow();
  });

  it('should reject invalid aggregation function', () => {
    expect(() => QuerySchema.parse({
      object: 'order',
      aggregations: [
        { function: 'invalid_func', alias: 'test' },
      ],
    })).toThrow();
  });

  it('should reject invalid sort order', () => {
    expect(() => QuerySchema.parse({
      object: 'account',
      orderBy: [{ field: 'name', order: 'invalid' }],
    })).toThrow();
  });
});

describe('QuerySchema - Type Coercion Edge Cases', () => {
  it('should handle various data types in filter values', () => {
    const queries = [
      { object: 'account', filters: ['age', '>', 18] }, // number
      { object: 'account', filters: ['active', '=', true] }, // boolean
      { object: 'account', filters: ['name', '=', 'John'] }, // string
      { object: 'account', filters: ['tags', 'in', ['a', 'b', 'c']] }, // array
      { object: 'account', filters: ['value', 'between', [0, 100]] }, // array
    ];

    queries.forEach(query => {
      expect(() => QuerySchema.parse(query)).not.toThrow();
    });
  });

  it('should handle boolean flags', () => {
    const query: QueryAST = {
      object: 'account',
      fields: ['name'],
      distinct: true,
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();

    const query2: QueryAST = {
      object: 'account',
      fields: ['name'],
      distinct: false,
    };

    expect(() => QuerySchema.parse(query2)).not.toThrow();
  });

  it('should handle default sort order', () => {
    const query: QueryAST = {
      object: 'account',
      orderBy: [{ field: 'name' }], // order defaults to 'asc'
    };

    const result = QuerySchema.parse(query);
    expect(result.orderBy?.[0].order).toBe('asc');
  });

  // [#4196] There are no longer two field types to mix — a select list is field
  // names. The mixed list is refused at the entry that is not one, and the
  // issue `path` points at it so the caller knows which entry to rewrite.
  it('refuses a select list that mixes names with object entries, naming the entry', () => {
    const result = QuerySchema.safeParse({
      object: 'account',
      fields: ['simple_field', { field: 'related_field', fields: ['nested_field'], alias: 'rel' }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['fields', 1]);
  });

  it('should handle deeply nested filters', () => {
    const query: QueryAST = {
      object: 'order',
      filters: [
        [
          ['status', '=', 'active'],
          'and',
          ['amount', '>', 100],
        ],
        'or',
        [
          ['priority', '=', 'high'],
          'and',
          ['urgent', '=', true],
        ],
      ],
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should handle complex having clauses', () => {
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'count', alias: 'order_count' },
        { function: 'sum', field: 'amount', alias: 'total' },
      ],
      groupBy: ['customer_id'],
      having: {
        $and: [
          { order_count: { $gt: 5 } },
          { total: { $gt: 1000 } },
        ],
      },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });
});

describe('QuerySchema - Full-Text Search', () => {
  it('should accept basic full-text search query', () => {
    const query: QueryAST = {
      object: 'article',
      search: {
        query: 'machine learning',
      },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept full-text search with field specification', () => {
    const query: QueryAST = {
      object: 'article',
      search: {
        query: 'machine learning',
        fields: ['title', 'content', 'abstract'],
      },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept full-text search with fuzzy matching', () => {
    const query: QueryAST = {
      object: 'product',
      search: {
        query: 'loptop',  // typo: laptop
        fuzzy: true,
      },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept full-text search with field boosting', () => {
    const query: QueryAST = {
      object: 'article',
      search: {
        query: 'artificial intelligence',
        fields: ['title', 'content'],
        boost: {
          title: 2.0,
          content: 1.0,
        },
      },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept full-text search with AND operator', () => {
    const query: QueryAST = {
      object: 'document',
      search: {
        query: 'contract agreement',
        operator: 'and',
      },
    };

    const result = QuerySchema.parse(query);
    expect(result.search?.operator).toBe('and');
  });

  it('should default to OR operator', () => {
    const query: QueryAST = {
      object: 'document',
      search: {
        query: 'contract agreement',
      },
    };

    const result = QuerySchema.parse(query);
    expect(result.search?.operator).toBe('or');
  });

  it('should accept full-text search with minimum score', () => {
    const query: QueryAST = {
      object: 'article',
      search: {
        query: 'technology',
        minScore: 0.5,
      },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept full-text search with language', () => {
    const query: QueryAST = {
      object: 'article',
      search: {
        query: '机器学习',
        language: 'zh',
      },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept full-text search with highlighting', () => {
    const query: QueryAST = {
      object: 'article',
      search: {
        query: 'artificial intelligence',
        highlight: true,
      },
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept full-text search combined with filters', () => {
    const query: QueryAST = {
      object: 'article',
      search: {
        query: 'machine learning',
        fields: ['title', 'content'],
      },
      where: { published: true },
      orderBy: [{ field: 'created_at', order: 'desc' }],
      limit: 10,
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should accept full-text search with all options', () => {
    const query: QueryAST = {
      object: 'research_paper',
      search: {
        query: 'neural networks deep learning',
        fields: ['title', 'abstract', 'content'],
        fuzzy: true,
        operator: 'and',
        boost: {
          title: 3.0,
          abstract: 2.0,
          content: 1.0,
        },
        minScore: 0.7,
        language: 'en',
        highlight: true,
      },
      where: { status: 'published' },
      limit: 20,
    };

    expect(() => QuerySchema.parse(query)).not.toThrow();
  });

  it('should default fuzzy to false', () => {
    const query: QueryAST = {
      object: 'article',
      search: {
        query: 'test',
      },
    };

    const result = QuerySchema.parse(query);
    expect(result.search?.fuzzy).toBe(false);
  });

  it('should default highlight to false', () => {
    const query: QueryAST = {
      object: 'article',
      search: {
        query: 'test',
      },
    };

    const result = QuerySchema.parse(query);
    expect(result.search?.highlight).toBe(false);
  });
});
