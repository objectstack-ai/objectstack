import { describe, it, expect } from 'vitest';
import {
  AnalyticsEndpoint,
  AnalyticsQueryRequestSchema,
  AnalyticsResultResponseSchema,
  GetAnalyticsMetaRequestSchema,
  AnalyticsMetadataResponseSchema,
  AnalyticsSqlResponseSchema,
} from './analytics.zod';
import type { AnalyticsMetadataResponse } from './analytics.zod';
import type { CubeMeta } from '../contracts/analytics-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert< T extends true > = T;

/**
 * #6442 — the declared element of `AnalyticsMetadataResponse.data` IS the
 * `CubeMeta` contract interface, not merely shaped like it.
 *
 * `CubeMeta` in `contracts/analytics-service.ts` is what both `getMeta`
 * implementations return, and it was already correct while
 * `AnalyticsMetadataResponseSchema` was not — `packages/spec` stated one shape
 * in two files and let them disagree. Binding them here is what stops that
 * happening a second time: narrow either one alone and this goes red.
 *
 * Exported deliberately — an unread alias inside a test body is TS6196, and a
 * `@ts-expect-error`-style pin no program compiles is no pin at all.
 */
export type CubeMetaMatchesContract = Assert< Eq< AnalyticsMetadataResponse['data'][number], CubeMeta > >;

describe('AnalyticsEndpoint', () => {
  it('should accept all valid endpoints', () => {
    for (const ep of [
      '/api/v1/analytics/query',
      '/api/v1/analytics/meta',
      '/api/v1/analytics/sql',
    ]) {
      expect(AnalyticsEndpoint.parse(ep)).toBe(ep);
    }
  });

  it('should reject invalid endpoint', () => {
    expect(() => AnalyticsEndpoint.parse('/api/v1/analytics/unknown')).toThrow();
  });
});

describe('AnalyticsQueryRequestSchema — the BARE AnalyticsQuery shape (#3878)', () => {
  it('should accept a minimal bare query', () => {
    const req = AnalyticsQueryRequestSchema.parse({
      cube: 'orders',
      measures: ['total_revenue'],
    });
    expect(req.cube).toBe('orders');
    expect(req.measures).toEqual(['total_revenue']);
  });

  it('should accept the full bare shape: where (canonical), timeDimensions, order, limit', () => {
    const req = AnalyticsQueryRequestSchema.parse({
      cube: 'sales',
      measures: ['total_revenue'],
      dimensions: ['product_category'],
      where: { status: 'active', stage: { $nin: ['lost'] } },
      timeDimensions: [
        { dimension: 'created_at', granularity: 'month', dateRange: 'Last 7 days' },
      ],
      order: { total_revenue: 'desc' },
      limit: 100,
      offset: 10,
      timezone: 'Asia/Shanghai',
    });
    expect(req.where).toEqual({ status: 'active', stage: { $nin: ['lost'] } });
    expect(req.timeDimensions).toHaveLength(1);
    expect(req.timezone).toBe('Asia/Shanghai');
  });

  it('should reject missing cube', () => {
    expect(() =>
      AnalyticsQueryRequestSchema.parse({ measures: ['x'] })
    ).toThrow();
  });

  it('should reject missing measures', () => {
    expect(() =>
      AnalyticsQueryRequestSchema.parse({ cube: 'test' })
    ).toThrow();
  });

  it('should reject the retired {cube, query: {...}} envelope (#3891 shim dialect)', () => {
    expect(() =>
      AnalyticsQueryRequestSchema.parse({
        cube: 'orders',
        query: { measures: ['total_revenue'] },
      })
    ).toThrow();
  });

  it('should reject the non-contract `filters` key (the field is `where`)', () => {
    expect(() =>
      AnalyticsQueryRequestSchema.parse({
        cube: 'orders',
        measures: ['count'],
        filters: [{ member: 'status', operator: 'equals', values: ['active'] }],
      })
    ).toThrow();
  });

  it('should reject the retired unimplemented `format` key', () => {
    expect(() =>
      AnalyticsQueryRequestSchema.parse({
        cube: 'orders',
        measures: ['count'],
        format: 'csv',
      })
    ).toThrow();
  });
});

describe('AnalyticsResultResponseSchema', () => {
  it('should accept valid result response', () => {
    const resp = AnalyticsResultResponseSchema.parse({
      success: true,
      data: {
        rows: [
          { category: 'Electronics', total: 5000 },
          { category: 'Books', total: 1200 },
        ],
        fields: [
          { name: 'category', type: 'string' },
          { name: 'total', type: 'number' },
        ],
      },
    });
    expect(resp.data.rows).toHaveLength(2);
    expect(resp.data.fields).toHaveLength(2);
    expect(resp.data.sql).toBeUndefined();
  });

  it('should accept result with sql debug info', () => {
    const resp = AnalyticsResultResponseSchema.parse({
      success: true,
      data: {
        rows: [],
        fields: [],
        sql: 'SELECT category, SUM(amount) FROM orders GROUP BY category',
      },
    });
    expect(resp.data.sql).toBeDefined();
  });

  it('should reject missing rows or fields', () => {
    expect(() =>
      AnalyticsResultResponseSchema.parse({
        success: true,
        data: { rows: [] },
      })
    ).toThrow();

    expect(() =>
      AnalyticsResultResponseSchema.parse({
        success: true,
        data: { fields: [] },
      })
    ).toThrow();
  });
});

describe('GetAnalyticsMetaRequestSchema', () => {
  it('should accept empty request', () => {
    const req = GetAnalyticsMetaRequestSchema.parse({});
    expect(req.cube).toBeUndefined();
  });

  it('should accept request with cube filter', () => {
    const req = GetAnalyticsMetaRequestSchema.parse({ cube: 'orders' });
    expect(req.cube).toBe('orders');
  });
});

/**
 * #6442 — `data` is the `CubeMeta[]` discovery projection the endpoint really
 * serves, NOT the `{ cubes: CubeSchema[] }` wrapper it used to declare.
 *
 * The three cases here previously pinned the old declaration, and every one of
 * them was re-judged rather than re-spelled: the first pinned a body no
 * implementation has ever produced (replaced with the real one), the second only
 * needed the wrapper dropped, and the third — "should reject missing cubes" —
 * would have kept passing against the new schema for the WRONG reason (`{}` is
 * not an array either), pinning a `cubes` key that no longer exists. It is
 * replaced by the assertion that carries the actual load of this change: the
 * previously-declared shape is now rejected.
 */
describe('AnalyticsMetadataResponseSchema — the CubeMeta[] projection (#6442)', () => {
  /**
   * A real `GET /analytics/meta` body: what `AnalyticsService.getMeta` and its
   * `driver-memory` twin both build — measure/dimension names CUBE-QUALIFIED,
   * `title` projected from the definition's `label`, and no `sql` anywhere.
   */
  const SERVED_BODY = {
    success: true,
    data: [
      {
        name: 'orders',
        title: 'Orders',
        measures: [
          { name: 'orders.total_revenue', type: 'sum', title: 'Total Revenue' },
        ],
        dimensions: [
          { name: 'orders.status', type: 'string', title: 'Status' },
        ],
      },
    ],
  };

  it('accepts the body the endpoint actually serves', () => {
    const resp = AnalyticsMetadataResponseSchema.parse(SERVED_BODY);
    expect(resp.data).toHaveLength(1);
    expect(resp.data[0].name).toBe('orders');
    // The substance of the projection: qualified member names, display titles,
    // and no `sql` reaching the client.
    expect(resp.data[0].measures[0].name).toBe('orders.total_revenue');
    expect(resp.data[0].measures[0].title).toBe('Total Revenue');
    expect(resp.data[0].dimensions[0].name).toBe('orders.status');
    expect(resp.data[0]).not.toHaveProperty('sql');
  });

  it('accepts an empty cube list', () => {
    const resp = AnalyticsMetadataResponseSchema.parse({ success: true, data: [] });
    expect(resp.data).toHaveLength(0);
  });

  it('REJECTS the previously-declared `{ cubes: CubeSchema[] }` wrapper', () => {
    // This is the direction of the fix, stated as a test: the old declaration
    // described a body no implementation produced, so a client written against
    // it read `data.cubes` and got `undefined`. That shape must now fail loudly
    // rather than be quietly accepted alongside the real one.
    expect(() =>
      AnalyticsMetadataResponseSchema.parse({
        success: true,
        data: {
          cubes: [
            {
              name: 'orders',
              sql: 'SELECT * FROM orders',
              measures: { total_revenue: { name: 'total_revenue', label: 'Total Revenue', type: 'sum', sql: 'amount' } },
              dimensions: { status: { name: 'status', label: 'Status', type: 'string', sql: 'status' } },
            },
          ],
        },
      }),
    ).toThrow();
  });

  it('requires each measure/dimension to carry `name` and `type`', () => {
    expect(() =>
      AnalyticsMetadataResponseSchema.parse({
        success: true,
        data: [{ name: 'orders', measures: [{ title: 'Total Revenue' }], dimensions: [] }],
      }),
    ).toThrow();
  });

  it('declares exactly the `CubeMeta` contract shape, element for element', () => {
    // The compile-time half is `CubeMetaMatchesContract` at module scope below —
    // it must be EXPORTED to be a real check: a type alias declared inside this
    // function body and never read is TS6196 under `noUnusedLocals`, and
    // deleting it would leave every gate just as green (the phantom-check shape
    // AGENTS.md names).
    //
    // Runtime half: a value typed as the contract parses against the schema.
    const fromContract: CubeMeta = {
      name: 'orders',
      measures: [{ name: 'orders.total_revenue', type: 'sum' }],
      dimensions: [{ name: 'orders.status', type: 'string' }],
    };
    expect(() => AnalyticsMetadataResponseSchema.parse({ success: true, data: [fromContract] })).not.toThrow();
  });
});

describe('AnalyticsSqlResponseSchema', () => {
  it('should accept valid SQL response', () => {
    const resp = AnalyticsSqlResponseSchema.parse({
      success: true,
      data: {
        sql: 'SELECT COUNT(*) FROM orders WHERE status = $1',
        params: ['active'],
      },
    });
    expect(resp.data.sql).toContain('SELECT');
    expect(resp.data.params).toEqual(['active']);
  });

  it('should accept empty params', () => {
    const resp = AnalyticsSqlResponseSchema.parse({
      success: true,
      data: {
        sql: 'SELECT 1',
        params: [],
      },
    });
    expect(resp.data.params).toHaveLength(0);
  });

  it('should reject missing sql or params', () => {
    expect(() =>
      AnalyticsSqlResponseSchema.parse({
        success: true,
        data: { params: [] },
      })
    ).toThrow();

    expect(() =>
      AnalyticsSqlResponseSchema.parse({
        success: true,
        data: { sql: 'SELECT 1' },
      })
    ).toThrow();
  });
});
