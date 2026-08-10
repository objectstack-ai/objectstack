import { describe, it, expect } from 'vitest';
import {
  QuerySchema,
  FieldNodeSchema,
  SortNodeSchema,
  AggregationFunction,
  AggregationNodeSchema,
  type QueryAST,
} from './query.zod';
import { EngineAggregateOptionsSchema } from './data-engine.zod';

describe('AggregationFunction', () => {
  it('should accept valid aggregation functions', () => {
    const validFunctions = [
      'count', 'sum', 'avg', 'min', 'max',
      'count_distinct'
    ];

    validFunctions.forEach(fn => {
      expect(() => AggregationFunction.parse(fn)).not.toThrow();
    });
  });

  it('declares exactly the functions the SQL family can lower', () => {
    // The roster itself is the contract (#6188): `service-analytics` derives
    // its supported set from `.options`, so an addition here silently widens
    // what the dataset compiler claims to support. A change to this list is a
    // vocabulary decision and must be visible in review.
    expect(AggregationFunction.options).toEqual([
      'count', 'sum', 'avg', 'min', 'max', 'count_distinct',
    ]);
  });

  it('should reject invalid aggregation functions', () => {
    expect(() => AggregationFunction.parse('COUNT')).toThrow();
    expect(() => AggregationFunction.parse('median')).toThrow();
  });

  // ── #6188: the two retired values carry a prescription, not a bare reject ──
  //
  // Both halves matter. The refusal alone is what `median` already got; what
  // the retirement adds is that the author who wrote a value which USED to be
  // legal is told it was removed and what to do instead. A test that only
  // asserted `.toThrow()` would stay green if the error map were deleted.
  it('prescribes the retirement for `array_agg`', () => {
    expect(() => AggregationFunction.parse('array_agg'))
      .toThrow(/`array_agg`.*was removed.*#6188.*Delete the aggregation/s);
  });

  it('prescribes the retirement for `string_agg`', () => {
    expect(() => AggregationFunction.parse('string_agg'))
      .toThrow(/`string_agg`.*was removed.*#6188.*Delete the aggregation/s);
  });

  it('does NOT tell a mis-spelling that it "was removed"', () => {
    // `arry_agg` was never legal; claiming it was removed would misinform.
    // Only the two retired spellings are dispatched — everything else keeps
    // zod's own enum message listing the legal functions.
    expect(() => AggregationFunction.parse('arry_agg')).toThrow();
    const message = (() => {
      try {
        AggregationFunction.parse('arry_agg');
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(message).not.toContain('was removed');
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

  // 'query with distinct' moved to the retirement pins (#4286): the tombstone
  // refuses the key; unique values go through groupBy / count_distinct / the
  // drivers' distinct(object, field) door.
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
      .toThrow(/nested-select object form.*removed in @objectstack\/spec 17.*expand/s);
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

/**
 * #4721 — the sort node is closed against unknown keys, and `direction` gets a
 * named translation on the way out.
 *
 * The number that made this worth a wire-breaking change is not "a key was
 * dropped" but which way the rows then came back. Measured on `main` before the
 * change:
 *
 * ```
 * SortNodeSchema.parse({ field: 'updated_at', direction: 'desc' })
 *   →  { field: 'updated_at', order: 'asc' }
 * ```
 *
 * Descending in, ascending out, success reported. So these tests pin the
 * REJECTION and the PRESCRIPTION, not merely "unknown keys are unrecognized":
 * a strict schema whose error says `Unrecognized key(s): direction` and nothing
 * else leaves the caller exactly where the silent strip did — they still do not
 * know that the word they want is `order`. Edit distance cannot get there
 * (`direction` → `order` is not a typo), which is why the alias table is the
 * load-bearing half.
 */
describe('SortNode — closed, and `direction` carries its translation (#4721)', () => {
  it('accepts the canonical two-key node, defaulting `order` to asc', () => {
    expect(SortNodeSchema.parse({ field: 'updated_at', order: 'desc' }))
      .toEqual({ field: 'updated_at', order: 'desc' });
    expect(SortNodeSchema.parse({ field: 'updated_at' }))
      .toEqual({ field: 'updated_at', order: 'asc' });
  });

  it('REJECTS `direction` instead of silently sorting the other way', () => {
    const r = SortNodeSchema.safeParse({ field: 'updated_at', direction: 'desc' });
    expect(r.success, 'this parsed to `order: asc` before #4721').toBe(false);
    expect(r.error!.issues[0].message).toContain('`direction` → `order`');
  });

  it('names the surface and echoes the offending key', () => {
    const message = SortNodeSchema.safeParse({ field: 'x', direction: 'desc' })
      .error!.issues[0].message;
    expect(message).toContain('this sort node');
    expect(message).toContain('`direction`');
  });

  it('rejects `direction` even when `order` is also present', () => {
    // Both keys written means the caller is guessing. Half-honouring the guess
    // is how the two vocabularies stay alive; refusing it is how one wins.
    expect(SortNodeSchema.safeParse({ field: 'x', order: 'desc', direction: 'asc' }).success)
      .toBe(false);
  });

  it('closes the same door through `QueryAST.orderBy`, which is where it is written', () => {
    const r = QuerySchema.safeParse({
      object: 'sales',
      orderBy: [{ field: 'updated_at', direction: 'desc' }],
      limit: 20,
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error!.issues)).toContain('`direction` → `order`');

    // The control: the canonical spelling still parses through the same path.
    expect(QuerySchema.parse({
      object: 'sales', orderBy: [{ field: 'updated_at', order: 'desc' }], limit: 20,
    })).toMatchObject({ orderBy: [{ field: 'updated_at', order: 'desc' }] });
  });

  it('suggests a declared key for an ordinary typo, and never a tombstone', () => {
    const message = SortNodeSchema.safeParse({ field: 'x', ordr: 'desc' })
      .error!.issues[0].message;
    expect(message).toContain('`ordr` → `order`');
  });

  it('leaves the REST of the query dialect open — the carve-out is this schema only', () => {
    // `query.zod.ts` stays classed `open` in the strictness ledger; only
    // `SortNodeSchema` was re-classed authorable. Pinned so a later blanket
    // `.strict()` on the file is a deliberate decision with its own ruling
    // rather than a side effect of this change (#4001 tracks the top level).
    expect(QuerySchema.safeParse({ object: 'sales', nonsenseKey: 1 }).success).toBe(true);
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

  it('rejects the retired per-aggregation `distinct` flag (#6815)', () => {
    // Was `should accept aggregation with distinct flag`. `count` + `distinct`
    // is the exact shape `count_distinct` already spells portably, and it is
    // the shape the removal is loudest about: the two answered the same number
    // in the in-memory fallback and different numbers on every SQL face.
    expect(() => QuerySchema.parse({
      object: 'order',
      aggregations: [
        { function: 'count', field: 'customer_id', distinct: true, alias: 'unique_customers' },
      ],
    })).toThrow(/aggregations\[\]\.distinct.*removed.*count_distinct/s);
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

  // These two used to assert that `array_agg` / `string_agg` PARSE. #6188
  // retired both, so the fixtures are replaced rather than re-spelled: what
  // needs pinning now is that the refusal reaches the author through the
  // nested `aggregations[]` parse, carrying the prescription — the enum's
  // error map is reachable from the real authoring surface, not just from a
  // bare `AggregationFunction.parse`.
  it('refuses ARRAY_AGG through the query surface, with the prescription', () => {
    const query = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'array_agg', field: 'product_id', alias: 'products' },
      ],
      groupBy: ['customer_id'],
    };

    expect(() => QuerySchema.parse(query))
      .toThrow(/`array_agg`.*was removed.*os migrate meta/s);
  });

  it('refuses STRING_AGG through the query surface, with the prescription', () => {
    const query = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'string_agg', field: 'product_name', alias: 'product_names' },
      ],
      groupBy: ['customer_id'],
    };

    expect(() => QuerySchema.parse(query))
      .toThrow(/`string_agg`.*was removed.*os migrate meta/s);
  });

  it('still accepts the aggregation that was kept', () => {
    // `count_distinct` takes ADR-0049's ENFORCE leg (maintainer ruling
    // 2026-08-07), so the split must be visible from the authoring surface:
    // one of the three unlowered functions stayed and two left.
    const query: QueryAST = {
      object: 'order',
      fields: ['customer_id'],
      aggregations: [
        { function: 'count_distinct', field: 'product_id', alias: 'products' },
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

describe('QueryAST.cursor — REMOVED (#4286)', () => {
  it('rejects a caller-built cursor with the prescription pointing at the manual keyset', () => {
    expect(() => QuerySchema.parse({ object: 'customer', cursor: { id: 'rec_9' } }))
      .toThrow(/query\.cursor.*removed.*where.*sort key/s);
    expect(() => QuerySchema.parse({ object: 'customer', cursor: {} }))
      .toThrow(/query\.cursor.*removed/s);
  });

  it('still accepts absence, and the manual keyset parses', () => {
    expect(() => QuerySchema.parse({ object: 'customer', cursor: undefined })).not.toThrow();
    expect(() => QuerySchema.parse({
      object: 'customer',
      where: { created_at: { $gt: '2026-01-01T00:00:00.000Z' } },
      orderBy: [{ field: 'created_at', order: 'asc' }],
      limit: 10,
    })).not.toThrow();
  });
});

describe('QueryAST.distinct — REMOVED (#4286)', () => {
  it('rejects the flag with the prescription naming the live spellings — either value', () => {
    expect(() => QuerySchema.parse({ object: 'account', distinct: true }))
      .toThrow(/query\.distinct.*removed.*count_distinct/s);
    // `distinct: false` was as inert as true — the tombstone refuses any value.
    expect(() => QuerySchema.parse({ object: 'account', distinct: false }))
      .toThrow(/query\.distinct.*removed/s);
  });

  // This case used to read `per-aggregation distinct is a DIFFERENT, live
  // member and still parses` — true when #4286 swept the request surface, and
  // the reason `AggregationNode.distinct` outlived that sweep: #4286
  // dispositioned `QueryAST.distinct` (this file's other tombstone) and
  // `AggregationNode.filter` (marked EXPERIMENTAL), and the per-aggregation
  // flag was neither. It IS still a different member — with the same verdict
  // one level down, reached separately in #6815.
  it('per-aggregation `distinct` is a DIFFERENT member with its OWN prescription (#6815)', () => {
    expect(() => QuerySchema.parse({
      object: 'order',
      aggregations: [{ function: 'count', field: 'customer_id', distinct: true, alias: 'unique_customers' }],
    })).toThrow(/aggregations\[\]\.distinct.*removed/s);
    // Not the query-level message: two keys, two prescriptions, two live
    // replacements. Mixing them would send an author to `groupBy` for a
    // problem `count_distinct` solves.
    expect(() => QuerySchema.parse({
      object: 'order',
      aggregations: [{ function: 'count', field: 'customer_id', distinct: true, alias: 'unique_customers' }],
    })).not.toThrow(/`query\.distinct` was removed/);
  });
});

describe('AggregationNode.distinct — REMOVED (#6815, ADR-0049)', () => {
  it('refuses either value — `false` was as divergent as `true`', () => {
    // `distinct: false` selected the SQL faces' behaviour on the in-memory
    // path, so it was never inert: it was one of the two answers. The
    // tombstone refuses the KEY, not a value.
    for (const value of [true, false]) {
      expect(() => AggregationNodeSchema.parse(
        { function: 'sum', field: 'amount', alias: 'total', distinct: value },
      )).toThrow(/aggregations\[\]\.distinct.*removed/s);
    }
  });

  it('the prescription names the six faces and the live spelling', () => {
    const message = AggregationNodeSchema.safeParse(
      { function: 'sum', field: 'amount', alias: 'total', distinct: true },
    ).error!.issues[0]!.message;
    // The FROM → TO an upgrading author needs, and the measurement that
    // justifies it: one honouring face, five ignoring ones.
    expect(message).toContain('@objectstack/spec 17');
    expect(message).toContain('count_distinct');
    for (const face of ['driver-sql', 'driver-turso', 'driver-mongodb', 'driver-memory']) {
      expect(message, `the prescription must name the ${face} face`).toContain(face);
    }
  });

  it('a legal aggregation parses and carries NO `distinct` property (non-strict strip path)', () => {
    // `AggregationNodeSchema` is `z.object()`, not `.strict()`. A bare
    // deletion would therefore have made zod SILENTLY STRIP a caller's
    // `distinct` — replacing a divergent flag with an ignored one, which is
    // the #3733 / ADR-0104 shape. The tombstone is what makes the removal
    // audible; this pins that the surviving members are untouched by it.
    const parsed = AggregationNodeSchema.parse({ function: 'sum', field: 'amount', alias: 'total' });
    expect(parsed).not.toHaveProperty('distinct');
    expect(parsed).toEqual({ function: 'sum', field: 'amount', alias: 'total' });
  });

  it('`count_distinct` — the live deduplicating spelling — is untouched', () => {
    // The removal deletes the flag, never the capability: `count_distinct`
    // took ADR-0049's ENFORCE leg in #6409 and every SQL face compiles it.
    expect(() => QuerySchema.parse({
      object: 'order',
      aggregations: [{ function: 'count_distinct', field: 'customer_id', alias: 'unique_customers' }],
    })).not.toThrow();
  });

  it('reaches `EngineAggregateOptionsSchema` too — one schema, every aggregation door', () => {
    // `EngineAggregateOptionsSchema.aggregations` reuses this schema BY
    // REFERENCE (data-engine.zod.ts), so the engine-options door inherits the
    // tombstone without restating it. Pinned because the query-level
    // `cursor`/`distinct` pair had to be re-declared there by hand, and a
    // reader could reasonably expect the same here.
    expect(() => EngineAggregateOptionsSchema.parse({
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total', distinct: true }],
    })).toThrow(/aggregations\[\]\.distinct.*removed/s);
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

  it('refuses a mixed aggregation list the moment ONE entry carries `distinct` (#6815)', () => {
    // Was `should handle optional distinct flag in aggregation`. The mixed
    // list is the interesting shape: the second entry is untouched by the
    // retirement, so the refusal has to come from the first ENTRY rather than
    // from the array, and it has to point at that entry's index.
    const result = QuerySchema.safeParse({
      object: 'order',
      aggregations: [
        { function: 'count', field: 'customer_id', alias: 'unique_customers', distinct: true },
        { function: 'sum', field: 'amount', alias: 'total_amount' }, // never carried the key
      ],
      groupBy: ['region'],
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'aggregations.0.distinct');
    expect(issue, JSON.stringify(result.error!.issues)).toBeDefined();
    expect(issue!.message).toMatch(/aggregations\[\]\.distinct.*removed/s);
    // Only the offending entry is reported — the sibling `sum` is legal.
    expect(result.error!.issues).toHaveLength(1);
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
