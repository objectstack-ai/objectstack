// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26133] One keyed import never writes two of its own rows for one
 * `matchFields` key. Rows of the SAME import that carry the same key fail with
 * `DUPLICATE_MATCH_KEY`, every one of them, naming every row that carries it,
 * and none of them is written: which spreadsheet row was right is the author's
 * call, never the runner's. Through the real `POST /data/:object/import` route
 * over a real `SqlDriver` (better-sqlite3 `:memory:`).
 *
 * The card's object: a supplier certificate keyed on `supplier` (a lookup,
 * resolved by name), `cert_type` (a select whose label `ISO 14001` and value
 * `iso14001` both coerce to the value) and `cert_no`, with no unique index
 * over the key. At the base each duplicate row was created, and from then on
 * every upsert of that key answered `AMBIGUOUS_MATCH`.
 *
 * The key is compared AFTER cell coercion, by the key set the row is matched
 * by — the value the matcher queries with — so `ISO 14001` and `ISO14001` are
 * one key. A file without in-file duplicates answers exactly as before.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const SUPPLIER = {
  name: 'srm_supplier_26133', label: 'Supplier', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
  },
};

const certificate = (name: string, extra: Record<string, unknown> = {}) => ({
  name, label: 'Certificate', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    supplier: { name: 'supplier', type: 'lookup' as const, label: 'Supplier', reference: SUPPLIER.name, displayField: 'name' },
    cert_type: {
      name: 'cert_type', type: 'select' as const, label: 'Type',
      options: [{ label: 'ISO 9001', value: 'iso9001' }, { label: 'ISO 14001', value: 'iso14001' }],
    },
    cert_no: { name: 'cert_no', type: 'text' as const, label: 'No.' },
    note: { name: 'note', type: 'text' as const, label: 'Note' },
  },
  ...extra,
});

const CERT = certificate('srm_cert_26133');

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot(objects: any[] = [SUPPLIER, CERT]) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  }), true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o);
  await engine.syncSchemas();
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const noop = () => {};
  const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
  const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import') as any;
  expect(route).toBeDefined();
  await engine.insert(SUPPLIER.name, { id: 'sup_a', name: 'Acme' });
  await engine.insert(SUPPLIER.name, { id: 'sup_b', name: 'Beta' });
  const importInto = async (object: string, body: Record<string, unknown>) => {
    const res = makeRes();
    await route.handler({ params: { object }, body } as any, res);
    expect(res._status ?? 200).toBe(200);
    return res._json;
  };
  return { engine, importInto };
}

const MAPPING = { Supplier: 'supplier', Type: 'cert_type', No: 'cert_no', Note: 'note' };
const KEY = ['supplier', 'cert_type', 'cert_no'];
const csvOf = (...lines: string[]) => ['Supplier,Type,No,Note', ...lines].join('\n');
const upsert = (csv: string, extra: Record<string, unknown> = {}) =>
  ({ format: 'csv', csv, mapping: MAPPING, writeMode: 'upsert', matchFields: KEY, ...extra });

const duplicate = (row: number, rows: number[], keySet = 'supplier + cert_type + cert_no') => ({
  row, ok: false, action: 'failed', code: 'DUPLICATE_MATCH_KEY',
  error: `Rows ${rows.join(', ')} of this import have the same match key (${keySet}), so none of them was written: keep one row per key and import again`,
});

describe('[#26133] an upsert import refuses rows of its own that share a match key', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  const certs = async (object = CERT.name) =>
    (await ctx.engine.find(object, { orderBy: [{ field: 'note', order: 'asc' }] } as any))
      .map((r: any) => ({ supplier: r.supplier, cert_type: r.cert_type, cert_no: r.cert_no, note: r.note ?? null }));
  beforeEach(async () => { ctx = await boot(); });

  it('the card: two identical rows, and `ISO 14001` beside `ISO14001`, are refused whole; the rest of the file imports', async () => {
    const summary = await ctx.importInto(CERT.name, upsert(csvOf(
      'Acme,ISO 9001,A-1,first',
      'Acme,ISO 9001,A-1,second',
      'Acme,ISO 14001,B-1,third',
      'Beta,ISO 9001,A-1,fourth',
      'Acme,ISO14001,B-1,fifth',
    )));

    expect(summary.results).toEqual([
      duplicate(1, [1, 2]),
      duplicate(2, [1, 2]),
      duplicate(3, [3, 5]),
      { row: 4, ok: true, action: 'created', id: expect.any(String) },
      duplicate(5, [3, 5]),
    ]);
    expect(summary).toMatchObject({ total: 5, ok: 1, errors: 4, created: 1, updated: 0, skipped: 0 });
    expect(await certs()).toEqual([{ supplier: 'sup_b', cert_type: 'iso9001', cert_no: 'A-1', note: 'fourth' }]);
  });

  it('the fixed file imports, and re-running it updates instead of answering `AMBIGUOUS_MATCH`', async () => {
    await ctx.importInto(CERT.name, upsert(csvOf('Acme,ISO 14001,B-1,first', 'Acme,ISO14001,B-1,second')));
    expect(await certs()).toEqual([]);

    const fixed = csvOf('Acme,ISO 14001,B-1,kept');
    const first = await ctx.importInto(CERT.name, upsert(fixed));
    expect(first.results).toEqual([{ row: 1, ok: true, action: 'created', id: expect.any(String) }]);
    const again = await ctx.importInto(CERT.name, upsert(fixed));
    expect(again.results).toEqual([{ row: 1, ok: true, action: 'updated', id: first.results[0].id }]);
    expect(await certs()).toEqual([{ supplier: 'sup_a', cert_type: 'iso14001', cert_no: 'B-1', note: 'kept' }]);
  });

  it('two rows naming a record that already exists are refused too: neither silently wins the update', async () => {
    await ctx.engine.insert(CERT.name, { id: 'c1', supplier: 'sup_a', cert_type: 'iso9001', cert_no: 'A-1', note: 'stored' });
    const summary = await ctx.importInto(CERT.name, upsert(csvOf('Acme,ISO 9001,A-1,first', 'Acme,iso9001,A-1,second')));

    expect(summary.results).toEqual([duplicate(1, [1, 2]), duplicate(2, [1, 2])]);
    expect(await certs()).toEqual([{ supplier: 'sup_a', cert_type: 'iso9001', cert_no: 'A-1', note: 'stored' }]);
  });

  it('the dry run answers exactly what the import answers, and persists nothing', async () => {
    const csv = csvOf('Acme,ISO 9001,A-1,first', 'Beta,ISO 9001,A-1,second', 'Acme,ISO 9001,A-1,third');
    const dry = await ctx.importInto(CERT.name, upsert(csv, { dryRun: true }));
    expect(dry.results).toEqual([
      duplicate(1, [1, 3]),
      { row: 2, ok: true, action: 'created' },
      duplicate(3, [1, 3]),
    ]);
    expect(await certs()).toEqual([]);

    const real = await ctx.importInto(CERT.name, upsert(csv));
    expect(real.results.map(({ id: _id, ...r }: any) => r)).toEqual(dry.results);
  });

  it('a row whose own cell fails coercion keeps its cell error; the row it would have collided with still names both', async () => {
    const summary = await ctx.importInto(CERT.name, upsert(csvOf('Acme,ISO 9001,A-1,first', 'Acme,ISO 9001,A-1,second', 'Acme,ISO 27001,A-1,third')));
    expect(summary.results).toEqual([
      duplicate(1, [1, 2]),
      duplicate(2, [1, 2]),
      expect.objectContaining({ row: 3, ok: false, action: 'failed', field: 'cert_type', code: 'invalid_option' }),
    ]);
    expect(await certs()).toEqual([]);
  });

  it('update mode refuses them the same way; insert mode, which matches nothing, still writes every row', async () => {
    await ctx.engine.insert(CERT.name, { id: 'c1', supplier: 'sup_a', cert_type: 'iso9001', cert_no: 'A-1', note: 'stored' });
    const csv = csvOf('Acme,ISO 9001,A-1,first', 'Acme,ISO 9001,A-1,second');

    const update = await ctx.importInto(CERT.name, upsert(csv, { writeMode: 'update' }));
    expect(update.results).toEqual([duplicate(1, [1, 2]), duplicate(2, [1, 2])]);
    expect(await certs()).toEqual([{ supplier: 'sup_a', cert_type: 'iso9001', cert_no: 'A-1', note: 'stored' }]);

    const insert = await ctx.importInto(CERT.name, { format: 'csv', csv, mapping: MAPPING, writeMode: 'insert' });
    expect(insert.results).toEqual([
      { row: 1, ok: true, action: 'created', id: expect.any(String) },
      { row: 2, ok: true, action: 'created', id: expect.any(String) },
    ]);
  });

  it('ordered key sets: a key is the set a row is matched by plus its values, so rows matched by different sets never collide', async () => {
    const summary = await ctx.importInto(CERT.name, {
      format: 'json', writeMode: 'upsert', matchFields: [['cert_no'], ['supplier', 'note']],
      rows: [
        { supplier: 'Acme', cert_type: 'ISO 9001', cert_no: 'A-1', note: 'x' },
        { supplier: 'Acme', cert_type: 'ISO 9001', note: 'A-1' },
        { supplier: 'Beta', cert_type: 'ISO 9001', note: 'y' },
        { supplier: 'Beta', cert_type: 'ISO 14001', note: 'y' },
      ],
    });
    expect(summary.results).toEqual([
      { row: 1, ok: true, action: 'created', id: expect.any(String) },
      { row: 2, ok: true, action: 'created', id: expect.any(String) },
      duplicate(3, [3, 4], 'supplier + note'),
      duplicate(4, [3, 4], 'supplier + note'),
    ]);
  });

  it('a file without in-file duplicates answers as before: created, updated and blank-key rows', async () => {
    await ctx.engine.insert(CERT.name, { id: 'c1', supplier: 'sup_a', cert_type: 'iso9001', cert_no: 'A-1', note: 'stored' });
    const summary = await ctx.importInto(CERT.name, upsert(csvOf(
      'Acme,ISO 9001,A-1,updated',
      'Acme,ISO 14001,A-1,new',
      'Acme,ISO 9001,,blank-1',
      'Acme,ISO 9001,,blank-2',
    )));
    expect(summary.results).toEqual([
      { row: 1, ok: true, action: 'updated', id: 'c1' },
      { row: 2, ok: true, action: 'created', id: expect.any(String) },
      { row: 3, ok: true, action: 'created', id: expect.any(String) },
      { row: 4, ok: true, action: 'created', id: expect.any(String) },
    ]);
  });
});

describe('[#26133] an object with a unique index over the key', () => {
  const UNIQUE_CERT = certificate('srm_cert_unique_26133', {
    indexes: [{ name: 'uk_cert_26133', fields: KEY, unique: 'global' }],
  });

  it('answers the same refusal: the key is a property of the file, not of the index', async () => {
    const { engine, importInto } = await boot([SUPPLIER, UNIQUE_CERT]);
    const summary = await importInto(UNIQUE_CERT.name, upsert(csvOf('Acme,ISO 9001,A-1,first', 'Acme,ISO9001,A-1,second')));
    expect(summary.results).toEqual([duplicate(1, [1, 2]), duplicate(2, [1, 2])]);
    expect(await engine.find(UNIQUE_CERT.name, {})).toEqual([]);
  });
});
