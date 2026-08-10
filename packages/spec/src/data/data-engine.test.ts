import { describe, it, expect } from 'vitest';
import {
  DataEngineFilterSchema,
  DataEngineSortSchema,
  DataEngineQueryOptionsSchema,
  DataEngineInsertOptionsSchema,
  DataEngineUpdateOptionsSchema,
  DataEngineDeleteOptionsSchema,
  DataEngineAggregateOptionsSchema,
  DataEngineCountOptionsSchema,
  EngineQueryOptionsSchema,
  EngineUpdateOptionsSchema,
  EngineDeleteOptionsSchema,
  EngineAggregateOptionsSchema,
  EngineCountOptionsSchema,
  DataEngineFindRequestSchema,
  DataEngineFindOneRequestSchema,
  DataEngineInsertRequestSchema,
  DataEngineUpdateRequestSchema,
  DataEngineDeleteRequestSchema,
  DataEngineCountRequestSchema,
  DataEngineAggregateRequestSchema,
  DataEngineExecuteRequestSchema,
  DataEngineVectorFindRequestSchema,
  DataEngineRequestSchema,
  DroppedFieldsEventSchema,
} from './data-engine.zod';
import { QuerySchema } from './query.zod';

describe('DataEngineFilterSchema', () => {
  it('should accept simple key-value filter', () => {
    const filter = DataEngineFilterSchema.parse({
      status: 'active',
      category: 'premium',
    });

    expect(filter.status).toBe('active');
    expect(filter.category).toBe('premium');
  });

  it('should accept complex filter expressions', () => {
    const filter = DataEngineFilterSchema.parse({
      operator: 'and',
      conditions: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'revenue', operator: 'gt', value: 100000 },
      ],
    });

    expect(filter.operator).toBe('and');
    expect(filter.conditions).toHaveLength(2);
  });

  it('should accept nested filters', () => {
    const filter = DataEngineFilterSchema.parse({
      'address.city': 'New York',
      'address.state': 'NY',
    });

    expect(filter['address.city']).toBe('New York');
  });
});

describe('DataEngineSortSchema', () => {
  it('should accept string-based sort', () => {
    const sort = DataEngineSortSchema.parse({
      name: 'asc',
      created_at: 'desc',
    });

    expect(sort.name).toBe('asc');
    expect(sort.created_at).toBe('desc');
  });

  it('should accept number-based sort', () => {
    const sort = DataEngineSortSchema.parse({
      name: 1,
      created_at: -1,
    });

    expect(sort.name).toBe(1);
    expect(sort.created_at).toBe(-1);
  });

  it('should accept array-based sort', () => {
    const sort = DataEngineSortSchema.parse([
      { field: 'name', order: 'asc' },
      { field: 'created_at', order: 'desc' },
    ]);

    expect(sort).toHaveLength(2);
  });
});

describe('DataEngineQueryOptionsSchema', () => {
  it('should accept minimal options', () => {
    const options = DataEngineQueryOptionsSchema.parse({});

    expect(options).toBeDefined();
  });

  it('should accept filter option', () => {
    const options = DataEngineQueryOptionsSchema.parse({
      filter: { status: 'active' },
    });

    expect(options.filter).toBeDefined();
  });

  it('should accept select option', () => {
    const options = DataEngineQueryOptionsSchema.parse({
      select: ['id', 'name', 'email'],
    });

    expect(options.select).toHaveLength(3);
  });

  it('should accept sort option', () => {
    const options = DataEngineQueryOptionsSchema.parse({
      sort: { name: 'asc' },
    });

    expect(options.sort).toBeDefined();
  });

  it('should accept pagination with limit/skip', () => {
    const options = DataEngineQueryOptionsSchema.parse({
      limit: 10,
      skip: 20,
    });

    expect(options.limit).toBe(10);
    expect(options.skip).toBe(20);
  });

  it('should accept pagination with top', () => {
    const options = DataEngineQueryOptionsSchema.parse({
      top: 25,
      skip: 50,
    });

    expect(options.top).toBe(25);
    expect(options.skip).toBe(50);
  });

  it('should accept populate option', () => {
    const options = DataEngineQueryOptionsSchema.parse({
      populate: ['owner', 'contacts'],
    });

    expect(options.populate).toHaveLength(2);
  });

  it('should accept complete query options', () => {
    const options = DataEngineQueryOptionsSchema.parse({
      filter: { status: 'active' },
      select: ['id', 'name', 'email'],
      sort: { name: 'asc' },
      limit: 50,
      skip: 0,
      populate: ['owner'],
    });

    expect(options.filter).toBeDefined();
    expect(options.select).toHaveLength(3);
    expect(options.limit).toBe(50);
    expect(options.populate).toHaveLength(1);
  });
});

describe('DataEngineInsertOptionsSchema', () => {
  it('should accept returning option', () => {
    const options = DataEngineInsertOptionsSchema.parse({
      returning: true,
    });

    expect(options.returning).toBe(true);
  });

  it('should accept custom returning', () => {
    const options = DataEngineInsertOptionsSchema.parse({
      returning: false,
    });

    expect(options.returning).toBe(false);
  });
});

describe('DataEngineUpdateOptionsSchema', () => {
  it('should accept empty options', () => {
    const options = DataEngineUpdateOptionsSchema.parse({});

    expect(options).toBeDefined();
  });

  it('should accept upsert mode', () => {
    const options = DataEngineUpdateOptionsSchema.parse({
      upsert: true,
    });

    expect(options.upsert).toBe(true);
  });

  it('should accept multi-update', () => {
    const options = DataEngineUpdateOptionsSchema.parse({
      multi: true,
      returning: true,
    });

    expect(options.multi).toBe(true);
    expect(options.returning).toBe(true);
  });

  it('should accept update with filter', () => {
    const options = DataEngineUpdateOptionsSchema.parse({
      filter: { status: 'inactive' },
      multi: true,
    });

    expect(options.filter).toBeDefined();
    expect(options.multi).toBe(true);
  });
});

describe('DataEngineDeleteOptionsSchema', () => {
  it('should accept empty options', () => {
    const options = DataEngineDeleteOptionsSchema.parse({});

    expect(options).toBeDefined();
  });

  it('should accept multi-delete', () => {
    const options = DataEngineDeleteOptionsSchema.parse({
      multi: true,
    });

    expect(options.multi).toBe(true);
  });

  it('should accept delete with filter', () => {
    const options = DataEngineDeleteOptionsSchema.parse({
      filter: { status: 'archived' },
      multi: true,
    });

    expect(options.filter).toBeDefined();
  });
});

describe('DataEngineAggregateOptionsSchema', () => {
  it('should accept group by', () => {
    const options = DataEngineAggregateOptionsSchema.parse({
      groupBy: ['status', 'category'],
    });

    expect(options.groupBy).toHaveLength(2);
  });

  it('should accept aggregations', () => {
    const options = DataEngineAggregateOptionsSchema.parse({
      aggregations: [
        { field: 'revenue', method: 'sum', alias: 'total_revenue' },
        { field: 'id', method: 'count', alias: 'total_count' },
      ],
    });

    expect(options.aggregations).toHaveLength(2);
  });

  it('should accept all aggregation methods', () => {
    const methods = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'] as const;
    
    methods.forEach(method => {
      const options = DataEngineAggregateOptionsSchema.parse({
        aggregations: [
          { field: 'value', method },
        ],
      });
      expect(options.aggregations![0].method).toBe(method);
    });
  });

  it('should accept aggregation with filter and groupBy', () => {
    const options = DataEngineAggregateOptionsSchema.parse({
      filter: { status: 'active' },
      groupBy: ['category'],
      aggregations: [
        { field: 'revenue', method: 'sum' },
        { field: 'revenue', method: 'avg' },
      ],
    });

    expect(options.filter).toBeDefined();
    expect(options.groupBy).toHaveLength(1);
    expect(options.aggregations).toHaveLength(2);
  });
});

describe('DataEngineCountOptionsSchema', () => {
  it('should accept empty options', () => {
    const options = DataEngineCountOptionsSchema.parse({});

    expect(options).toBeDefined();
  });

  it('should accept count with filter', () => {
    const options = DataEngineCountOptionsSchema.parse({
      filter: { status: 'active' },
    });

    expect(options.filter).toBeDefined();
  });
});

// ==========================================================================
// NEW: QueryAST-aligned Engine Options Schemas
// ==========================================================================

describe('EngineQueryOptionsSchema', () => {
  it('should accept minimal options', () => {
    const options = EngineQueryOptionsSchema.parse({});
    expect(options).toBeDefined();
  });

  it('should accept where (standard QueryAST filter)', () => {
    const options = EngineQueryOptionsSchema.parse({
      where: { status: 'active' },
    });
    expect(options.where).toBeDefined();
  });

  it('should accept fields (standard QueryAST select)', () => {
    const options = EngineQueryOptionsSchema.parse({
      fields: ['id', 'name', 'email'],
    });
    expect(options.fields).toHaveLength(3);
  });

  it('should accept orderBy (standard QueryAST sort)', () => {
    const options = EngineQueryOptionsSchema.parse({
      orderBy: [{ field: 'name', order: 'asc' }],
    });
    expect(options.orderBy).toHaveLength(1);
  });

  it('should accept pagination with limit/offset', () => {
    const options = EngineQueryOptionsSchema.parse({
      limit: 10,
      offset: 20,
    });
    expect(options.limit).toBe(10);
    expect(options.offset).toBe(20);
  });

  it('should accept expand (standard QueryAST relation loading)', () => {
    const options = EngineQueryOptionsSchema.parse({
      expand: {
        owner: { object: 'user', fields: ['name', 'email'] },
      },
    });
    expect(options.expand).toBeDefined();
    expect(options.expand!.owner.object).toBe('user');
  });

  it('should accept complete QueryAST-style options', () => {
    const options = EngineQueryOptionsSchema.parse({
      where: { status: 'active' },
      fields: ['id', 'name', 'email'],
      orderBy: [{ field: 'name', order: 'asc' }],
      limit: 50,
      offset: 0,
      expand: { owner: { object: 'user' } },
    });
    expect(options.where).toBeDefined();
    expect(options.fields).toHaveLength(3);
    expect(options.limit).toBe(50);
    expect(options.expand!.owner.object).toBe('user');
  });

  // ── `search`: both spellings, canonical one first (#7178) ────────────

  it('accepts the BARE query string — the canonical ADR-0061 D1 spelling (#7178)', () => {
    // This is the pin that was RED before #7178: the schema declared only the
    // structured form, so the spelling the executor actually serves, every
    // surface sends, and `BaseQuerySchema.search` already accepts was rejected
    // here — and every engine caller wanting it had to `as any` the whole query.
    const options = EngineQueryOptionsSchema.parse({ search: 'acme corp' });
    expect(options.search).toBe('acme corp');
  });

  it('still accepts the structured FullTextSearch form — the Tier-2 knobs (#7178)', () => {
    const options = EngineQueryOptionsSchema.parse({
      search: { query: 'acme corp', fields: ['name', 'industry'] },
    });
    expect(typeof options.search).toBe('object');
    expect((options.search as { query: string }).query).toBe('acme corp');
    expect((options.search as { fields?: string[] }).fields).toEqual(['name', 'industry']);
  });

  it('accepts search alongside searchFields, in both spellings (#7178)', () => {
    expect(EngineQueryOptionsSchema.parse({
      search: 'acme', searchFields: ['name'],
    }).searchFields).toEqual(['name']);
    expect(EngineQueryOptionsSchema.parse({
      search: { query: 'acme' }, searchFields: ['name'],
    }).searchFields).toEqual(['name']);
  });

  it('rejects a search that is neither a string nor a FullTextSearch (#7178)', () => {
    // The union widens the accept face by exactly one spelling — it does not
    // open the key to anything.
    expect(() => EngineQueryOptionsSchema.parse({ search: 42 })).toThrow();
    expect(() => EngineQueryOptionsSchema.parse({ search: { fields: ['name'] } })).toThrow();
  });

  it('matches BaseQuerySchema.search — the two sibling schemas agree (#7178)', () => {
    // The whole point of the repair: what QuerySchema accepts for `search`,
    // the engine options schema accepts too. `DriverQuery` (= Omit<QueryAST,
    // 'object'>) is assignable to `EngineQueryOptionsParsed` again because of
    // this, which is what lets `database-loader`'s engine branch drop its casts.
    for (const search of ['acme corp', { query: 'acme corp', fields: ['name'] }]) {
      expect(QuerySchema.parse({ object: 'crm_account', search })).toBeDefined();
      expect(EngineQueryOptionsSchema.parse({ search })).toBeDefined();
    }
  });

  it('rejects the removed cursor/distinct keys with the query.* prescriptions (#4286)', () => {
    expect(() => EngineQueryOptionsSchema.parse({ cursor: { id: 'x' } }))
      .toThrow(/query\.cursor.*removed/s);
    expect(() => EngineQueryOptionsSchema.parse({ distinct: true }))
      .toThrow(/query\.distinct.*removed/s);
  });

  it('should accept context', () => {
    const options = EngineQueryOptionsSchema.parse({
      where: { status: 'active' },
      context: { userId: 'user_123', tenantId: 'org_456' },
    });
    expect(options.context?.userId).toBe('user_123');
  });
});

describe('EngineUpdateOptionsSchema', () => {
  it('should accept where instead of filter', () => {
    const options = EngineUpdateOptionsSchema.parse({
      where: { status: 'inactive' },
      multi: true,
    });
    expect(options.where).toBeDefined();
    expect(options.multi).toBe(true);
  });
});

describe('EngineDeleteOptionsSchema', () => {
  it('should accept where instead of filter', () => {
    const options = EngineDeleteOptionsSchema.parse({
      where: { status: 'archived' },
      multi: true,
    });
    expect(options.where).toBeDefined();
    expect(options.multi).toBe(true);
  });
});

describe('EngineAggregateOptionsSchema', () => {
  it('should accept where and standard AggregationNodeSchema', () => {
    const options = EngineAggregateOptionsSchema.parse({
      where: { status: 'active' },
      groupBy: ['category'],
      aggregations: [
        { function: 'sum', field: 'revenue', alias: 'total_revenue' },
        { function: 'avg', field: 'revenue', alias: 'avg_revenue' },
      ],
    });
    expect(options.where).toBeDefined();
    expect(options.groupBy).toHaveLength(1);
    expect(options.aggregations).toHaveLength(2);
  });
});

describe('EngineCountOptionsSchema', () => {
  it('should accept where instead of filter', () => {
    const options = EngineCountOptionsSchema.parse({
      where: { status: 'active' },
    });
    expect(options.where).toBeDefined();
  });
});

describe('DataEngineFindRequestSchema', () => {
  it('should accept minimal find request', () => {
    const request = DataEngineFindRequestSchema.parse({
      method: 'find',
      object: 'account',
    });

    expect(request.method).toBe('find');
    expect(request.object).toBe('account');
  });

  it('should accept find with query', () => {
    const request = DataEngineFindRequestSchema.parse({
      method: 'find',
      object: 'account',
      query: {
        where: { status: 'active' },
        limit: 10,
      },
    });

    expect(request.query?.where).toBeDefined();
  });

  it('folds legacy params into their canonical keys and drops the aliases (#3795, #4346)', () => {
    const request = DataEngineFindRequestSchema.parse({
      method: 'find',
      object: 'account',
      query: {
        filter: { status: 'active' },
        select: ['id', 'name'],
        sort: [{ field: 'name', order: 'asc' }],
        skip: 10,
        populate: ['owner'],
        top: 5,
      },
    });

    // Legacy input stays accepted (backward compat) — but the parsed output
    // speaks canonical QueryAST only, so no consumer re-implements precedence.
    expect(request.query?.where).toEqual({ status: 'active' });
    expect(request.query?.fields).toEqual(['id', 'name']);
    expect(request.query?.orderBy).toEqual([{ field: 'name', order: 'asc' }]);
    expect(request.query?.offset).toBe(10);
    expect(request.query?.expand).toEqual({ owner: { object: 'owner' } });
    expect(request.query?.limit).toBe(5);
    for (const alias of ['filter', 'select', 'sort', 'skip', 'populate', 'top']) {
      expect(request.query && alias in request.query).toBe(false);
    }
  });

  it('lowers the record sort spellings while folding (#3795)', () => {
    const named = DataEngineFindRequestSchema.parse({
      method: 'find',
      object: 'account',
      query: { sort: { name: 'desc' } },
    });
    expect(named.query?.orderBy).toEqual([{ field: 'name', order: 'desc' }]);

    const numeric = DataEngineFindRequestSchema.parse({
      method: 'find',
      object: 'account',
      query: { sort: { created_at: 1, name: -1 } },
    });
    expect(numeric.query?.orderBy).toEqual([
      { field: 'created_at', order: 'asc' },
      { field: 'name', order: 'desc' },
    ]);
  });

  it('tolerates a redundant identical spelling, refuses a conflicting one (#3795)', () => {
    const redundant = DataEngineFindRequestSchema.parse({
      method: 'find',
      object: 'account',
      query: { fields: ['id'], select: ['id'] },
    });
    expect(redundant.query?.fields).toEqual(['id']);
    expect(redundant.query && 'select' in redundant.query).toBe(false);

    const conflict = DataEngineFindRequestSchema.safeParse({
      method: 'find',
      object: 'account',
      query: { fields: ['id'], select: ['name'] },
    });
    expect(conflict.success).toBe(false);
    if (!conflict.success) {
      expect(conflict.error.issues[0].message).toMatch(/Send exactly one/);
    }
  });

  it('refuses a conflicting value on every alias pair (#3795, #4346)', () => {
    const cases: Array<Record<string, unknown>> = [
      { filter: { a: 1 }, where: { b: 2 } },
      { select: ['a'], fields: ['b'] },
      { sort: [{ field: 'a', order: 'asc' }], orderBy: [{ field: 'b', order: 'asc' }] },
      { skip: 1, offset: 2 },
      { populate: ['a'], expand: { b: { object: 'b' } } },
      { top: 1, limit: 3 },
    ];
    for (const query of cases) {
      const result = DataEngineFindRequestSchema.safeParse({ method: 'find', object: 'account', query });
      expect(result.success, `${Object.keys(query).join('+')} must be refused`).toBe(false);
    }
  });
});

describe('DataEngineFindOneRequestSchema', () => {
  it('should accept find one request', () => {
    const request = DataEngineFindOneRequestSchema.parse({
      method: 'findOne',
      object: 'account',
      query: {
        where: { id: '123' },
      },
    });

    expect(request.method).toBe('findOne');
  });

  it('folds legacy params into canonical keys (backward compat input, #3795)', () => {
    const request = DataEngineFindOneRequestSchema.parse({
      method: 'findOne',
      object: 'account',
      query: {
        filter: { id: '123' },
        select: ['id', 'name'],
      },
    });

    expect(request.query?.where).toEqual({ id: '123' });
    expect(request.query?.fields).toEqual(['id', 'name']);
    expect(request.query && 'filter' in request.query).toBe(false);
  });
});

describe('DataEngineInsertRequestSchema', () => {
  it('should accept single record insert', () => {
    const request = DataEngineInsertRequestSchema.parse({
      method: 'insert',
      object: 'account',
      data: { name: 'Test Account' },
    });

    expect(request.method).toBe('insert');
    expect(request.data.name).toBe('Test Account');
  });

  it('should accept multiple records insert', () => {
    const request = DataEngineInsertRequestSchema.parse({
      method: 'insert',
      object: 'account',
      data: [
        { name: 'Account 1' },
        { name: 'Account 2' },
      ],
    });

    expect(request.data).toHaveLength(2);
  });

  it('should accept insert with options', () => {
    const request = DataEngineInsertRequestSchema.parse({
      method: 'insert',
      object: 'account',
      data: { name: 'Test' },
      options: {
        returning: true,
      },
    });

    expect(request.options?.returning).toBe(true);
  });
});

describe('DataEngineUpdateRequestSchema', () => {
  it('should accept update with id', () => {
    const request = DataEngineUpdateRequestSchema.parse({
      method: 'update',
      object: 'account',
      id: '123',
      data: { status: 'active' },
    });

    expect(request.id).toBe('123');
  });

  it('folds a legacy filter into where (backward compat input, #3795)', () => {
    const request = DataEngineUpdateRequestSchema.parse({
      method: 'update',
      object: 'account',
      data: { status: 'active' },
      options: {
        filter: { category: 'premium' },
        multi: true,
      },
    });

    expect(request.options?.where).toEqual({ category: 'premium' });
    expect(request.options && 'filter' in request.options).toBe(false);
    expect(request.options?.multi).toBe(true);
  });

  it('should accept update with new where (preferred)', () => {
    const request = DataEngineUpdateRequestSchema.parse({
      method: 'update',
      object: 'account',
      data: { status: 'active' },
      options: {
        where: { category: 'premium' },
        multi: true,
      },
    });

    expect(request.options?.where).toEqual({ category: 'premium' });
    expect(request.options?.multi).toBe(true);
  });
});

describe('DataEngineDeleteRequestSchema', () => {
  it('should accept delete with id', () => {
    const request = DataEngineDeleteRequestSchema.parse({
      method: 'delete',
      object: 'account',
      id: '123',
    });

    expect(request.id).toBe('123');
  });

  it('folds a legacy filter into where (backward compat input, #3795)', () => {
    const request = DataEngineDeleteRequestSchema.parse({
      method: 'delete',
      object: 'account',
      options: {
        filter: { status: 'archived' },
        multi: true,
      },
    });

    expect(request.options?.where).toEqual({ status: 'archived' });
    expect(request.options && 'filter' in request.options).toBe(false);
    expect(request.options?.multi).toBe(true);
  });

  it('should accept delete with new where (preferred)', () => {
    const request = DataEngineDeleteRequestSchema.parse({
      method: 'delete',
      object: 'account',
      options: {
        where: { status: 'archived' },
        multi: true,
      },
    });

    expect(request.options?.where).toEqual({ status: 'archived' });
    expect(request.options?.multi).toBe(true);
  });
});

describe('DataEngineCountRequestSchema', () => {
  it('should accept count request', () => {
    const request = DataEngineCountRequestSchema.parse({
      method: 'count',
      object: 'account',
    });

    expect(request.method).toBe('count');
  });

  it('should accept count with where (preferred)', () => {
    const request = DataEngineCountRequestSchema.parse({
      method: 'count',
      object: 'account',
      query: {
        where: { status: 'active' },
      },
    });

    expect(request.query?.where).toBeDefined();
  });

  it('folds a legacy filter into where (backward compat input, #3795)', () => {
    const request = DataEngineCountRequestSchema.parse({
      method: 'count',
      object: 'account',
      query: {
        filter: { status: 'active' },
      },
    });

    expect(request.query?.where).toEqual({ status: 'active' });
    expect(request.query && 'filter' in request.query).toBe(false);
  });

  it('refuses filter + where with different values (#3795)', () => {
    const result = DataEngineCountRequestSchema.safeParse({
      method: 'count',
      object: 'account',
      query: { filter: { a: 1 }, where: { b: 2 } },
    });
    expect(result.success).toBe(false);
  });
});

describe('DataEngineAggregateRequestSchema', () => {
  it('should accept aggregate request', () => {
    const request = DataEngineAggregateRequestSchema.parse({
      method: 'aggregate',
      object: 'account',
      query: {
        groupBy: ['status'],
        aggregations: [
          { function: 'sum', field: 'revenue', alias: 'total_revenue' },
        ],
      },
    });

    expect(request.method).toBe('aggregate');
  });
});

describe('DataEngineExecuteRequestSchema', () => {
  it('should accept execute with SQL command', () => {
    const request = DataEngineExecuteRequestSchema.parse({
      method: 'execute',
      command: 'SELECT * FROM accounts WHERE status = ?',
    });

    expect(request.method).toBe('execute');
  });

  it('should accept execute with object command', () => {
    const request = DataEngineExecuteRequestSchema.parse({
      method: 'execute',
      command: {
        operation: 'custom_query',
        params: { limit: 10 },
      },
    });

    expect(request.command.operation).toBe('custom_query');
  });

  it('should accept execute with options', () => {
    const request = DataEngineExecuteRequestSchema.parse({
      method: 'execute',
      command: 'CUSTOM QUERY',
      options: {
        timeout: 5000,
      },
    });

    expect(request.options?.timeout).toBe(5000);
  });
});

describe('DataEngineVectorFindRequestSchema', () => {
  it('should accept vector find request', () => {
    const request = DataEngineVectorFindRequestSchema.parse({
      method: 'vectorFind',
      object: 'documents',
      vector: [0.1, 0.2, 0.3, 0.4],
    });

    expect(request.method).toBe('vectorFind');
    expect(request.vector).toHaveLength(4);
  });

  it('should accept custom limit', () => {
    const request = DataEngineVectorFindRequestSchema.parse({
      method: 'vectorFind',
      object: 'documents',
      vector: [0.1, 0.2, 0.3],
      limit: 10,
    });

    expect(request.limit).toBe(10);
  });

  it('should accept vector find with filter', () => {
    const request = DataEngineVectorFindRequestSchema.parse({
      method: 'vectorFind',
      object: 'documents',
      vector: [0.1, 0.2, 0.3],
      where: { category: 'tech' },
      limit: 10,
      threshold: 0.8,
    });

    expect(request.where).toBeDefined();
    expect(request.limit).toBe(10);
    expect(request.threshold).toBe(0.8);
  });

  it('should accept vector find with fields', () => {
    const request = DataEngineVectorFindRequestSchema.parse({
      method: 'vectorFind',
      object: 'documents',
      vector: [0.1, 0.2],
      fields: ['id', 'title', 'content'],
    });

    expect(request.fields).toHaveLength(3);
  });
});

// The `DataEngineBatchRequestSchema` suite that stood here was removed with
// the schema itself (ADR-0119 D3, #4618). Every case parsed a literal through
// a schema no production code ever called, so it proved the schema matched
// itself and nothing more.

describe('DataEngineRequestSchema', () => {
  it('should accept all request types', () => {
    const requests = [
      { method: 'find' as const, object: 'account' },
      { method: 'findOne' as const, object: 'account' },
      { method: 'insert' as const, object: 'account', data: {} },
      { method: 'update' as const, object: 'account', data: {} },
      { method: 'delete' as const, object: 'account' },
      { method: 'count' as const, object: 'account' },
      { method: 'aggregate' as const, object: 'account', query: {} },
      { method: 'execute' as const, command: 'SQL' },
      { method: 'vectorFind' as const, object: 'docs', vector: [0.1] },
    ];

    requests.forEach(request => {
      expect(() => DataEngineRequestSchema.parse(request)).not.toThrow();
    });
  });
});

describe('Integration Tests', () => {
  it('should support context in query options', () => {
    const options = DataEngineQueryOptionsSchema.parse({
      filter: { status: 'active' },
      context: {
        userId: 'user_123',
        tenantId: 'org_456',
        positions: ['admin'],
      },
    });

    expect(options.context?.userId).toBe('user_123');
    expect(options.context?.tenantId).toBe('org_456');
    expect(options.context?.positions).toEqual(['admin']);
  });

  it('should support context in insert options', () => {
    const options = DataEngineInsertOptionsSchema.parse({
      returning: true,
      context: { userId: 'user_1', isSystem: false },
    });

    expect(options.context?.userId).toBe('user_1');
  });

  it('should support context in update options', () => {
    const options = DataEngineUpdateOptionsSchema.parse({
      filter: { id: '1' },
      context: { userId: 'user_1', tenantId: 'org_1' },
    });

    expect(options.context?.tenantId).toBe('org_1');
  });

  it('should support context in delete options', () => {
    const options = DataEngineDeleteOptionsSchema.parse({
      filter: { id: '1' },
      context: { isSystem: true },
    });

    expect(options.context?.isSystem).toBe(true);
  });

  it('should support context in count options', () => {
    const options = DataEngineCountOptionsSchema.parse({
      filter: { status: 'active' },
      context: { userId: 'u1' },
    });

    expect(options.context?.userId).toBe('u1');
  });

  it('should support context in aggregate options', () => {
    const options = DataEngineAggregateOptionsSchema.parse({
      groupBy: ['status'],
      context: { userId: 'u1', positions: ['analyst'] },
    });

    expect(options.context?.positions).toEqual(['analyst']);
  });

  it('should accept options without context (backward compatible)', () => {
    const queryOpts = DataEngineQueryOptionsSchema.parse({ filter: { x: 1 } });
    const insertOpts = DataEngineInsertOptionsSchema.parse({ returning: true });
    const updateOpts = DataEngineUpdateOptionsSchema.parse({ upsert: true });
    const deleteOpts = DataEngineDeleteOptionsSchema.parse({ multi: true });
    const countOpts = DataEngineCountOptionsSchema.parse({});
    const aggOpts = DataEngineAggregateOptionsSchema.parse({ groupBy: ['a'] });

    expect(queryOpts.context).toBeUndefined();
    expect(insertOpts.context).toBeUndefined();
    expect(updateOpts.context).toBeUndefined();
    expect(deleteOpts.context).toBeUndefined();
    expect(countOpts.context).toBeUndefined();
    expect(aggOpts.context).toBeUndefined();
  });

  it('should support complete CRUD workflow', () => {
    // Create
    const insertRequest = DataEngineInsertRequestSchema.parse({
      method: 'insert',
      object: 'account',
      data: { name: 'Test Account', status: 'active' },
      options: { returning: true },
    });

    // Read
    const findRequest = DataEngineFindRequestSchema.parse({
      method: 'find',
      object: 'account',
      query: {
        where: { status: 'active' },
        fields: ['id', 'name', 'status'],
        orderBy: [{ field: 'name', order: 'asc' }],
        limit: 10,
      },
    });

    // Update
    const updateRequest = DataEngineUpdateRequestSchema.parse({
      method: 'update',
      object: 'account',
      id: '123',
      data: { status: 'inactive' },
      options: { returning: true },
    });

    // Delete
    const deleteRequest = DataEngineDeleteRequestSchema.parse({
      method: 'delete',
      object: 'account',
      id: '123',
    });

    expect(insertRequest.method).toBe('insert');
    expect(findRequest.method).toBe('find');
    expect(updateRequest.method).toBe('update');
    expect(deleteRequest.method).toBe('delete');
  });

  it('should support analytics workflow', () => {
    // Count
    const countRequest = DataEngineCountRequestSchema.parse({
      method: 'count',
      object: 'opportunity',
      query: {
        where: { stage: 'closed_won' },
      },
    });

    // Aggregate
    const aggregateRequest = DataEngineAggregateRequestSchema.parse({
      method: 'aggregate',
      object: 'opportunity',
      query: {
        where: { status: 'closed' },
        groupBy: ['stage', 'owner_id'],
        aggregations: [
          { function: 'sum', field: 'amount', alias: 'total_amount' },
          { function: 'avg', field: 'amount', alias: 'avg_amount' },
          { function: 'count', field: 'id', alias: 'deal_count' },
        ],
      },
    });

    expect(countRequest.method).toBe('count');
    expect(aggregateRequest.query.aggregations).toHaveLength(3);
  });

});

describe('DroppedFieldsEventSchema.reason (#3407, widened by #6437)', () => {
  // The ACCEPTANCE surface: this enum is what validates on the protocol
  // responses that carry `droppedFields` (`api/batch.zod.ts`,
  // `api/protocol.zod.ts`), so the accepted set is the contract, not a label.
  it('accepts all three reasons the write path can report', () => {
    for (const reason of ['readonly', 'readonly_when', 'primary_key'] as const) {
      const parsed = DroppedFieldsEventSchema.safeParse({
        object: 'task', fields: ['id'], reason,
      });
      expect(parsed.success, `reason ${reason} should be accepted`).toBe(true);
    }
  });

  it('primary_key is the value the engine reports for the ruled-non-id strip (#6262/#6433, #6435)', () => {
    const parsed = DroppedFieldsEventSchema.parse({
      object: 'task', fields: ['id'], reason: 'primary_key',
    });
    expect(parsed).toEqual({ object: 'task', fields: ['id'], reason: 'primary_key' });
  });

  it('still REJECTS a reason outside the vocabulary — widening is deliberate, not open-ended', () => {
    // The enum grows by decision (a new legal strip class), never by a
    // producer inventing a string. Rejection is asserted on the issue's own
    // `code` and `path`, not on truthiness of `success`.
    const parsed = DroppedFieldsEventSchema.safeParse({
      object: 'task', fields: ['id'], reason: 'dispatch_ruled',
    });
    expect(parsed.success).toBe(false);
    const issue = parsed.success ? undefined : parsed.error.issues[0];
    expect(issue?.code).toBe('invalid_value');
    expect(issue?.path).toEqual(['reason']);
  });
});
