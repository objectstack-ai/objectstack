// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27465] A field that holds a list or a structured value cannot be a match
 * key. An update or upsert import whose `matchFields` (or whose named mapping's
 * `upsertKey`) names one is refused at the door with `400 INVALID_REQUEST`
 * naming the field, before any row is read, matched or written, on the dry run
 * and the commit alike. Through the real `POST /data/:object/import` route
 * over a real `SqlDriver` (better-sqlite3 `:memory:`).
 *
 * The card's object: a task with a `multiple: true` lookup (`work_object`).
 * At the base the door accepted the request and every row failed on the
 * driver's raw SQL-binding refusal, because the matcher put the coerced id
 * array straight into an implicit `$eq`.
 *
 * Which fields count is one rule, the population stored as a JSON column:
 * `isMultiValueField` (a multi-capable type with `multiple: true`, or an
 * inherently multi option type: `multiselect`, `checkboxes`, `tags`) and
 * `STRUCTURED_JSON_TYPES` (`json`, `address`, …). A scalar key keeps working,
 * with the multi-value field written as an ordinary column, and an insert
 * import, which matches nothing, is not judged.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const PROJECT = {
  name: 'pm_project_27465', label: 'Project', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
  },
};

const TASK = {
  name: 'pm_task_27465', label: 'Task', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    code: { name: 'code', type: 'text' as const, label: 'Code' },
    title: { name: 'title', type: 'text' as const, label: 'Title' },
    work_object: {
      name: 'work_object', type: 'lookup' as const, label: 'Work object',
      reference: PROJECT.name, multiple: true, displayField: 'name',
    },
    topics: {
      name: 'topics', type: 'multiselect' as const, label: 'Topics',
      options: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }],
    },
    labels: { name: 'labels', type: 'tags' as const, label: 'Labels' },
    meta: { name: 'meta', type: 'json' as const, label: 'Meta' },
  },
};

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  }), true);
  await engine.init();
  for (const o of [PROJECT, TASK]) engine.registry.registerObject(o as any);
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
  await engine.insert(PROJECT.name, { id: 'prj_a', name: 'Apollo' });
  await engine.insert(PROJECT.name, { id: 'prj_b', name: 'Borealis' });
  await engine.insert(TASK.name, { id: 't1', code: 'T-1', title: 'old title', work_object: ['prj_a'] });
  // Every read and write the import could make goes through these three.
  const reads = vi.spyOn(protocol as any, 'findData');
  const writes = [vi.spyOn(protocol as any, 'updateData'), vi.spyOn(protocol as any, 'createManyData')];
  const importInto = async (body: Record<string, unknown>) => {
    const res = makeRes();
    await route.handler({ params: { object: TASK.name }, body } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const tasks = async () =>
    (await engine.find(TASK.name, {}))
      .map((r: any) => ({ id: r.id, code: r.code, title: r.title, work_object: r.work_object }))
      .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
  return { engine, importInto, tasks, reads, writes };
}

const csvOf = (...lines: string[]) => ['Code,Title,Work object', ...lines].join('\n');
const MAPPING = { Code: 'code', Title: 'title', 'Work object': 'work_object' };
const CSV = csvOf('T-1,new title,Apollo;Borealis', 'T-2,second,Borealis');

describe('[#27465] a multi-value field named as a match key is refused at the import door', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { ctx = await boot(); });

  const expectRefusedUntouched = async (res: { status: number; body: any }, ...fields: string[]) => {
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
    for (const f of fields) expect(res.body.error).toContain(`"${f}"`);
    expect(res.body.results).toBeUndefined();
    expect(ctx.reads).not.toHaveBeenCalled();
    for (const w of ctx.writes) expect(w).not.toHaveBeenCalled();
    expect(await ctx.tasks()).toEqual([{ id: 't1', code: 'T-1', title: 'old title', work_object: ['prj_a'] }]);
  };

  it.each([
    ['upsert, commit', { writeMode: 'upsert' }],
    ['upsert, dry run', { writeMode: 'upsert', dryRun: true }],
    ['update, commit', { writeMode: 'update' }],
    ['update, dry run', { writeMode: 'update', dryRun: true }],
  ])('the card: a `multiple: true` lookup as the key (%s)', async (_label, extra) => {
    const res = await ctx.importInto({ format: 'csv', csv: CSV, mapping: MAPPING, matchFields: ['work_object'], ...extra });
    await expectRefusedUntouched(res, 'work_object');
  });

  it('the lookup beside a scalar in one key set, and as a later ordered key set, is refused all the same', async () => {
    await expectRefusedUntouched(
      await ctx.importInto({ format: 'csv', csv: CSV, mapping: MAPPING, writeMode: 'upsert', matchFields: ['code', 'work_object'] }),
      'work_object',
    );
    await expectRefusedUntouched(
      await ctx.importInto({ format: 'csv', csv: CSV, mapping: MAPPING, writeMode: 'upsert', matchFields: [['code'], ['work_object']] }),
      'work_object',
    );
  });

  it('every other JSON-stored kind is refused too, and every offending field is named in one answer', async () => {
    const csv = ['Code,Topics,Labels,Meta', 'T-1,Red,x,"{""a"":1}"'].join('\n');
    const mapping = { Code: 'code', Topics: 'topics', Labels: 'labels', Meta: 'meta' };
    for (const f of ['topics', 'labels', 'meta']) {
      await expectRefusedUntouched(
        await ctx.importInto({ format: 'csv', csv, mapping, writeMode: 'upsert', matchFields: ['code', f] }),
        f,
      );
    }
    await expectRefusedUntouched(
      await ctx.importInto({ format: 'csv', csv, mapping, writeMode: 'update', matchFields: [['topics'], ['labels', 'meta']] }),
      'topics', 'labels', 'meta',
    );
  });

  it('a named mapping whose upsertKey names the lookup is refused the same way', async () => {
    ctx.engine.registry.registerItem('mapping', {
      name: 'task_feed_27465', label: 'Task feed', sourceFormat: 'csv', targetObject: TASK.name,
      fieldMapping: [
        { source: 'Code', target: 'code', transform: 'none' },
        { source: 'Title', target: 'title', transform: 'none' },
        { source: 'Work object', target: 'work_object', transform: 'none' },
      ],
      mode: 'upsert',
      upsertKey: ['work_object'],
    } as any, 'name');
    await expectRefusedUntouched(
      await ctx.importInto({ format: 'csv', csv: CSV, mappingName: 'task_feed_27465' }),
      'work_object',
    );
  });

  it('preserved: a scalar key upserts, writing the lookup as an ordinary column', async () => {
    const res = await ctx.importInto({ format: 'csv', csv: CSV, mapping: MAPPING, writeMode: 'upsert', matchFields: ['code'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, ok: 2, errors: 0, created: 1, updated: 1 });
    expect(ctx.reads).toHaveBeenCalled();
    expect(await ctx.tasks()).toEqual([
      { id: 't1', code: 'T-1', title: 'new title', work_object: ['prj_a', 'prj_b'] },
      { id: expect.any(String), code: 'T-2', title: 'second', work_object: ['prj_b'] },
    ]);
  });

  it('preserved: an insert import matches nothing, so a matchFields it carries is not judged', async () => {
    const res = await ctx.importInto({ format: 'csv', csv: csvOf('T-9,inserted,Apollo'), mapping: MAPPING, writeMode: 'insert', matchFields: ['work_object'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, ok: 1, created: 1 });
  });
});
