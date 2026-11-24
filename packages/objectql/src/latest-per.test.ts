// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The engine-internal one-row-per-group request (`latest-per.ts`): a `find`
 * carrying {@link LATEST_PER} is handed to a SQL driver as ONE statement with
 * the window directive on the composed AST — after every middleware, over the
 * `where` they composed — and its partition and order fields are sort keys to
 * every door before that. Wherever the engine cannot serve it in the driver's
 * own statement, it is refused `INVALID_QUERY` / 400 with nothing read.
 *
 * A recording driver stands in for the SQL family: it answers to the name the
 * engine names (or not) and records every call. What `driver-sql` compiles
 * the directive to is pinned in that package; the whole read over MCP, under
 * real row and field security, in the dogfood harness.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { LATEST_PER, LATEST_PER_DIRECTIVE, type LatestPerRequest } from './latest-per.js';

const DEAL = 'lp_deal';

const DEAL_OBJECT = {
  name: DEAL,
  label: 'Deal',
  fields: {
    account: { name: 'account', type: 'text' },
    owner: { name: 'owner', type: 'text' },
    stage: { name: 'stage', type: 'text' },
    close_date: { name: 'close_date', type: 'date' },
    secret_rank: { name: 'secret_rank', type: 'number' },
    score: { name: 'score', type: 'formula', expression: '1', returnType: 'number' },
    tags: { name: 'tags', type: 'select', multiple: true, options: [{ label: 'A', value: 'a' }] },
  },
};

interface SeenCall { verb: string; object: string; ast: any }

function makeRecordingDriver(name: string, extra: Record<string, unknown> = {}) {
  const calls: SeenCall[] = [];
  const driver: any = {
    name, version: '0.0.0', supports: { readableIdsLeaf: true }, ...extra,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) { calls.push({ verb: 'find', object: o, ast }); return [{ id: 'd1', account: 'a1' }]; },
    async findOne(o: string, ast: any) { calls.push({ verb: 'findOne', object: o, ast }); return null; },
    async count(o: string, ast: any) { calls.push({ verb: 'count', object: o, ast }); return 0; },
    async aggregate(o: string, ast: any) { calls.push({ verb: 'aggregate', object: o, ast }); return []; },
    async create(_o: string, data: Record<string, unknown>) { return { ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { ...data, id }; },
    async delete() { return true; },
    async beginTransaction() { return {}; },
    async commit() {}, async rollback() {},
  };
  return { driver, calls };
}

type Thrown = (Error & { code?: string; status?: number; param?: string; field?: string }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e: any) => e);

const newest = (over: Partial<LatestPerRequest> = {}): LatestPerRequest => ({
  by: ['account'],
  orderBy: [{ field: 'close_date', order: 'desc' }],
  ...over,
});

async function makeEngine(driverName: string, extra?: Record<string, unknown>) {
  const rec = makeRecordingDriver(driverName, extra);
  const engine = new ObjectQL();
  engine.registerDriver(rec.driver, true);
  await engine.init();
  engine.registry.registerObject(DEAL_OBJECT as any, 'test');
  return { engine, rec };
}

describe('latest per group — one driver statement, the window over the composed read', () => {
  let engine: ObjectQL;
  let rec: ReturnType<typeof makeRecordingDriver>;

  beforeEach(async () => {
    ({ engine, rec } = await makeEngine('com.objectstack.driver.sql'));
  });

  it('one driver call: the directive rides the composed AST, after the middleware\'s injected where; the outcome is set', async () => {
    // A read middleware injecting a row scope, as row-level security does.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (op.object === DEAL) op.ast.where = op.ast.where ? { $and: [op.ast.where, { owner: 'u_me' }] } : { owner: 'u_me' };
      await next();
    });
    const req = newest();
    const rows = await engine.find(DEAL, { where: { stage: 'open' }, limit: 5 }, { [LATEST_PER]: req } as never);

    expect(rows.map((r: any) => r.id)).toEqual(['d1']);
    expect(req.outcome).toEqual({ kind: 'served' });
    const finds = rec.calls.filter((c) => c.verb === 'find');
    expect(finds).toHaveLength(1);
    const ast = finds[0].ast;
    expect(ast[LATEST_PER_DIRECTIVE]).toEqual({ by: ['account'], orderBy: [{ field: 'close_date', order: 'desc' }] });
    expect(ast.where).toEqual({ $and: [{ stage: 'open' }, { owner: 'u_me' }] });
    expect(ast.limit).toBe(5);
    // The judged sort keys are taken back off: the caller sent no orderBy.
    expect(ast.orderBy).toBeUndefined();
  });

  it('the middleware chain sees every partition and order field as a sort key, after the caller\'s own', async () => {
    let seen: unknown;
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (op.object === DEAL) seen = op.ast.orderBy;
      await next();
    });
    await engine.find(DEAL, { orderBy: [{ field: 'stage', order: 'asc' }] }, {
      [LATEST_PER]: newest({ by: ['account', 'owner'] }),
    } as never);
    expect(seen).toEqual([
      { field: 'stage', order: 'asc' },
      { field: 'account', order: 'asc' },
      { field: 'owner', order: 'asc' },
      { field: 'close_date', order: 'desc' },
    ]);
    // …and the driver gets the caller's own ORDER BY only.
    expect(rec.calls.find((c) => c.verb === 'find')?.ast.orderBy).toEqual([{ field: 'stage', order: 'asc' }]);
  });

  it('a caller\'s own sort key on a partition field stays on the statement', async () => {
    await engine.find(DEAL, { orderBy: [{ field: 'account', order: 'desc' }] }, { [LATEST_PER]: newest() } as never);
    expect(rec.calls.find((c) => c.verb === 'find')?.ast.orderBy).toEqual([{ field: 'account', order: 'desc' }]);
  });

  it('a field gate that refuses a sort key refuses a hidden partition field before the driver is asked', async () => {
    // Stands in for the field-level predicate guard: it refuses a hidden
    // field wherever it appears as a sort key.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      const sorted = (op.ast.orderBy ?? []).map((s: any) => s.field);
      if (op.object === DEAL && sorted.includes('secret_rank')) {
        const err: any = new Error('hidden field');
        err.code = 'PERMISSION_DENIED';
        err.status = 403;
        throw err;
      }
      await next();
    });
    const req = newest({ by: ['secret_rank'] });
    const err = await refusalOf(engine.find(DEAL, {}, { [LATEST_PER]: req } as never));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(rec.calls).toHaveLength(0);
    expect(req.outcome).toBeUndefined();
  });

  it('no request, no directive: an ordinary find is unchanged', async () => {
    await engine.find(DEAL, { orderBy: [{ field: 'stage', order: 'asc' }] });
    const ast = rec.calls.find((c) => c.verb === 'find')?.ast;
    expect(ast[LATEST_PER_DIRECTIVE]).toBeUndefined();
    expect(ast.orderBy).toEqual([{ field: 'stage', order: 'asc' }]);
  });
});

describe('latest per group — refused INVALID_QUERY / 400 with nothing read', () => {
  const refusedOn = async (name: string, extra?: Record<string, unknown>) => {
    const { engine, rec } = await makeEngine(name, extra);
    const req = newest();
    const err = await refusalOf(engine.find(DEAL, {}, { [LATEST_PER]: req } as never));
    return { err, calls: rec.calls.length, outcome: req.outcome };
  };

  for (const [label, name, extra] of [
    ['the in-memory driver', 'com.objectstack.driver.memory', undefined],
    ['MongoDB', 'com.objectstack.driver.mongodb', undefined],
    ['the Turso driver on its remote face', 'com.objectstack.driver.turso', { transportMode: 'remote' }],
    ['the Turso driver with no face it names', 'com.objectstack.driver.turso', undefined],
  ] as const) {
    it(`on ${label}`, async () => {
      const { err, calls, outcome } = await refusedOn(name, extra);
      expect({ code: err?.code, status: err?.status, param: err?.param }).toEqual({ code: 'INVALID_QUERY', status: 400, param: 'latestPer' });
      expect(err?.message).toMatch(/nothing was read/);
      expect(calls).toBe(0);
      expect(outcome).toBeUndefined();
    });
  }

  for (const [label, name, extra] of [
    ['the WASM SQLite driver', 'com.objectstack.driver.sqlite-wasm', undefined],
    ['the Turso driver on its local face', 'com.objectstack.driver.turso', { transportMode: 'local' }],
    ['the Turso driver on its replica face', 'com.objectstack.driver.turso', { transportMode: 'replica' }],
  ] as const) {
    it(`control: served on ${label}`, async () => {
      const { err, calls, outcome } = await refusedOn(name, extra);
      expect(err).toBeNull();
      expect(calls).toBe(1);
      expect(outcome).toEqual({ kind: 'served' });
    });
  }

  it('on an object with an afterFind hook', async () => {
    const { engine, rec } = await makeEngine('com.objectstack.driver.sql');
    engine.registerHook('afterFind', async () => {}, { object: DEAL });
    const err = await refusalOf(engine.find(DEAL, {}, { [LATEST_PER]: newest() } as never));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_QUERY', status: 400 });
    expect(err?.message).toMatch(/afterFind/);
    expect(rec.calls).toHaveLength(0);
  });

  it('on an object with an object-keyed read middleware', async () => {
    const { engine, rec } = await makeEngine('com.objectstack.driver.sql');
    engine.registerMiddleware(async (_op: any, next: () => Promise<void>) => { await next(); }, { object: DEAL });
    const err = await refusalOf(engine.find(DEAL, {}, { [LATEST_PER]: newest() } as never));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_QUERY', status: 400 });
    expect(err?.message).toMatch(/object-keyed read middleware/);
    expect(rec.calls).toHaveLength(0);
  });

  for (const [label, req, field] of [
    ['an unknown partition field', newest({ by: ['nope'] }), 'nope'],
    ['a dotted partition field', newest({ by: ['account.name'] }), 'account.name'],
    ['a formula order field', newest({ orderBy: [{ field: 'score', order: 'desc' }] }), 'score'],
    ['a multi-value partition field', newest({ by: ['tags'] }), 'tags'],
  ] as const) {
    it(`${label}: INVALID_FIELD / 400`, async () => {
      const { engine, rec } = await makeEngine('com.objectstack.driver.sql');
      const err = await refusalOf(engine.find(DEAL, {}, { [LATEST_PER]: req } as never));
      expect({ code: err?.code, status: err?.status, field: err?.field }).toEqual({ code: 'INVALID_FIELD', status: 400, field });
      expect(rec.calls).toHaveLength(0);
    });
  }

  for (const [label, req] of [
    ['no partition field', { by: [], orderBy: [{ field: 'close_date', order: 'desc' }] }],
    ['four partition fields', { by: ['account', 'owner', 'stage', 'id'], orderBy: [{ field: 'close_date', order: 'desc' }] }],
    ['no order key', { by: ['account'], orderBy: [] }],
    ['an order that is neither asc nor desc', { by: ['account'], orderBy: [{ field: 'close_date', order: 'newest' }] }],
    ['a partition field named twice', { by: ['account', 'account'], orderBy: [{ field: 'close_date', order: 'desc' }] }],
  ] as const) {
    it(`a request built wrong (${label})`, async () => {
      const { engine, rec } = await makeEngine('com.objectstack.driver.sql');
      const err = await refusalOf(engine.find(DEAL, {}, { [LATEST_PER]: req } as never));
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_QUERY', status: 400 });
      expect(rec.calls).toHaveLength(0);
    });
  }
});
