// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `analytics_cube.description`, `measures.description`, `dimensions.description`
 * and `measures.format` on the discovery door — `getMeta()`, which
 * `GET /api/v1/analytics/meta` hands to `success()` verbatim.
 *
 * The `CubeMeta` projection carried `{ name, type, title }` per member and
 * `{ name, title }` per cube, so an authored description reached no reader at
 * all, and a measure's `format` reached only the query door's `fields[]`.
 *
 * What this file pins:
 * - an authored cube's descriptions (cube, measure, dimension) and a measure's
 *   `format` are published exactly as written;
 * - a definition that declares none of them publishes no key — the projection
 *   copies, it never fills in;
 * - a compiled dataset's cube publishes the `format` the dataset compiler
 *   copies from each dataset measure, and no `description`: the compiler
 *   writes none, so there is none to publish;
 * - a hidden cube stays hidden, descriptions or not.
 */

import { describe, it, expect, vi } from 'vitest';
import { CubeSchema, type Cube } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

/** Parsed the way `defineCube()` and `defineStack({ analyticsCubes })` parse an authored cube. */
const described: Cube = CubeSchema.parse({
  name: 'orders',
  title: 'Orders',
  description: 'Every order placed in the shop, one row per order.',
  sql: 'shop_order',
  measures: {
    revenue: {
      label: 'Revenue',
      description: 'Sum of order amounts, in the order currency.',
      type: 'sum',
      sql: 'amount',
      format: '$0,0.00',
    },
    margin: { label: 'Margin', type: 'avg', sql: 'margin', format: '0.0%' },
    count: { label: 'Orders', description: 'Number of orders.', type: 'count', sql: '*' },
  },
  dimensions: {
    status: { label: 'Status', description: 'Fulfilment status of the order.', type: 'string', sql: 'status' },
    placed_at: { label: 'Placed', type: 'time', sql: 'placed_at' },
  },
});

/** The same kind of cube with no description and no format anywhere. */
const bare: Cube = CubeSchema.parse({
  name: 'refunds',
  sql: 'shop_refund',
  measures: { count: { label: 'Refunds', type: 'count', sql: '*' } },
  dimensions: { reason: { label: 'Reason', type: 'string', sql: 'reason' } },
});

function service(cubes: Cube[]) {
  return new AnalyticsService({ logger: silentLogger, cubes });
}

describe('getMeta — an authored cube publishes its descriptions and measure formats', () => {
  it('copies the cube, measure and dimension descriptions and each measure format as written', async () => {
    const [cube] = await service([described]).getMeta('orders');

    expect(cube).toEqual({
      name: 'orders',
      title: 'Orders',
      description: 'Every order placed in the shop, one row per order.',
      measures: [
        {
          name: 'orders.revenue',
          type: 'sum',
          title: 'Revenue',
          description: 'Sum of order amounts, in the order currency.',
          format: '$0,0.00',
        },
        { name: 'orders.margin', type: 'avg', title: 'Margin', format: '0.0%' },
        { name: 'orders.count', type: 'count', title: 'Orders', description: 'Number of orders.' },
      ],
      dimensions: [
        { name: 'orders.status', type: 'string', title: 'Status', description: 'Fulfilment status of the order.' },
        { name: 'orders.placed_at', type: 'time', title: 'Placed' },
      ],
    });
  });

  it('publishes no key a definition does not declare', async () => {
    const [cube] = await service([bare]).getMeta('refunds');

    expect(cube).not.toHaveProperty('description');
    expect(cube.measures[0]).not.toHaveProperty('description');
    expect(cube.measures[0]).not.toHaveProperty('format');
    expect(cube.dimensions[0]).not.toHaveProperty('description');
    // What the projection did publish before this change is unchanged.
    expect(cube.measures[0]).toEqual({ name: 'refunds.count', type: 'count', title: 'Refunds' });
    expect(cube.dimensions[0]).toEqual({ name: 'refunds.reason', type: 'string', title: 'Reason' });
  });

  it('answers the listing and the by-name lookup alike', async () => {
    const svc = service([described, bare]);
    const listed = (await svc.getMeta()).find((c) => c.name === 'orders');
    const [byName] = await svc.getMeta('orders');
    expect(listed).toEqual(byName);
    expect(listed?.description).toBe('Every order placed in the shop, one row per order.');
  });

  it('still omits a cube declared `public: false`, whatever it describes', async () => {
    const hidden = CubeSchema.parse({ ...described, name: 'hidden_orders', public: false });
    const svc = service([hidden]);
    expect(await svc.getMeta()).toEqual([]);
    expect(await svc.getMeta('hidden_orders')).toEqual([]);
  });
});

describe('getMeta — a compiled dataset cube publishes what the compiler wrote', () => {
  const dataset = DatasetSchema.parse({
    name: 'order_metrics',
    label: 'Order metrics',
    description: 'Order KPIs for the sales dashboard.',
    object: 'shop_order',
    include: [],
    dimensions: [{ name: 'status', field: 'status', type: 'string' }],
    measures: [
      { name: 'revenue', aggregate: 'sum', field: 'amount', format: '$0,0' },
      { name: 'count', aggregate: 'count' },
    ],
  });

  it('carries each dataset measure `format`, and no description (the compiler writes none)', async () => {
    const svc = service([]);
    svc.registerDataset(dataset);
    const [cube] = await svc.getMeta('order_metrics');

    expect(cube.measures.find((m) => m.name === 'order_metrics.revenue')?.format).toBe('$0,0');
    expect(cube.measures.find((m) => m.name === 'order_metrics.count')).not.toHaveProperty('format');
    // The dataset's own `description` is not copied onto the cube it compiles to
    // (`dataset-compiler.ts#compileDataset`), and a dataset measure or dimension
    // has no `description` key to copy. Nothing is filled in on this path.
    expect(cube).not.toHaveProperty('description');
    for (const member of [...cube.measures, ...cube.dimensions]) {
      expect(member).not.toHaveProperty('description');
    }
  });
});
