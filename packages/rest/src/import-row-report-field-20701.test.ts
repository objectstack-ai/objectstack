// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20701] What the import row report and the driver-string branch say about
 * a column, read through the public doors — `POST /api/v1/data/:object/import`
 * (dry run and commit) and `POST /api/v1/data/:object` — over a REAL
 * {@link ObjectQL} + {@link ObjectStackProtocolImplementation} + SQLite
 * `:memory:`.
 *
 * Measured on the base (`ca5408c629`), with the engine half (#20805) already
 * landed:
 *
 * | column | dry run | commit | `POST /data/:object` |
 * |:--|:--|:--|:--|
 * | undeclared `nope` | failed `INVALID_FIELD`, **no `field`** | failed `INVALID_FIELD`, **no `field`** | `400 INVALID_FIELD`, `field: 'nope'` |
 * | declared `late`, no column (drift) | — | — | `400 INVALID_FIELD` "Unknown field 'late'" |
 * | formula `doubled` / readonly `ro` | ok, created | ok, created | `201` + `droppedFields` |
 * | writable `title` | ok, created | ok, created | `201` |
 * | a `unique` value already held | — | failed `UNIQUE_VIOLATION`, **no `field`** | `409 UNIQUE_VIOLATION`, `field` |
 *
 * The first and last rows are `toFailedResult` reading `field` only off a
 * `ValidationError` finding, while the engine's declared-field door and its
 * `DuplicateRecordError` carry it on the envelope (`field`; the declared-field
 * door puts the bare names in `fields`). The second is `mapDataError`'s
 * driver-string branch calling a DECLARED field unknown.
 *
 * The formula / readonly rows also carry the drop signal now: the engine
 * reports its strips per row (`validateData` on the dry run, `insertManyData`
 * on the commit) and the import runner copies the report onto the row. The
 * cells below pin both halves succeeding AND reporting the strip with its
 * reason; `import-row-dropped-fields-20701.test.ts` pins the rest of that
 * family (the create door's equality, upsert updates, the async job).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'proj_20701';

const PROJ = {
  name: OBJECT, label: 'Proj 20701', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    n: { name: 'n', type: 'number' as const },
    doubled: { name: 'doubled', type: 'formula' as const, expression: 'record.n * 2' },
    ro: { name: 'ro', type: 'text' as const, readonly: true },
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
  engine.registry.registerObject(PROJ as any);
  await engine.syncSchemas();
  await engine.insert(OBJECT, { id: 'e1', title: 'existing', n: 1 } as any);

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const call = async (method: string, path: string, body: unknown, object: string = OBJECT): Promise<{ status: number; body: any }> => {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(route, `${method} ${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ params: { object }, body, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const importRows = (rows: Array<Record<string, unknown>>, opts: { dryRun: boolean; writeMode?: 'insert' | 'upsert' }) =>
    call('POST', '/api/v1/data/:object/import', {
      format: 'json', rows, dryRun: opts.dryRun,
      ...(opts.writeMode === 'upsert' ? { writeMode: 'upsert', matchFields: ['id'] } : {}),
    });
  return { engine, call, importRows };
}

type Boot = Awaited<ReturnType<typeof boot>>;

describe('[#20701] an unknown column fails the row on the dry run and on the commit alike, and both rows name it', () => {
  let b: Boot;
  beforeEach(async () => { b = await boot(); });

  it.each([
    ['insert', [{ title: 't', n: 2, nope: 5 }, { title: 'control', n: 3 }]],
    ['upsert', [{ id: 'e1', title: 't', nope: 5 }, { id: 'n1', title: 'control', n: 3 }]],
  ] as const)('writeMode %s', async (writeMode, rows) => {
    for (const dryRun of [true, false]) {
      const r = await b.importRows(rows as any, { dryRun, writeMode });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.results[0], `dryRun=${dryRun}`).toMatchObject({
        row: 1, ok: false, action: 'failed', code: 'INVALID_FIELD', field: 'nope',
      });
      // The second row is the control: the refusal is the row's, not the file's.
      expect(r.body.results[1], `dryRun=${dryRun}`).toMatchObject({ row: 2, ok: true });
      expect(r.body.errors, `dryRun=${dryRun}`).toBe(1);
    }
  });

  it('the row names the same field the create door names for the same key', async () => {
    const door = await b.call('POST', '/api/v1/data/:object', { title: 't', nope: 5 });
    expect(door.status).toBe(400);
    expect(door.body).toMatchObject({ code: 'INVALID_FIELD', field: 'nope' });
    const commit = await b.importRows([{ title: 't', nope: 5 }], { dryRun: false });
    expect(commit.body.results[0]).toMatchObject({ code: door.body.code, field: door.body.field });
  });
});

describe('[#20701] a unique conflict row names the column the 409 names — the same envelope member', () => {
  it('the engine\'s DuplicateRecordError carries `field`; the commit row reads it', async () => {
    const b = await boot();
    const UQ = 'uq_20701';
    b.engine.registry.registerObject({
      name: UQ, systemFields: false,
      fields: { id: { name: 'id', type: 'text', primaryKey: true }, code: { name: 'code', type: 'text', unique: true } },
    } as any);
    await b.engine.syncSchemas();
    await b.engine.insert(UQ, { id: 'a', code: 'X' } as any);
    const door = await b.call('POST', '/api/v1/data/:object', { code: 'X' }, UQ);
    expect(door.status).toBe(409);
    expect(door.body).toMatchObject({ code: 'UNIQUE_VIOLATION', field: 'code' });
    const commit = await b.call('POST', '/api/v1/data/:object/import', { format: 'json', rows: [{ code: 'X' }, { code: 'Y' }], dryRun: false }, UQ);
    expect(commit.body.results[0]).toMatchObject({ row: 1, ok: false, action: 'failed', code: door.body.code, field: door.body.field });
    expect(commit.body.results[1]).toMatchObject({ row: 2, ok: true, action: 'created' });
  });
});

describe('[#20701] a writable column imports — the control', () => {
  it('dry run and commit both create the row, and the commit stores it', async () => {
    const b = await boot();
    const preview = await b.importRows([{ id: 'w1', title: 'written', n: 4 }], { dryRun: true });
    expect(preview.body).toMatchObject({ ok: 1, errors: 0, created: 1 });
    expect(preview.body.results[0]).toMatchObject({ row: 1, ok: true, action: 'created' });
    const commit = await b.importRows([{ id: 'w1', title: 'written', n: 4 }], { dryRun: false });
    expect(commit.body).toMatchObject({ ok: 1, errors: 0, created: 1 });
    expect(commit.body.results[0]).toMatchObject({ row: 1, ok: true, action: 'created', id: 'w1' });
    const stored = await b.engine.findOne(OBJECT, { where: { id: 'w1' } });
    expect(stored).toMatchObject({ title: 'written', n: 4, doubled: 8 });
  });
});

describe('[#20701] a formula or readonly column: the dry run and the commit both succeed and both report the strip', () => {
  it.each([
    ['formula', { id: 'f1', title: 't', n: 2, doubled: 5 }, { object: OBJECT, fields: ['doubled'], reason: 'computed' }],
    ['readonly', { id: 'f1', title: 't', n: 2, ro: 'forged' }, { object: OBJECT, fields: ['ro'], reason: 'readonly' }],
  ] as const)('%s column', async (_label, row, dropped) => {
    const b = await boot();
    for (const dryRun of [true, false]) {
      const r = await b.importRows([row], { dryRun });
      expect(r.body, `dryRun=${dryRun}`).toMatchObject({ ok: 1, errors: 0, created: 1 });
      expect(r.body.results[0], `dryRun=${dryRun}`).toMatchObject({ row: 1, ok: true, action: 'created' });
      expect(r.body.results[0].droppedFields, `dryRun=${dryRun}`).toEqual([dropped]);
    }
    // The supplied value was not stored: the formula answers from `n`, and the readonly column stays empty.
    const stored = await b.engine.findOne(OBJECT, { where: { id: 'f1' } });
    expect(stored).toMatchObject({ n: 2, doubled: 4 });
    expect(stored?.ro ?? null).toBeNull();
  });
});

describe('[#20701] the driver-string branch does not call a declared field unknown', () => {
  it('a declared field whose column is missing: 400 INVALID_FIELD naming it, and the sentence is the database\'s', async () => {
    const b = await boot();
    // The object declares `late` after the DDL ran, with no re-sync — metadata and the table have drifted.
    b.engine.registry.registerObject({ ...PROJ, fields: { ...PROJ.fields, late: { name: 'late', type: 'text' as const } } } as any);
    const r = await b.call('POST', '/api/v1/data/:object', { title: 't', late: 'x' });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body).toMatchObject({ code: 'INVALID_FIELD', field: 'late', object: OBJECT });
    // The wording IS the fix here, so its first sentence is pinned.
    expect(String(r.body.error).split('. ')[0]).toBe(`The database table of object '${OBJECT}' has no column for field 'late'`);
    expect(String(r.body.error)).not.toMatch(/unknown field/i);
  });

  it('an undeclared key is still refused by the engine\'s own door, in its own words — the control', async () => {
    const b = await boot();
    const r = await b.call('POST', '/api/v1/data/:object', { title: 't', nope: 'x' });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'INVALID_FIELD', field: 'nope', object: OBJECT });
    expect(String(r.body.error)).toContain("Unknown field 'nope'");
  });
});
