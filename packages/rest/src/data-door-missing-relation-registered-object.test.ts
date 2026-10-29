// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27702] A registered object whose table is missing is answered the same
 * classified error on its insert as on its read — never `OBJECT_NOT_FOUND`.
 *
 * ## What was measured
 *
 * The object is registered after the DDL ran, so the engine resolves it and
 * the driver addresses a table that was never created — the card's setup (a
 * code object bound to a datasource whose table was never provisioned).
 *
 * | door | producer of the answer | before |
 * |---|---|---|
 * | `GET /data/:object`, `GET /data/:object/:id` | driver-sql's declared read-exit fault (`backendStatementFault`) | `500 DATABASE_ERROR` |
 * | `POST /data/:object` | the boundary's text classification of the raw driver error (`classifyDataError`) | `404 OBJECT_NOT_FOUND` "Object '…' is not registered" |
 *
 * The write paths leave the driver as the dialect's raw error by design (the
 * boundary turns a unique violation into a 409, an unknown column into a 400),
 * so the boundary's missing-relation limb is what answered the insert. It read
 * "the relation the caller named is missing" as "the object is not
 * registered" — but no unregistered name reaches a driver: the protocol's
 * registry gate and the engine's own name resolution refuse it first, with the
 * structured `OBJECT_NOT_FOUND` that the classifier matches above every text
 * limb. A missing relation is therefore always a registered object whose
 * storage is missing, and the read's verdict for it is the classified one.
 *
 * ## What is pinned
 *
 * - each door answers the same status and code for the missing table;
 * - that answer is the read's `500 DATABASE_ERROR`;
 * - the control: an unregistered object is still `404 OBJECT_NOT_FOUND` on
 *   both doors — the gate's answer, untouched.
 *
 * The SQLite cell always runs. The live Postgres cell (`42P01 relation "…"
 * does not exist`, the card's dialect) runs when `OS_TEST_POSTGRES_URL` is
 * set and is a named skip otherwise.
 *
 * Ablation: restoring the attributed missing-relation 404 in
 * `@objectstack/types`' `classifyDataError` turns the agreement cells and the
 * insert's own cell red (the POST answers 404 again), while the control stays
 * green.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

/** Registered after the DDL, so its table never exists. */
const OBJECT = 'wh_note_27702';
/** Never registered. */
const GHOST = 'wh_ghost_27702';

const NOTE = {
  name: OBJECT,
  label: 'Warehouse note',
  sharingModel: 'public_read_write',
  fields: { title: { name: 'title', type: 'text', label: 'Title' } },
};

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
}

const CELLS: readonly Cell[] = [
  { id: 'sqlite', label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {}, setHeader: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

interface Answer {
  status: number;
  code: unknown;
}

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#27702] a registered object whose table is missing — insert and read agree — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      let call: (method: string, path: string, req: Record<string, unknown>) => Promise<Answer>;

      const dropTable = async () => {
        if (cell.id === 'sqlite') return;
        await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTable();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        await installDefaultOrganization(engine);
        // After the DDL: the registry holds the object, the database has no table for it.
        engine.registry.registerObject(NOTE as any, '@objectstack/rest');

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        call = async (method, path, req) => {
          const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
          expect(route, `${method} ${path}`).toBeDefined();
          const res = makeRes();
          await route!.handler({ method, params: {}, query: {}, body: {}, headers: {}, ...req } as any, res);
          return { status: res._status ?? 200, code: res._json?.code };
        };
      }, 60_000);

      afterAll(async () => {
        await dropTable();
        await engine?.destroy().catch(() => {});
      }, 60_000);

      const insert = (object: string) =>
        call('POST', '/api/v1/data/:object', { params: { object }, body: { title: 'first' } });
      const list = (object: string) => call('GET', '/api/v1/data/:object', { params: { object } });
      const read = (object: string) => call('GET', '/api/v1/data/:object/:id', { params: { object, id: 'rec_1' } });

      it('premise: the object is registered and its table is missing', async () => {
        expect(engine.getSchema(OBJECT)).toBeDefined();
        await expect(driver.find(OBJECT, {})).rejects.toBeTruthy();
      }, 60_000);

      it('the read answers the classified store fault: 500 DATABASE_ERROR', async () => {
        expect(await list(OBJECT)).toEqual({ status: 500, code: 'DATABASE_ERROR' });
        expect(await read(OBJECT)).toEqual({ status: 500, code: 'DATABASE_ERROR' });
      }, 60_000);

      it('the insert answers the same, never OBJECT_NOT_FOUND', async () => {
        const answer = await insert(OBJECT);
        expect(answer.code).not.toBe('OBJECT_NOT_FOUND');
        expect(answer).toEqual({ status: 500, code: 'DATABASE_ERROR' });
      }, 60_000);

      it('insert and read agree', async () => {
        expect(await insert(OBJECT)).toEqual(await list(OBJECT));
      }, 60_000);

      it('the update and delete doors answer the same', async () => {
        const update = await call('PATCH', '/api/v1/data/:object/:id', { params: { object: OBJECT, id: 'rec_1' }, body: { title: 'second' } });
        const remove = await call('DELETE', '/api/v1/data/:object/:id', { params: { object: OBJECT, id: 'rec_1' } });
        expect(update).toEqual({ status: 500, code: 'DATABASE_ERROR' });
        expect(remove).toEqual({ status: 500, code: 'DATABASE_ERROR' });
      }, 60_000);

      it('control: an unregistered object is still 404 OBJECT_NOT_FOUND on both doors', async () => {
        expect(await insert(GHOST)).toEqual({ status: 404, code: 'OBJECT_NOT_FOUND' });
        expect(await list(GHOST)).toEqual({ status: 404, code: 'OBJECT_NOT_FOUND' });
      }, 60_000);
    },
  );
}
