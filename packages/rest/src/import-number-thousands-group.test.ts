// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20497] `POST /api/v1/data/:object/import` reads a comma in a number cell
 * as a thousands separator ONLY where it groups thousands — 1 to 3 leading
 * digits, then groups of exactly three, and only before any `.` — and refuses
 * every other comma as that row's `invalid_number` error, through the real
 * route over a real `SqlDriver` (better-sqlite3 `:memory:`).
 *
 * Measured through this route, JSON rows, `writeMode: 'insert'`, on
 * `InMemoryDriver` and on `SqlDriver` (better-sqlite3) alike, at the base
 * (`9449512a31`) and at the head of the PR that landed this file:
 *
 * | cell | base: stored · answer | head |
 * |:--|:--|:--|
 * | `'3,14'` | `314` · ok 1, errors 0 | row refused, `invalid_number`, nothing stored |
 * | `'1,5'` | `15` · ok 1, errors 0 | row refused, `invalid_number`, nothing stored |
 * | `'1.000,5'` | `1.0005` · ok 1, errors 0 | row refused, `invalid_number`, nothing stored |
 * | `'1,2,3'` | `123` · ok 1, errors 0 | row refused, `invalid_number`, nothing stored |
 * | `'1,000'` / `'12,345.67'` / `'(1,234)'` | `1000` / `12345.67` / `-1234` | unchanged |
 *
 * The `InMemoryDriver` row is this file's by construction, not by a second
 * arm: the cell is judged by the import's own reader (`parseNumberCell`)
 * before any driver is reached, so one verdict holds on every driver. A test
 * import of `@objectstack/driver-memory` is also not this file's to add — its
 * test consumers are a ruled, ledgered set
 * (`scripts/driver-memory-census.ledger.json`, `pnpm check:driver-memory-census`).
 *
 * The plain create door already answered `400 VALIDATION_FAILED` with field
 * code `invalid_number` for each of the four; the import row now answers the
 * same code. The reader's own case table (every documented form, the comma
 * probes) is `import-coerce.test.ts`'s `parseNumberCell` block; this file pins
 * the door.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const OBJECT = 'import_thousands_20497';

const LEDGER = {
  name: OBJECT, label: 'Ledger 20497', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', type: 'number' as const, label: 'Amount' },
  },
};

/** The card's four cells: each used to be stored as a different number. */
const REFUSED = ['3,14', '1,5', '1.000,5', '1,2,3'] as const;

/** The admitted controls: a well-formed thousands grouping keeps its reading. */
const ADMITTED: ReadonlyArray<readonly [cell: string, stored: number]> = [
  ['1,000', 1000],
  ['12,345.67', 12345.67],
  ['(1,234)', -1234],
];

function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  });
}

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
  engine.registerDriver(makeSqliteDriver(), true);
  await engine.init();
  engine.registry.registerObject(LEDGER as any);
  await engine.syncSchemas();
  // [#21516] The protocol reads the stored-metadata family; the engine refuses a
  // name its registry does not hold, so the harness registers the family as a boot
  // does — after the DDL, so an unprovisioned store still answers "no such table".
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const find = (method: string, path: string) =>
    rest.getRoutes().find((r: any) => r.method === method && r.path === path) as any;
  const importRoute = find('POST', '/api/v1/data/:object/import');
  const createRoute = find('POST', '/api/v1/data/:object');
  expect(importRoute).toBeDefined();
  expect(createRoute).toBeDefined();
  const send = async (route: any, body: unknown) => {
    const res = makeRes();
    await route.handler({ params: { object: OBJECT }, body } as any, res);
    return res;
  };
  return {
    engine,
    importRows: (body: Record<string, unknown>) => send(importRoute, body),
    create: (body: Record<string, unknown>) => send(createRoute, body),
  };
}

describe('[#20497] /import — a comma is read only as a thousands group', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  it.each(REFUSED)('refuses %j as that row\'s invalid_number error and writes its sibling row', async (cell) => {
    const res = await ctx.importRows({
      format: 'json', writeMode: 'insert',
      rows: [{ id: 'bad', amount: cell }, { id: 'good', amount: 7 }],
    });

    expect(res._status ?? 200).toBe(200);
    expect(res._json).toMatchObject({ total: 2, ok: 1, errors: 1, created: 1 });
    expect(res._json.results[0]).toMatchObject({
      row: 1, ok: false, action: 'failed', field: 'amount', code: 'invalid_number',
    });
    // Refused, not stored as some other number.
    expect(await ctx.engine.findOne(OBJECT, { where: { id: 'bad' } })).toBeNull();
    expect((await ctx.engine.findOne(OBJECT, { where: { id: 'good' } }))?.amount).toBe(7);
  });

  it.each(ADMITTED)('admits the thousands grouping %j and stores %s', async (cell, stored) => {
    const res = await ctx.importRows({
      format: 'json', writeMode: 'insert',
      rows: [{ id: 'r', amount: cell }],
    });

    expect(res._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    expect(res._json.results[0]).toMatchObject({ row: 1, ok: true, action: 'created' });
    expect((await ctx.engine.findOne(OBJECT, { where: { id: 'r' } }))?.amount).toBe(stored);
  });

  it('gives the same verdicts to quoted CSV cells', async () => {
    const csv = [
      'ID,Amount',
      ...REFUSED.map((cell, i) => `r${i},"${cell}"`),
      ...ADMITTED.map(([cell], j) => `c${j},"${cell}"`),
    ].join('\n');
    const res = await ctx.importRows({ format: 'csv', csv, writeMode: 'insert', mapping: { ID: 'id', Amount: 'amount' } });

    expect(res._json).toMatchObject({ total: REFUSED.length + ADMITTED.length, ok: ADMITTED.length, errors: REFUSED.length });
    const failedFields = res._json.results.filter((r: any) => !r.ok).map((r: any) => [r.field, r.code]);
    expect(failedFields).toEqual(REFUSED.map(() => ['amount', 'invalid_number']));
    for (const [j, [, stored]] of ADMITTED.entries()) {
      expect((await ctx.engine.findOne(OBJECT, { where: { id: `c${j}` } }))?.amount).toBe(stored);
    }
  });

  it('dry run predicts the same refusals and persists nothing', async () => {
    const res = await ctx.importRows({
      format: 'json', writeMode: 'insert', dryRun: true,
      rows: REFUSED.map((amount, i) => ({ id: `d${i}`, amount })),
    });

    expect(res._json).toMatchObject({ dryRun: true, total: REFUSED.length, ok: 0, errors: REFUSED.length });
    for (const r of res._json.results) expect(r).toMatchObject({ ok: false, field: 'amount', code: 'invalid_number' });
    for (const [i] of REFUSED.entries()) {
      expect(await ctx.engine.findOne(OBJECT, { where: { id: `d${i}` } })).toBeNull();
    }
  });

  it('answers the code the plain create door answers for the same cells', async () => {
    for (const [i, amount] of REFUSED.entries()) {
      const res = await ctx.create({ id: `p${i}`, amount });
      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(res._json.fields[0]).toMatchObject({ field: 'amount', code: 'invalid_number' });
    }
  });
});
