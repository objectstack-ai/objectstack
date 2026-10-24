// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25582, maintainer ruling 6377844879 letter A, proposals 1 and 2]
 * `POST /api/v1/data/:object/import` reads two more year-first spellings of a
 * `date` cell — the dotted `YYYY.MM.DD` (`2011.07.01`) and the compact
 * `YYYYMMDD` (`20090615`) — and matches a select cell against the option
 * VALUES case-insensitively (`CN` stores the declared `cn`), as it already
 * matched the labels. Through the real route over a real `SqlDriver`
 * (better-sqlite3 `:memory:`).
 *
 * Measured through this route by ablating each half on the built
 * `@objectstack/core` the route reads: with either half removed, the ledger row
 * below fails whole (`ok: 0`, `errors: 1`) on the CSV import and on the JSON
 * dry run alike, as it did at the base (`ce18e73483`). At head it imports.
 *
 * The reader's own case table is `import-coerce.test.ts`'s `[#25582]` blocks
 * in `@objectstack/core`; this file pins the door.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const OBJECT = 'import_supplier_25582';

const SUPPLIER = {
  name: OBJECT, label: 'Supplier 25582', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    opened: { name: 'opened', type: 'date' as const, label: 'Opened' },
    founded: { name: 'founded', type: 'date' as const, label: 'Founded' },
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
    write: () => true,
    end: () => {},
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
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  }), true);
  await engine.init();
  engine.registry.registerObject(SUPPLIER as any);
  await engine.syncSchemas();
  // The protocol reads the stored-metadata family; register it as a boot does.
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const importRoute = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import') as any;
  expect(importRoute).toBeDefined();
  const importRows = async (body: Record<string, unknown>) => {
    const res = makeRes();
    await importRoute.handler({ params: { object: OBJECT }, body } as any, res);
    return res;
  };
  return { engine, importRows };
}

const MAPPING = { ID: 'id', Opened: 'opened', Founded: 'founded', Country: 'country' };

describe('[#25582] /import reads the dotted and compact year-first day and an option value in any case', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  it('imports the ledger row `2011.07.01`, `20090615`, `CN` (CSV) and stores the ISO days and the declared value', async () => {
    const csv = ['ID,Opened,Founded,Country', 's1,2011.07.01,20090615,CN'].join('\n');
    const res = await ctx.importRows({ format: 'csv', csv, writeMode: 'insert', mapping: MAPPING });

    expect(res._status ?? 200).toBe(200);
    expect(res._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    const row = await ctx.engine.findOne(OBJECT, { where: { id: 's1' } });
    expect({ opened: row?.opened, founded: row?.founded, country: row?.country })
      .toEqual({ opened: '2011-07-01', founded: '2009-06-15', country: 'cn' });
  });

  it('dry-runs the same row clean (JSON) and persists nothing', async () => {
    const res = await ctx.importRows({
      format: 'json', writeMode: 'insert', dryRun: true,
      rows: [{ id: 'd1', opened: '2011.07.01', founded: '20090615', country: 'CN' }],
    });
    expect(res._json).toMatchObject({ dryRun: true, total: 1, ok: 1, errors: 0 });
    expect(await ctx.engine.findOne(OBJECT, { where: { id: 'd1' } })).toBeNull();
  });

  it('still refuses a compact day that does not exist, and an unknown option, as that row\'s error', async () => {
    const res = await ctx.importRows({
      format: 'json', writeMode: 'insert',
      rows: [{ id: 'bad', founded: '20090230' }, { id: 'odd', country: 'DE' }, { id: 'good', founded: '20090615' }],
    });
    expect(res._json).toMatchObject({ total: 3, ok: 1, errors: 2, created: 1 });
    expect(res._json.results[0]).toMatchObject({ row: 1, ok: false, action: 'failed', field: 'founded', code: 'invalid_date' });
    expect(res._json.results[1]).toMatchObject({ row: 2, ok: false, action: 'failed', field: 'country', code: 'invalid_option' });
    expect(await ctx.engine.findOne(OBJECT, { where: { id: 'bad' } })).toBeNull();
    expect((await ctx.engine.findOne(OBJECT, { where: { id: 'good' } }))?.founded).toBe('2009-06-15');
  });
});
