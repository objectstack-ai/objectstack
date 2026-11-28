// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #35543 — a `where` key that names no field is refused `INVALID_FIELD` / 400
 * on all three analytics doors, as `/data` answers the same body.
 *
 * Measured on the stock showcase at `7605e0c9c` before the fix:
 *
 * ```
 * POST /analytics/query  where {"": "z"}                     -> 500 DATABASE_ERROR (near "=": syntax error)
 * POST /analytics/dataset/query  runtimeFilter {"": "z"}     -> 500 DATABASE_ERROR
 * MCP query_dataset  runtimeFilter {"": "z"}                 -> isError, DATABASE_ERROR
 * the same three with {" ": "z"} or {"foo bar": "z"}         -> 403 PERMISSION_DENIED (field-read gate)
 * POST /data/showcase_invoice/query  where {"": "z"}         -> 400 INVALID_FIELD
 * ```
 *
 * The harness is the plugin-wired service over an engine double that runs any
 * statement, so before the fix the empty key RESOLVED here (the double has no
 * SQL parser to fail) and the blank key was refused 403: both cases below read
 * red without the fix. `statements` stays empty on every refusal: the body
 * never reached the engine.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { AnalyticsService } from '../analytics-service.js';

const ADMIN = { userId: 'u_admin', tenantId: 'org_a' } as ExecutionContext;

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text' },
  status: { type: 'text' },
  amount: { type: 'number' },
};

const INVOICE_METRICS = {
  name: 'invoice_metrics',
  label: 'Invoice metrics',
  object: 'inv_invoice',
  dimensions: [{ name: 'status', label: 'Status', field: 'status', type: 'string' }],
  measures: [{ name: 'invoice_count', label: 'Invoices', aggregate: 'count' }],
};

const security = {
  getReadFilter: async () => undefined,
  canReadObject: () => true,
  getReadableFields: async () => Object.keys(FIELDS),
  getQueryableFields: async () => Object.keys(FIELDS),
};

async function boot() {
  const statements: string[] = [];
  const engine = {
    execute: async (sql: unknown) => {
      statements.push(String((sql as { sql?: string })?.sql ?? sql));
      return { rows: [{ invoice_count: 1, 'inv_invoice.count': 1 }] };
    },
    hasObjectMiddleware: () => false,
    getObject: (name: string) => (name === 'inv_invoice' ? { fields: FIELDS } : undefined),
    resolveEffectiveDatasource: () => undefined,
  };
  const registered: Record<string, unknown> = {};
  const ctx = {
    getService: (name: string) => (name === 'security' ? security : name === 'data' ? engine : registered[name]),
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
  await new AnalyticsServicePlugin({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
  }).init(ctx as never);
  const service = registered.analytics as AnalyticsService;
  const tools = service.datasetTools({ loadDatasets: vi.fn(async () => [INVOICE_METRICS]) });
  return { service, tools, statements };
}

type Door = (filter: Record<string, unknown>) => Promise<unknown>;

/** The three doors, each handed the same filter where its caller puts it. */
function doors(b: Awaited<ReturnType<typeof boot>>): Array<[string, Door]> {
  return [
    ['/analytics/query', (where) => b.service.query({ cube: 'inv_invoice', measures: ['inv_invoice.count'], where } as never, ADMIN)],
    ['/analytics/dataset/query', (runtimeFilter) =>
      b.service.queryDataset(INVOICE_METRICS as never, { measures: ['invoice_count'], runtimeFilter } as never, ADMIN)],
    ['MCP query_dataset', (runtimeFilter) =>
      b.tools.queryDataset({ datasetName: 'invoice_metrics', selection: { measures: ['invoice_count'], runtimeFilter } }, ADMIN)],
  ];
}

const DOOR_NAMES = ['/analytics/query', '/analytics/dataset/query', 'MCP query_dataset'];

const REFUSED = { code: 'INVALID_FIELD', status: 400 };

describe('[#35543] a where key that names no field is INVALID_FIELD / 400 on every analytics door', () => {
  for (const [label, key] of [
    ['an empty key', ''],
    ['a blank key', ' '],
    ['a key with a space in it', 'foo bar'],
  ] as const) {
    for (const index of [0, 1, 2]) {
      it(`${label} on ${DOOR_NAMES[index]} is refused before the engine is reached`, async () => {
        const b = await boot();
        const [, door] = doors(b)[index];
        await expect(door({ [key]: 'z' })).rejects.toMatchObject({ ...REFUSED, field: key, param: 'where' });
        expect(b.statements).toEqual([]);
      });
    }
  }

  it('an empty key nested under $or is refused the same way', async () => {
    const b = await boot();
    const [, door] = doors(b)[0];
    await expect(door({ $or: [{ status: 'paid' }, { '': 'z' }] })).rejects.toMatchObject(REFUSED);
    expect(b.statements).toEqual([]);
  });

  it('CONTROL: a valid filter answers on all three doors', async () => {
    for (const [label, door] of doors(await boot())) {
      await expect(door({ status: 'paid' }), label).resolves.toBeDefined();
    }
  });
});
