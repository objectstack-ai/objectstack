// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34916] A boolean field given the string `'true'` / `'false'` stores the
 * boolean, at every public write door, over SqlDriver on SQLite.
 *
 * Measured on `origin/main` @ `c81f498b5f` through these route handlers (the
 * console's inline grid saves through `POST /api/v1/batch` and sends a boolean
 * cell as its select option's string):
 *
 * | write                                 | base: stored     | base: GET | head: stored | head: GET |
 * |:--|:--|:--|:--|:--|
 * | POST /data won: true (the form)       | 1 (integer)      | true      | 1            | true      |
 * | POST /data won: 'true'                | 'true' (text)    | true      | 1            | true      |
 * | POST /batch create won: 'true'        | 'true' (text)    | true      | 1            | true      |
 * | POST /batch update won: 'true'        | 'true' (text)    | true      | 1            | true      |
 * | POST /batch update won: 'false'       | 'false' (text)   | **true**  | 0            | false     |
 * | PATCH /data/:id won: 'true'           | 'true' (text)    | true      | 1            | true      |
 *
 * On the base `where won = true` found only the form's row, `won = false` none
 * of the text rows, and `requiredWhen: record.won == true` admitted `'true'`
 * with no delivery date while refusing `true` (400 VALIDATION_FAILED). The
 * engine's write normalisation now writes the boolean its arm judged, so every
 * door stores the same value; the accepted set is unchanged (`'yes'` is still
 * refused). The unit pins are `objectql`'s
 * `validation/record-validator.boolean-reading.test.ts`; the driver read of a
 * legacy text row is `driver-sql`'s `sql-driver-34916-boolean-text-read.test.ts`,
 * and its legacy cell is repeated here at the GET door.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_boolean_reading_34916';

const DEAL_LINE = {
  name: OBJECT,
  label: 'Deal line 34916',
  fields: {
    product: { name: 'product', type: 'text' as const },
    won: { name: 'won', type: 'boolean' as const },
    delivery_date: { name: 'delivery_date', type: 'date' as const, requiredWhen: 'record.won == true' },
  },
};

const DATE = '2026-12-01';

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res, setHeader: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

describe('[#34916] a boolean field given its string reading stores the boolean, at every write door — sqlite', () => {
  let engine: ObjectQL;
  let driver: any;
  let call: (method: string, path: string, params: Record<string, string>, body: unknown) => Promise<{ status: number; body: any }>;

  const post = (data: Record<string, unknown>) => call('POST', '/api/v1/data/:object', { object: OBJECT }, data);
  const patch = (id: string, data: Record<string, unknown>) => call('PATCH', '/api/v1/data/:object/:id', { object: OBJECT, id }, data);
  const batch = (operations: unknown[]) => call('POST', '/api/v1/batch', {}, { operations });
  const get = (id: string) => call('GET', '/api/v1/data/:object/:id', { object: OBJECT, id }, undefined);
  const ids = async (where: Record<string, unknown>) => {
    const res = await call('POST', '/api/v1/data/:object/query', { object: OBJECT }, { where });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.records as Array<{ id: string }>).map((r) => r.id).sort();
  };
  /** The stored column as SQLite holds it: the value and its storage class. */
  const raw = async (id: string) => {
    const rows = await driver.knex.raw(`select won, typeof(won) as t from ${OBJECT} where id = ?`, [id]);
    return rows[0] as { won: unknown; t: string } | undefined;
  };

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(DEAL_LINE as any);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    // The transactional batch resolves its engine through this seam.
    (rest as any).objectQLProvider = async () => engine;
    rest.registerRoutes();
    call = async (method, path, params, body) => {
      const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
      expect(route, `${method} ${path}`).toBeDefined();
      const res = makeRes();
      await route!.handler({ params, body, query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };

    // Each door, once with each reading; the form's boolean writes are the control.
    const expectOk = async (label: string, p: Promise<{ status: number; body: any }>) => {
      const res = await p;
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
    };
    await expectOk('form true', post({ id: 'form_true', product: 'a', won: true, delivery_date: DATE }));
    await expectOk('form false', post({ id: 'form_false', product: 'a', won: false }));
    await expectOk("post 'true'", post({ id: 'post_true', product: 'b', won: 'true', delivery_date: DATE }));
    await expectOk("post 'false'", post({ id: 'post_false', product: 'b', won: 'false' }));
    await expectOk('patch seed', post({ id: 'patch_true', product: 'c', won: false }));
    await expectOk('patch seed', post({ id: 'patch_false', product: 'c', won: true, delivery_date: DATE }));
    await expectOk("patch 'true'", patch('patch_true', { won: 'true', delivery_date: DATE }));
    await expectOk("patch 'false'", patch('patch_false', { won: 'false' }));
    await expectOk("batch create 'true' / 'false'", batch([
      { object: OBJECT, action: 'create', data: { id: 'batch_new_true', product: 'd', won: 'true', delivery_date: DATE } },
      { object: OBJECT, action: 'create', data: { id: 'batch_new_false', product: 'd', won: 'false' } },
    ]));
    await expectOk('batch seed', post({ id: 'batch_upd_true', product: 'e', won: false }));
    await expectOk('batch seed', post({ id: 'batch_upd_false', product: 'e', won: true, delivery_date: DATE }));
    await expectOk("batch update 'true' / 'false'", batch([
      { object: OBJECT, action: 'update', id: 'batch_upd_true', data: { won: 'true', delivery_date: DATE } },
      { object: OBJECT, action: 'update', id: 'batch_upd_false', data: { won: 'false' } },
    ]));
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const TRUE_IDS = ['batch_new_true', 'batch_upd_true', 'form_true', 'patch_true', 'post_true'];
  const FALSE_IDS = ['batch_new_false', 'batch_upd_false', 'form_false', 'patch_false', 'post_false'];

  it('every door stores the integer the form stores: 1 for the true readings, 0 for the false ones', async () => {
    for (const id of TRUE_IDS) expect(await raw(id), id).toEqual({ won: 1, t: 'integer' });
    for (const id of FALSE_IDS) expect(await raw(id), id).toEqual({ won: 0, t: 'integer' });
  });

  it('GET answers the boolean each row was written with', async () => {
    for (const [list, won] of [[TRUE_IDS, true], [FALSE_IDS, false]] as const) {
      for (const id of list) {
        const res = await get(id);
        expect(res.status, id).toBe(200);
        expect(res.body.record.won, id).toBe(won);
      }
    }
  });

  it('`won = true` and `won = false` each find exactly their rows, whichever door wrote them', async () => {
    expect(await ids({ won: true })).toEqual(TRUE_IDS);
    expect(await ids({ won: false })).toEqual(FALSE_IDS);
  });

  it("requiredWhen `record.won == true` refuses 'true' with no delivery date at every door, exactly as it refuses true", async () => {
    const refusals: Array<[string, Promise<{ status: number; body: any }>, string]> = [
      ['POST true', post({ id: 'rw_post_bool', product: 'f', won: true }), 'rw_post_bool'],
      ["POST 'true'", post({ id: 'rw_post_str', product: 'f', won: 'true' }), 'rw_post_str'],
      ["batch create 'true'", batch([{ object: OBJECT, action: 'create', data: { id: 'rw_batch_str', product: 'f', won: 'true' } }]), 'rw_batch_str'],
    ];
    for (const [label, p, id] of refusals) {
      const res = await p;
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, label).toBe('VALIDATION_FAILED');
      expect((await get(id)).status, `${label}: nothing written`).toBe(404);
    }
    for (const [label, write] of [
      ["PATCH 'true'", (id: string) => patch(id, { won: 'true' })],
      ["batch update 'true'", (id: string) => batch([{ object: OBJECT, action: 'update', id, data: { won: 'true' } }])],
      ['batch update true', (id: string) => batch([{ object: OBJECT, action: 'update', id, data: { won: true } }])],
    ] as const) {
      const id = `rw_${label.replace(/\W+/g, '_')}`;
      expect((await post({ id, product: 'g', won: false })).status).toBe(201);
      const res = await write(id);
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, label).toBe('VALIDATION_FAILED');
      expect(await raw(id), `${label}: the row is unchanged`).toEqual({ won: 0, t: 'integer' });
    }
  });

  it("CONTROL — a value outside the arm's readings is still refused: 'yes' at POST and at the batch", async () => {
    const single = await post({ id: 'yes_post', product: 'h', won: 'yes' });
    expect(single.status, JSON.stringify(single.body)).toBe(400);
    expect(single.body.code).toBe('VALIDATION_FAILED');
    const viaBatch = await batch([{ object: OBJECT, action: 'create', data: { id: 'yes_batch', product: 'h', won: 'yes' } }]);
    expect(viaBatch.status, JSON.stringify(viaBatch.body)).toBe(400);
    expect(viaBatch.body.code).toBe('VALIDATION_FAILED');
    expect((await get('yes_post')).status).toBe(404);
    expect((await get('yes_batch')).status).toBe(404);
  });

  it("a legacy row stored as the text 'false' (written before this change) reads won: false at GET", async () => {
    // A copy of a row the engine wrote (its tenant and audit columns), with the column as the grid used to leave it.
    const legacy = { ...(await driver.knex(OBJECT).where({ id: 'form_false' }).first()), id: 'legacy_false', won: 'false' };
    await driver.knex(OBJECT).insert(legacy);
    expect(await raw('legacy_false')).toEqual({ won: 'false', t: 'text' });
    const res = await get('legacy_false');
    expect(res.status).toBe(200);
    expect(res.body.record.won).toBe(false);
  });
});
