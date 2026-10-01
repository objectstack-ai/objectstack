// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20701] A column the engine legally strips: the import row reports the
 * strip, on the dry run and on the commit, in the words the create door uses.
 * Read through the public doors — `POST /api/v1/data/:object/import` (dry run
 * and commit), the async job's results route, `POST /api/v1/data/:object` and
 * `PATCH /api/v1/data/:object/:id` — over a REAL {@link ObjectQL} +
 * {@link ObjectStackProtocolImplementation} + SQLite `:memory:`, with the
 * platform's own `sys_import_job`.
 *
 * Measured on the base (`f3b16fc2f`), after the engine strips a formula value
 * and reports it per row (#20805, #20922):
 *
 * | column | create door | import dry run | import commit |
 * |:--|:--|:--|:--|
 * | formula `doubled` (the card's case) | `201` + `droppedFields` `computed` | ok, created, **no drop signal** | ok, created, **no drop signal** |
 * | readonly `ro` | `201` + `droppedFields` `readonly` | the same | the same |
 * | only a formula key | `201`, an empty record + `computed` | ok, created | ok, created (an empty record) |
 * | writable `title` | `201` | ok, created | ok, created |
 *
 * The commit no longer fails the formula row (the engine strips the value
 * before the driver sees it), so the remaining gap was the report: the door
 * said what it dropped and the import row said nothing. Each `ok` row now
 * carries the engine's own per-row `droppedFields`, equal to the door's, and
 * the dry run's equals the commit's. A row whose only key is dropped is a row
 * both halves create, as the door does: the preview promises it and the
 * commit writes it.
 *
 * ⚠️ The one cell where the halves still differ is pinned as the named limit,
 * not as a goal: an upsert row matched to a record whose `readonlyWhen` is
 * true. The preview asks `validateData` in `update` mode, which runs no
 * `readonlyWhen` strip (it has no prior record), so the dry run names nothing
 * while the commit reports `readonly_when`, as `PATCH` does. The spec states
 * the limit on `ValidateDataResponseSchema` and on the row's `droppedFields`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysImportJob } from '@objectstack/platform-objects/audit';
import { RestServer } from './rest-server';

const OBJECT = 'proj_drops_20701';

const PROJ = {
  name: OBJECT, label: 'Proj drops 20701', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    status: { name: 'status', type: 'text' as const },
    n: { name: 'n', type: 'number' as const },
    doubled: { name: 'doubled', type: 'formula' as const, expression: 'record.n * 2' },
    ro: { name: 'ro', type: 'text' as const, readonly: true },
    locked: { name: 'locked', type: 'text' as const, readonlyWhen: "record.status == 'closed'" },
  },
};

const COMPUTED = { object: OBJECT, fields: ['doubled'], reason: 'computed' };
const READONLY = { object: OBJECT, fields: ['ro'], reason: 'readonly' };
const READONLY_WHEN = { object: OBJECT, fields: ['locked'], reason: 'readonly_when' };

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
  await engine.insert(OBJECT, { id: 'e1', title: 'open one', n: 1, status: 'open' } as any);
  // A record whose `readonlyWhen` is already true; seeded under `isSystem`.
  await engine.insert(OBJECT, { id: 'e2', title: 'closed one', n: 1, status: 'closed', locked: 'L' } as any, { context: { isSystem: true } } as any);

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
  const importRows = (rows: Array<Record<string, unknown>>, opts: { dryRun: boolean; upsert?: boolean }) =>
    call('POST', '/api/v1/data/:object/import', {
      format: 'json', rows, dryRun: opts.dryRun,
      ...(opts.upsert ? { writeMode: 'upsert', matchFields: ['id'] } : {}),
    });
  const runJob = async (rows: Array<Record<string, unknown>>, dryRun: boolean): Promise<any[]> => {
    const created = await call('POST', '/api/v1/data/:object/import/jobs', { format: 'json', dryRun, rows });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const jobId = String(created.body.jobId);
    let progress: { status: number; body: any } | undefined;
    for (let i = 0; i < 200; i++) {
      progress = await call('GET', '/api/v1/data/import/jobs/:jobId', undefined, { jobId });
      if (['succeeded', 'failed', 'cancelled'].includes(progress.body?.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(progress?.body?.status).toBe('succeeded');
    const results = await call('GET', '/api/v1/data/import/jobs/:jobId/results', undefined, { jobId });
    return results.body.results;
  };
  return { engine, call, importRows, runJob };
}

/** What `POST /data/:object` reports dropping for this payload: the answer each import row must carry. */
async function createDoorDrops(b: Awaited<ReturnType<typeof boot>>, row: Record<string, unknown>) {
  const door = await b.call('POST', '/api/v1/data/:object', row);
  expect(door.status, JSON.stringify(door.body)).toBe(201);
  return door.body.droppedFields;
}

describe('[#20701] a stripped column: the import row reports what the create door reports, on both halves', () => {
  it.each([
    ['formula (the card\'s case)', { title: 't', n: 2, doubled: 5 }, [COMPUTED]],
    ['readonly', { title: 't', n: 2, ro: 'forged' }, [READONLY]],
    ['formula and readonly in one row', { title: 't', n: 2, doubled: 5, ro: 'forged' }, [COMPUTED, READONLY]],
  ] as const)('%s', async (_label, row, expected) => {
    const b = await boot();
    const door = await createDoorDrops(b, row);
    expect(door).toEqual(expected);

    const dry = await b.importRows([{ id: 'p1', ...row }], { dryRun: true });
    expect(dry.body).toMatchObject({ ok: 1, errors: 0, created: 1 });
    expect(dry.body.results[0]).toEqual({ row: 1, ok: true, action: 'created', droppedFields: door });

    const commit = await b.importRows([{ id: 'p1', ...row }], { dryRun: false });
    expect(commit.body).toMatchObject({ ok: 1, errors: 0, created: 1 });
    expect(commit.body.results[0]).toEqual({ row: 1, ok: true, action: 'created', id: 'p1', droppedFields: door });

    // The supplied values were not stored: the formula answers from `n`, the readonly column stays empty.
    const stored = await b.engine.findOne(OBJECT, { where: { id: 'p1' } });
    expect(stored).toMatchObject({ n: 2, doubled: 4 });
    expect(stored?.ro ?? null).toBeNull();
  });

  it('a writable column carries no key on either half, as the door carries none (the control)', async () => {
    const b = await boot();
    expect(await createDoorDrops(b, { title: 'w', n: 4 })).toBeUndefined();
    for (const dryRun of [true, false]) {
      const r = await b.importRows([{ id: 'w1', title: 'w', n: 4 }], { dryRun });
      expect(r.body.results[0], `dryRun=${dryRun}`).toMatchObject({ row: 1, ok: true, action: 'created' });
      expect(r.body.results[0], `dryRun=${dryRun}`).not.toHaveProperty('droppedFields');
    }
  });

  it('a row whose only key is dropped: the preview and the commit agree — both create it and both report the drop', async () => {
    const b = await boot();
    const door = await createDoorDrops(b, { doubled: 5 });
    expect(door).toEqual([COMPUTED]);
    const dry = await b.importRows([{ id: 'only', doubled: 5 }], { dryRun: true });
    const commit = await b.importRows([{ id: 'only', doubled: 5 }], { dryRun: false });
    expect(dry.body.results[0]).toEqual({ row: 1, ok: true, action: 'created', droppedFields: door });
    expect(commit.body.results[0]).toEqual({ row: 1, ok: true, action: 'created', id: 'only', droppedFields: door });
    expect(await b.engine.findOne(OBJECT, { where: { id: 'only' } })).toMatchObject({ id: 'only', title: null, doubled: null });
  });

  it('each row carries its OWN drops: a clean row between two stripped rows carries none', async () => {
    const b = await boot();
    const rows = [{ id: 'a', title: 'a', doubled: 1 }, { id: 'b', title: 'b' }, { id: 'c', title: 'c', ro: 'x' }];
    for (const dryRun of [true, false]) {
      const r = await b.importRows(rows, { dryRun });
      expect(r.body, `dryRun=${dryRun}`).toMatchObject({ ok: 3, errors: 0, created: 3 });
      expect(r.body.results.map((x: any) => x.droppedFields), `dryRun=${dryRun}`).toEqual([[COMPUTED], undefined, [READONLY]]);
    }
  });
});

describe('[#20701] an upsert row matched to an existing record: the update\'s own report', () => {
  it('formula and readonly keys: the dry run and the commit both report what PATCH reports', async () => {
    const b = await boot();
    const patch = await b.call('PATCH', '/api/v1/data/:object/:id', { doubled: 9, ro: 'z' }, { object: OBJECT, id: 'e1' });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.droppedFields).toEqual([COMPUTED, READONLY]);

    for (const dryRun of [true, false]) {
      const r = await b.importRows([{ id: 'e1', doubled: 9, ro: 'z' }], { dryRun, upsert: true });
      expect(r.body, `dryRun=${dryRun}`).toMatchObject({ ok: 1, errors: 0, updated: 1 });
      expect(r.body.results[0], `dryRun=${dryRun}`).toEqual({ row: 1, ok: true, action: 'updated', id: 'e1', droppedFields: patch.body.droppedFields });
    }
  });

  it('a readonlyWhen-locked record: the commit reports readonly_when as PATCH does; the update-mode preview cannot (the named limit)', async () => {
    const b = await boot();
    const patch = await b.call('PATCH', '/api/v1/data/:object/:id', { locked: 'NEW' }, { object: OBJECT, id: 'e2' });
    expect(patch.body.droppedFields).toEqual([READONLY_WHEN]);

    const commit = await b.importRows([{ id: 'e2', locked: 'NEW2' }], { dryRun: false, upsert: true });
    expect(commit.body.results[0]).toEqual({ row: 1, ok: true, action: 'updated', id: 'e2', droppedFields: [READONLY_WHEN] });
    expect(await b.engine.findOne(OBJECT, { where: { id: 'e2' } })).toMatchObject({ locked: 'L' });

    // The named limit: `validateData` in `update` mode runs no `readonlyWhen`
    // strip. Closing it flips this assertion on purpose.
    const dry = await b.importRows([{ id: 'e2', locked: 'NEW2' }], { dryRun: true, upsert: true });
    expect(dry.body.results[0]).toEqual({ row: 1, ok: true, action: 'updated', id: 'e2' });
  });
});

describe('[#20701] the async import job\'s results carry the same per-row report', () => {
  it.each([false, true])('dryRun=%s: the results route returns each row\'s drops, and the clean row none', async (dryRun) => {
    const b = await boot();
    const rows = await b.runJob([{ id: 'j1', title: 'f', doubled: 3 }, { id: 'j2', title: 'r', ro: 'x' }, { id: 'j3', title: 'w' }], dryRun);
    const byRow = (n: number) => rows.find((r) => r.row === n);
    expect(byRow(1)).toMatchObject({ ok: true, action: 'created', droppedFields: [COMPUTED] });
    expect(byRow(2)).toMatchObject({ ok: true, action: 'created', droppedFields: [READONLY] });
    expect(byRow(3)).toMatchObject({ ok: true, action: 'created' });
    expect(byRow(3)).not.toHaveProperty('droppedFields');
  });
});
