// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `internal: true` evaluate refusal on the ENGINE's own read path, against
 * a REAL {@link ObjectQL} over a minimal recording driver, and on a real
 * kernel that composes the engine plugin with no `protocol` service at all.
 *
 * Every refusal is the ADR-0112 `INVALID_FIELD` / 400 envelope, located at the
 * object, the field and the position, and leaves the driver unasked. A system
 * context is served (the server's own lookups match on such a column), every
 * ordinary field is served, and the public face (`assertNoInternalFieldEvaluated`,
 * the `QueryEvaluationGate` member) binds a system context too and runs a
 * door's relation-target hook before it judges that hop.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { EngineAggregateOptions, EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

function makeRecordingDriver() {
  const rows = new Map<string, Record<string, unknown>[]>();
  const calls: string[] = [];
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (v !== null && typeof v === 'object') continue;
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      calls.push(`find:${object}`);
      const found = (rows.get(object) ?? []).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? found.slice(0, ast.limit) : found;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      calls.push(`findOne:${object}`);
      const r = (rows.get(object) ?? []).find((x) => matches(x, ast?.where));
      return r ? { ...r } : null;
    },
    async count(object: string, ast: any) {
      calls.push(`count:${object}`);
      return (rows.get(object) ?? []).filter((r) => matches(r, ast?.where)).length;
    },
    async aggregate(object: string) {
      calls.push(`aggregate:${object}`);
      return [{ n: (rows.get(object) ?? []).length }];
    },
    async create(object: string, data: Record<string, unknown>) {
      const list = rows.get(object) ?? [];
      const row = { id: `r${list.length + 1}`, ...data };
      list.push(row);
      rows.set(object, list);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      calls.push(`update:${object}`);
      return { id, ...data };
    },
    async updateMany(object: string) { calls.push(`updateMany:${object}`); return 0; },
    async delete(object: string) { calls.push(`delete:${object}`); return true; },
    async deleteMany(object: string) { calls.push(`deleteMany:${object}`); return 0; },
    async upsert(_o: string, data: Record<string, unknown>) { return data; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rows, calls };
}

/** The related object: its own flagged column, reached through a lookup and an expand. */
const holder = {
  name: 'ifg_holder', label: 'Holder',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    holder_digest: { name: 'holder_digest', label: 'Digest', type: 'text' as const, internal: true },
  },
};

/** The flagged column is a one-way digest in an ordinary `text` column, the shape the flag exists for. */
const vault = {
  name: 'ifg_vault', label: 'Vault',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    rank: { name: 'rank', label: 'Rank', type: 'number' as const },
    digest: { name: 'digest', label: 'Digest', type: 'text' as const, internal: true },
    holder: { name: 'holder', label: 'Holder', type: 'lookup' as const, reference: 'ifg_holder' },
  },
};

const MEMBER: EngineQueryOptions['context'] = { userId: 'u1' };
const ADMIN: EngineQueryOptions['context'] = { userId: 'u_admin', roles: ['admin'], isPlatformAdmin: true } as never;
const SYSTEM: EngineQueryOptions['context'] = { isSystem: true };
const COUNT = { function: 'count' as const, alias: 'n' };

async function buildEngine() {
  const engine = new ObjectQL();
  const recording = makeRecordingDriver();
  engine.registerDriver(recording.driver, true);
  await engine.init();
  engine.registry.registerObject(holder as any);
  engine.registry.registerObject(vault as any);
  recording.rows.set('ifg_holder', [{ id: 'h1', name: 'Pat', holder_digest: 'hd1' }]);
  recording.rows.set('ifg_vault', [{ id: 'v1', name: 'alpha', rank: 1, digest: 'd1', holder: 'h1' }]);
  return { engine, ...recording };
}

/** The ADR-0112 envelope, asserted on the thrown error, never on a bare throw. */
async function expectRefused(run: () => unknown, object: string, field: string, param: string) {
  let thrown: any;
  try { await run(); } catch (e) { thrown = e; }
  expect(thrown, 'the call was refused').toBeDefined();
  expect(thrown.code).toBe('INVALID_FIELD');
  expect(thrown.status).toBe(400);
  expect(thrown.httpStatus).toBe(400);
  expect(thrown.object).toBe(object);
  expect(thrown.field).toBe(field);
  expect(thrown.param).toBe(param);
  return thrown;
}

describe('internal: true — the engine read path refuses every evaluate position for a non-system caller', () => {
  let ctx: Awaited<ReturnType<typeof buildEngine>>;
  beforeEach(async () => { ctx = await buildEngine(); });

  const wheres: Array<[string, EngineQueryOptions['where']]> = [
    ['equality', { digest: 'd1' }],
    ['$eq', { digest: { $eq: 'd1' } }],
    ['$startsWith', { digest: { $startsWith: 'd' } }],
    ['under $or', { $or: [{ name: '__none__' }, { digest: 'd1' }] }],
    ['under $not', { $not: { digest: 'd1' } }],
    ['a presence check (no carve-out, unlike the credential guard)', { digest: { $null: false } }],
    ['a cross-field comparand', { name: { $eq: { $field: 'digest' } } }],
    ['the array form', [['digest', '=', 'd1']]],
  ];
  for (const [label, where] of wheres) {
    for (const [persona, context] of Object.entries({ member: MEMBER, admin: ADMIN })) {
      it(`find refuses a filter on it (${label}) — ${persona}, driver never asked`, async () => {
        await expectRefused(() => ctx.engine.find('ifg_vault', { where, context }), 'ifg_vault', 'digest', 'filter');
        expect(ctx.calls).toEqual([]);
      });
    }
  }

  it('a context-less engine call is judged like any non-system caller', async () => {
    await expectRefused(() => ctx.engine.find('ifg_vault', { where: { digest: 'd1' } }), 'ifg_vault', 'digest', 'filter');
  });

  it('refuses a sort, on find and on findOne', async () => {
    await expectRefused(
      () => ctx.engine.find('ifg_vault', { orderBy: [{ field: 'digest', order: 'asc' }], context: MEMBER }), 'ifg_vault', 'digest', 'sort',
    );
    await expectRefused(
      () => ctx.engine.findOne('ifg_vault', { where: { name: 'alpha' }, orderBy: [{ field: 'digest', order: 'desc' }], context: MEMBER }),
      'ifg_vault', 'digest', 'sort',
    );
    expect(ctx.calls).toEqual([]);
  });

  it('refuses on findOne and count', async () => {
    await expectRefused(() => ctx.engine.findOne('ifg_vault', { where: { digest: 'd1' }, context: MEMBER }), 'ifg_vault', 'digest', 'filter');
    await expectRefused(() => ctx.engine.count('ifg_vault', { where: { digest: 'd1' }, context: MEMBER }), 'ifg_vault', 'digest', 'filter');
    expect(ctx.calls).toEqual([]);
  });

  it('refuses every aggregate position — where, group key, operand, per-aggregation filter — in the door\'s words', async () => {
    const shapes: Array<[EngineAggregateOptions, string]> = [
      [{ where: { digest: 'd1' }, aggregations: [COUNT] }, 'filter'],
      [{ groupBy: ['digest'], aggregations: [COUNT] }, 'groupBy'],
      [{ groupBy: [{ field: 'digest' }] as never, aggregations: [COUNT] }, 'groupBy'],
      [{ aggregations: [{ function: 'max', field: 'digest', alias: 'm' }] }, 'aggregations[0].field'],
      [{ aggregations: [{ ...COUNT, filter: { digest: 'd1' } }] }, 'aggregations[0].filter'],
    ];
    for (const [query, param] of shapes) {
      const err = await expectRefused(() => ctx.engine.aggregate('ifg_vault', query, { context: MEMBER }), 'ifg_vault', 'digest', param);
      // The door's sentence, not the aggregate guard's.
      expect(err.message).toMatch(/is declared `internal: true`/);
    }
    expect(ctx.calls).toEqual([]);
  });

  it('refuses a nested-relation condition on the related object\'s flagged column, located at the hop', async () => {
    await expectRefused(
      () => ctx.engine.find('ifg_vault', { where: { holder: { holder_digest: 'hd1' } }, context: MEMBER }),
      'ifg_holder', 'holder_digest', 'filter.holder',
    );
    expect(ctx.calls).toEqual([]);
  });

  it('refuses an expand entry\'s own filter and sort on the target\'s flagged column', async () => {
    await expectRefused(
      () => ctx.engine.find('ifg_vault', { expand: { holder: { object: 'ifg_holder', where: { holder_digest: 'hd1' } } }, context: MEMBER } satisfies EngineQueryOptions),
      'ifg_holder', 'holder_digest', "expand['holder'].filter",
    );
    await expectRefused(
      () => ctx.engine.find('ifg_vault', { expand: { holder: { object: 'ifg_holder', orderBy: [{ field: 'holder_digest' }] } }, context: MEMBER } satisfies EngineQueryOptions),
      'ifg_holder', 'holder_digest', "expand['holder'].sort",
    );
    expect(ctx.calls).toEqual([]);
  });
});

describe('internal: true — what the engine path still serves', () => {
  let ctx: Awaited<ReturnType<typeof buildEngine>>;
  beforeEach(async () => { ctx = await buildEngine(); });

  it('a system context is served unchanged — the server\'s own lookups match on a flagged column', async () => {
    const rows = await ctx.engine.find('ifg_vault', { where: { digest: 'd1' }, context: SYSTEM });
    expect(rows.map((r: any) => r.id)).toEqual(['v1']);
    // Matched on, and still never returned.
    expect(rows[0]).not.toHaveProperty('digest');
    await expect(ctx.engine.findOne('ifg_vault', { where: { digest: 'd1' }, context: SYSTEM })).resolves.toMatchObject({ id: 'v1' });
    await expect(ctx.engine.count('ifg_vault', { where: { digest: 'd1' }, context: SYSTEM })).resolves.toBe(1);
    await expect(ctx.engine.find('ifg_vault', { orderBy: [{ field: 'digest', order: 'asc' }], context: SYSTEM })).resolves.toHaveLength(1);
    expect(ctx.calls).toEqual(['find:ifg_vault', 'findOne:ifg_vault', 'count:ifg_vault', 'find:ifg_vault']);
  });

  it('every ordinary field filters, sorts, counts and aggregates for a member', async () => {
    const rows = await ctx.engine.find('ifg_vault', {
      where: { name: 'alpha', holder: 'h1' }, orderBy: [{ field: 'name', order: 'asc' }], context: MEMBER,
    });
    expect(rows.map((r: any) => r.id)).toEqual(['v1']);
    expect(rows[0]).not.toHaveProperty('digest');
    await expect(ctx.engine.count('ifg_vault', { where: { name: 'alpha' }, context: MEMBER })).resolves.toBe(1);
    await expect(ctx.engine.aggregate('ifg_vault', {
      groupBy: ['name'], aggregations: [{ function: 'max', field: 'rank', alias: 'm', filter: { name: 'alpha' } }],
    }, { context: MEMBER })).resolves.toBeInstanceOf(Array);
    // Reached the driver (natively or through the engine's in-memory fold).
    expect(ctx.calls.length).toBeGreaterThan(2);
  });
});

describe('internal: true — the public face (QueryEvaluationGate) binds every caller and runs a door\'s hop hook first', () => {
  let ctx: Awaited<ReturnType<typeof buildEngine>>;
  beforeEach(async () => { ctx = await buildEngine(); });

  it('refuses for every caller — the face takes no context, so a system caller at a door is judged too', () => {
    let thrown: any;
    try { ctx.engine.assertNoInternalFieldEvaluated('ifg_vault', { where: { digest: 'd1' } }); } catch (e) { thrown = e; }
    expect(thrown).toMatchObject({ code: 'INVALID_FIELD', status: 400, object: 'ifg_vault', field: 'digest', param: 'filter' });
  });

  it('answers exactly what the engine path answers, message included', async () => {
    const shapes: Array<Record<string, unknown>> = [
      { where: { digest: { $startsWith: 'd' } } },
      { orderBy: [{ field: 'digest', order: 'asc' }] },
      { where: { holder: { holder_digest: 'hd1' } } },
    ];
    for (const query of shapes) {
      let face: any;
      try { ctx.engine.assertNoInternalFieldEvaluated('ifg_vault', query); } catch (e) { face = e; }
      let path: any;
      try { await ctx.engine.find('ifg_vault', { ...query, context: MEMBER } as EngineQueryOptions); } catch (e) { path = e; }
      const envelope = (e: any) => ({ code: e?.code, status: e?.status, object: e?.object, field: e?.field, param: e?.param, message: e?.message });
      expect(face).toBeDefined();
      expect(envelope(face)).toEqual(envelope(path));
    }
  });

  it('calls beforeRelationTarget at each hop before judging it, and lets what it throws win', () => {
    const seen: Array<[string, string]> = [];
    ctx.engine.assertNoInternalFieldEvaluated('ifg_vault', { where: { holder: { name: 'Pat' } } }, {
      beforeRelationTarget: (target, param) => { seen.push([target, param]); },
    });
    expect(seen).toEqual([['ifg_holder', 'filter.holder']]);

    const hop = Object.assign(new Error('not exposed'), { code: 'OBJECT_API_DISABLED', status: 404 });
    expect(() => ctx.engine.assertNoInternalFieldEvaluated('ifg_vault', { where: { holder: { holder_digest: 'hd1' } } }, {
      beforeRelationTarget: () => { throw hop; },
    })).toThrow(hop);
  });

  it('CONTROL — ordinary fields in every position pass the face', () => {
    expect(() => ctx.engine.assertNoInternalFieldEvaluated('ifg_vault', {
      where: { name: { $startsWith: 'a' }, holder: { name: 'Pat' } },
      orderBy: [{ field: 'name', order: 'asc' }],
      groupBy: ['name'],
      aggregations: [{ function: 'max', field: 'rank', alias: 'm', filter: { name: 'alpha' } }],
      expand: { holder: { object: 'ifg_holder', where: { name: 'Pat' }, orderBy: [{ field: 'name' }] } },
    })).not.toThrow();
  });
});

describe('internal: true — a kernel that registers no protocol service still refuses', () => {
  let kernel: ObjectKernel;
  beforeEach(() => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  });
  afterEach(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  it('registerProtocol: false without MetadataProtocolPlugin: the objectql slot refuses a member and serves the system context', async () => {
    await kernel.use(new ObjectQLPlugin({ registerProtocol: false }));
    await kernel.bootstrap();
    expect(() => kernel.getService('protocol')).toThrow();

    const engine = kernel.getService<ObjectQL>('objectql');
    const recording = makeRecordingDriver();
    engine.registerDriver(recording.driver, true);
    engine.registry.registerObject(holder as any);
    engine.registry.registerObject(vault as any);
    recording.rows.set('ifg_vault', [{ id: 'v1', name: 'alpha', rank: 1, digest: 'd1', holder: 'h1' }]);

    await expectRefused(
      () => engine.find('ifg_vault', { where: { digest: { $startsWith: 'd' } }, context: MEMBER }), 'ifg_vault', 'digest', 'filter',
    );
    await expectRefused(
      () => engine.aggregate('ifg_vault', { groupBy: ['digest'], aggregations: [COUNT] }, { context: MEMBER }), 'ifg_vault', 'digest', 'groupBy',
    );
    expect(recording.calls).toEqual([]);
    await expect(engine.find('ifg_vault', { where: { digest: 'd1' }, context: SYSTEM })).resolves.toHaveLength(1);
    await expect(engine.find('ifg_vault', { where: { name: 'alpha' }, context: MEMBER })).resolves.toHaveLength(1);
  });
});
