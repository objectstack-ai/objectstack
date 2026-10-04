// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21571] A read with no projection serves the object's DECLARED fields plus
 * the platform's own system columns — never a column no metadata declares.
 *
 * The door the card measured, reproduced on the composed REST harness this
 * package already uses (`RestServer` → `ObjectStackProtocolImplementation` →
 * `ObjectQL` → a real `SqlDriver` on better-sqlite3):
 *
 *  1. Boot ONE declares `rq_contact` with two mailing fields, syncs, and writes
 *     rows carrying values in them.
 *  2. Boot TWO declares the same object with those two fields retired — the
 *     upgrade the card describes. Schema sync is additive, so the two columns
 *     and their values stay in the table, with no field behind them.
 *  3. `POST /api/v1/data/rq_contact/query` with no `fields`.
 *
 * Before the engine owned the default projection, step 3 answered every row
 * WITH the two retired columns and their values, while naming one of them in
 * `fields` answered `400 INVALID_FIELD`: the platform knew they were not fields
 * and served them anyway. The default projection is now decided once, in the
 * engine, from the registry's field map plus the platform-provisioned columns —
 * the same set an explicit projection is judged against.
 *
 * The last case is the driver-sql recovery ladder: an EXPLICIT projection that
 * names a declared field whose column does not exist yet makes the statement
 * fail, and the ladder answers it with `select('*')`. That rung served the
 * retired columns too, and no driver edit is involved in closing it: the
 * engine shapes the rows the driver hands back, whichever rung answered.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rq_contact';
const LADDER = 'rq_ladder';
const RETIRED = ['mailing_street', 'mailing_city'] as const;

const CONTACT_V1 = {
  name: OBJECT,
  label: 'Contact',
  fields: {
    name: { name: 'name', type: 'text' as const },
    email: { name: 'email', type: 'text' as const },
    mailing_street: { name: 'mailing_street', type: 'text' as const },
    mailing_city: { name: 'mailing_city', type: 'text' as const },
  },
};

/** The upgrade: the two mailing fields are retired from the declaration. */
const CONTACT_V2 = {
  name: OBJECT,
  label: 'Contact',
  fields: {
    name: { name: 'name', type: 'text' as const },
    email: { name: 'email', type: 'text' as const },
  },
};

const LADDER_V1 = {
  name: LADDER,
  label: 'Ladder',
  fields: {
    name: { name: 'name', type: 'text' as const },
    legacy_note: { name: 'legacy_note', type: 'text' as const },
  },
};

/**
 * Boot two retires `legacy_note` and declares `pending_note`, registered AFTER
 * the schema sync so its column is never created: a declared field with no
 * column, the state that sends an explicit projection down the ladder.
 */
const LADDER_V2 = {
  name: LADDER,
  label: 'Ladder',
  fields: {
    name: { name: 'name', type: 'text' as const },
    pending_note: { name: 'pending_note', type: 'text' as const },
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

const dir = mkdtempSync(join(tmpdir(), 'os-21571-'));
const filename = join(dir, 'retired-columns.sqlite');
const engines: ObjectQL[] = [];
afterAll(async () => {
  for (const e of engines) {
    try { await e.destroy(); } catch { /* noop */ }
  }
  rmSync(dir, { recursive: true, force: true });
});

const sqlDriver = () =>
  new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true }) as any;

/** Boot one: the old declaration creates the tables and writes the values. */
async function bootOne(): Promise<void> {
  const engine = new ObjectQL();
  engine.registerDriver(sqlDriver(), true);
  await engine.init();
  engine.registry.registerObject(CONTACT_V1 as any);
  engine.registry.registerObject(LADDER_V1 as any);
  await engine.syncSchemas();
  await engine.insert(OBJECT, [
    { id: 'c1', name: 'Ada', email: 'ada@example.com', mailing_street: '1 Retired Way', mailing_city: 'Oldtown' },
    { id: 'c2', name: 'Bo', email: 'bo@example.com', mailing_street: '2 Retired Way', mailing_city: 'Oldtown' },
  ] as any);
  await engine.insert(LADDER, [{ id: 'l1', name: 'one', legacy_note: 'retired value' }] as any);
  await engine.destroy();
}

/** Boot two: the new declaration on the database boot one left behind. */
async function bootTwo() {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(sqlDriver(), true);
  await engine.init();
  engine.registry.registerObject(CONTACT_V2 as any);
  await engine.syncSchemas();
  engine.registry.registerObject(LADDER_V2 as any);

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const queryRoute = routes.find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
  const getRoute = routes.find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/:id');
  expect(queryRoute).toBeDefined();
  expect(getRoute).toBeDefined();
  const query = async (object: string, body: Record<string, unknown>) => {
    const res = makeRes();
    await queryRoute!.handler({ params: { object }, body } as any, res);
    return res;
  };
  const getById = async (object: string, id: string) => {
    const res = makeRes();
    await getRoute!.handler({ params: { object, id }, query: {} } as any, res);
    return res;
  };
  return { engine, query, getById };
}

const rowsOf = (res: any): Array<Record<string, unknown>> => res._json?.records ?? res._json?.data ?? res._json;

describe('[#21571] an unprojected read serves the declared fields, never a retired column', () => {
  let engine: ObjectQL;
  let query: Awaited<ReturnType<typeof bootTwo>>['query'];
  let getById: Awaited<ReturnType<typeof bootTwo>>['getById'];
  beforeAll(async () => {
    await bootOne();
    ({ engine, query, getById } = await bootTwo());
  });

  it('POST /data/:object/query with no `fields` omits the retired columns from every row', async () => {
    const res = await query(OBJECT, {});
    expect(res._status ?? 200).toBe(200);
    const rows = rowsOf(res);
    expect(rows.map((r) => r.id).sort()).toEqual(['c1', 'c2']);
    for (const row of rows) {
      for (const retired of RETIRED) expect(row).not.toHaveProperty(retired);
    }
  });

  it('GET /data/:object/:id omits them too (the findOne door)', async () => {
    const res = await getById(OBJECT, 'c1');
    expect(res._status ?? 200).toBe(200);
    const record = res._json?.record ?? res._json;
    expect(record.id).toBe('c1');
    for (const retired of RETIRED) expect(record).not.toHaveProperty(retired);
  });

  it('declared fields and the system columns are served as before', async () => {
    const [row] = rowsOf(await query(OBJECT, { where: { id: 'c1' } }));
    expect(row).toMatchObject({ id: 'c1', name: 'Ada', email: 'ada@example.com' });
    // The registry-injected system columns, named one by one so a change that
    // dropped any of them fails here, and the platform-provisioned three.
    for (const system of [
      'id', 'created_at', 'updated_at', 'created_by', 'updated_by',
      'organization_id', 'owner_id', 'owning_business_unit_id',
    ]) {
      expect(row).toHaveProperty(system);
    }
    expect(row.created_at).toEqual(expect.any(String));
  });

  it('every key a row carries is a declared field or a platform-provisioned column', async () => {
    const declared = new Set([
      ...Object.keys(engine.registry.getObject(OBJECT)!.fields as object),
      'id', 'created_at', 'updated_at',
    ]);
    for (const row of rowsOf(await query(OBJECT, {}))) {
      expect(Object.keys(row).filter((key) => !declared.has(key))).toEqual([]);
    }
  });

  it('naming a retired column in `fields` still answers INVALID_FIELD / 400', async () => {
    const res = await query(OBJECT, { fields: ['name', 'mailing_street'] });
    expect(res._status).toBe(400);
    expect(res._json?.error?.code ?? res._json?.code).toBe('INVALID_FIELD');
  });

  it('the recovery ladder\'s select(*) rung serves no retired column either', async () => {
    // `pending_note` is declared but has no column: the projected statement
    // fails and driver-sql retries `select('*')`.
    const res = await query(LADDER, { fields: ['name', 'pending_note'] });
    expect(res._status ?? 200).toBe(200);
    const rows = rowsOf(res);
    expect(rows.map((r) => r.id)).toEqual(['l1']);
    expect(rows[0]).toMatchObject({ id: 'l1', name: 'one' });
    expect(rows[0]).not.toHaveProperty('legacy_note');
  });
});
