// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25582, maintainer ruling 6377844879 letter A, proposal 4] An import row
 * with several bad cells reports every one of them, so one import tells the
 * operator about every bad cell instead of one per re-import. Through the real
 * routes over a real {@link ObjectQL} + {@link ObjectStackProtocolImplementation}
 * + SQLite `:memory:`, with the platform's own `sys_import_job`: the
 * synchronous `POST /data/:object/import` and the async job's
 * `GET /data/import/jobs/:jobId/results`, each on the dry run and the commit.
 *
 * The row carries `errors` (`ImportRowResultSchema.errors`): one element per
 * failed cell, in column order, each `{ field, code, message }`. The
 * first-error keys `field` / `code` / `error` stay and name element 0. Measured
 * at the base (`45de8c6cba`): the same row reported its first cell only, with
 * no `errors` key, on all four paths.
 *
 * A row that failed for another reason omits the key: the dry run's validate
 * verdict (`required` here) and the commit's refused write (the create door's
 * `required` verdict) both name a field, but not as a cell error.
 *
 * The runner's own cases are `packages/core/src/utils/import-runner-cell-errors.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysImportJob } from '@objectstack/platform-objects/audit';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'supplier_cells_25582';

const SUPPLIER = {
  name: OBJECT, label: 'Supplier cells 25582', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    name: { name: 'name', type: 'text' as const, label: 'Name', required: true },
    opened: { name: 'opened', type: 'date' as const, label: 'Opened' },
    qty: { name: 'qty', type: 'number' as const, label: 'Qty' },
    country: {
      name: 'country', type: 'select' as const, label: 'Country',
      options: [{ label: '中国', value: 'cn' }, { label: '美国', value: 'us' }],
    },
  },
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  engine.registry.registerObject(SUPPLIER as any);
  engine.registry.registerObject(SysImportJob as any);
  await engine.syncSchemas();
  // A real `single` install's Default Organization: the job row's system
  // writes derive it (ADR-0131 D9).
  await installDefaultOrganization(engine);

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const call = async (method: string, path: string, body: unknown, params: Record<string, string> = { object: OBJECT }): Promise<{ status: number; body: any }> => {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(route, `${method} ${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ params, body, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };

  /** The synchronous route's per-row report. */
  const syncRows = async (rows: Array<Record<string, unknown>>, dryRun: boolean) => {
    const r = await call('POST', '/api/v1/data/:object/import', { format: 'json', rows, dryRun });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.results as any[];
  };

  /** The async job's per-row report, read off the results route once the job is terminal. */
  const jobRows = async (rows: Array<Record<string, unknown>>, dryRun: boolean) => {
    const created = await call('POST', '/api/v1/data/:object/import/jobs', { format: 'json', rows, dryRun });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const jobId = String(created.body.jobId);
    let progress: { status: number; body: any } | undefined;
    for (let i = 0; i < 200; i++) {
      progress = await call('GET', '/api/v1/data/import/jobs/:jobId', undefined, { jobId });
      if (['succeeded', 'failed', 'cancelled'].includes(progress.body?.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(progress?.body?.status, JSON.stringify(progress?.body)).toBe('succeeded');
    const results = await call('GET', '/api/v1/data/import/jobs/:jobId/results', undefined, { jobId });
    return [...(results.body.results as any[])].sort((a, b) => a.row - b.row);
  };

  return { engine, syncRows, jobRows };
}

/** Three bad cells around good ones, in this column order. */
const BAD_ROW = { id: 'b1', name: 'Acme', opened: '2011-13-45', qty: 'many', country: 'DE' };
const GOOD_ROW = { id: 'g1', name: 'Good', opened: '2011-07-01', qty: '3', country: 'cn' };

function expectEveryCellError(row: any) {
  expect(row, JSON.stringify(row)).toMatchObject({ row: 1, ok: false, action: 'failed' });
  expect(row.errors?.map((e: any) => [e.field, e.code]), JSON.stringify(row)).toEqual([
    ['opened', 'invalid_date'],
    ['qty', 'invalid_number'],
    ['country', 'invalid_option'],
  ]);
  for (const e of row.errors) {
    expect(Object.keys(e).sort()).toEqual(['code', 'field', 'message']);
    expect(typeof e.message).toBe('string');
  }
  // The first-error keys are element 0, as they were before the list.
  expect({ field: row.field, code: row.code, error: row.error })
    .toEqual({ field: row.errors[0].field, code: row.errors[0].code, error: row.errors[0].message });
}

describe('[#25582] every cell error of a row reaches the report', () => {
  for (const dryRun of [true, false]) {
    const leg = dryRun ? 'dry run' : 'commit';

    it(`sync route, ${leg}`, async () => {
      const b = await boot();
      const rows = await b.syncRows([BAD_ROW, GOOD_ROW], dryRun);
      expectEveryCellError(rows[0]);
      expect(rows[1]).toMatchObject({ row: 2, ok: true, action: 'created' });
      expect(rows[1]).not.toHaveProperty('errors');
      expect(await b.engine.findOne(OBJECT, { where: { id: 'b1' } })).toBeNull();
    });

    it(`async job, ${leg}`, async () => {
      const b = await boot();
      const rows = await b.jobRows([BAD_ROW, GOOD_ROW], dryRun);
      expectEveryCellError(rows[0]);
      expect(rows[1]).toMatchObject({ row: 2, ok: true, action: 'created' });
      expect(rows[1]).not.toHaveProperty('errors');
    });
  }
});

describe('[#25582] a row that failed for another reason carries no `errors`', () => {
  /** Every cell coerces; `name` is required and missing. */
  const NO_NAME = { id: 'n1', qty: '3' };

  it('the dry run\'s validate verdict (sync and async)', async () => {
    const b = await boot();
    for (const rows of [await b.syncRows([NO_NAME], true), await b.jobRows([NO_NAME], true)]) {
      expect(rows[0], JSON.stringify(rows[0])).toMatchObject({ row: 1, ok: false, action: 'failed', field: 'name', code: 'required' });
      expect(rows[0]).not.toHaveProperty('errors');
    }
  });

  it('the commit\'s refused write (sync and async)', async () => {
    const b = await boot();
    for (const rows of [await b.syncRows([NO_NAME], false), await b.jobRows([NO_NAME], false)]) {
      expect(rows[0], JSON.stringify(rows[0])).toMatchObject({ row: 1, ok: false, action: 'failed', field: 'name', code: 'required' });
      expect(rows[0]).not.toHaveProperty('errors');
    }
    expect(await b.engine.findOne(OBJECT, { where: { id: 'n1' } })).toBeNull();
  });
});
