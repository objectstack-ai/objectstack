// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20701] A write the driver refuses on a column: the import row answers what
 * `POST /api/v1/data/:object` answers, on the commit and on the async job's
 * rows. Read through the public doors over a REAL {@link ObjectQL} +
 * {@link ObjectStackProtocolImplementation} + SQLite `:memory:`, with the
 * platform's own `sys_import_job`. Three refusals, each classified by
 * `mapDataError`, the mapper the door uses (`toFailedResult` adopts its
 * verdict):
 *
 *  1. **Schema drift.** The object declares `late` after the DDL ran, with no
 *     re-sync. The engine's declared-field door passes `late`, since it is
 *     declared, and the driver refuses the write.
 *  2. **NOT NULL.** `must` is `storage: { notNull: true }` and not `required`,
 *     so the record validator lets a missing value through (ADR-0113) and the
 *     driver refuses it.
 *  3. **Unique conflict.** `code` is `unique: true` and the row repeats `X`.
 *
 * Measured on the bases (`67c1b11a20` for 1, `75519e1c0a` for 2 and 3):
 *
 * | door | drift (`late`) | NOT NULL (`must`) | unique (`code`) |
 * |:--|:--|:--|:--|
 * | `POST /data/:object` | `400 INVALID_FIELD`, `field: 'late'`, "The database table of object … has no column for field 'late'. …" | `400 VALIDATION_FAILED`, `fields: [{ field: 'must', code: 'required' }]`, "must is required", a `hint` | `409 UNIQUE_VIOLATION`, `field: 'code'`, "A record with this code already exists", the engine's sentence as `developerMessage` |
 * | import commit row, before | `SQLITE_ERROR`, the driver's text, no `field` | `SQLITE_CONSTRAINT_NOTNULL`, "must is required.", no `field` | `UNIQUE_VIOLATION`, `field: 'code'`, the engine's sentence |
 * | async import job row, before | the same as the commit | the same as the commit | the same as the commit |
 *
 * Each row now carries the door's `code`, `field` and sentence. For NOT NULL
 * the door's `required` finding wins over its top-level `VALIDATION_FAILED`,
 * the rule the row applies to the engine's own findings, so the row reads
 * `code: 'required'`, `field: 'must'` — the row a metadata-`required` field
 * already gets — and no driver dialect's code reaches the wire (ADR-0112). No
 * key is added: the door's `hint`, `object` and `developerMessage` stay off the
 * row, whose keys are `ImportRowResultSchema`'s.
 *
 * ⚠️ Not pinned: the dry run. `engine.validate` reads metadata, never the
 * table, and does not judge `storage.notNull` or uniqueness, so all three rows
 * preview as `ok` / `created` (measured on the bases, and unchanged here). That
 * gap between the preview and the commit is not a behaviour this file vouches
 * for; triage settled the drift case as the migration door's.
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

/** The row's whole key set: the door's extra keys (`hint`, `object`, `developerMessage`) are not on it. */
const ROW_KEYS = ['action', 'code', 'error', 'field', 'ok', 'row'];

/** Dialect codes for a NOT NULL or unique refusal (SQLite, Postgres SQLSTATE, MySQL): none reaches a row. */
const DIALECT_CODE = /^(SQLITE_|ER_)|^\d{5}$/;

function expectRowIsDoor(row: any, door: { code: unknown; field: unknown; error: unknown }, rowNo: number) {
  expect(row, JSON.stringify(row)).toMatchObject({ row: rowNo, ok: false, action: 'failed', ...door });
  expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
  expect(String(row.code)).not.toMatch(DIALECT_CODE);
}

describe('[#20701] a NOT NULL refusal fails the row with the create door\'s `required` finding', () => {
  let b: Boot;
  beforeEach(async () => { b = await boot(); });

  /** What the door answers for a record missing `must`, read as the row renders a finding. */
  const notNullDoor = async () => {
    const door = await b.call('POST', '/api/v1/data/:object', { title: 't' });
    expect(door.status, JSON.stringify(door.body)).toBe(400);
    expect(door.body).toMatchObject({ code: 'VALIDATION_FAILED', fields: [{ field: 'must', code: 'required' }] });
    return { code: door.body.fields[0].code, field: door.body.fields[0].field, error: door.body.error };
  };

  it('insert: the bulk create path', async () => {
    const door = await notNullDoor();
    const r = await b.importRows([{ title: 't' }, { id: 'w1', title: 'control', must: 'm' }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expectRowIsDoor(r.body.results[0], door, 1);
    expect(r.body.results[0]).toMatchObject({ code: 'required', field: 'must' });
    expect(r.body.results[1]).toMatchObject({ row: 2, ok: true, action: 'created', id: 'w1' });
    expect(r.body).toMatchObject({ ok: 1, errors: 1, created: 1 });
  });

  it('upsert with no match: the create half of an upsert', async () => {
    const door = await notNullDoor();
    const r = await b.importRows([{ id: 'n1', title: 't' }], { writeMode: 'upsert' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expectRowIsDoor(r.body.results[0], door, 1);
    expect(await b.engine.findOne(OBJECT, { where: { id: 'n1' } })).toBeNull();
  });
});

describe('[#20701] a unique conflict fails the row with the create door\'s sentence', () => {
  let b: Boot;
  beforeEach(async () => { b = await boot(); });

  it('insert: UNIQUE_VIOLATION naming the column, in the words of `POST /data/:object`', async () => {
    const door = await b.call('POST', '/api/v1/data/:object', { title: 't', must: 'm', code: 'X' });
    expect(door.status, JSON.stringify(door.body)).toBe(409);
    expect(door.body).toMatchObject({ code: 'UNIQUE_VIOLATION', field: 'code' });
    const r = await b.importRows([{ title: 't', must: 'm', code: 'X' }, { id: 'w1', title: 'control', must: 'm', code: 'Z' }]);
    expectRowIsDoor(r.body.results[0], { code: door.body.code, field: door.body.field, error: door.body.error }, 1);
    // The engine's sentence is the door's `developerMessage`, and it is no longer the row's.
    expect(r.body.results[0].error).not.toBe(door.body.developerMessage);
    expect(r.body.results[1]).toMatchObject({ row: 2, ok: true, action: 'created', id: 'w1' });
  });

  it('upsert onto an existing row: the update path, in the words of `PATCH /data/:object/:id`', async () => {
    await b.engine.insert(OBJECT, { id: 'e2', title: 'other', code: 'Y', must: 'm' } as any);
    const door = await b.call('PATCH', '/api/v1/data/:object/:id', { code: 'X' }, { object: OBJECT, id: 'e2' });
    expect(door.status, JSON.stringify(door.body)).toBe(409);
    const r = await b.importRows([{ id: 'e2', code: 'X' }], { writeMode: 'upsert' });
    expectRowIsDoor(r.body.results[0], { code: door.body.code, field: door.body.field, error: door.body.error }, 1);
    expect(await b.engine.findOne(OBJECT, { where: { id: 'e2' } })).toMatchObject({ code: 'Y' });
  });
});

describe('[#20701] the async import job\'s rows carry the door\'s NOT NULL and unique answers', () => {
  it('the results route reports both, and the writable row is created', async () => {
    const b = await boot();
    const notNull = await b.call('POST', '/api/v1/data/:object', { title: 't' });
    const unique = await b.call('POST', '/api/v1/data/:object', { title: 't', must: 'm', code: 'X' });
    const created = await b.call('POST', '/api/v1/data/:object/import/jobs', {
      format: 'json', dryRun: false,
      rows: [{ title: 't' }, { title: 't', must: 'm', code: 'X' }, { id: 'w3', title: 'control', must: 'm' }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const jobId = String(created.body.jobId);
    let progress: { status: number; body: any } | undefined;
    for (let i = 0; i < 200; i++) {
      progress = await b.call('GET', '/api/v1/data/import/jobs/:jobId', undefined, { jobId });
      if (['succeeded', 'failed', 'cancelled'].includes(progress.body?.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(progress?.body).toMatchObject({ status: 'succeeded', created: 1, errors: 2 });
    const rows: any[] = (await b.call('GET', '/api/v1/data/import/jobs/:jobId/results', undefined, { jobId })).body.results;
    expectRowIsDoor(rows.find((r) => r.row === 1), {
      code: notNull.body.fields[0].code, field: notNull.body.fields[0].field, error: notNull.body.error,
    }, 1);
    expectRowIsDoor(rows.find((r) => r.row === 2), { code: unique.body.code, field: unique.body.field, error: unique.body.error }, 2);
    expect(rows.find((r) => r.row === 3)).toMatchObject({ row: 3, ok: true, action: 'created', id: 'w3' });
  });
});
