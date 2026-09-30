// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20701] A declared field whose column is missing (schema drift): the import
 * row answers what `POST /api/v1/data/:object` answers, on the commit and on
 * the async job's rows. Read through the public doors over a REAL
 * {@link ObjectQL} + {@link ObjectStackProtocolImplementation} + SQLite
 * `:memory:`, with the platform's own `sys_import_job`.
 *
 * Drift is made the way it happens: the object declares `late` after the DDL
 * ran, with no re-sync. The engine's declared-field door passes `late`, since it
 * is declared, and the driver refuses the write.
 *
 * Measured on the base (`67c1b11a20`):
 *
 * | door | answer for `late` |
 * |:--|:--|
 * | `POST /data/:object` | `400 INVALID_FIELD`, `field: 'late'`, "The database table of object … has no column for field 'late'. …" |
 * | import commit, insert | failed, `code: 'SQLITE_ERROR'`, `table proj_… has no column named late`, no `field` |
 * | import commit, upsert onto an existing row | failed, `code: 'SQLITE_ERROR'`, `no such column: late`, no `field` |
 * | async import job, results route | failed, `code: 'SQLITE_ERROR'`, the driver's text, no `field` |
 *
 * The row now takes the door's verdict when the door's verdict is
 * `INVALID_FIELD` (`toFailedResult` asks `mapDataError`, the mapper the door
 * uses). The unique-conflict and NOT NULL rows are controls: the door answers
 * them in other words (see `toFailedResult`'s docblock), and this change leaves
 * both rows as they were. Their pins say "unchanged by this card", not "right".
 * A card that converges them updates these pins on purpose.
 *
 * ⚠️ Not pinned: the dry run. `engine.validate` reads metadata, never the
 * table, so a drifted column previews as `ok` / `created` (measured on the
 * base, and unchanged here). That is the gap between the preview and the
 * commit that the fix report names, not a behaviour this file vouches for.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysImportJob } from '@objectstack/platform-objects/audit';
import { RestServer } from './rest-server';

const OBJECT = 'proj_drift_20701';

const PROJ = {
  name: OBJECT, label: 'Proj drift 20701', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    code: { name: 'code', type: 'text' as const, unique: true },
    // Physically NOT NULL, not `required`: the record validator lets a missing
    // value through, and the driver refuses it (ADR-0113).
    must: { name: 'must', type: 'text' as const, storage: { notNull: true } },
  },
};

/** The same object, now also declaring `late`, which has no column. */
const PROJ_DRIFTED = { ...PROJ, fields: { ...PROJ.fields, late: { name: 'late', type: 'text' as const } } };

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
  engine.registry.registerObject(PROJ as any);
  engine.registry.registerObject(SysImportJob as any);
  await engine.syncSchemas();
  await engine.insert(OBJECT, { id: 'e1', title: 'existing', code: 'X', must: 'm' } as any);
  // The drift: `late` is declared after the DDL ran.
  engine.registry.registerObject(PROJ_DRIFTED as any);

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
  const importRows = (rows: Array<Record<string, unknown>>, opts: { writeMode?: 'insert' | 'upsert' } = {}) =>
    call('POST', '/api/v1/data/:object/import', {
      format: 'json', rows, dryRun: false,
      ...(opts.writeMode === 'upsert' ? { writeMode: 'upsert', matchFields: ['id'] } : {}),
    });
  /** What the create door answers for `late`: the answer every drift row must carry. */
  const doorAnswer = async () => {
    const door = await call('POST', '/api/v1/data/:object', { title: 't', must: 'm', late: 'x' });
    expect(door.status, JSON.stringify(door.body)).toBe(400);
    expect(door.body).toMatchObject({ code: 'INVALID_FIELD', field: 'late', object: OBJECT });
    return { code: door.body.code, field: door.body.field, error: door.body.error };
  };
  return { engine, call, importRows, doorAnswer };
}

type Boot = Awaited<ReturnType<typeof boot>>;

/** The driver's own words for a missing column, on the insert and on the update. */
const DRIVER_TEXT = /has no column named|no such column|SQLITE_/i;

function expectDoorAnswer(row: any, door: { code: unknown; field: unknown; error: unknown }, rowNo: number) {
  expect(row, JSON.stringify(row)).toMatchObject({ row: rowNo, ok: false, action: 'failed', ...door });
  expect(String(row.error)).not.toMatch(DRIVER_TEXT);
}

describe('[#20701] a drifted column fails the commit row with the create door\'s answer', () => {
  let b: Boot;
  beforeEach(async () => { b = await boot(); });

  it('insert: the bulk create path', async () => {
    const door = await b.doorAnswer();
    const r = await b.importRows([{ title: 't', must: 'm', late: 'x' }, { id: 'w1', title: 'control', must: 'm' }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expectDoorAnswer(r.body.results[0], door, 1);
    // A writable row in the same file imports: the refusal is the row's, not the file's.
    expect(r.body.results[1]).toMatchObject({ row: 2, ok: true, action: 'created', id: 'w1' });
    expect(r.body).toMatchObject({ ok: 1, errors: 1, created: 1 });
    expect(await b.engine.findOne(OBJECT, { where: { id: 'w1' } })).toMatchObject({ title: 'control' });
  });

  it('upsert onto an existing row: the update path', async () => {
    const door = await b.doorAnswer();
    const r = await b.importRows([{ id: 'e1', title: 't', late: 'x' }], { writeMode: 'upsert' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expectDoorAnswer(r.body.results[0], door, 1);
    expect(await b.engine.findOne(OBJECT, { where: { id: 'e1' } })).toMatchObject({ title: 'existing' });
  });
});

describe('[#20701] the async import job\'s rows carry the same answer', () => {
  it('the results route reports the door\'s answer for the drifted row, and the writable row is created', async () => {
    const b = await boot();
    const door = await b.doorAnswer();
    const created = await b.call('POST', '/api/v1/data/:object/import/jobs', {
      format: 'json', dryRun: false,
      rows: [{ title: 't', must: 'm', late: 'x' }, { id: 'w2', title: 'control', must: 'm' }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const jobId = String(created.body.jobId);
    let progress: { status: number; body: any } | undefined;
    for (let i = 0; i < 200; i++) {
      progress = await b.call('GET', '/api/v1/data/import/jobs/:jobId', undefined, { jobId });
      if (['succeeded', 'failed', 'cancelled'].includes(progress.body?.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(progress?.body).toMatchObject({ status: 'succeeded', created: 1, errors: 1 });
    const results = await b.call('GET', '/api/v1/data/import/jobs/:jobId/results', undefined, { jobId });
    const rows: any[] = results.body.results;
    expectDoorAnswer(rows.find((r) => r.row === 1), door, 1);
    expect(rows.find((r) => r.row === 2)).toMatchObject({ row: 2, ok: true, action: 'created', id: 'w2' });
  });
});

describe('[#20701] controls: a unique conflict and a NOT NULL row keep the answers they had', () => {
  let b: Boot;
  beforeEach(async () => { b = await boot(); });

  it('unique conflict: UNIQUE_VIOLATION naming the column, with the engine\'s sentence', async () => {
    const door = await b.call('POST', '/api/v1/data/:object', { title: 't', must: 'm', code: 'X' });
    expect(door.status).toBe(409);
    const r = await b.importRows([{ title: 't', must: 'm', code: 'X' }]);
    expect(r.body.results[0]).toMatchObject({
      row: 1, ok: false, action: 'failed', code: 'UNIQUE_VIOLATION', field: 'code',
      // The row's sentence is the engine's, which the door ships as `developerMessage`.
      error: door.body.developerMessage,
    });
  });

  it('NOT NULL: the driver\'s code, with no field (the door says VALIDATION_FAILED with a `required` finding)', async () => {
    const door = await b.call('POST', '/api/v1/data/:object', { title: 't' });
    expect(door.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const r = await b.importRows([{ title: 't' }]);
    expect(r.body.results[0]).toMatchObject({ row: 1, ok: false, action: 'failed', code: 'SQLITE_CONSTRAINT_NOTNULL' });
    expect(r.body.results[0]).not.toHaveProperty('field');
  });
});
